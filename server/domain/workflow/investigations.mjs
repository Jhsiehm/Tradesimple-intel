import { cleanWorkflowProtocol, WORKFLOW_LIMITS } from "../../../shared/workflow.mjs";
import { getObservations } from "../research-observations.mjs";
import { hashOf } from "../research-store.mjs";
import { freezeSources, pinSources } from "./sources.mjs";
import {
  readWorkflowHistory,
  saveWorkflowRecord,
  workflowSummaries,
  workflowView,
  findWorkflowByProtocol,
} from "./records.mjs";
import { workflowEngine } from "./engine.mjs";
import { runWorkflowEvaluation } from "./worker.mjs";

export { exportInvestigation, exportInvestigationArchive } from "./archive.mjs";
export { verifyWorkflowRecord, verifyWorkflowRows } from "./records.mjs";

const LIMIT_NOTICE =
  "A completed descriptive calculation does not establish source authenticity, historical coverage, verified publication timing, causality or an investable edge.";
const lookup = (db) => (id) => getObservations(db, id);
const read = (db, id) => readWorkflowHistory(db, id, lookup(db)).at(-1);
const active = new WeakMap();

export function listInvestigations(db) {
  return {
    ok: true,
    items: workflowSummaries(db),
    capabilities: {
      version: 1,
      claimScope: "descriptive",
      sources: "pinned-imported-observation-snapshots",
      operations: ["source", "filter", "join", "difference", "summarize"],
      sourceAuthenticityVerified: false,
      historicalCoverageCertified: false,
      notice: LIMIT_NOTICE,
    },
  };
}

export function getInvestigation(db, id) {
  return workflowView(read(db, id));
}

export function createInvestigation(db, input) {
  const protocol = cleanWorkflowProtocol(input);
  const protocolHash = hashOf(protocol);
  const existing = findWorkflowByProtocol(db, protocolHash);
  if (existing) return getInvestigation(db, existing);
  const { refs, issues } = pinSources(db, protocol);
  const now = new Date().toISOString();
  const blocked = protocol.family !== "descriptive" || protocol.unresolved.length > 0 || issues.length > 0;
  const saved = saveWorkflowRecord(db, {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    protocol,
    protocolHash,
    sourceRefs: refs,
    sourceIssues: issues,
    status: blocked ? "blocked" : "draft",
    result: null,
    evaluation: null,
    notice: LIMIT_NOTICE,
  });
  return getInvestigation(db, saved.existing || saved.record.id);
}

/** Amendments are new identities; the original protocol and results remain immutable. */
export function amendInvestigation(db, id, { revision, protocol: input, amendment } = {}) {
  const parent = read(db, id);
  if (!Number.isSafeInteger(revision) || revision !== parent.revision)
    throw Error("This workflow investigation changed. Inspect its current revision before amending.");
  if (typeof amendment !== "string" || !amendment.trim() || amendment.length > 8000)
    throw Error("An amendment request of 1–8000 characters is required.");
  const protocol = cleanWorkflowProtocol({ ...input, question: parent.protocol.question });
  if (protocol.family !== parent.protocol.family)
    throw Error(
      "An amendment must preserve the requested claim family. A different research question needs an explicit new study.",
    );
  const { refs, issues } = pinSources(db, protocol);
  const now = new Date().toISOString();
  const saved = saveWorkflowRecord(db, {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    parentId: parent.id,
    parentRevision: parent.revision,
    amendment: amendment.trim(),
    protocol,
    protocolHash: hashOf(protocol),
    sourceRefs: refs,
    sourceIssues: issues,
    status: protocol.family !== "descriptive" || protocol.unresolved.length || issues.length ? "blocked" : "draft",
    result: null,
    evaluation: null,
    notice: LIMIT_NOTICE,
  });
  return getInvestigation(db, saved.existing || saved.record.id);
}

/** Replay validated frozen inputs, without recollection, mutation or executing archived code. */
export async function replayInvestigation(db, id, { signal } = {}) {
  const record = read(db, id);
  const frozen = record.evaluation;
  if (!frozen) throw Error("Run and freeze this investigation before replaying it.");
  if (workflowEngine().hash !== frozen.engineHash)
    throw Error(
      "The installed engine differs from this frozen study. Use its exported offline archive to replay the original engine.",
    );
  if (Buffer.byteLength(JSON.stringify(frozen.inputs)) > WORKFLOW_LIMITS.inputBytes)
    throw Error("Frozen workflow inputs exceed the bounded engine budget.");
  const result = await runWorkflowEvaluation(frozen.inputs, frozen.engineHash, { signal });
  const resultHash = hashOf(result);
  return {
    investigation: workflowView(record),
    replay: {
      matches: resultHash === frozen.resultHash,
      resultHash,
      expectedResultHash: frozen.resultHash,
      inputHash: frozen.inputHash,
      engineHash: frozen.engineHash,
      status: result.status,
      executed: result.executed,
    },
  };
}

export async function runInvestigation(db, id, { revision, signal } = {}) {
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
    throw Error("Revision must be a positive integer.");
  const record = read(db, id);
  if (record.evaluation) {
    if (revision !== undefined && revision !== record.revision && revision !== record.evaluation.baseRevision)
      throw Error("This workflow investigation changed. Reload before trying again.");
    return workflowView(record);
  }
  if (record.attempt && revision === record.attempt.baseRevision) return workflowView(record);
  if (revision !== undefined && revision !== record.revision)
    throw Error("This workflow investigation changed. Reload before trying again.");
  if (!active.has(db)) active.set(db, new Map());
  const running = active.get(db).get(id);
  if (running) return running;
  const promise = execute(db, record, { signal }).finally(() => active.get(db).delete(id));
  active.get(db).set(id, promise);
  return promise;
}

async function execute(db, record, { signal }) {
  if (record.revision >= 100) throw Error("Workflow attempt budget reached. Create a revised study protocol.");
  const { sources, originals } = freezeSources(db, record.protocol, record.sourceRefs);
  const inputs = { protocol: record.protocol, sources };
  if (Buffer.byteLength(JSON.stringify(inputs)) > WORKFLOW_LIMITS.inputBytes)
    throw Error("Workflow inputs exceed the bounded engine budget. Narrow the study.");
  const engine = workflowEngine();
  let result;
  try {
    result = await runWorkflowEvaluation(inputs, engine.hash, { signal });
  } catch (error) {
    const now = new Date().toISOString();
    return persistAttempt(
      db,
      {
        ...record,
        status: "failed",
        updatedAt: now,
        result: null,
        evaluation: null,
        attempt: {
          baseRevision: record.revision,
          attemptedAt: now,
          inputHash: hashOf(inputs),
          engineHash: engine.hash,
          error: error.message.slice(0, 1000),
        },
      },
      record.revision,
    );
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 8 * 1024 * 1024)
    throw Error("Workflow results exceed 8 MiB. Narrow the outputs.");
  const now = new Date().toISOString();
  return persistAttempt(
    db,
    {
      ...record,
      status: result.status,
      updatedAt: now,
      result,
      evaluation: {
        version: 1,
        baseRevision: record.revision,
        evaluatedAt: now,
        inputs,
        inputHash: hashOf(inputs),
        originals,
        originalsHash: hashOf(originals),
        engineFiles: engine.files,
        engineHash: engine.hash,
        resultHash: hashOf(result),
        environment: {
          runtime: "Node.js",
          version: process.version,
          dependencies: "none for offline replay",
          network: "not used during workflow evaluation",
        },
      },
    },
    record.revision,
  );
}

function persistAttempt(db, input, expectedRevision) {
  try {
    return workflowView(saveWorkflowRecord(db, input, expectedRevision).record);
  } catch (error) {
    if (!error.message.includes("changed")) throw error;
    const current = read(db, input.id);
    const ours = input.evaluation || input.attempt,
      theirs = current.evaluation || current.attempt;
    if (
      theirs?.baseRevision === expectedRevision &&
      theirs.inputHash === ours.inputHash &&
      theirs.engineHash === ours.engineHash
    )
      return workflowView(current);
    throw error;
  }
}
