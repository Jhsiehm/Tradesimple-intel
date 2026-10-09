import { useState } from "react";
import { CATEGORY_IDS, counts, type CategoryId, type Graph } from "../../shared/relations.mjs";
import { Icon } from "../ui/icons/Icon";
import { CATEGORY_LOOK, NODE_LOOK, THEORY_LOOK } from "./palette";

/** A dash sample matching the canvas stroke for one category. */
function Dash({ color, dash, width = 2 }: { color: string; dash: number[]; width?: number }) {
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
      <line x1="1" y1="4" x2="25" y2="4" stroke={color} strokeWidth={width} strokeDasharray={dash.join(" ") || undefined} />
    </svg>
  );
}

/** Filter chips: one per category on the canvas, with its count. Off hides those lines (and nodes only they reach). */
export function FilterChips({ graph, hidden, onToggle }: { graph: Graph; hidden: Set<CategoryId>; onToggle: (c: CategoryId) => void }) {
  const c = counts(graph);
  const present = CATEGORY_IDS.filter((id) => c.byCat[id] > 0);
  if (!present.length && !c.theories) return null;
  return (
    <div className="relmap-chips" role="group" aria-label="Show relationship categories">
      {present.map((id) => {
        const look = CATEGORY_LOOK[id];
        const on = !hidden.has(id);
        return (
          <button key={id} className="relmap-chip" aria-pressed={on} style={{ ["--tint" as string]: look.color }} onClick={() => onToggle(id)} title={`${on ? "Hide" : "Show"} ${look.label}`}>
            <Icon name={look.icon} /> <span>{look.label}</span> <b>{c.byCat[id]}</b>
          </button>
        );
      })}
      {c.theories ? (
        <span className="relmap-chip theory" style={{ ["--tint" as string]: THEORY_LOOK.color }} title="Your theories are always shown and never counted as data">
          <Icon name="theory" /> <span>Yours</span> <b>{c.theories}</b>
        </span>
      ) : null}
    </div>
  );
}

/** Line and node key. Collapses to one row on small screens. */
export function Legend({ graph }: { graph: Graph }) {
  const [open, setOpen] = useState(() => !window.matchMedia?.("(max-width: 720px)").matches);
  const c = counts(graph);
  const cats = CATEGORY_IDS.filter((id) => c.byCat[id] > 0);
  const types = [...new Set(graph.nodes.map((n) => n.type))];
  return (
    <aside className="relmap-legend" aria-label="Legend">
      <button className="relmap-legend-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? "chevron-down" : "chevron-right"} /> Key
      </button>
      {open ? (
        <ul>
          {cats.map((id) => (
            <li key={id} style={{ color: CATEGORY_LOOK[id].color }}>
              <Dash color={CATEGORY_LOOK[id].color} dash={CATEGORY_LOOK[id].dash} /><Icon name={CATEGORY_LOOK[id].icon} /> <span>{CATEGORY_LOOK[id].label}</span>
            </li>
          ))}
          <li className="theory" style={{ color: THEORY_LOOK.color }}>
            <Dash color={THEORY_LOOK.color} dash={THEORY_LOOK.dash} width={2.5} /><Icon name="theory" /> <span>{THEORY_LOOK.label}</span>
          </li>
          {types.length ? <li className="relmap-legend-sep" aria-hidden="true" /> : null}
          {types.map((t) => (
            <li key={t} style={{ color: NODE_LOOK[t].color }}>
              <i className={`relmap-shape ${NODE_LOOK[t].shape}${t === "note" ? " mine" : ""}`} /><Icon name={NODE_LOOK[t].icon} /> <span>{NODE_LOOK[t].label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
