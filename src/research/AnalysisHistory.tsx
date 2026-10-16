import { useEffect, useRef, useState } from 'react';
import { read, message } from './api';
import { describeAnalysis, analysisEventLabel, type Analysis, type AnalysisEvent, type AnalysisSummary } from './analysis-records';

function EventRecord({ event }: { event: AnalysisEvent }) {
  const [open, setOpen] = useState(false);
  const raw = open ? JSON.stringify(event.data, null, 2) : '';
  return <details onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{event.sequence} · {analysisEventLabel(event)} <time dateTime={event.at}>{event.at}</time></summary>
    {open && <><pre className="analysis-payload">{raw.slice(0, 50000)}</pre>{raw.length > 50000 && <p>Preview limited to 50,000 characters. Open the full journal JSON for the complete payload.</p>}</>}
  </details>;
}

export function AnalysisHistory() {
  const [items, setItems] = useState<AnalysisSummary[]>([]), [selected, setSelected] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [allEvents, setAllEvents] = useState(false), [page, setPage] = useState(0);
  const [expandedAnswer, setExpandedAnswer] = useState(false);
  const ticket = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { let live = true; void read<{ items: AnalysisSummary[] }>('analyses').then(out => { if (live) setItems(out.items); }).catch(err => { if (live) setError(message(err)); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; ticket.current++; }; }, []);
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected?.id]);
  const open = async (id: string) => {
    const current = ++ticket.current; setBusy(true); setError(''); setSelected(null); setPage(0); setExpandedAnswer(false);
    try { const out = await read<{ analysis: Analysis }>(`analyses/${id}`); if (current === ticket.current) setSelected(out.analysis); }
    catch (err) { if (current === ticket.current) setError(message(err)); }
    finally { if (current === ticket.current) setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true); setError('');
    try { const out = await read<{ items: AnalysisSummary[] }>('analyses'); setItems(out.items); if (selected) await open(selected.id); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  };
  const shown = items.filter(item => (!status || item.status === status) && `${item.question} ${item.mode} ${item.id}`.toLowerCase().includes(query.toLowerCase()));
  const summary = selected ? describeAnalysis(selected) : null;
  const events = selected?.events.filter(event => allEvents || event.kind !== 'event') || [];
  const pages = Math.max(1, Math.ceil(events.length / 30));
  return <section className="research-content analysis-history">
    <h2>Execution history</h2>
    <p>Inspect what a controlled analysis received and produced. Includes isolated, context-aware and paired runs; ordinary conversations are not included.</p>
    <div className="research-form research-mapping"><label>Search executions<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Question, memory mode or execution ID" /></label><label>Execution status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['completed', 'failed', 'aborted', 'clarification', 'incomplete'].map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="research-actions"><button className="panels-btn" disabled={busy || loading} onClick={() => void refresh()}>Refresh executions</button><span>Latest 200 records · {shown.length} match{shown.length === 1 ? '' : 'es'}</span></div>
    {(loading || busy) && <p role="status" className="research-working">Loading execution records…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !shown.length && <p>{items.length ? 'No executions match these filters.' : 'No controlled executions yet. Start an isolated or context-aware analysis from Memory.'}</p>}
    <div className="data-workbench" data-selected={Boolean(selected)}>
      <section className="data-library" aria-label="Saved executions"><div className="research-list">{shown.map(item => <button key={item.id} className="research-item" disabled={busy} aria-pressed={selected?.id === item.id} onClick={() => void open(item.id)}><strong>{item.question || 'Untitled analysis'}</strong><span>{item.status} · {item.mode}</span><time dateTime={item.createdAt}>{item.createdAt}</time></button>)}</div></section>
      {selected && summary && <section className="research-content" key={selected.id}>
        <h3 tabIndex={-1} ref={heading}>{summary.question || 'Recorded analysis'}</h3>
        <p><strong>{selected.status}</strong> · {summary.mode || 'Mode not recorded'} · {summary.provider || 'Provider not recorded'} / {summary.model || 'Model not recorded'}</p>
        {selected.status === 'incomplete' && <p role="status">No terminal record exists. This may be running or interrupted. Refresh to check; this view will not restart it.</p>}
        {summary.error && <p role="alert">Recorded error: {summary.error}</p>}
        <p>{summary.modelCalls} model request{summary.modelCalls === 1 ? '' : 's'} · {summary.toolCalls} tool request{summary.toolCalls === 1 ? '' : 's'} · {selected.events.length} journal events</p>
        <h3>{selected.status === 'completed' ? 'Recorded answer' : 'Recorded text · may be partial'}</h3>
        {summary.answer ? <><p className="analysis-answer">{expandedAnswer ? summary.answer : summary.answer.slice(0, 1000)}</p>{summary.answer.length > 1000 && <button className="panels-btn" aria-expanded={expandedAnswer} onClick={() => setExpandedAnswer(!expandedAnswer)}>{expandedAnswer ? 'Show less' : 'Read full recorded text'}</button>}</> : <p>No answer text was recorded.</p>}
        <details><summary>Memory supplied · {summary.records.length} saved revisions</summary><p>Snapshot: {summary.snapshotId || 'Not recorded'}<br />Memory cutoff: {summary.knownAt || 'Not recorded'}</p>{summary.records.map((record, i) => <section key={i}><h4>{record.title} · revision {String(record.revision ?? 'unknown')}</h4><p className="analysis-answer">{record.conclusion}</p></section>)}<p>This is the context recorded at execution time. It does not establish current approval or restrict live external sources to the memory cutoff.</p></details>
        <h3>Execution trail</h3><label><input type="checkbox" checked={allEvents} onChange={e => { setAllEvents(e.target.checked); setPage(0); }} /> Include streamed tokens and status events</label>
        <div>{events.slice(page * 30, (page + 1) * 30).map(event => <EventRecord key={event.sequence} event={event} />)}</div>
        {pages > 1 && <div className="research-actions"><button className="panels-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous events</button><span>Page {page + 1} of {pages}</span><button className="panels-btn" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next events</button></div>}
        <details><summary>Integrity and limitations</summary><p className="research-hash">Execution: {selected.id}<br />Journal head: {selected.headHash}</p><p>The server checks the stored hash chain when reading this record. Checksums detect inconsistency; they do not certify source truth or reproduce a hosted model. Recorded citation identifiers alone do not prove claim support.</p></details>
        <a href={`/api/research/analyses/${selected.id}`} target="_blank" rel="noreferrer">Open full journal JSON</a>
      </section>}
    </div>
  </section>;
}
