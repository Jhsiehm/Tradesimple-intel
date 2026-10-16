import {ConnectorRetrievals} from './ConnectorRetrievals';
import { useEffect, useRef, useState } from 'react';
import { DEMO, post } from '../lib/api';
import { message, read, write, type Dataset, type DatasetSummary, type Preview, type EventRow } from './api';
import { ObservationHub } from './ObservationHub';
import { UniverseCoverage } from './UniverseCoverage';
const fields = ['id', 'symbol', 'eventAt', 'availableAt', 'side', 'sourceUrl', 'value'];
export function EventTable({ events }: { events: EventRow[] }) {
  return <div className="research-table"><table><thead><tr><th>Record</th><th>Entity</th><th>Event time</th><th>Available time</th></tr></thead><tbody>{events.map((e, i) => <tr key={`${e.id}:${i}`}><td>{e.id}</td><td>{e.entity.securityId}<small>{e.entity.companyId || 'No CIK mapping'}</small></td><td>{e.eventAt || 'Unknown'}</td><td>{e.availableAt}<small>{e.availabilityBasis}</small></td></tr>)}</tbody></table></div>;
}
export function DataHub({ onRun }: { onRun: (dataset: DatasetSummary) => void }) {
  const [kind, setKind] = useState<'signals' | 'observations'>('signals');
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]), [connectors, setConnectors] = useState<{ id: string; label: string; resumable?: boolean; kind?: string }[]>([]);
  const [name, setName] = useState(''), [source, setSource] = useState(''), [content, setContent] = useState(''), [format, setFormat] = useState('csv'), [connector, setConnector] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({}), [preview, setPreview] = useState<Preview | null>(null), [selected, setSelected] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) selectedHeading.current?.focus(); }, [selected?.id]);
  const revision = useRef(0), selectedRequest = useRef(0);
  const load = async () => { const out = await read<{ items: DatasetSummary[]; connectors: { id: string; label: string; resumable?: boolean; kind?: string }[] }>('datasets'); setDatasets(out.items || []); setConnectors(out.connectors || []); };
  useEffect(() => { void load().catch(e => setError(message(e))); }, []);
  const change = () => { revision.current++; setPreview(null); setNotice(''); setError(''); };
  const inspect = async (id: string) => { const ticket = ++selectedRequest.current; try { const out = await read<{ dataset: Dataset }>(`datasets/${id}`); if (ticket === selectedRequest.current) setSelected(out.dataset); } catch (e) { if (ticket === selectedRequest.current) setError(message(e)); } };
  const check = async () => {
    const ticket = revision.current; setBusy(true); setError(''); setNotice('');
    try {
      const out = await post<Preview & { error?: string }>('/api/research/preview', { name, source, content, format, mapping, connector });
      if (ticket !== revision.current) return;
      if (out.error) throw new Error(out.error);
      if (out.content !== undefined) { setContent(out.content); setFormat(out.format || 'json'); setSource(out.source || source); setConnector(''); }
      setPreview(out);
    } catch (e) { if (ticket === revision.current) setError(message(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview?.ok) return;
    setBusy(true); setError(''); setNotice('');
    try { const out = await write<{ dataset: Dataset }>('datasets', { name, source, content, format, mapping }); setSelected(out.dataset); setNotice(`Saved ${out.dataset.name} · version ${out.dataset.version}. Identical content reuses its version.`); setPreview(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <div className="research-content data-hub">
    <h2>Data Hub</h2><p className="research-lead">Bring your evidence together. Check it, save a version, then test an idea.</p><div className="data-kind" aria-label="Data type"><button className="panels-btn" aria-pressed={kind === 'signals'} onClick={() => setKind('signals')}><strong>Transaction signals</strong><span>Trades and dated buy / sell events</span></button><button className="panels-btn" aria-pressed={kind === 'observations'} onClick={() => setKind('observations')}><strong>Numeric observations</strong><span>Measurements and historical forecasts</span></button></div>
    <div hidden={kind !== 'observations'}><ObservationHub onRun={onRun} /></div><div hidden={kind !== 'signals'} className="research-content">
    <p>Use public-availability dates and registered tickers. Files stay on this server. Limit: 5,000 rows / 2 MiB.</p>
    <ConnectorRetrievals connectors={connectors} disabled={busy || DEMO} onUse={result=>{change();setContent(result.content);setFormat(result.format);setSource(result.source);setConnector('');}} />
    <details><summary>Supported tickers and source coverage</summary><UniverseCoverage /></details>
    <details open={!selected} className="data-import"><summary>Add transaction data</summary>
    <fieldset className="research-form" disabled={busy || DEMO}>
      <label>Dataset name<input value={name} maxLength={120} onChange={e => { change(); setName(e.target.value); }} placeholder="Utility insider events" /></label>
      <label>Source label<input value={source} maxLength={300} onChange={e => { change(); setSource(e.target.value); }} placeholder="Your data source and coverage" /></label>
      <label>Input<select value={connector ? `api:${connector}` : format} onChange={e => { change(); if (e.target.value === 'csv' || e.target.value === 'json') { setFormat(e.target.value); setConnector(''); } else setConnector(e.target.value.slice(4)); }}><option value="csv">CSV file or pasted CSV</option><option value="json">JSON array or items array</option>{connectors.map(c => <option value={`api:${c.id}`} key={c.id}>{c.kind === 'sqlite' ? 'Database' : 'API'} · {c.label}</option>)}</select></label>
      {!connector && <>
        <label>Choose file<input type="file" accept=".csv,.json,text/csv,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; change(); const ticket = revision.current; if (file.size > 2 * 1024 * 1024) { setError('File exceeds 2 MiB.'); return; } try { const text = await file.text(); if (ticket !== revision.current) return; setContent(text); setFormat(/\.json$/i.test(file.name) ? 'json' : 'csv'); if (!name) setName(file.name.replace(/\.(csv|json)$/i, '')); } catch (error) { setError(message(error)); } }} /></label>
        <details><summary>Paste or inspect file contents</summary><label>Import content<textarea className="research-data" value={content} onChange={e => { change(); setContent(e.target.value); }} placeholder="id,symbol,eventAt,availableAt,side,sourceUrl,value" /></label></details>
      </>}
      <details><summary>Map source columns</summary><p>Use exact header names or top-level JSON property names. Dates accept YYYY-MM-DD or UTC ISO timestamps ending in Z.</p><div className="research-mapping">{fields.map(f => <label key={f}>{f}{f === 'value' || f === 'sourceUrl' ? ' (optional)' : ''}<input value={mapping[f] ?? f} onChange={e => { change(); setMapping(m => ({ ...m, [f]: e.target.value })); }} /></label>)}</div></details>
      <div className="research-actions"><button className="bt-run" disabled={!name.trim() || (!connector && (!content || !source.trim()))} onClick={() => void check()}>Preview and validate</button>{preview?.ok && <button className="bt-run" onClick={() => void commit()}>Import validated snapshot</button>}</div>
    </fieldset></details>
    {!connectors.length && <p className="bt-note">CSV and JSON imports available. No API connections configured.</p>}
    {busy && <p role="status" className="research-working">Working…</p>}{error && <p role="alert" className="bt-note warn">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && <section><h3>Validation preview</h3>{preview.retrieval && <p>API retrieval completed: {preview.retrieval.pages} pages · {preview.retrieval.rows} records. Historical completeness is not certified.</p>}<p>{preview.coverage.valid} valid / {preview.coverage.received} rows · {preview.coverage.rejected} rejected · {preview.coverage.missingSourceUrls} without source URLs.</p>{preview.errors.length > 0 && <ul>{preview.errors.map((e, i) => <li key={i}>Data row {e.row} · {e.field}: {e.message}</li>)}</ul>}{preview.errorCount > 100 && <p>Showing the first 100 of {preview.errorCount} errors.</p>}{preview.preview.length > 0 && <EventTable events={preview.preview} />}</section>}
    <div className="data-workbench" data-selected={Boolean(selected)}><aside className="data-library" aria-label="Saved datasets">    <h3>Your transaction datasets <span className="research-count">{datasets.length}</span></h3>{!datasets.length ? <p>No datasets imported yet. Preview a file above to begin.</p> : <div className="research-list">{datasets.map(d => <button className="research-item" key={d.id} aria-pressed={selected?.id === d.id} onClick={() => void inspect(d.id)}><strong>{d.name} · v{d.version}</strong><span>{d.rows} rows · {d.createdAt.slice(0, 10)}</span></button>)}</div>}
</aside>
    {selected && <section><h3 ref={selectedHeading} tabIndex={-1}>{selected.name} · version {selected.version}</h3><p>{selected.source} · imported {selected.createdAt} · availability {selected.coverage.from} to {selected.coverage.to}</p><p>{selected.coverage.received} rows · {selected.coverage.missingSourceUrls} without original source URLs</p><details><summary>Source details, limitations and preview</summary><ul>{selected.caveats.map(c => <li key={c}>{c}</li>)}</ul><p className="research-hash">Dataset checksum: {selected.contentHash}</p><EventTable events={selected.preview} /></details><button className="bt-run" onClick={() => onRun({ ...selected, rows: selected.coverage.received })}>Create experiment from this version</button></section>}
  </div>
  </div></div>;
}
