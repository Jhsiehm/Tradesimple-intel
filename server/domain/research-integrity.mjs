import { hashOf } from './research-store.mjs';
import { resolveRelationshipPath } from './relationship-history.mjs';
/** Frozen timing audit. Source-derived dates are evidence, not a certification of publication. */
import { timestamp } from './research-events.mjs';
export const INTEGRITY_VERSION = 2;
export function auditSignals(signals, { source, now = new Date().toISOString() } = {}) {
  if (!timestamp(now)) throw new Error('Integrity audit requires a valid UTC timestamp.');
  const accepted = [], exclusions = [];
  const timing = {};
  for (const signal of signals) {
    const available = timestamp(signal.signalDate), event = timestamp(signal.tradeDate);
    let reason = null;
    if (!available) reason = 'invalid-availability';
    else if (!event) reason = 'invalid-event-time';
    else if (Date.parse(available.value) < Date.parse(event.value)) reason = 'availability-before-event';
    else if (Date.parse(available.value) > Date.parse(now)) reason = 'future-availability';
    if (reason) { exclusions.push({ id: signal.id, symbol: signal.symbol, reason, eventAt: signal.tradeDate ?? null, availableAt: signal.signalDate ?? null }); continue; }
    accepted.push(signal);
    const basis = signal.availabilityBasis || (source === 'contracts' ? 'assumed-publication-lag' : ['congress', 'form4', 'lobbying'].includes(source) ? 'source-derived-public-date' : 'unknown');
    timing[basis] = (timing[basis] || 0) + 1;
  }
  const report = { version: INTEGRITY_VERSION, evaluatedAt: now, received: signals.length, accepted: accepted.length, excluded: exclusions.length, exclusions, timing, historicalIdentity: 'current-registry-only', coverage: 'not-certified', publicationVerification: 'not-certified' };
  const notes = [{ id: 'historicalIntegrity', level: 'warn', text: 'Historical integrity: public dates may be source-derived, assumed or importer-asserted. Historical identity validity and full source coverage are not certified; inspect the frozen integrity report.' }];
  if (exclusions.length) notes.push({ id: 'invalidTiming', level: 'warn', text: `${exclusions.length} signals excluded for invalid, reversed or future timestamps. Exact records and reasons are retained in the frozen integrity report.` });
  return { signals: accepted, report, notes };
}

/** New comparisons must not silently grandfather snapshots made before timing safeguards. */
export function requireAuditedSource(run) {
  const integrity = run.provenance?.integrity;
  if (run.result?.integrityVersion !== INTEGRITY_VERSION || integrity?.version !== INTEGRITY_VERSION) {
    throw new Error('Source experiment predates current historical-integrity checks. Rerun it as a new experiment before creating a comparison; its original export remains available.');
  }
  const signals = run.provenance.matchedSignals;
  const relationship = run.provenance.relationship;
  const expectedCount = relationship ? relationship.eligible : integrity.accepted;
  if (!Array.isArray(signals) || expectedCount !== signals.length) throw new Error('Source integrity counts do not match its saved signals. Rerun the source experiment.');
  if (relationship) {
    const {snapshot,policy,decisions} = relationship;
    if (!snapshot || hashOf(snapshot.rows) !== snapshot.contentHash || snapshot.id !== policy?.snapshotId || relationship.received !== integrity.accepted || relationship.excluded !== relationship.received - relationship.eligible || !Array.isArray(decisions) || decisions.length !== relationship.received || decisions.filter(d=>d.reason === 'eligible').length !== signals.length) throw new Error('Source relationship audit is inconsistent.');
    for (const signal of signals) {
      const subject = policy.subjects?.[signal.symbol];
      if (!subject) throw new Error('Source relationship identity mapping is missing.');
      const lookup = resolveRelationshipPath(snapshot,{subject,policy,effectiveAt:signal.signalDate,knownAt:signal.signalDate});
      if (lookup.ambiguous.length || !lookup.matched) throw new Error('Source contains a relationship-ineligible signal.');
    }
  }
  const checked = auditSignals(signals, { source: run.result.spec.source, now: integrity.evaluatedAt });
  if (checked.report.excluded) throw new Error('Source contains invalid historical timing. Rerun the source experiment.');
  return { version: INTEGRITY_VERSION, sourceRunId: run.id, sourceAudit: integrity, ...(relationship ? { relationshipAudit: relationship } : {}) };
}
