import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { usd } from '../lib/format';
type Recipient = { rank: number; name: string; recipientId: string; uei: string | null; obligations: number; symbols: string[]; mapping: string };
type Universe = { total: number; core: number; onDemand: number; historicalInsiderScope: number; asOf: string; selection: string; contractors: { fy: number; count: number; mapped: number; note: string; items: Recipient[] } };
export function UniverseCoverage() {
  const [data, setData] = useState<Universe | null>(null), [error, setError] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(0);
  useEffect(() => { let live = true; void api<Universe>('/api/universe').then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); }); return () => { live = false; }; }, []);
  const rows = (data?.contractors.items || []).filter(r => `${r.name} ${r.uei || ''} ${r.symbols.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <section>
    <h3>Universe coverage</h3>
    {error ? <p role="alert">Universe coverage unavailable: {error}</p> : !data ? <p>Loading registry coverage…</p> : <>
      <p>{data.total.toLocaleString()} tickers · {data.core} core names refreshed automatically · {data.onDemand} additions loaded on demand. Historical insider ingestion covers {data.historicalInsiderScope} registered tickers; additions are not backfilled yet.</p>
      <p>{data.selection} Snapshot: {data.asOf.slice(0, 10)}.</p>
      <details><summary>Top {data.contractors.count} federal contract recipients · FY{data.contractors.fy} · {data.contractors.mapped} with existing ticker links</summary>
        <p>{data.contractors.note}</p>
        <label>Find recipient, UEI, or linked ticker<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
        <div className="research-actions"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>{rows.length ? `${page * 25 + 1}–${Math.min(rows.length, (page + 1) * 25)} of ${rows.length}` : 'No matches'}</span><button disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</button><a href="/api/universe" target="_blank" rel="noreferrer">Open full JSON snapshot</a></div>
        <div className="research-table"><table><thead><tr><th>Rank</th><th>Recipient / UEI</th><th>Net obligations</th><th>Ticker mapping</th></tr></thead><tbody>{rows.slice(page * 25, (page + 1) * 25).map(r => <tr key={r.rank}><td>{r.rank}</td><td>{r.recipientId ? <a href={`https://www.usaspending.gov/recipient/${r.recipientId}/latest`} target="_blank" rel="noreferrer">{r.name}</a> : r.name}<small>{r.uei || 'UEI unavailable'}</small></td><td>{usd(r.obligations)}</td><td>{r.symbols.length ? r.symbols.join(', ') : 'Unresolved'}<small>{r.symbols.length ? 'Existing parent UEI join' : 'Ownership review needed'}</small></td></tr>)}</tbody></table></div>
      </details>
    </>}
  </section>;
}
