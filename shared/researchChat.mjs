/** Bounded view receipts from actual saved-study tools. No model-generated HTML or URLs. */
export const studyId = value => typeof value === 'string' && /^(inv|policy)_[a-f0-9]{32}$/.test(value) ? value : null;
const text = (v, n = 2000) => typeof v === 'string' ? v.slice(0, n) : '';
const list = v => Array.isArray(v) ? v.slice(0, 30).map(x => typeof x === 'string' ? text(x) : text(x?.reason || x?.message || JSON.stringify(x))).filter(Boolean) : [];
function bounded(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return text(value);
  if (depth >= 6) return '[Details retained in export]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => bounded(v, depth + 1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__','constructor','prototype','bars','engineFiles','originals'].includes(key)).slice(0, 30).map(([k,v]) => [k, bounded(v, depth + 1)]));
}
export function cleanResearchStudies(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(-8).flatMap(v => {
    const id = studyId(v?.id);
    if (!id || !Number.isSafeInteger(v.revision) || v.revision < 1) return [];
    return [{ id, kind: id.startsWith('policy_') ? 'policy' : 'workflow', revision: v.revision,
      title: text(v.title, 200), question: text(v.question), status: text(v.status, 80), claim: text(v.claim),
      executed: v.executed === true, archiveAvailable: v.archiveAvailable === true,
      plan: bounded(v.plan || {}), gaps: list(v.gaps), limitations: list(v.limitations),
      evidence: bounded(v.evidence || {}), outputs: bounded(v.outputs || {}),
      ...(studyId(v.parentId) ? {parentId: v.parentId} : {}),
      ...(typeof v.replay?.matches === 'boolean' ? {replay: {matches:v.replay.matches}} : {}) }];
  });
}
export function studyReceipt(raw) {
  if (!raw || raw.ok === false) return null;
  const record = raw.investigation || raw.policyInvestigation;
  if (!record) return null;
  const policy = Boolean(raw.policyInvestigation);
  const receipt = { id:record.id, revision:record.revision, title:record.protocol?.title,
    question:record.protocol?.question, status:record.status, parentId:record.parentId,
    executed:record.executed || record.result?.executed, archiveAvailable:record.archiveAvailable || Boolean(record.evaluation),
    claim:record.result?.claimCeiling || (policy ? 'Conditional paired event-return comparison; not portfolio performance or causality.' : record.protocol?.family && record.protocol.family !== 'descriptive' ? `Requested ${record.protocol.family} design; this engine cannot establish that claim.` : 'Descriptive calculation only; no causal, predictive or investable claim.'),
    plan:record.protocol, gaps:[...(record.protocol?.unresolved || []), ...(record.sourceIssues || []), ...(record.readiness?.gaps || []), ...(record.result?.gaps || []), ...(record.lastError ? [record.lastError] : []), ...(record.attempt?.error ? [record.attempt.error] : [])],
    limitations:record.result?.limitations || [record.notice].filter(Boolean),
    evidence:policy ? record.evidence : {sources:record.sourceRefs, steps:record.result?.steps, evaluation:record.evaluation},
    outputs:policy ? {summary:record.result?.summary, counts:record.result?.counts, exclusions:record.result?.exclusions, rows:record.result?.rows} : record.result?.outputs,
    replay:raw.replay };
  return cleanResearchStudies([receipt])[0] || null;
}
export function mergeResearchStudies(prior, incoming) {
  const next = cleanResearchStudies(incoming);
  return cleanResearchStudies([...cleanResearchStudies(prior).filter(p => !next.some(n => n.id === p.id)), ...next]);
}
export function latestStudyId(turns) {
  for (let i = (turns?.length || 0) - 1; i >= 0; i--) {
    if (turns[i].done?.backtests?.some(b => b.ok)) return null;
    const studies = cleanResearchStudies(turns[i].studies || turns[i].done?.studies);
    if (studies.length) return studies.at(-1).id;
  }
  return null;
}
