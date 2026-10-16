import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dayOf } from "../shared/backtest.mjs";
import { DEFAULT_RULES } from "../shared/backtestSpec.mjs";
import { cleanEventStudy, runEventStudy, eventStudyUncertainty } from "../shared/eventStudy.mjs";
import { openDb } from "../server/lib/db.mjs";
import { importDataset, datasetSource } from "../server/domain/research-events.mjs";
import { runSpec } from "../server/domain/backtest/index.mjs";
import { saveExperiment } from "../server/domain/research-store.mjs";
import {
  createEventStudy,
  getEventStudy,
  listEventStudies,
  evaluateEventStudy,
} from "../server/domain/event-studies.mjs";
import { replayRun, exportRun } from "../server/domain/research-replay.mjs";
import { createResearchBackup, verifyResearchBackup } from "../server/domain/research-backup.mjs";
const bars = Array.from({ length: 80 }, (_, i) => [dayOf("2025-01-01") + i, 100 * 1.02 ** i, 100 * 1.02 ** i]);
const market = bars.map((b, i) => [b[0], 100 * 1.01 ** i, 100 * 1.01 ** i]);
const base = {
  signals: [
    { id: "a", symbol: "AAPL", side: "buy", signalDate: "2025-01-10", tradeDate: "2025-01-09" },
    { id: "b", symbol: "AAPL", side: "sell", signalDate: "2025-01-10", tradeDate: "2025-01-09" },
    { id: "c", symbol: "AAPL", side: "buy", signalDate: "2025-01-12", tradeDate: "2025-01-11" },
  ],
  bars: { AAPL: bars },
  benchBars: { SPY: market },
  rules: { ...DEFAULT_RULES, holdDays: 10 },
};
const spec = { from: "2025-01-01", to: "2025-02-01", before: 2, after: 2, sides: "both" };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test("event study uses subsequent sessions, one issuer-day cohort, exact AR/CAR and BHAR", () => {
  const before = JSON.stringify(base),
    report = runEventStudy({ base, spec });
  assert.equal(JSON.stringify(base), before);
  assert.equal(report.counts.completeEvents, 2);
  assert.equal(report.counts.includedPublications, 3);
  assert.equal(report.events[0].anchorDate, "2025-01-11");
  assert.deepEqual(report.events[0].signalIds, ["a", "b"]);
  assert.deepEqual(report.events[0].sides, ["buy", "sell"]);
  assert.equal(report.counts.overlappingEvents, 2);
  assert.deepEqual(report.events[0].overlappingEventIds, [report.events[1].id]);
  assert.equal(report.curve.length, 5);
  for (const point of report.curve) {
    assert.equal(point.n, 2);
    near(point.aar, 0.01);
  }
  near(report.summary.meanCar, 0.05);
  near(report.summary.meanBuyHoldAbnormalReturn, 1.02 ** 5 - 1.01 ** 5);
  assert.deepEqual(runEventStudy({ base: { ...base, signals: [...base.signals].reverse() }, spec }), report);
  const sell = runEventStudy({ base, spec: { ...spec, sides: "sell" } });
  assert.equal(sell.counts.completeEvents, 1);
  near(sell.summary.meanCar, 0.05);
});
test("event study excludes whole incomplete windows and never fills missing prices or reports empty zero", () => {
  const broken = { ...base, bars: { AAPL: bars.filter((b) => b[0] !== dayOf("2025-01-08")) } };
  const report = runEventStudy({ base: broken, spec });
  assert.equal(report.counts.completeEvents, 1);
  assert.equal(report.counts.excludedEvents, 1);
  assert.equal(report.exclusions["missing-security-close"], 2);
  assert.ok(report.curve.every((p) => p.n === 1));
  const empty = runEventStudy({ base: { ...base, bars: {} }, spec });
  assert.equal(empty.summary, null);
  assert.deepEqual(empty.curve, []);
  assert.equal(empty.counts.completeEvents, 0);
  const short = runEventStudy({ base, spec: { ...spec, before: 20 } });
  assert.equal(short.summary, null);
  assert.equal(short.exclusions["incomplete-calendar-window"], 3);
  assert.throws(() => runEventStudy({ base: { ...base, benchBars: {} }, spec }), /SPY/);
  assert.throws(() => runEventStudy({ base: { ...base, bars: { AAPL: [...bars, bars[0]] } }, spec }), /duplicate/);
  for (const patch of [
    { before: 21 },
    { after: -1 },
    { after: 1.5 },
    { sides: "short" },
    { from: "2025-02-30" },
    { to: "2024-01-01" },
    { unknown: true },
  ])
    assert.throws(() => cleanEventStudy({ ...spec, ...patch }));
});
test("registered event study is immutable, evaluated once and portable with source evidence and backups", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-event-study-")),
    prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = path.join(dir, "cache.sqlite");
  let db;
  try {
    db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
    const dataset = importDataset(db, {
      name: "Event study fixture",
      source: "Synthetic",
      format: "json",
      content: JSON.stringify(
        base.signals.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          side: s.side,
          eventAt: s.tradeDate,
          availableAt: s.signalDate,
        })),
      ),
    }).dataset;
    const run = await runSpec(
      db,
      { source: "dataset", datasetId: dataset.id, rules: base.rules },
      {
        sourceFn: async () => datasetSource(dataset),
        loadBarsFn: async () => ({
          bars: { AAPL: bars, SPY: market },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const experiment = saveExperiment(db, { runId: run.runId, title: "Synthetic source" });
    const body = {
      title: "Descriptive disclosure study",
      hypothesis: "Compare daily returns to SPY around disclosure.",
      experimentId: experiment.id,
      spec,
    };
    const plan = createEventStudy(db, body);
    assert.equal(plan.run, null);
    assert.equal(plan.priorPlans, 0);
    const done = evaluateEventStudy(db, plan.id);
    assert.equal(done.run.inputs.kind, "event-study");
    assert.equal(replayRun(done.run).matches, true);
    assert.equal(evaluateEventStudy(db, plan.id).run.id, done.run.id);
    assert.equal(getEventStudy(db, plan.id).run.id, done.run.id);
    assert.equal(listEventStudies(db)[0].evaluated, true);
    assert.equal(createEventStudy(db, body).priorPlans, 1);
    assert.throws(() => db.exec("DELETE FROM research.event_study_plans"), /immutable/);
    createResearchBackup(path.join(dir, "research.sqlite"), path.join(dir, "backup"));
    assert.equal(verifyResearchBackup(path.join(dir, "backup")).counts.event_study_evaluations, 1);
    fs.writeFileSync(path.join(dir, "run.zip"), exportRun(db, done.run));
    db.close();
    db = null;
    assert.equal(spawnSync("unzip", ["-q", "run.zip"], { cwd: dir }).status, 0);
    const replay = spawnSync(process.execPath, ["replay.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).matches, true);
    const evidence = JSON.parse(fs.readFileSync(path.join(dir, "evidence.json"), "utf8"));
    assert.ok(evidence.runs[experiment.runId]);
    assert.equal(evidence.datasets[dataset.id].rawContent, dataset.rawContent);
  } finally {
    db?.close();
    if (prior === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function modelFixture() {
  let stock = 100,
    spy = 100;
  const security = [],
    benchmark = [];
  for (let i = 0; i < 100; i++) {
    const x = ((i % 7) - 3) * 0.003;
    if (i) {
      spy *= 1 + x;
      stock *= 1 + 0.001 + 1.5 * x;
    }
    const day = dayOf("2025-01-01") + i;
    security.push([day, stock, stock]);
    benchmark.push([day, spy, spy]);
  }
  return {
    base: {
      ...base,
      signals: [{ id: "model-event", symbol: "AAPL", side: "buy", signalDate: "2025-03-01", tradeDate: "2025-02-28" }],
      bars: { AAPL: security },
      benchBars: { SPY: benchmark },
    },
    spec: {
      from: "2025-03-01",
      to: "2025-03-02",
      before: 2,
      after: 2,
      sides: "both",
      model: "market-model",
      estimationSessions: 30,
      estimationGap: 5,
    },
  };
}
test("market model recovers coefficients from strictly pre-window returns and compares the same cohort", () => {
  const fixture = modelFixture(),
    report = runEventStudy(fixture),
    event = report.events[0];
  assert.equal(report.counts.completeEvents, 1);
  near(event.estimation.alpha, 0.001);
  near(event.estimation.beta, 1.5);
  near(event.estimation.rSquared, 1);
  near(event.estimation.residualStdDev, 0);
  near(event.car, 0);
  assert.equal(event.estimation.n, 30);
  assert.equal(event.estimation.samples.length, 30);
  assert.equal(dayOf(event.from) - dayOf(event.estimation.to), 6);
  for (const p of event.path) {
    near(p.expectedReturn, 0.001 + 1.5 * p.benchmarkReturn);
    near(p.abnormalReturn, 0);
    near(p.marketAdjustedReturn, p.securityReturn - p.benchmarkReturn);
  }
  near(report.summary.marketAdjustedMeanCar, event.marketAdjustedCar);
  assert.ok(Math.abs(event.marketAdjustedCar) > 1e-4);
  // Alter event and gap prices without allowing them to affect fitted coefficients.
  const changed = structuredClone(fixture),
    cutoff = dayOf(event.estimation.to);
  for (const row of changed.base.bars.AAPL)
    if (row[0] > cutoff) {
      row[1] *= 1.2;
      row[2] *= 1.2;
    }
  const altered = runEventStudy(changed).events[0];
  assert.deepEqual(altered.estimation, event.estimation);
  // Alter a post-anchor close: fitted coefficients stay fixed, measured residual changes.
  const shock = structuredClone(fixture);
  shock.base.bars.AAPL.find((b) => b[0] === dayOf(event.anchorDate))[2] *= 1.1;
  const stressed = runEventStudy(shock).events[0];
  assert.deepEqual(stressed.estimation, event.estimation);
  assert.notEqual(
    stressed.path.find((p) => p.offset === 0).abnormalReturn,
    event.path.find((p) => p.offset === 0).abnormalReturn,
  );
});
test("market model refuses incomplete estimation, degenerate SPY returns and invalid conditions", () => {
  const fixture = modelFixture();
  const missing = structuredClone(fixture);
  missing.base.bars.AAPL = missing.base.bars.AAPL.filter((b) => b[0] !== dayOf("2025-02-01"));
  const report = runEventStudy(missing);
  assert.equal(report.summary, null);
  assert.equal(report.exclusions["missing-estimation-security-close"], 1);
  const flat = structuredClone(fixture);
  flat.base.benchBars.SPY = flat.base.benchBars.SPY.map((b) => [b[0], 100, 100]);
  assert.equal(runEventStudy(flat).exclusions["unstable-estimation-fit"], 1);
  assert.equal(
    runEventStudy({ ...fixture, spec: { ...fixture.spec, estimationSessions: 120 } }).exclusions[
      "incomplete-estimation-calendar"
    ],
    1,
  );
  for (const patch of [
    { estimationSessions: 19 },
    { estimationSessions: 253 },
    { estimationGap: -1 },
    { estimationGap: 1.5 },
    { model: "CAPM" },
    { model: "market-adjusted", estimationSessions: 30 },
  ])
    assert.throws(() => cleanEventStudy({ ...fixture.spec, ...patch }));
});

test("registered market model exports estimation evidence and replays without its database", async () => {
  const fixture = modelFixture(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsi-market-model-")),
    prior = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = path.join(dir, "cache.sqlite");
  let db;
  try {
    db = openDb(decodeURIComponent(new URL("..", import.meta.url).pathname));
    const dataset = importDataset(db, {
      name: "Market model fixture",
      source: "Synthetic",
      format: "json",
      content: JSON.stringify(
        fixture.base.signals.map((s) => ({
          id: s.id,
          symbol: s.symbol,
          side: s.side,
          eventAt: s.tradeDate,
          availableAt: s.signalDate,
        })),
      ),
    }).dataset;
    const run = await runSpec(
      db,
      { source: "dataset", datasetId: dataset.id, rules: base.rules },
      {
        sourceFn: async () => datasetSource(dataset),
        loadBarsFn: async () => ({
          bars: { AAPL: fixture.base.bars.AAPL, SPY: fixture.base.benchBars.SPY },
          pending: [],
          stale: [],
          cached: 2,
          fetched: 0,
          missing: [],
          oldestStoredAt: Date.now(),
        }),
      },
    );
    const experiment = saveExperiment(db, { runId: run.runId, title: "Synthetic model source" });
    const plan = createEventStudy(db, {
      title: "Registered market model",
      hypothesis: "Recover the synthetic relationship",
      experimentId: experiment.id,
      spec: fixture.spec,
    });
    const done = evaluateEventStudy(db, plan.id);
    near(done.run.result.eventStudy.events[0].estimation.beta, 1.5);
    assert.equal(replayRun(done.run).matches, true);
    createResearchBackup(path.join(dir, "research.sqlite"), path.join(dir, "backup"));
    assert.equal(verifyResearchBackup(path.join(dir, "backup")).counts.event_study_evaluations, 1);
    fs.writeFileSync(path.join(dir, "run.zip"), exportRun(db, done.run));
    db.close();
    db = null;
    assert.equal(spawnSync("unzip", ["-q", "run.zip"], { cwd: dir }).status, 0);
    const replay = spawnSync(process.execPath, ["replay.mjs"], { cwd: dir, encoding: "utf8" });
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).matches, true);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    assert.equal(saved.result.eventStudy.events[0].estimation.samples.length, 30);
    assert.equal(saved.result.eventStudy.uncertainty.groups, 1);
    assert.equal(saved.result.eventStudy.uncertainty.standardError, null);
  } finally {
    db?.close();
    if (prior === undefined) delete process.env.INTEL_CACHE;
    else process.env.INTEL_CACHE = prior;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("event uncertainty uses connected ticker and calendar clusters with intercept-only CR1", () => {
  const event = (id, symbol, from, to, car) => ({ id, symbol, from, to, car });
  const rows = [
    event("a", "AAA", "2025-01-01", "2025-01-02", 0),
    event("b", "AAA", "2025-02-01", "2025-02-02", 0),
    event("c", "BBB", "2025-03-01", "2025-03-02", 4),
    event("d", "BBB", "2025-04-01", "2025-04-02", 4),
  ];
  const result = eventStudyUncertainty(rows);
  assert.equal(result.groups, 2);
  assert.equal(result.largestGroup, 2);
  near(result.meanCar, 2);
  // Cluster score sums are -4 and +4; CR1 variance = (2/1)*(16+16)/4² = 4.
  near(result.standardError, 2);
  assert.equal(result.status, "estimated");
  assert.deepEqual(eventStudyUncertainty([...rows].reverse()), result);
  assert.deepEqual(
    result.blocks.map((b) => b.eventIds),
    [
      ["a", "b"],
      ["c", "d"],
    ],
  );
  const bridge = event("bridge", "CCC", "2025-02-02", "2025-03-01", 1);
  const connected = eventStudyUncertainty([...rows, bridge]);
  assert.equal(connected.groups, 1, "cross-ticker calendar overlap joins transitive same-ticker links");
  assert.equal(connected.largestGroup, 5);
  assert.equal(connected.standardError, null);
  assert.equal(connected.status, "insufficient-groups");
  assert.equal(eventStudyUncertainty([]).meanCar, null);
  assert.equal(eventStudyUncertainty([]).standardError, null);
  const identical = eventStudyUncertainty(rows.map((r) => ({ ...r, car: 1 })));
  assert.equal(identical.status, "zero-variance");
  assert.equal(identical.standardError, 0);
});

test("event uncertainty includes only the measured cohort and merges simultaneous cross-security windows", () => {
  const signals = [...base.signals, { ...base.signals[0], id: "other", symbol: "OTHER" }];
  const report = runEventStudy({ base: { ...base, signals, bars: { ...base.bars, OTHER: bars } }, spec });
  assert.equal(report.uncertainty.n, 3);
  assert.equal(report.uncertainty.groups, 1);
  assert.deepEqual(report.uncertainty.blocks[0].symbols, ["AAPL", "OTHER"]);
  assert.deepEqual(report.uncertainty.blocks[0].eventIds, [...report.events.map((e) => e.id)].sort());
  const excluded = runEventStudy({ base: { ...base, signals }, spec });
  assert.equal(excluded.uncertainty.n, 2);
  assert.deepEqual(excluded.uncertainty.blocks[0].symbols, ["AAPL"]);
  assert.equal(excluded.exclusions["missing-security-close"], 1);
});
