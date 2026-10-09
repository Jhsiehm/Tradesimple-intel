import { useEffect } from "react";
import { categoriesFor, type CategoryId, type RelNode } from "../../shared/relations.mjs";
import { when } from "../lib/api";
import { Icon } from "../ui/icons/Icon";
import { CATEGORY_LOOK, NODE_LOOK, THEORY_LOOK } from "./palette";
import type { Relations } from "./useRelations";

type Props = {
  rel: Relations;
  node: RelNode;
  at: { x: number; y: number };
  bounds: { w: number; h: number };
  onExpand: (cat: CategoryId, more: boolean) => void;
  onTheory: () => void;
  onRemove: () => void;
  onClose: () => void;
  onFollow: (action: string) => void;
};

/** Categories a node can expand into, with counts from the feeds. Opens beside the node. */
export function CategoryMenu({ rel, node, at, bounds, onExpand, onTheory, onRemove, onClose, onFollow }: Props) {
  const info = rel.infos[node.id];
  const { info: load } = rel;
  useEffect(() => { if (!node.user) void load(node.id); }, [node.id, node.user, load]);
  const look = NODE_LOOK[node.type];
  const cats = categoriesFor(node.type);
  const left = Math.max(8, Math.min(at.x + 16, bounds.w - 296));
  const top = Math.max(8, Math.min(at.y - 20, bounds.h - 60 - cats.length * 38 - 120));
  const record = node.type === "member" ? `member:${node.id.slice(7)}` : node.type === "ticker" ? `ticker:${node.id.slice(7)}` : node.type === "district" && node.id.includes("-") ? `district:${node.id.slice(9)}` : "";
  return (
    <div className="relmap-menu" style={{ left, top, ["--tint" as string]: look.color }} role="menu" aria-label={`Relationships for ${node.label}`} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <header>
        <span style={{ color: look.color }}><Icon name={look.icon} size={16} /></span>
        <div>
          <strong>{node.label}</strong>
          <small>{node.user ? "Added by you · not from a data source" : `${look.label}${node.sub ? ` · ${node.sub}` : ""}`}</small>
        </div>
        <button className="ghost" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button>
      </header>
      {cats.length ? <p className="relmap-menu-h">Add from the data</p> : null}
      {cats.map((c) => {
        const cl = CATEGORY_LOOK[c.id];
        const key = `${node.id}|${c.id}`;
        const meta = rel.loaded[key];
        const got = meta?.shown ? meta : undefined;
        const busy = rel.busy.has(key);
        const ci = info?.categories?.find((x) => x.id === c.id);
        const total = meta && !meta.error ? meta.total : ci?.count;
        const title = `${ci?.source || c.source}${ci?.asOf ? ` · as of ${when(ci.asOf)} UTC` : ""}`;
        const empty = total === 0;
        return (
          <div key={c.id} className="relmap-cat" style={{ ["--tint" as string]: cl.color }}>
            <button role="menuitem" disabled={busy || empty || Boolean(got && !got.more)} onClick={() => onExpand(c.id, Boolean(got))} title={title}>
              <span className="relmap-cat-ic"><Icon name={cl.icon} /></span>
              <span className="relmap-cat-lbl">{cl.label}</span>
              <span className="relmap-cat-n">
                {busy ? "…" : got ? `${got.shown}/${got.total}` : total == null ? (info ? "?" : "…") : total}
              </span>
              <span className="relmap-cat-act">{busy ? "Loading" : empty ? "None" : got ? (got.more ? <><Icon name="more" /> More</> : "All shown") : "Add"}</span>
            </button>
            {meta?.error ? <small className="relmap-cat-err">{meta.error}</small> : null}
          </div>
        );
      })}
      {!node.user && info && !info.ok ? <p className="relmap-cat-err">{info.error}</p> : null}
      <p className="relmap-menu-h">Yours</p>
      <button role="menuitem" className="relmap-menu-row" style={{ color: THEORY_LOOK.color }} onClick={onTheory}><Icon name="draw" /> Draw a theory from here</button>
      {record ? <button role="menuitem" className="relmap-menu-row" onClick={() => onFollow(record)}><Icon name="dossier" /> Open the record</button> : null}
      <button role="menuitem" className="relmap-menu-row" onClick={onRemove}><Icon name="trash" /> Remove from canvas <kbd>Del</kbd></button>
    </div>
  );
}
