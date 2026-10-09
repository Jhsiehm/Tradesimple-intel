import { useEffect, useState } from "react";
import type { Theory } from "../../shared/relations.mjs";
import { Icon } from "../ui/icons/Icon";
import { THEORY_LOOK } from "./palette";

/** Label, note, and confidence for one of your theories. Saved on every change; delete is one click with undo. */
export function TheoryEditor({ theory, a, b, onSave, onDelete, onClose }: {
  theory: Theory;
  a: string;
  b: string;
  onSave: (patch: Partial<Theory>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(theory.label);
  const [note, setNote] = useState(theory.note);
  useEffect(() => { setLabel(theory.label); setNote(theory.note); }, [theory.id]);
  const commit = () => { if (label !== theory.label || note !== theory.note) onSave({ label, note }); };
  return (
    <div className="relmap-pop relmap-theory" style={{ ["--tint" as string]: THEORY_LOOK.color }} role="dialog" aria-label="Your theory">
      <header>
        <span style={{ color: THEORY_LOOK.color }}><Icon name="theory" size={16} /></span>
        <div>
          <strong>Your theory</strong>
          <small>{a} ↔ {b} · not from a data source</small>
        </div>
        <button className="ghost" onClick={() => { commit(); onClose(); }} aria-label="Close"><Icon name="close" /></button>
      </header>
      <label>Label<input value={label} maxLength={80} placeholder="e.g. Same donor network" onChange={(e) => setLabel(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} /></label>
      <label>Note<textarea value={note} maxLength={280} rows={3} placeholder="Why you think so; what would confirm it" onChange={(e) => setNote(e.target.value)} onBlur={commit} /></label>
      <div className="seg" role="radiogroup" aria-label="Confidence">
        {(["low", "medium", "high"] as const).map((c) => (
          <button key={c} role="radio" aria-checked={theory.confidence === c} aria-pressed={theory.confidence === c} onClick={() => onSave({ confidence: c })}>{c[0].toUpperCase() + c.slice(1)}</button>
        ))}
      </div>
      <footer>
        <small>Saved in this browser only. Never mixed into data counts or case files.</small>
        <button className="ghost danger" onClick={onDelete}><Icon name="trash" /> Delete</button>
      </footer>
    </div>
  );
}

/** Add a node of your own (a person, event, or company the feeds do not hold). */
export function NoteForm({ onAdd, onClose }: { onAdd: (label: string, kind: string) => void; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("person");
  return (
    <form className="relmap-pop relmap-note" style={{ ["--tint" as string]: THEORY_LOOK.color }} onSubmit={(e) => { e.preventDefault(); if (label.trim()) onAdd(label.trim(), kind); }}>
      <header>
        <span style={{ color: THEORY_LOOK.color }}><Icon name="user-node" size={16} /></span>
        <div><strong>Add your own node</strong><small>Marked as yours; no feed backs it</small></div>
        <button type="button" className="ghost" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </header>
      <label>Name<input autoFocus value={label} maxLength={80} placeholder="Person, event, or company" onChange={(e) => setLabel(e.target.value)} /></label>
      <div className="seg" role="radiogroup" aria-label="Kind">
        {["person", "event", "company", "other"].map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <footer><button type="submit" className="relmap-primary" disabled={!label.trim()}><Icon name="user-node" /> Add to map</button></footer>
    </form>
  );
}