import { useEffect, useRef, useState } from 'react';
import { ActivityFeedback } from '../ActivityFeedback';
import { message } from '../api';
import { policyRequest } from './api';
import { ProtocolForm } from './ProtocolForm';
import { EvidenceImport } from './EvidenceImport';
import { EvidenceTable } from './EvidenceTable';
import { StudyReport } from './StudyReport';
import { evidenceLabels, statusLabel, type EvidenceKind, type EvidenceRecord, type PolicyInvestigation, type PolicyProtocol, type PolicySummary } from './types';
import './policy.css';

type Detail = { investigation: PolicyInvestigation };
type Listing = { items: PolicySummary[]; capabilities?: Record<string, unknown> };
const studyId = () => location.hash.match(/^#research\/policy\/([^/]+)$/)?.[1];
export function PolicyWorkspace() {
  const [items, setItems] = useState<PolicySummary[]>([]), [selected, setSelected] = useState<PolicyInvestigation | null>(null);
  const [capabilities, setCapabilities] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [showDraft, setShowDraft] = useState(false), [draft, setDraft] = useState<PolicyProtocol | undefined>(), [draftKey, setDraftKey] = useState(0);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true);
  const accept = (investigation: PolicyInvestigation) => {
    setSelected(investigation); setItems(previous => [investigation, ...previous.filter(item => item.id !== investigation.id)]);
    history.replaceState(null, '', `#research/policy/${encodeURIComponent(investigation.id)}`);
  };
  const action = async (label: string, task: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(label); setError(''); setNotice('');
    try { await task(request.signal); return true; }
    catch (cause) { if (mounted.current && !request.signal.aborted) setError(message(cause)); return false; }
    finally { if (mounted.current && controller.current === request) { setBusy(''); setLoading(false); } }
  };
  const open = (id: string) => action('Opening saved study…', async signal => {
    const out = await policyRequest<Detail>(`/${encodeURIComponent(id)}`, signal); accept(out.investigation); setShowDraft(false);
  });
  useEffect(() => {
    mounted.current = true;
    void action('Loading policy research…', async signal => {
      const out = await policyRequest<Listing>('', signal); setItems(out.items || []); setCapabilities(out.capabilities || null);
      const id = studyId(); if (id) { const detail = await policyRequest<Detail>(`/${encodeURIComponent(id)}`, signal); accept(detail.investigation); }
    });
    const onHash = () => { const id = studyId(); if (id) void open(decodeURIComponent(id)); };
    window.addEventListener('hashchange', onHash);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('hashchange', onHash); };
  }, []);
  const create = (protocol: PolicyProtocol) => void action('Saving locked study…', async signal => {
    const out = await policyRequest<Detail>('', signal, { protocol }); accept(out.investigation); setShowDraft(false);
    setNotice('Protocol saved. Collection preserves source records; evaluation will retain missing evidence and exclusions.');
  });
  const mutate = (operation: string, label: string, payload: object = {}) => action(label, async signal => {
    const out = await policyRequest<Detail>(`/${encodeURIComponent(selected!.id)}/${operation}`, signal, { revision: selected!.revision, ...payload }); accept(out.investigation);
    setNotice(operation === 'evaluate' ? 'Evidence evaluated and the calculation record saved. Review what was included, excluded, and still unknown.' : operation === 'collect' ? 'Collection finished. Inspect actual source coverage and timing before interpreting the study.' : 'Evidence appended. Inspect the new readiness assessment before evaluating.');
  });
  const clone = (copy?: PolicyProtocol) => { setDraft(copy); setDraftKey(value => value + 1); setShowDraft(true); setError(''); setNotice(''); };
  const replay = () => void action('Replaying frozen evaluation…', async signal => {
    const out = await policyRequest<{ matches: boolean }>(`/${encodeURIComponent(selected!.id)}/replay`, signal, {});
    setNotice(out.matches ? 'Offline replay matches the saved evaluation. No fresh source data was fetched.' : 'Replay does not match. Export this study and inspect the recorded inputs before relying on it.');
  });
  const refresh = () => void action('Refreshing saved studies…', async signal => {
    const out = await policyRequest<Listing>('', signal); setItems(out.items || []); setCapabilities(out.capabilities || null);
    if (selected) { const detail = await policyRequest<Detail>(`/${encodeURIComponent(selected.id)}`, signal); accept(detail.investigation); }
  });
  const cancelCollection = async () => {
    if (!selected) return; setCancelling(true); setError('');
    try {
      await policyRequest<{ stopping: boolean }>(`/${encodeURIComponent(selected.id)}/cancel`, new AbortController().signal, {});
      controller.current?.abort(); setBusy(''); setNotice('Collection cancellation requested. Completed source receipts are preserved; refresh this study to inspect the final checkpoint.');
    } catch (cause) { setError(message(cause)); }
    finally { setCancelling(false); }
  };
  const collecting = busy === 'Collecting legislative actions and news observations…' || selected?.status === 'collecting';
  const working = Boolean(busy) || collecting || cancelling;
  return <section className="policy-workspace" aria-labelledby="policy-title">
    <div className="policy-heading"><div><h2 id="policy-title">Legislative action before news</h2><p>Compare entries after public legislative release and after news coverage, using preserved evidence and predefined rules.</p></div><button className="panels-btn" disabled={working} onClick={() => clone()}>New study</button></div>
    <p className="policy-scope-note">This pilot studies specified bills and companies. It does not substitute politicians’ personal trades or automatically infer which stocks a bill benefits.</p>
    {(busy || collecting) && <div className="policy-request"><ActivityFeedback>{busy || 'Collection is running on this server…'}</ActivityFeedback>{collecting ? <button className="panels-btn" disabled={cancelling} onClick={() => void cancelCollection()}>{cancelling ? 'Requesting cancellation…' : 'Cancel collection'}</button> : <button className="panels-btn" onClick={() => { controller.current?.abort(); setBusy(''); setLoading(false); setNotice('Stopped waiting. A server action may still finish; refresh saved studies before retrying it.'); }}>Stop waiting</button>}</div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!loading && !selected && !showDraft && <ProtocolForm key={draftKey} busy={working} onCreate={create} />}
    {showDraft && <ProtocolForm key={draftKey} initial={draft} busy={working} onCreate={create} onCancel={() => setShowDraft(false)} />}
    <div className="policy-saved-heading"><h3>Saved studies <span className="research-count">{items.length}</span></h3><button className="panels-btn" disabled={Boolean(busy) || cancelling} onClick={refresh}>Refresh studies</button></div>
    {!loading && !items.length && <p className="policy-empty">No studies saved yet. Define the question above to create a locked protocol.</p>}
    {items.length > 0 && <div className="policy-study-list">{items.map(item => <button className="research-item" key={item.id} disabled={working} aria-pressed={item.id === selected?.id} onClick={() => void open(item.id)}><strong>{item.protocol?.title || item.title || item.id}</strong><span>{statusLabel(item.status || 'saved')}{item.protocol?.from ? ` · ${item.protocol.from} → ${item.protocol.to}` : ''}</span></button>)}</div>}
    {selected && !showDraft && <section className="policy-investigation" key={selected.id}>
      <div className="policy-heading"><div><h3>{selected.protocol.title}</h3><p>{statusLabel(selected.status)} · revision {selected.revision} · saved {selected.createdAt}</p></div><button className="panels-btn" disabled={working} onClick={() => clone(selected.protocol)}>Create new version</button></div>
      {selected.lastError && <p role="alert">{selected.lastError}</p>}
      <details><summary>Locked question, trading rules, and protocol hash</summary><p>{selected.protocol.question}</p><dl className="policy-rules"><div><dt>Bills</dt><dd>{selected.protocol.billIds.join(', ')}</dd></div><div><dt>Universe</dt><dd>{selected.protocol.universe.join(', ')}</dd></div><div><dt>Period / holdout</dt><dd>{selected.protocol.from} → {selected.protocol.to} / {selected.protocol.holdoutFrom}</dd></div><div><dt>Entry / exit</dt><dd>Public release + {selected.protocol.latencySeconds} seconds; hold {selected.protocol.holdingMinutes} minutes</dd></div><div><dt>Round-trip costs</dt><dd>{selected.protocol.costBps} basis points</dd></div><div><dt>Benchmarks</dt><dd>{[selected.protocol.benchmark, selected.protocol.sectorBenchmark].filter(Boolean).join(', ')}</dd></div><div><dt>News timing</dt><dd>{selected.protocol.newsArchive} · {statusLabel(selected.protocol.newsTimeBasis)}</dd></div></dl><code className="policy-hash">{selected.protocolHash}</code><p>Editing requires a new study. Existing source records and calculation revisions remain preserved.</p></details>
      <section className="policy-readiness" aria-labelledby="policy-readiness-title"><h3 id="policy-readiness-title">{selected.readiness.ready ? 'Evidence eligible for a bounded comparison' : 'Evidence still needed'}</h3><dl className="policy-evidence-counts">{Object.entries(evidenceLabels).map(([kind, label]) => <div key={kind}><dt>{label}</dt><dd>{(selected.evidence[kind as EvidenceKind] || []).length.toLocaleString()}</dd></div>)}</dl>{selected.readiness.gaps?.length > 0 && <ul>{selected.readiness.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}<p className="policy-note">Eligibility checks the saved assertions and available observations. It does not certify exhaustive legislative or news history.</p></section>
      <div className="research-actions"><button className="panels-btn" disabled={working} onClick={() => void mutate('collect', 'Collecting legislative actions and news observations…')}>Collect public evidence</button><button className="bt-run" disabled={working} onClick={() => void mutate('evaluate', 'Evaluating frozen evidence…')}>{selected.readiness.ready ? 'Run paired comparison' : 'Evaluate evidence and record gaps'}</button></div>
      <EvidenceImport busy={working} onImport={(kind: EvidenceKind, records: EvidenceRecord[]) => mutate('import', 'Validating and saving evidence…', { kind, records })} />
      <StudyReport investigation={selected} />
      <div className="research-actions">{selected.result && <a className="panels-btn" href={`/api/research/policy/${encodeURIComponent(selected.id)}/archive`} download>Export study and replay engine</a>}<a className="panels-btn" href={`/api/research/policy/${encodeURIComponent(selected.id)}/export`} download>Export evidence JSON</a>{selected.result && <button className="panels-btn" disabled={working} onClick={replay}>Verify offline replay</button>}</div>
      <EvidenceTable investigation={selected} />
    </section>}
    {capabilities && <details className="policy-capabilities"><summary>Available collection and analysis capabilities</summary><p>Configuration describes what this server can attempt. Successful retrieval is not proof of complete historical coverage.</p><pre>{JSON.stringify(capabilities, null, 2)}</pre></details>}
  </section>;
}
