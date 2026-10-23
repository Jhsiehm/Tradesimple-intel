import { beginResearchTrial, finishResearchTrial, researchTrialReceipt } from "./research-trials.mjs";
import { requireAuditedSource, INTEGRITY_VERSION } from "./research-integrity.mjs";
import { cleanConvergence, runConvergence } from "../../shared/convergence.mjs";
import { dayOf } from "../../shared/backtest.mjs";
import { researchStore, getExperiment, getRun, putRun, newId, hashOf } from "./research-store.mjs";
import { CONVERGENCE_ENGINE } from "./research-replay.mjs";
function storedPlan(db, id) {
  researchStore(db);
  const row = db.prepare("SELECT body, body_hash FROM research.convergence_plans WHERE id=?").get(id);
  if (!row) throw new Error("Convergence plan not found.");
  if (hashOf(row.body) !== row.body_hash) throw new Error("Convergence plan checksum mismatch.");
  return JSON.parse(row.body);
}
export function listPlans(db) {
  researchStore(db);
  return db
    .prepare("SELECT id FROM research.convergence_plans ORDER BY created_at DESC, id DESC LIMIT 500")
    .all()
    .map(({ id }) => {
      const p = storedPlan(db, id);
      return {
        id,
        title: p.title,
        createdAt: p.createdAt,
        evaluated: !!db.prepare("SELECT 1 FROM research.convergence_evaluations WHERE plan_id=?").get(id),
      };
    });
}
function exposure(db, spec) {
  return db
    .prepare("SELECT plan_id FROM research.convergence_evaluations")
    .all()
    .filter((row) => {
      const p = storedPlan(db, row.plan_id);
      return (
        p.spec.split <= spec.to && p.spec.to >= spec.split && p.spec.universe.some((s) => spec.universe.includes(s))
      );
    }).length;
}
export function getPlan(db, id) {
  const plan = storedPlan(db, id);
  const evaluation = db.prepare("SELECT run_id FROM research.convergence_evaluations WHERE plan_id=?").get(id);
  const run = getRun(db, evaluation?.run_id || plan.developmentRunId);
  return {
    ...plan,
    evaluated: !!evaluation,
    runId: run.id,
    inputHash: run.inputHash,
    report: run.result.convergence,
    priorEvaluations: run.provenance.priorEvaluations,
    trial: run.provenance.trial,
  };
}
function validatePrices(rows, symbol, spec) {
  if (
    !Array.isArray(rows) ||
    rows.length < 2 ||
    rows[0][0] > dayOf(spec.from) + 7 ||
    rows.at(-1)[0] < dayOf(spec.to) - 7
  )
    throw new Error(
      `First experiment needs price coverage for ${symbol} across both periods. Choose a covered date range or rerun that source.`,
    );
  for (let i = 0; i < rows.length; i++) {
    const [d, o, c] = rows[i];
    if (
      !Number.isInteger(d) ||
      (i && d <= rows[i - 1][0]) ||
      !Number.isFinite(c) ||
      c <= 0 ||
      (spec.rules.entry === "nextOpen" && (!Number.isFinite(o) || o <= 0))
    )
      throw new Error(`Invalid or missing adjusted prices for ${symbol}; refresh the source experiment.`);
  }
}
export function createPlan(db, body) {
  return getPlan(db, createPlanRecord(db, body));
}
function createPlanRecord(db, body) {
  researchStore(db);
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > 200)
    throw new Error("Provide a title of 1–200 characters.");
  const spec = cleanConvergence(body.spec);
  if (spec.to >= new Date().toISOString().slice(0, 10))
    throw new Error("Evaluation end must be a completed historical day.");
  if (
    !Array.isArray(body.experimentIds) ||
    body.experimentIds.length < 2 ||
    body.experimentIds.length > 3 ||
    new Set(body.experimentIds).size !== body.experimentIds.length
  )
    throw new Error("Choose two or three distinct saved experiments.");
  const experiments = body.experimentIds.map((id) => getExperiment(db, String(id)));
  const families = new Set();
  const sourceAudits = [];
  const sources = experiments.map((e) => {
    if (!e?.run.inputs || !e.run.result.ok || e.run.result.building || e.run.inputs.kind)
      throw new Error("Sources must be completed single-source experiments.");
    sourceAudits.push(requireAuditedSource(e.run));
    const f = e.run.result.spec.filters || {};
    if (f.committee || f.nearHearingDays)
      throw new Error("Committee and hearing cohorts use current membership; choose a source without these filters.");
    const family = e.run.provenance.dataset ? `dataset:${e.run.provenance.dataset.name}` : e.run.result.spec.source;
    if (families.has(family))
      throw new Error(
        "Choose distinct source families or separately named datasets; versions of one dataset are not independent sources.",
      );
    families.add(family);
    const signals = e.run.provenance.matchedSignals || e.run.inputs.signals;
    if (!signals?.length) throw new Error("Each source needs saved signals.");
    return { id: e.id, label: e.title, signals };
  });
  const reference = experiments[0].run.inputs;
  const bars = Object.fromEntries(
    spec.universe.map((s) => {
      validatePrices(reference.bars[s], s, spec);
      return [s, reference.bars[s]];
    }),
  );
  validatePrices(reference.benchBars.SPY, "SPY", spec);
  const inputs = {
    kind: "convergence",
    phase: "development",
    spec,
    sources,
    bars,
    benchBars: { SPY: reference.benchBars.SPY },
  };
  const trial = beginResearchTrial(db, { kind: "convergence-development", spec });
  let report;
  try {
    report = runConvergence(inputs);
  } catch (error) {
    finishResearchTrial(db, trial, { status: "failed", detail: error.message });
    throw error;
  }
  const provenance = {
    trial: researchTrialReceipt(trial),
    integrityVersion: INTEGRITY_VERSION,
    sourceAudits,
    sourceRuns: experiments.map((e) => ({
      experimentId: e.id,
      runId: e.run.id,
      inputHash: e.run.inputHash,
      caveats: e.run.result.caveats,
      feeds: e.run.provenance.feeds,
    })),
    priceRunId: experiments[0].run.id,
    priorEvaluations: exposure(db, spec),
  };
  db.exec("SAVEPOINT convergence_create");
  try {
    const developmentRunId = putRun(db, {
      inputs,
      result: { ok: true, convergence: report },
      provenance,
      engine: CONVERGENCE_ENGINE,
    });
    const plan = {
      id: newId("cv"),
      title: body.title.trim(),
      createdAt: new Date().toISOString(),
      spec,
      sources: sources.map(({ signals, ...s }) => s),
      developmentRunId,
      provenance,
    };
    const text = JSON.stringify(plan);
    db.prepare("INSERT INTO research.convergence_plans VALUES (?,?,?,?)").run(
      plan.id,
      plan.createdAt,
      hashOf(text),
      text,
    );
    finishResearchTrial(db, trial, { status: "completed", runId: developmentRunId });
    db.exec("RELEASE convergence_create");
    return plan.id;
  } catch (e) {
    db.exec("ROLLBACK TO convergence_create; RELEASE convergence_create");
    finishResearchTrial(db, trial, { status: "failed", detail: e.message });
    throw e;
  }
}
export function evaluatePlan(db, id) {
  const plan = storedPlan(db, id);
  if (db.prepare("SELECT 1 FROM research.convergence_evaluations WHERE plan_id=?").get(id)) return getPlan(db, id);
  const original = getRun(db, plan.developmentRunId);
  if (original.provenance.integrityVersion !== INTEGRITY_VERSION)
    throw new Error(
      "This plan predates current historical-integrity checks. Create a new plan from newly audited source experiments. Its original report and export remain available.",
    );
  if (original.engineId !== CONVERGENCE_ENGINE.id)
    throw new Error("Engine changed since lock. Create a new plan with the current engine.");
  const inputs = { ...original.inputs, phase: "evaluation" };
  const trial = beginResearchTrial(db, { kind: "convergence-holdout", spec: { ...plan.spec, from: plan.spec.split } });
  let report;
  try {
    report = runConvergence(inputs);
  } catch (error) {
    finishResearchTrial(db, trial, { status: "failed", detail: error.message });
    throw error;
  }
  const provenance = {
    ...original.provenance,
    trial: researchTrialReceipt(trial),
    priorEvaluations: exposure(db, plan.spec),
  };
  db.exec("SAVEPOINT convergence_evaluate");
  try {
    const runId = putRun(db, {
      inputs,
      result: { ok: true, convergence: report },
      provenance,
      engine: CONVERGENCE_ENGINE,
    });
    db.prepare("INSERT INTO research.convergence_evaluations VALUES (?,?,?)").run(id, runId, new Date().toISOString());
    finishResearchTrial(db, trial, { status: "completed", runId });
    db.exec("RELEASE convergence_evaluate");
  } catch (e) {
    db.exec("ROLLBACK TO convergence_evaluate; RELEASE convergence_evaluate");
    finishResearchTrial(db, trial, { status: "failed", detail: e.message });
    throw e;
  }
  return getPlan(db, id);
}
