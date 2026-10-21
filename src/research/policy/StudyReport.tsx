import { readable, statusLabel, type PolicyInvestigation } from './types';
import type { PolicyGroupSummary, PolicyStudyRow } from '../../../shared/policyStudy.mjs';

const label = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(3)}%` : 'Not available';
const points = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(3)} pp` : 'Not available';
function ReturnSummary({ name, summary }: { name: string; summary: Partial<PolicyGroupSummary> }) {
  return <div className="policy-group-summary"><h4>{name}</h4><dl className="policy-report-values">
    <div><dt>Paired observations / events</dt><dd>{summary.pairs ?? 0} / {summary.events ?? 0}</dd></div>
    <div><dt>Mean legislative-entry return · net</dt><dd>{percent(summary.meanPolicyNet)}</dd></div>
    <div><dt>Mean news-entry return · net</dt><dd>{percent(summary.meanNewsNet)}</dd></div>
    <div><dt>Mean paired return difference</dt><dd>{points(summary.meanPairedDifference)}</dd></div>
    <div><dt>Mean legislative-entry excess vs SPY</dt><dd>{points(summary.meanPolicyExcess)}</dd></div>
    <div><dt>Mean news-entry excess vs SPY</dt><dd>{points(summary.meanNewsExcess)}</dd></div>
  </dl></div>;
}
export function StudyReport({ investigation }: { investigation: PolicyInvestigation }) {
  const result = investigation.result;
  if (!result) return <section className="policy-report"><h3>Study result</h3><p>No evaluation has been saved. Collect or import evidence, then evaluate it against the locked rules. A successful collection alone does not establish a trading result.</p></section>;
  const rows = result.rows || [], summary = result.summary;
  const preciseSummary = summary && typeof summary === 'object' && summary.units === 'decimal-return' ? summary : null;
  return <section className="policy-report" aria-labelledby="policy-report-title">
    <h3 id="policy-report-title">{result.executed ? 'Paired event-return comparison' : 'Evidence assessment · no study executed'}</h3>
    <p>{result.status ? statusLabel(result.status) : statusLabel(investigation.status)}. {result.executed ? 'Calculated from the saved inputs under the locked timing rules. This is not a portfolio backtest or a causal finding.' : 'The saved evidence does not support executing the requested comparison.'}</p>
    <p><strong>Frozen evaluation time · UTC:</strong> {readable(result.asOf)}</p>
    <div className="policy-study-scope"><strong>Requested study</strong><p>{investigation.protocol.question}</p><strong>Actual scope</strong><p>{investigation.protocol.billIds.join(', ')} · {investigation.protocol.universe.join(', ')} · {investigation.protocol.from} through {investigation.protocol.to} · {investigation.protocol.newsTimeBasis === 'publication' ? 'publication-time comparison' : 'archive first-observation comparison'} in {investigation.protocol.newsArchive}. Imported assertions remain conditional.</p></div>
    {result.claimCeiling && <p className="policy-claim"><strong>What this can support:</strong> {result.claimCeiling}</p>}
    {preciseSummary ? <>
      <ReturnSummary name="All eligible observations" summary={preciseSummary as Partial<PolicyGroupSummary>} />
      <p className="policy-note">Returns are means per eligible company-event observation, after the protocol’s round-trip costs. Differences are percentage points (pp). They do not measure portfolio performance.</p>
      {preciseSummary.train != null && <ReturnSummary name="Training period" summary={preciseSummary.train as Partial<PolicyGroupSummary>} />}
      {preciseSummary.holdout != null && <ReturnSummary name="Holdout period" summary={preciseSummary.holdout as Partial<PolicyGroupSummary>} />}
      <p><strong>Holdout status:</strong> {readable(preciseSummary.holdoutStatus)}</p>
      {preciseSummary.uncertainty != null && <p><strong>Statistical uncertainty:</strong> {readable((preciseSummary.uncertainty as { reason?: string }).reason)} No confidence interval or statistical edge is established.</p>}
    </> : typeof summary === 'string' ? <p>{summary}</p> : summary && <dl className="policy-report-values">{Object.entries(summary).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{readable(value)}</dd></div>)}</dl>}
    {result.counts && <dl className="policy-report-values">{Object.entries(result.counts).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{readable(value)}</dd></div>)}</dl>}
    {!!result.limitations?.length && <><h4>Limits on interpretation</h4><ul>{result.limitations.map((value, index) => <li key={index}>{value}</li>)}</ul></>}
    {!!result.exclusions && <details><summary>Excluded observations and reasons</summary><pre>{JSON.stringify(result.exclusions, null, 2)}</pre></details>}
    {rows.length > 0 && <details><summary>Included paired observations · {rows.length}</summary><p>Both entries follow the same processing delay and holding rule. Export contains every observation and source citation.</p><div className="research-table policy-table" tabIndex={0} role="region" aria-label="Included policy and news entry comparisons"><table><thead><tr>{['Event / company', 'Partition', 'Legislative entry · UTC', 'News entry · UTC', 'Legislative net', 'News net', 'Difference · pp'].map(value => <th scope="col" key={value}>{value}</th>)}</tr></thead><tbody>{rows.slice(0, 50).map((record, index) => {
      const row = record as unknown as PolicyStudyRow;
      return <tr key={`${row.eventId}-${row.symbol}-${index}`}><td>{row.symbol} · {row.side}<small>{row.billId} / {row.eventId}</small></td><td>{row.partition}</td><td>{row.policyEntryAt}</td><td>{row.newsEntryAt}</td><td>{percent(row.returns?.policyNet)}</td><td>{percent(row.returns?.newsNet)}</td><td>{points(row.returns?.pairedDifference)}</td></tr>;
    })}</tbody></table></div>{rows.length > 50 && <p>First 50 shown. Export the frozen archive for the full set.</p>}</details>}
    <details><summary>Full saved calculation and units</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
