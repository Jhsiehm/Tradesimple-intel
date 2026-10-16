import { useEffect, useState } from 'react';
import { read, write, message } from './api';

type Summary = { id: string; name: string; version: number; rows: number; createdAt: string; contentHash: string };
type Assertion = { id: string; relationshipId: string; subject: string; predicate: string; object: string; effectiveFrom: string; effectiveTo: string | null; availableAt: string; sourceUrl: string; documentHash: string | null };
type Result = { snapshotId: string; contentHash: string; effectiveAt: string; knownAt: string; items: Assertion[]; ambiguous: { relationshipId: string; assertionIds: string[]; reason: string }[]; caveats: string[] };
const predicates = ['owns', 'operates', 'located-in', 'regulated-by', 'member-of', 'issued-by', 'exposed-to'];
const draftKey = 'research.relationships.draft.v1';
const blank = { name: '', content: '', effectiveAt: '', knownAt: '', subject: '', predicate: '' };
function initialDraft() {
  try { const saved = JSON.parse(sessionStorage.getItem(draftKey) || '{}'); return Object.fromEntries(Object.entries(blank).map(([k, v]) => [k, typeof saved[k] === 'string' ? saved[k] : v])) as typeof blank; }
  catch { return blank; }
}
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function RelationshipHistory() {
  const [draft, setDraft] = useState(initialDraft);
  const [items, setItems] = useState<Summary[]>([]), [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* The current draft remains usable if browser storage is full. */ } }, [draft]);
  useEffect(() => {
    let active = true;
    void read<{ items: Summary[] }>('relationships').then(out => { if (active) { setItems(out.items); setSelected(out.items[0]?.id || ''); } }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const update = (key: keyof typeof blank, value: string) => { setDraft(old => ({ ...old, [key]: value })); setResult(null); setNotice(''); };
  async function importSnapshot() {
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const parsed = JSON.parse(draft.content);
      const rows = Array.isArray(parsed) ? parsed : parsed?.rows;
      if (!Array.isArray(rows)) throw new Error('Provide a JSON array of assertions, or an object containing rows.');
      const out = await write<{ snapshot: Omit<Summary, 'rows'> & { rows: Assertion[] } }>('relationships', { name: draft.name.trim(), rows });
      const s = out.snapshot;
      setItems(old => [{ ...s, rows: s.rows.length }, ...old.filter(x => x.id !== s.id)]); setSelected(s.id);
      setNotice(`Saved ${s.name}, version ${s.version}, with ${s.rows.length} assertions. Use the dated lookup below to inspect it.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function query() {
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try { const out = await write<{ result: Result }>(`relationships/${selected}/query`, { effectiveAt: draft.effectiveAt, knownAt: draft.knownAt, subject: draft.subject.trim(), predicate: draft.predicate }); setResult(out.result); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function exportSnapshot() {
    setBusy(true); setError('');
    try { const out = await read<{ snapshot: unknown }>(`relationships/${selected}`); download(out.snapshot, `${selected}.json`); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="research-content relationship-history">
    <div><h2>Relationship history</h2><p>Inspect ownership, operations and exposure using what was known at a particular date.</p></div>
    <p className="bt-note">These are researcher-supplied assertions. Evidence links and archived documents do not independently verify a claim. This lookup does not change backtest eligibility or current ticker mappings.</p>
    {loading && <p role="status">Loading relationship snapshots…</p>}
    {error && <p className="bt-note warn" role="alert">{error}</p>}
    {notice && <p className="bt-note" role="status">{notice}</p>}
    <details open={!loading && !items.length ? true : undefined}>
      <summary>Import a relationship snapshot</summary>
      <fieldset disabled={busy} className="research-form"><legend>New immutable version</legend>
        <label>Snapshot name<input value={draft.name} maxLength={200} onChange={e => update('name', e.target.value)} /></label>
        <label>Load a JSON file<input type="file" accept=".json,application/json" onChange={e => { const file = e.target.files?.[0]; if (!file) return; setError(''); if (file.size > 10 * 1024 * 1024) { setError('Choose a JSON file smaller than 10 MiB.'); return; } setBusy(true); void file.text().then(content => update('content', content)).catch(e => setError(message(e))).finally(() => setBusy(false)); e.target.value = ''; }} /></label>
        <label>Relationship assertions (JSON)<textarea className="research-data" spellCheck={false} value={draft.content} onChange={e => update('content', e.target.value)} aria-describedby="relationship-import-help" /></label>
        <p id="relationship-import-help">Up to 5,000 assertions. Required: id, relationshipId, subject, predicate, object, effectiveFrom, availableAt and sourceUrl. Optional: effectiveTo, status and documentHash. Each version contains the full snapshot.</p>
        <details><summary>Field guide</summary><p>Use typed IDs such as company:example, facility:plant-1 or jurisdiction:US-NY. Other entity types: security, agency, institution, person, industry and policy.</p><p>Predicates: {predicates.join(', ')}. Dates use YYYY-MM-DD; availableAt also accepts a UTC timestamp ending in Z. effectiveTo is exclusive. Status is asserted or retracted. Revisions share relationshipId and retain their subject and predicate.</p><p>sourceUrl must point to evidence. Optional documentHash refers to a source document already archived by this installation. No example claims are loaded automatically.</p></details>
        <button className="bt-run" disabled={!draft.name.trim() || !draft.content.trim()} onClick={() => void importSnapshot()}>Import snapshot</button>
      </fieldset>
    </details>
    {!loading && !items.length && <p>No snapshots yet. Import your evidence-backed relationship assertions to begin.</p>}
    {items.length > 0 && <fieldset disabled={busy} className="research-form"><legend>Historical lookup</legend>
      <label>Saved snapshot<select value={selected} onChange={e => { setSelected(e.target.value); setResult(null); setNotice(''); setError(''); }}>{items.map(s => <option key={s.id} value={s.id}>{s.name} · v{s.version} · {s.rows} assertions</option>)}</select></label>
      <div className="research-mapping">
        <label>Effective on<input type="date" value={draft.effectiveAt} onChange={e => update('effectiveAt', e.target.value)} /></label>
        <label>Known by (UTC date)<input type="date" value={draft.knownAt} onChange={e => update('knownAt', e.target.value)} /></label>
        <label>Subject (optional)<input value={draft.subject} placeholder="company:example" onChange={e => update('subject', e.target.value)} /></label>
        <label>Relationship<select value={draft.predicate} onChange={e => update('predicate', e.target.value)}><option value="">All relationships</option>{predicates.map(p => <option key={p}>{p}</option>)}</select></label>
      </div>
      <p>“Effective on” selects when the relationship applied. “Known by” excludes later publications and corrections. Date-only availability is eligible at the end of that UTC day.</p>
      <div className="research-actions"><button className="bt-run" disabled={!selected || !draft.effectiveAt || !draft.knownAt} onClick={() => void query()}>Look up relationships</button><button className="panels-btn" disabled={!selected} onClick={() => void exportSnapshot()}>Export snapshot JSON</button></div>
    </fieldset>}
    {busy && <p role="status">Working…</p>}
    {result && <section aria-live="polite"><h3>{result.items.length} resolved · {result.ambiguous.length} ambiguous</h3><p>Effective {result.effectiveAt} · known by {result.knownAt}</p>
      {!result.items.length && <p>No resolved relationships match this lookup. This does not prove that no relationship existed.</p>}
      {result.items.length > 0 && <div className="research-table" tabIndex={0} role="region" aria-label="Resolved historical relationships"><table><thead><tr><th scope="col">Subject and relationship</th><th scope="col">Object</th><th scope="col">Effective interval</th><th scope="col">Available / evidence</th></tr></thead><tbody>{result.items.map(r => <tr key={r.id}><td>{r.subject}<small>{r.predicate} · {r.relationshipId}</small></td><td>{r.object}</td><td>{r.effectiveFrom}<small>Until {r.effectiveTo || 'unspecified'}{r.effectiveTo ? ' (exclusive)' : ''}</small></td><td>{r.availableAt}<small><a href={r.sourceUrl} target="_blank" rel="noreferrer">Source evidence</a> · {r.documentHash ? 'Document archived' : 'Link only'}</small></td></tr>)}</tbody></table></div>}
      {result.ambiguous.length > 0 && <div className="bt-note warn"><h3>Conflicting assertions excluded</h3><ul>{result.ambiguous.map(a => <li key={a.relationshipId}>{a.relationshipId}: {a.assertionIds.join(', ')}. {a.reason}</li>)}</ul></div>}
      <details><summary>Interpretation and provenance</summary><ul>{result.caveats.map(c => <li key={c}>{c}</li>)}</ul><p className="research-hash">Snapshot: {result.snapshotId}<br />Content checksum: {result.contentHash}</p></details>
      <button className="panels-btn" onClick={() => download(result, `${result.snapshotId}-lookup.json`)}>Export lookup JSON</button>
    </section>}
  </section>;
}
