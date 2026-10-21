import { cleanPolicyProtocol } from '../../../shared/policyProtocol.mjs';
import { hashOf } from '../research-store.mjs';
import { collectPolicyEvidence } from './acquisition.mjs';
import { getPolicyRecord, savePolicyRecord, policyView, listPolicyRecords } from './store.mjs';
import { preparePolicyImport, mergePolicyRows, assertPolicyEvidenceSize } from './imports.mjs';
import { policyEngine } from './replay.mjs';
import { runPolicyMethod } from './worker.mjs';

const active = new WeakMap();
const clock = options => new Date(typeof options?.now === 'function' ? options.now() : options?.now || Date.now()).toISOString();
const emptyEvidence = () => ({ events: [], news: [], exposures: [], bars: [], newsCoverage: [], sources: [], manifest: null, gaps: [] });
const activeJobs = db => { if (!active.has(db)) active.set(db, new Map()); return active.get(db); };

export function policyCapabilities() {
  return {
    legislation: process.env.CONGRESS_API_KEY ? 'configured' : 'requires-configuration',
    news: 'bounded-gdelt-discovery', historicalNewsCoverage: 'not-certified',
    prices: 'researcher-imported-one-minute-bars', exposure: 'dated-reviewed-assertions',
    method: 'paired-event-return-comparison', portfolio: false, causalInference: false,
    notice: 'Collection preserves source versions and observation times. Historical publication precision, news completeness and company mappings require separate evidence. Imported inputs remain researcher assertions.'
  };
}

function required(db, id) {
  const record = getPolicyRecord(db, id);
  if (!record) throw Error('Policy investigation not found.');
  return record;
}

function view(db, record) {
  const output = policyView(record);
  if (output.status === 'collecting' && !activeJobs(db).has(record.id)) {
    output.status = 'partial';
    output.lastError = 'The previous collection was interrupted. Collect again to resume from preserved evidence.';
  }
  return output;
}

async function assessed(record, evidence, now) {
  assertPolicyEvidenceSize(evidence);
  const readiness = await runPolicyMethod('readiness', record.protocol, evidence, { asOf: now });
  return { ...record, evidence, readiness, updatedAt: now, status: readiness.ready ? 'ready' : 'insufficient-evidence',
    result: null, evaluation: null, lastError: null };
}

export function listPolicyInvestigations(db) {
  return { ok: true, items: listPolicyRecords(db), capabilities: policyCapabilities() };
}

export function getPolicyInvestigation(db, id) { return view(db, required(db, id)); }

export async function createPolicyInvestigation(db, input, options = {}) {
  const now = clock(options);
  const checked = cleanPolicyProtocol(input, { now });
  if (!checked.ok) throw Error(checked.error);
  const protocol = checked.protocol;
  const record = await assessed({ schemaVersion: 1, createdAt: now, protocol, protocolHash: hashOf(protocol) }, emptyEvidence(), now);
  record.status = 'draft';
  return view(db, savePolicyRecord(db, record));
}

function checkRevision(record, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== record.revision) throw Error('This investigation changed. Reload before trying again.');
}

export async function importPolicyEvidence(db, id, { kind, records, revision }, options = {}) {
  if (activeJobs(db).has(id)) throw Error('Evidence collection is running. Wait or cancel before importing.');
  const record = required(db, id);
  checkRevision(record, revision);
  const now = clock(options), prepared = preparePolicyImport(kind, records, now);
  const merged = mergePolicyRows(kind, record.evidence[kind], prepared.records);
  if (merged.length === record.evidence[kind].length) return view(db, record);
  const evidence = { ...record.evidence, [kind]: merged,
    sources: mergePolicyRows('sources', record.evidence.sources.map(s => ({ ...s, id: s.contentHash })), [{ ...prepared.source, id: prepared.rawHash }]) };
  return view(db, savePolicyRecord(db, await assessed(record, evidence, now), record.revision));
}

export async function collectPolicyInvestigation(db, id, options = {}) {
  const jobs = activeJobs(db);
  if (jobs.has(id)) throw Error('Evidence collection is already running for this investigation.');
  const record = required(db, id);
  checkRevision(record, options.revision);
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  jobs.set(id, controller);
  let current;
  try {
    current = savePolicyRecord(db, { ...record, status: 'collecting', updatedAt: clock(options), lastError: null }, record.revision);
    const collected = await (options.collect || collectPolicyEvidence)(db, record.protocol, {
      ...options, signal, now: () => clock(options), previous: record.evidence
    });
    const evidence = { ...record.evidence, manifest: collected.manifest, gaps: collected.gaps || [] };
    for (const kind of ['events', 'news', 'newsCoverage']) evidence[kind] = mergePolicyRows(kind, record.evidence[kind], collected[kind] || [], { allowVersions: true });
    evidence.sources = mergePolicyRows('sources', record.evidence.sources.map(s => ({ ...s, id: s.contentHash })),
      (collected.sources || []).map(s => ({ ...s, id: s.contentHash })), { allowVersions: true });
    const next = await assessed(current, evidence, clock(options));
    if (signal.aborted) { next.status = 'partial'; next.lastError = 'Collection stopped. Completed source receipts remain saved.'; }
    current = savePolicyRecord(db, next, current.revision);
  } catch (error) {
    if (!current) throw error;
    current = savePolicyRecord(db, { ...current, status: signal.aborted ? 'partial' : 'failed', updatedAt: clock(options),
      lastError: error instanceof Error ? error.message : 'Evidence collection failed.' }, current.revision);
  } finally { jobs.delete(id); }
  return view(db, current);
}

export function cancelPolicyCollection(db, id) {
  required(db, id);
  activeJobs(db).get(id)?.abort();
  return { ok: true, stopping: activeJobs(db).has(id) };
}

export async function evaluatePolicyInvestigation(db, id, options = {}) {
  if (activeJobs(db).has(id)) throw Error('Wait for evidence collection to finish before evaluating.');
  const record = required(db, id);
  checkRevision(record, options.revision);
  const engine = policyEngine();
  const evidenceHash = hashOf({ protocol: record.protocol, evidence: record.evidence });
  const now = clock(options);
  const inputs = { protocol: record.protocol, evidence: record.evidence, asOf: now };
  const inputHash = hashOf(inputs);
  if (record.evaluation?.inputHash === inputHash && record.evaluation.engineHash === engine.hash) return view(db, record);
  const result = await runPolicyMethod('evaluate', record.protocol, record.evidence, { asOf: now, signal: options.signal });
  const next = { ...record, status: result.status, readiness: { ready: result.executed, gaps: result.gaps, counts: result.counts, claimCeiling: result.claimCeiling },
    result, updatedAt: now, evaluation: { inputs, inputHash, resultHash: hashOf(result), engineHash: engine.hash,
      engineFiles: engine.files, evaluatedAt: now, evidenceHash, revision: record.revision }, lastError: null };
  return view(db, savePolicyRecord(db, next, record.revision));
}
