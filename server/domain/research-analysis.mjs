/** Append-only execution journal for opt-in controlled research. No credentials or transport headers. */
import { researchStore, hashOf, newId } from "./research-store.mjs";
import { getMemorySnapshot } from "./research-context.mjs";
const ready = new WeakSet();
function ensure(db) {
  researchStore(db);
  if (ready.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS research.analysis_events (analysis_id TEXT NOT NULL, sequence INTEGER NOT NULL, body_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(analysis_id,sequence));
 CREATE TRIGGER IF NOT EXISTS research.analysis_events_update BEFORE UPDATE ON analysis_events BEGIN SELECT RAISE(ABORT,'Analysis records are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS research.analysis_events_delete BEFORE DELETE ON analysis_events BEGIN SELECT RAISE(ABORT,'Analysis records are immutable'); END;`);
  ready.add(db);
}
export function verifyAnalysisRows(rows) {
  let previousHash = null;
  const events = rows.map((row, index) => {
    if (hashOf(row.body) !== row.body_hash) throw Error("Analysis event checksum mismatch.");
    const event = JSON.parse(row.body);
    if (event.sequence !== index || event.previousHash !== previousHash) throw Error("Analysis event chain mismatch.");
    if (index && event.analysisId !== JSON.parse(rows[0].body).analysisId) throw Error("Analysis identity mismatch.");
    previousHash = row.body_hash;
    return event;
  });
  if (!events.length || events[0].kind !== "started") throw Error("Analysis start record is missing.");
  if (events.slice(0, -1).some((e) => e.kind === "finished")) throw Error("Analysis contains events after completion.");
  return { events, headHash: previousHash };
}
export function startAnalysis(db, { request, memory, provider, model }, { now = () => new Date().toISOString() } = {}) {
  ensure(db);
  const snapshot = getMemorySnapshot(db, memory.snapshotId);
  if (snapshot.contentHash !== memory.contentHash) throw Error("Analysis context checksum mismatch.");
  const id = newId("analysis");
  let sequence = 0,
    previousHash = null,
    finished = false;
  const append = (kind, data) => {
    if (finished) throw Error("Analysis is already finished.");
    const event = { schemaVersion: 1, analysisId: id, sequence, previousHash, at: now(), kind, data };
    const body = JSON.stringify(event),
      hash = hashOf(body);
    db.prepare("INSERT INTO research.analysis_events VALUES (?,?,?,?)").run(id, sequence, hash, body);
    sequence++;
    previousHash = hash;
    if (kind === "finished") finished = true;
    return hash;
  };
  append("started", {
    request,
    memory,
    snapshot,
    provider,
    model,
    scope: "local-owner",
    limitations: [
      "Recorded model inputs and outputs support inspection, not deterministic model regeneration.",
      "Memory cutoff does not restrict live external sources.",
      "An absent completion record means execution is incomplete or interrupted, not successful.",
    ],
  });
  return { id, append, finish: (status) => append("finished", { status }) };
}
export function getAnalysis(db, id) {
  ensure(db);
  const { events, headHash } = verifyAnalysisRows(
    db.prepare("SELECT body,body_hash FROM research.analysis_events WHERE analysis_id=? ORDER BY sequence").all(id),
  );
  const terminal = events.at(-1);
  return {
    id,
    schemaVersion: 1,
    createdAt: events[0].at,
    status: terminal.kind === "finished" ? terminal.data.status : "incomplete",
    headHash,
    events,
  };
}
export function listAnalyses(db) {
  ensure(db);
  return db
    .prepare("SELECT analysis_id FROM research.analysis_events WHERE sequence=0 ORDER BY rowid DESC LIMIT 200")
    .all()
    .map((r) => {
      const a = getAnalysis(db, r.analysis_id),
        start = a.events[0].data;
      return {
        id: a.id,
        createdAt: a.createdAt,
        status: a.status,
        question: start.request.question,
        mode: start.memory.mode,
        snapshotId: start.memory.snapshotId,
        headHash: a.headHash,
      };
    });
}
