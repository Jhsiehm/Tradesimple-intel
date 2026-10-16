import { useState } from 'react';
import { write, message } from './api';
import './research.css';
export function SaveExperiment({ runId, description, onOpen }: { runId: string; description: string; onOpen: () => void }) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState(description.slice(0, 200)), [hypothesis, setHypothesis] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await write('experiments', { runId, title, hypothesis }); setSaved(true); } catch (e) { setError(message(e)); } finally { setBusy(false); } };
  return <section className="research-save" aria-label="Save experiment">
    {saved ? <p>Experiment saved with frozen inputs. <button className="link" onClick={onOpen}>Open Experiments</button></p> : <>
      <button className="panels-btn" onClick={() => setOpen(!open)} aria-expanded={open}>Save experiment</button>
      {open && <div className="research-form">
        <label>Title<input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></label>
        <label>Hypothesis or research question<textarea value={hypothesis} maxLength={4000} onChange={e => setHypothesis(e.target.value)} placeholder="What did you test? A rejected hypothesis is still useful research." /></label>
        <p>This preserves the exact signals, prices, results, and engine used by this run.</p>
        <button className="bt-run" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save frozen run'}</button>
      </div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
