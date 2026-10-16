import type { AskApi } from '../ask/useAsk';
import type { AgentContext } from '../agent/context';
import { ResearchHome } from './ResearchHome';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RULES } from '../../shared/backtestSpec.mjs';
import type { StageList } from '../types';
import { DEMO } from '../lib/api';
import { BacktestResults } from '../backtest/BacktestResults';
import { Notebooks } from './Notebooks';
import { ConvergenceLab } from './ConvergenceLab';
import { DataHub, EventTable } from './DataHub';
import { read, write, message, type DatasetSummary, type Experiment, type ExperimentSummary } from './api';
import '../backtest/backtest.css';
import './research.css';
export function ResearchBoard({ ask, context, onClose, onFollow, onList }: { ask: AskApi; context: AgentContext; onClose: () => void; onFollow: (action: string) => void; onList: (list: StageList) => void }) {
  const [tab, setTab] = useState<'experiments' | 'data' | 'convergence' | 'notebooks' | 'home'>('home');
  const [items, setItems] = useState<ExperimentSummary[]>([]), [selected, setSelected] = useState<Experiment | null>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null), [title, setTitle] = useState(''), [hypothesis, setHypothesis] = useState('');
  const [holdDays, setHoldDays] = useState(30), [costBps, setCostBps] = useState(5), [slippageBps, setSlippageBps] = useState(5), [sides, setSides] = useState('buy');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const ticket = useRef(0);
  const [copied, setCopied] = useState(false);
  const load = async () => { const out = await read<{ items: ExperimentSummary[] }>('experiments'); setItems(out.items || []); };
  useEffect(() => { void load().catch(e => setError(message(e))).finally(() => setLoading(false)); }, []);
  useEffect(() => { onList({ title: 'Research', blurb: 'Experiments and versioned datasets', empty: 'Inspect saved experiments in the center board.', items: [], status: { source: 'Local research registry', asOf: selected?.createdAt || '', latency: 'Frozen snapshots; original feed timing is preserved per run.' } }); }, [onList, selected]);
  const open = async (id: string) => { const t = ++ticket.current; setError(''); setNotice(''); setDataset(null); setBusy(true); try { const out = await read<{ experiment: Experiment }>(`experiments/${id}`); if (t === ticket.current) { setSelected(out.experiment); setTab('experiments'); setCopied(false); history.replaceState(null, "", `#research/${out.experiment.id}`); } } catch (e) { if (t === ticket.current) setError(message(e)); } finally { if (t === ticket.current) setBusy(false); } };
  useEffect(() => { const onHash = () => { const id = location.hash.match(/^#research\/(exp_[a-f0-9]+)$/)?.[1]; if (id) void open(id); }; onHash(); window.addEventListener('hashchange', onHash); return () => { ticket.current++; window.removeEventListener('hashchange', onHash); }; }, []);
  const run = async (fresh?: Experiment) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const out = await write<{ experiment: Experiment }>('run', fresh ? { title: `${fresh.title.slice(0, 180)} · rerun`, hypothesis: fresh.hypothesis, parentId: fresh.id, spec: fresh.run.result.spec, datasetId: fresh.run.provenance.dataset?.id, rules: fresh.run.result.spec.rules } : { title, hypothesis, datasetId: dataset?.id, rules: { ...DEFAULT_RULES, holdDays, costBps, slippageBps, sides } });
      setSelected(out.experiment); setTab('experiments'); setCopied(false); history.replaceState(null, "", `#research/${out.experiment.id}`); setDataset(null); await load();
      setNotice(out.experiment.run.result.ok ? 'Saved a new immutable run. Inspect its coverage and caveats below.' : 'The run failed and its error was preserved. You can rerun it later.');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const replay = async () => {
    if (!selected) return; setBusy(true); setError(''); setNotice('');
    try { const out = await write<{ matches: boolean }>(`runs/${selected.runId}/replay`, {}); setNotice(out.matches ? 'Replay verified: all engine outputs and statistical checks match the saved run exactly. No data was fetched.' : 'Replay mismatch. Export and inspect this run before relying on it.'); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const result = selected?.run.result;
  return <div className="board bt research" data-home={tab === 'home'}><header className="board-head"><div className="board-title"><strong>Research</strong><span>Preserve what you tested and the evidence behind it.</span><button className="tl-close" onClick={onClose} aria-label="Close research">×</button></div><div className="bt-tabs"><button className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Research home</button><button className={tab === 'experiments' ? 'on' : ''} onClick={() => setTab('experiments')}>Experiments</button><button className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Data Hub</button><button className={tab === 'convergence' ? 'on' : ''} onClick={() => setTab('convergence')}>Convergence</button><button className={tab === 'notebooks' ? 'on' : ''} onClick={() => setTab('notebooks')}>Notebooks</button></div></header>
    <div className="board-scroll bt-body">
      {DEMO ? <p className="bt-note">The research registry requires the local server and is not available in the static demo.</p> : tab === 'home' ? (ask.open ? <div className="research-portable-placeholder"><p>Your investigation is open in the portable panel.</p><button className="bt-run" onClick={ask.close}>Return conversation here</button></div> : <ResearchHome ask={ask} context={context} onFollow={onFollow} onTool={setTab} />) : tab === 'notebooks' ? <Notebooks /> : tab === 'convergence' ? <ConvergenceLab /> : tab === 'data' ? <DataHub onRun={d => { ticket.current++; setDataset(d); setTitle(`${d.name} v${d.version}`); setHypothesis(''); setSelected(null); history.replaceState(null, '', '#research'); setTab('experiments'); setNotice(''); setError(''); }} /> : <>
        <p className="bt-note">Saved runs are immutable. Replay uses frozen inputs; rerun creates a new record. Imports and experiments belong to this server’s owner. Source timestamps are retained; institutional team permissions are not part of this release.</p>
        {loading && <p role="status">Loading experiments…</p>}
        <div className="research-actions"><button className="panels-btn" onClick={() => onFollow('bt:')}>Open Backtest</button><button className="panels-btn" onClick={() => setTab('data')}>Import dataset</button></div>
        {!loading && !items.length && !dataset && <p>Save a result from Backtest, or import transaction signals to create your first experiment. Failed and negative results can be preserved too.</p>}
        {items.length > 0 && <div className="research-list">{items.map(e => <button disabled={busy} aria-pressed={selected?.id === e.id} className="research-item" key={e.id} onClick={() => void open(e.id)}><strong>{e.title}</strong><span>{e.status} · {e.createdAt.slice(0, 19).replace('T', ' ')} UTC</span></button>)}</div>}
        {dataset && <fieldset disabled={busy} className="research-form"><legend>New experiment · {dataset.name} v{dataset.version}</legend><label>Title<input maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Hypothesis<textarea value={hypothesis} maxLength={4000} onChange={e => setHypothesis(e.target.value)} /></label><div className="research-mapping"><label>Hold (calendar days)<input type="number" min={1} max={730} value={holdDays} onChange={e => setHoldDays(Number(e.target.value))} /></label><label>Cost per side (bps)<input type="number" min={0} max={300} value={costBps} onChange={e => setCostBps(Number(e.target.value))} /></label><label>Slippage per side (bps)<input type="number" min={0} max={300} value={slippageBps} onChange={e => setSlippageBps(Number(e.target.value))} /></label><label>Signal side<select value={sides} onChange={e => setSides(e.target.value)}><option value="buy">Buys</option><option value="sell">Sells as shorts</option><option value="both">Both</option></select></label></div><p>SPY benchmark · equal weight · entry on the next trading day at the open. Price history is retrieved from the existing market feed, then frozen with the run.</p><button className="bt-run" disabled={!title.trim() || !Number.isFinite(holdDays) || holdDays < 1 || holdDays > 730 || costBps < 0 || costBps > 300 || slippageBps < 0 || slippageBps > 300} onClick={() => void run()}>Run and save experiment</button></fieldset>}
        {busy && <p role="status">Working… A new run can take up to a minute while source data loads.</p>}
        {error && <p role="alert" className="bt-note warn">{error}</p>}{notice && <p role="status" className="bt-note">{notice}</p>}
        {selected && <section className="research-content"><h2>{selected.title}</h2><p>{selected.hypothesis || 'No hypothesis recorded.'}</p><p>Saved {selected.createdAt} · {!result?.ok ? 'Run failed' : result.building ? 'Partial input coverage' : 'Run completed'}{selected.parentId ? ` · derived from ${selected.parentId}` : ''}</p>
          <div className="research-actions"><button className="panels-btn" disabled={busy || !selected.run.inputCounts} onClick={() => void replay()}>Verify offline replay</button><a className="panels-btn" href={`/api/research/runs/${selected.runId}/export`}>Export frozen run</a><button className="panels-btn" disabled={busy} onClick={() => void run(selected)}>Rerun as new experiment</button></div>
          <details><summary>Input manifest and event lineage</summary><p>{selected.run.inputCounts ? `${selected.run.inputCounts.signals} engine signals · ${selected.run.inputCounts.priced} priced symbols · ${selected.run.inputCounts.benchmarks} benchmarks` : 'No calculation inputs: see the recorded failure.'}</p><p>{selected.run.provenance.recordCount} source records preserved · {selected.run.provenance.matchedSignals} matched signals before caps.</p><p>{selected.run.provenance.identityBasis}</p><p className="research-hash">Input checksum: {selected.run.inputHash}<br/>Engine checksum: {selected.run.engineId}<br/>Identity version: {selected.run.provenance.identityVersion}</p>{selected.run.provenance.events.length > 0 && <><p>First 20 normalized events; export contains all inputs and source records retained by the adapters.</p><EventTable events={selected.run.provenance.events} /></>}</details>
          {result?.ok ? <BacktestResults frozen key={selected.runId} run={{ ...result, runId: selected.runId }} onFollow={onFollow} onCopy={() => { void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#research/${selected.id}`).then(() => setCopied(true)).catch(e => setError(message(e))); }} copied={copied} /> : <p className="bt-note warn">{result?.error || 'Run did not produce a result.'}</p>}
        </section>}
      </>}
    </div>
  </div>;
}
