import { ActivityFeedback } from './ActivityFeedback';
import { useEffect, useState } from 'react';
import { cleanSpec, type RelationshipPolicy } from '../../shared/backtestSpec.mjs';
import { read, message } from './api';
export const emptyRelationshipDraft = { relationshipSnapshot: '', relationshipPredicate: 'owns', relationshipFollowing: '', relationshipObject: '', relationshipSubjects: '', relationshipMinWeight: '' };
const predicates = ['owns','operates','located-in','regulated-by','member-of','issued-by','exposed-to'];
export type RelationshipDraft = typeof emptyRelationshipDraft;
export function parseRelationshipDraft(draft: RelationshipDraft): { policy?: RelationshipPolicy; error?: string } {
  if (!draft.relationshipSnapshot) return {};
  let subjects: unknown;
  try { subjects = JSON.parse(draft.relationshipSubjects); }
  catch { return { error: 'Enter ticker-to-entity mappings as a JSON object, such as {"AAPL":"company:your-verified-id"}.' }; }
  const checked = cleanSpec({ source: 'congress', relationship: { snapshotId: draft.relationshipSnapshot, predicate: draft.relationshipPredicate, object: draft.relationshipObject.trim(), ...(draft.relationshipMinWeight?.trim()?{minPathWeight:Number(draft.relationshipMinWeight)}:{}), path: [draft.relationshipPredicate, ...(draft.relationshipFollowing || '').split(',').filter(Boolean)], subjects } });
  return checked.ok ? { policy: checked.spec.relationship } : { error: checked.error };
}
export function RelationshipEligibility({ value, onChange }: { value: RelationshipDraft; onChange: (next: RelationshipDraft) => void }) {
  const [items, setItems] = useState<{ id: string; name: string; version: number }[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { const out = await read<{ items: typeof items }>('relationships'); setItems(out.items); } catch (e) { setError(message(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const update = (key: keyof RelationshipDraft, next: string) => onChange({ ...value, [key]: next });
  const following = (value.relationshipFollowing || '').split(',').filter(Boolean);
  return <details className="relationship-eligibility" open={value.relationshipSnapshot ? true : undefined}>
    <summary>Relationship eligibility (optional)</summary>
    <p>Require a direct relationship or a chain of up to four relationships. Every step must be effective and known by the same signal’s public date. Missing mappings, missing relationships and conflicting revisions exclude the signal.</p>
    {loading && <ActivityFeedback className="research-working">Loading relationship versions…</ActivityFeedback>}
    {error && <p role="alert">{error}</p>}
    <label>Relationship snapshot<select value={value.relationshipSnapshot} onChange={e => update('relationshipSnapshot', e.target.value)}><option value="">No relationship restriction</option>{value.relationshipSnapshot && !items.some(s => s.id === value.relationshipSnapshot) && <option value={value.relationshipSnapshot}>Selected version · {value.relationshipSnapshot}</option>}{items.map(s => <option key={s.id} value={s.id}>{s.name} · v{s.version}</option>)}</select></label>
    <button type="button" className="panels-btn" disabled={loading} onClick={() => void load()}>Refresh relationship versions</button>
    {!loading && !items.length && !error && <p>Import a snapshot in Relationships first. Your experiment draft stays available while you switch tools.</p>}
    {value.relationshipSnapshot && <>
      <label>Required relationship<select value={value.relationshipPredicate} onChange={e => update('relationshipPredicate', e.target.value)}>{predicates.map(p => <option key={p}>{p}</option>)}</select></label>
      {following.map((predicate, index) => <label key={index}>Then follow · step {index + 2}<select value={predicate} onChange={e => update('relationshipFollowing', following.map((p, i) => i === index ? e.target.value : p).join(','))}>{predicates.map(p => <option key={p}>{p}</option>)}</select></label>)}
      <div className="research-actions"><button type="button" className="panels-btn" disabled={following.length >= 3} onClick={() => update('relationshipFollowing', [...following, 'located-in'].join(','))}>Add relationship step</button>{following.length > 0 && <button type="button" className="panels-btn" onClick={() => update('relationshipFollowing', following.slice(0, -1).join(','))}>Remove last step</button>}</div>
      <p>Follow the mapped entity through {[value.relationshipPredicate, ...following].join(' → ')} to the required object below. For example, owns → located-in can connect a company to a facility’s jurisdiction. Intermediate entities come from the selected snapshot.</p>
      <label>Minimum path weight (optional, 0–1)<input type="number" min="0" max="1" step="any" value={value.relationshipMinWeight || ''} onChange={e=>update('relationshipMinWeight',e.target.value)} placeholder="No weight filter" /></label>
      {value.relationshipMinWeight?.trim()&&<p>Every edge must have an explicit weight. We multiply weights along each path and test the strongest fully weighted path. Alternative paths are not added together; this does not set trade sizes.</p>}
      <label>Required object ID<input value={value.relationshipObject} onChange={e => update('relationshipObject', e.target.value)} placeholder="facility:your-evidence-backed-id" /></label>
      <label>Ticker-to-entity mappings (JSON)<textarea value={value.relationshipSubjects} spellCheck={false} onChange={e => update('relationshipSubjects', e.target.value)} placeholder={'{"AAPL":"company:your-verified-id"}'} /></label>
      <p>Use exact uppercase tickers and subject IDs from your snapshot. Mappings and publication dates are researcher assertions. The complete snapshot and per-signal decisions are frozen with the run.</p>
    </>}
  </details>;
}
