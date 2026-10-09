import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, IconLabel } from "../ui/icons/Icon";
import { AddSearch } from "./AddSearch";
import { CategoryMenu } from "./CategoryMenu";
import { FilterChips, Legend } from "./Legend";
import { RelCanvas, type CanvasHandle } from "./RelCanvas";
import { NoteForm, TheoryEditor } from "./TheoryEditor";
import { THEORY_LOOK } from "./palette";
import { downloadDoc, readDocFile, shareUrl } from "./store";
import { theoryId } from "./dossier";
import type { Relations } from "./useRelations";
import "./relations.css";

export { useRelations } from "./useRelations";

type Props = {
  rel: Relations;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFollow: (action: string) => void;
};

/**
 * The relationship map: click a node for categories from the feeds, or switch to Theory and click two nodes
 * to draw your own link. The dossier and list on the right are the inspector; nothing here is a second rail.
 */
export function RelationsMap({ rel, selectedId, onSelect, onFollow }: Props) {
  const canvas = useRef<CanvasHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [theoryMode, setTheoryMode] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { graph, notice, setNotice } = rel;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);

  useEffect(() => { if (selectedId) canvas.current?.focus(selectedId); }, [selectedId]);

  const bounds = () => ({ w: box.current?.clientWidth || 800, h: box.current?.clientHeight || 600 });
  const center = () => canvas.current?.center() || { x: 0, y: 0 };
  const near = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n ? { x: n.x, y: n.y } : center();
  };

  async function add(id: string) {
    const got = await rel.addNode(id, center());
    if (!got) return;
    onSelect(got);
    window.setTimeout(() => {
      canvas.current?.focus(got);
      const b = bounds();
      setMenu({ id: got, x: b.w / 2, y: b.h / 2 });
    }, 50);
  }

  function linkClick(id: string) {
    if (!pending) { setPending(id); onSelect(id); return; }
    if (pending === id) { setPending(null); return; }
    const t = rel.putTheory(pending, id);
    setPending(null);
    onSelect(theoryId(t));
  }

  function key(e: ReactKeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) rel.redo(); else rel.undo(); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); rel.redo(); return; }
    if (e.key.toLowerCase() === "t" && !mod) { setTheoryMode((v) => !v); setPending(null); return; }
    if (e.key === "Escape") { setMenu(null); setPending(null); setNoteOpen(false); }
  }

  const menuNode = menu ? graph.nodes.find((n) => n.id === menu.id) : null;
  const selTheory = selectedId?.startsWith("theory:") ? graph.theories.find((t) => t.id === selectedId.slice(7)) : null;
  const label = (id: string, fallback: string) => graph.nodes.find((n) => n.id === id)?.label || fallback;

  return (
    <div className={`relmap${theoryMode ? " drawing" : ""}`} ref={box} onKeyDown={(e) => { if (e.target === e.currentTarget) key(e); }}>
      <div className="relmap-bar">
        <AddSearch onPick={(id) => void add(id)} />
        <span className="seg relmap-mode" role="radiogroup" aria-label="Mode">
          <button role="radio" aria-checked={!theoryMode} aria-pressed={!theoryMode} onClick={() => { setTheoryMode(false); setPending(null); }} title="Click a node for its data relationships · drag to move and pin">
            <IconLabel icon="filter" hide>Explore</IconLabel>
          </button>
          <button role="radio" aria-checked={theoryMode} aria-pressed={theoryMode} className="relmap-theory-btn" style={{ ["--tint" as string]: THEORY_LOOK.color }} onClick={() => { setTheoryMode(true); setMenu(null); }} title="Click two nodes, or drag from one to another, to draw your theory (T)">
            <IconLabel icon="theory" hide>Theory</IconLabel>
          </button>
        </span>
        <span className="seg">
          <button onClick={() => setNoteOpen((v) => !v)} aria-pressed={noteOpen} title="Add a person, event, or company of your own"><IconLabel icon="user-node" hide>Add node</IconLabel></button>
          <button onClick={rel.undo} disabled={!rel.canUndo} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button onClick={rel.redo} disabled={!rel.canRedo} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" /></button>
        </span>
        <span className="seg">
          <button onClick={() => canvas.current?.zoom(1 / 1.3)} title="Zoom out (−)" aria-label="Zoom out"><Icon name="zoom-out" /></button>
          <button onClick={() => canvas.current?.zoom(1.3)} title="Zoom in (+)" aria-label="Zoom in"><Icon name="zoom-in" /></button>
          <button onClick={() => canvas.current?.fit()} title="Fit to view (F)" aria-label="Fit to view"><Icon name="fit" /></button>
          <button onClick={() => { rel.relayout(); window.setTimeout(() => canvas.current?.fit(), 30); }} title="Re-run layout (pinned nodes stay)" aria-label="Re-run layout"><Icon name="layout" /></button>
        </span>
        <span className="relmap-more">
          <button className="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} title="Export, import, share, clear"><Icon name="more" /></button>
          {moreOpen ? (
            <div className="relmap-pop relmap-more-pop" role="menu" onMouseLeave={() => setMoreOpen(false)}>
              <button role="menuitem" onClick={() => { downloadDoc(graph); setMoreOpen(false); }}><Icon name="export" /> Export theories (JSON)</button>
              <button role="menuitem" onClick={() => file.current?.click()}><Icon name="import" /> Import theories…</button>
              <button role="menuitem" onClick={async () => {
                const url = shareUrl(graph);
                setMoreOpen(false);
                if (!url) { setNotice("Too many theories for a link; export a file instead."); return; }
                try { await navigator.clipboard.writeText(url); setNotice("Share link copied. It carries your theories and notes in the address; nothing is uploaded."); } catch { window.prompt("Copy this link", url); }
              }}><Icon name="link" /> Copy share link</button>
              <button role="menuitem" onClick={() => { rel.clear(); setMoreOpen(false); }}><Icon name="reset" /> Clear data from canvas (keeps theories)</button>
            </div>
          ) : null}
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            setMoreOpen(false);
            if (f) rel.importDoc(await readDocFile(f));
          }} />
        </span>
      </div>
      <FilterChips graph={graph} hidden={rel.hidden} onToggle={rel.toggleHidden} />
      <RelCanvas
        ref={canvas}
        graph={graph}
        hidden={rel.hidden}
        selectedId={selectedId}
        theoryMode={theoryMode}
        pendingFrom={pending}
        onSelect={onSelect}
        onMenu={(id, at) => { if (!theoryMode) setMenu({ id, ...at }); }}
        onCloseMenu={() => setMenu(null)}
        onExpand={(id) => rel.expandDefaults(id)}
        onMove={rel.move}
        onLinkClick={linkClick}
        onLinkDrop={(a, b) => { const t = rel.putTheory(a, b); setPending(null); onSelect(theoryId(t)); }}
        onRemove={(id) => { rel.remove(id); setMenu(null); onSelect(null); }}
        onKey={key}
      />
      {theoryMode ? (
        <p className="relmap-hint" style={{ ["--tint" as string]: THEORY_LOOK.color }}>
          <Icon name="theory" /> {pending ? <>From <b>{label(pending, pending)}</b> · click the second node, or Esc</> : "Theory: click a node, then another, or drag from one to the other. Your links are dashed magenta and never counted as data."}
        </p>
      ) : null}
      {!graph.nodes.length ? (
        <div className="relmap-empty">
          <Icon name="map" size={20} />
          <p>{rel.empty}</p>
          <div className="relmap-starts">
            {[["member:P000197", "Pelosi"], ["ticker:NVDA", "NVDA"], ["committee:HSAS", "House Armed Services"], ["ticker:LMT", "LMT"]].map(([id, l]) => (
              <button key={id} onClick={() => void add(id)}>{l}</button>
            ))}
          </div>
        </div>
      ) : null}
      {menu && menuNode ? (
        <CategoryMenu
          rel={rel}
          node={menuNode}
          at={menu}
          bounds={bounds()}
          onExpand={(cat, more) => void rel.expand(menuNode.id, cat, more, near(menuNode.id))}
          onTheory={() => { setTheoryMode(true); setPending(menuNode.id); setMenu(null); }}
          onRemove={() => { rel.remove(menuNode.id); setMenu(null); onSelect(null); }}
          onClose={() => setMenu(null)}
          onFollow={(a) => { setMenu(null); onFollow(a); }}
        />
      ) : null}
      {selTheory ? (
        <TheoryEditor
          theory={selTheory}
          a={label(selTheory.a.id, selTheory.a.label)}
          b={label(selTheory.b.id, selTheory.b.label)}
          onSave={(patch) => rel.putTheory(selTheory.a.id, selTheory.b.id, patch, selTheory.id)}
          onDelete={() => { rel.dropTheory(selTheory.id); onSelect(null); setNotice("Theory deleted. ⌘Z brings it back."); }}
          onClose={() => onSelect(null)}
        />
      ) : null}
      {noteOpen ? (
        <NoteForm
          onClose={() => setNoteOpen(false)}
          onAdd={(l, k) => {
            const id = rel.addNote(l, k, center());
            setNoteOpen(false);
            setTheoryMode(true);
            setPending(id);
            onSelect(id);
            setNotice("Added. Now click a node to link it as a theory, or Esc.");
          }}
        />
      ) : null}
      <Legend graph={graph} />
      {notice ? <p className="relmap-notice" role="status">{notice}</p> : null}
    </div>
  );
}
