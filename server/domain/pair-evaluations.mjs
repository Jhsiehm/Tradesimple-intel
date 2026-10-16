/** Versioned owner judgments about exact paired outputs, separate from execution success. */
import { researchStore, hashOf, newId } from "./research-store.mjs";
import { getPairProtocol } from "./research-pairs.mjs";
import { getPairExecution } from "../ai/pairedResearch.mjs";
const ready = new WeakSet();
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.pair_evaluations (protocol_id TEXT NOT NULL, revision INTEGER NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(protocol_id,revision));
 CREATE TRIGGER IF NOT EXISTS research.pair_evaluations_update BEFORE UPDATE ON pair_evaluations BEGIN SELECT RAISE(ABORT,'Pair evaluations are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS research.pair_evaluations_delete BEFORE DELETE ON pair_evaluations BEGIN SELECT RAISE(ABORT,'Pair evaluations are immutable'); END;`);
  ready.add(db);
}
function text(value, name, max = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error(`${name} must contain 1–${max} characters.`);
  return value.trim();
}
function decode(row) {
  if (hashOf(row.body) !== row.body_hash) throw Error("Pair evaluation checksum mismatch.");
  return JSON.parse(row.body);
}
export function listPairEvaluations(db, id) {
  ensure(db);
  getPairProtocol(db, id);
  return db
    .prepare("SELECT body,body_hash FROM research.pair_evaluations WHERE protocol_id=? ORDER BY revision DESC")
    .all(id)
    .map(decode);
}
export function savePairEvaluation(db, id, body) {
  ensure(db);
  const protocol = getPairProtocol(db, id),
    run = getPairExecution(db, id);
  if (
    run?.status !== "completed" ||
    !run.result ||
    Object.values(run.result.arms).some((a) => a.status !== "completed")
  )
    throw Error(
      "Both arms must complete before recording a comparative evaluation. Inspect the execution failures first.",
    );
  const previous = listPairEvaluations(db, id)[0];
  if (body?.baseRevision !== (previous?.revision || 0))
    throw Error("The evaluation changed elsewhere. Reload the latest revision before saving.");
  if (!["isolated", "context-aware", "tie", "inconclusive"].includes(body.verdict))
    throw Error("Choose isolated, context-aware, tie or inconclusive.");
  const assessments = {};
  for (const mode of ["isolated", "context-aware"]) {
    const raw = body.assessments?.[mode];
    assessments[mode] = {
      criteriaAssessment: text(raw?.criteriaAssessment, `${mode} assessment against registered criteria`),
      strengths: text(raw?.strengths, `${mode} strengths`),
      limitations: text(raw?.limitations, `${mode} limitations`),
    };
  }
  const excerpts = body.excerpts ?? [];
  if (!Array.isArray(excerpts) || excerpts.length > 10) throw Error("Attach at most 10 answer excerpts.");
  const validated = excerpts.map((e) => {
    if (!["isolated", "context-aware"].includes(e?.arm)) throw Error("Choose an arm for each excerpt.");
    const quote = text(e.quote, "Answer excerpt", 2000),
      comment = text(e.comment, "Excerpt assessment", 2000);
    if (!run.result.arms[e.arm].answer.includes(quote))
      throw Error("An excerpt does not match the frozen answer. Copy the exact text.");
    return { arm: e.arm, quote, comment, analysisId: run.result.arms[e.arm].analysisId };
  });
  const evaluation = {
    id: newId("pe"),
    schemaVersion: 1,
    protocolId: id,
    revision: (previous?.revision || 0) + 1,
    previousId: previous?.id || null,
    createdAt: new Date().toISOString(),
    actor: "local-owner",
    scope: "local-owner",
    executionId: run.execution.id,
    resultHash: hashOf(run.result),
    conditionsHash: protocol.conditionsHash,
    criteria: protocol.evaluation,
    hypothesis: protocol.hypothesis,
    verdict: body.verdict,
    rationale: text(body.rationale, "Comparative rationale"),
    reviewReason: text(body.reviewReason, "Reason for this review"),
    assessments,
    excerpts: validated,
    limitations: [
      "This is a researcher-authored judgment, not automated claim verification or independent review.",
      "A single pair cannot establish general benefit from institutional memory.",
      "Review history is retained; a later revision supersedes the current judgment without changing the original answers.",
    ],
  };
  const encoded = JSON.stringify(evaluation);
  db.prepare("INSERT INTO research.pair_evaluations VALUES (?,?,?,?)").run(
    id,
    evaluation.revision,
    hashOf(encoded),
    encoded,
  );
  return evaluation;
}
