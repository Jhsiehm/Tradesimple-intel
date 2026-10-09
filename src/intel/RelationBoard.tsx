import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { bundleArcs, dayIso, dayNum, type ArcKind } from "../../shared/intel.mjs";
import { when } from "../lib/api";
import type { DrawerModel, ListItem, StatusLine } from "../types";
import { ARC_COLOR } from "./arcs";
import { LANE_COLOR, presetWindow, type DayWindow } from "./lanes";
import type { IntelData } from "./useIntel";

const KINDS: Record<string, string> = {
  member: "Member",
  hq: "Ticker",
  agency: "Agency",
  trade: "Trade",
  hearing: "Hearing",
  roll: "Vote",
  contract: "Contract",
  form4: "Form 4",
  pac: "PAC"
};

const COLOR: Record<string, string> = {
  ...LANE_COLOR,
  member: "#e4e7e6",
  hq: "#ffc14a",
  agency: "#d9b45a",
  pac: "#b48cff"
};

type Node = { id: string; kind: string; label: string; action?: string; x: number; y: number };
type Line = { from: string; to: string; kind: string; note: string };
type Thread = { id: string; from: string; to: string };

export type BoardModel = {
  nodes: Node[];
  lines: Line[];
  scopeKey: string;
  items: ListItem[];
  empty: string;
  drawer: DrawerModel | null;
  status: StatusLine;
};

const EMPTY: BoardModel = {
  nodes: [],
  lines: [],
  scopeKey: "",
  items: [],
  empty: "Open a member card and choose Map, or a ticker dossier and choose Map. Their records land here.",
  drawer: null,
  status: {
    source: "Terminal records",
    asOf: "",
    latency: "A member or a ticker scopes the board. The scrubber is the window. Drag between two icons to keep a line."
  }
};

function column(kind: string) {
  if (kind === "member") return 0;
  if (kind === "trade" || kind === "form4") return 1;
  if (kind === "hearing" || kind === "roll") return 2;
  if (kind === "contract" || kind === "pac") return 3;
  return 4;
}

function layout(rows: { id: string; kind: string; label: string; action?: string }[]): Node[] {
  const groups = new Map<number, typeof rows>();
  for (const row of rows) {
    const col = column(row.kind);
    groups.set(col, [...(groups.get(col) || []), row]);
  }
  const cols = [...groups.keys()].sort((a, b) => a - b);
  const span = cols.length || 1;
  const nodes: Node[] = [];
  cols.forEach((col, ci) => {
    const list = groups.get(col) || [];
    list.forEach((row, i) => {
      nodes.push({
        ...row,
        x: 1.5 + (ci * 97) / span,
        y: (i / list.length) * 94
      });
    });
  });
  return nodes;
}

/** Icons and record lines for one scoped window. A line you draw is kept outside this model. */
export function relationModel(data: IntelData | null, win: DayWindow | null, kinds: Set<ArcKind>, selectedId: string | null): BoardModel {
  if (!data?.ok || data.scope.kind === "all") return EMPTY;
  const window = win || presetWindow(data.len, 90);
  const places = data.arcs.places;
  const bundled = bundleArcs(data.arcs.links, { from: window[0], to: window[1], kinds, cap: 24 });
  const weight = new Map<number, number>();
  for (const arc of bundled.arcs) {
    weight.set(arc.from, (weight.get(arc.from) || 0) + arc.n);
    weight.set(arc.to, (weight.get(arc.to) || 0) + arc.n);
  }
  const memberIdx = places.map((p, i) => (p.kind === "member" ? i : -1)).filter((i) => i >= 0).slice(0, 4);
  const otherIdx = [...weight.keys()].filter((i) => places[i]?.kind !== "member").sort((a, b) => (weight.get(b) || 0) - (weight.get(a) || 0)).slice(0, 10);
  const kept = new Set([...memberIdx, ...otherIdx]);
  const placeId = new Map<number, string>();
  const raw: { id: string; kind: string; label: string; action?: string }[] = [];
  for (const i of kept) {
    const place = places[i];
    if (!place) continue;
    const id = `place:${place.action || i}`;
    placeId.set(i, id);
    raw.push({ id, kind: place.kind, label: place.label, action: place.action || undefined });
  }
  const start = dayNum(data.from);
  const events = data.events.filter((e) => e.d >= window[0] && e.d <= window[1]).sort((a, b) => b.d - a.d).slice(0, 18);
  const seen = new Set(raw.map((r) => r.id));
  events.forEach((event, n) => {
    const id = `ev:${event.k}:${event.d}:${n}`;
    if (seen.has(id)) return;
    seen.add(id);
    raw.push({ id, kind: event.k, label: `${dayIso(start + event.d)} · ${event.label}`, action: event.action });
  });
  const nodes = layout(raw);
  const symbolOf = (action = "") => {
    const [kind, a, b] = action.split(":");
    if (kind === "hq" || kind === "pos" || kind === "ticker") return a || "";
    if (kind === "contracts" && a === "symbol") return b || "";
    if (kind === "member") return `member:${a}`;
    return "";
  };
  const byKey = new Map<string, string>();
  for (const node of nodes) {
    if (!node.id.startsWith("place:")) continue;
    if (node.action) byKey.set(node.action, node.id);
    const symbol = symbolOf(node.action);
    if (symbol) byKey.set(symbol, node.id);
  }
  const lines: Line[] = [];
  const pair = new Set<string>();
  const add = (from: string, to: string, kind: string, note: string) => {
    if (!from || !to || from === to) return;
    const key = [from, to, kind].join(">");
    if (pair.has(key)) return;
    pair.add(key);
    lines.push({ from, to, kind, note });
  };
  for (const arc of bundled.arcs) {
    const from = placeId.get(arc.from);
    const to = placeId.get(arc.to);
    if (from && to) add(from, to, arc.kind, `${arc.n}`);
  }
  for (const node of nodes) {
    if (node.id.startsWith("place:")) continue;
    const place = (node.action && byKey.get(node.action)) || byKey.get(symbolOf(node.action));
    if (place) add(node.id, place, node.kind, "");
  }
  const picked = nodes.find((n) => n.id === selectedId) || null;
  const items: ListItem[] = nodes.map((n) => ({
    id: n.id,
    title: n.label,
    meta: KINDS[n.kind] || n.kind
  }));
  const drawer: DrawerModel | null = picked
    ? {
        title: picked.label,
        meta: KINDS[picked.kind] || picked.kind,
        rows: [{ label: "Kind", value: KINDS[picked.kind] || picked.kind }],
        links: picked.action ? [{ label: "Open", value: "The record this icon points at", action: picked.action }] : [],
        source: "This icon is a record in the window. A solid line is one the feeds share. A dashed line is one you drew."
      }
    : null;
  return {
    nodes,
    lines,
    scopeKey: `${data.scope.kind}:${data.scope.id}`,
    items,
    empty: nodes.length ? "" : "Nothing in this window.",
    drawer,
    status: {
      source: data.scope.label,
      asOf: data.asOf ? `${when(data.asOf)} UTC` : "",
      latency: "Solid lines are trades, contracts, and PAC gifts in the window, plus a filing tied to the same member or ticker. Dashed lines are yours."
    }
  };
}

const STORE = "intel:threads:v1";

function readThreads(key: string): Thread[] {
  if (!key) return [];
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, Thread[]>;
    return all[key] || [];
  } catch {
    return [];
  }
}

function writeThreads(key: string, threads: Thread[]) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || "{}") as Record<string, Thread[]>;
    all[key] = threads.slice(0, 40);
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

/**
 * Abstract board for one scope. Record lines come from the window. Dragging from one icon to another
 * keeps a line that is yours, separate from the feeds.
 */
export function RelationBoard({ model, selectedId, onSelect }: { model: BoardModel; selectedId: string | null; onSelect: (id: string) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [draft, setDraft] = useState<{ from: string; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => { setThreads(readThreads(model.scopeKey)); }, [model.scopeKey]);

  const at = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  const mine = threads.filter((t) => at.has(t.from) && at.has(t.to));

  const point = (event: ReactPointerEvent) => {
    const box = board.current?.querySelector(".rel-stage")?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * 100, y: ((event.clientY - box.top) / box.height) * 100 };
  };

  function down(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    event.preventDefault();
    const p = point(event);
    drag.current = { id, x: p.x, y: p.y, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* a click still selects */ }
  }

  function move(event: ReactPointerEvent<HTMLButtonElement>) {
    const cur = drag.current;
    if (!cur) return;
    const p = point(event);
    if (Math.hypot(p.x - cur.x, p.y - cur.y) > 1.5) cur.moved = true;
    if (cur.moved) setDraft({ from: cur.id, x: p.x, y: p.y });
  }

  function up(event: ReactPointerEvent<HTMLButtonElement>) {
    const cur = drag.current;
    drag.current = null;
    setDraft(null);
    if (!cur) return;
    if (!cur.moved) {
      onSelect(cur.id);
      return;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-node]")?.getAttribute("data-node");
    if (!hit || hit === cur.id) return;
    const next = [...readThreads(model.scopeKey).filter((t) => !(t.from === cur.id && t.to === hit)), { id: `${cur.id}>${hit}`, from: cur.id, to: hit }];
    writeThreads(model.scopeKey, next);
    setThreads(next);
  }

  function dropThread(id: string) {
    const next = threads.filter((t) => t.id !== id);
    writeThreads(model.scopeKey, next);
    setThreads(next);
  }

  const fromOf = (id: string) => at.get(id);
  const cols = new Set(model.nodes.map((n) => column(n.kind))).size || 1;
  const nudge = Math.min(9, (97 / cols) * 0.42);
  const rows = Math.max(1, ...[...model.nodes.reduce((g, n) => g.set(column(n.kind), (g.get(column(n.kind)) || 0) + 1), new Map<number, number>()).values()]);

  return (
    <div ref={board} className="rel">
      <div className="rel-stage" style={{ ["--cols" as string]: cols, ["--rows" as string]: rows }}>
      <svg className="rel-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {model.lines.map((line) => {
          const a = fromOf(line.from);
          const b = fromOf(line.to);
          if (!a || !b) return null;
          return <line key={`${line.from}-${line.to}-${line.kind}`} x1={a.x + nudge} y1={a.y + 3} x2={b.x + nudge} y2={b.y + 3} stroke={ARC_COLOR[line.kind as ArcKind] || COLOR[line.kind] || "#5c6b78"} strokeWidth="0.35" />;
        })}
        {mine.map((line) => {
          const a = fromOf(line.from);
          const b = fromOf(line.to);
          if (!a || !b) return null;
          return <line key={line.id} x1={a.x + nudge} y1={a.y + 3} x2={b.x + nudge} y2={b.y + 3} stroke="#e4e7e6" strokeWidth="0.45" strokeDasharray="1.2 0.8" />;
        })}
        {draft && fromOf(draft.from) ? <line x1={fromOf(draft.from)!.x + nudge} y1={fromOf(draft.from)!.y + 3} x2={draft.x} y2={draft.y} stroke="#e4e7e6" strokeWidth="0.4" strokeDasharray="1.2 0.8" /> : null}
      </svg>
      {mine.map((line) => {
        const a = fromOf(line.from);
        const b = fromOf(line.to);
        if (!a || !b) return null;
        return (
          <button
            key={line.id}
            className="rel-cut"
            style={{ left: `${(a.x + b.x) / 2 + nudge}%`, top: `${(a.y + b.y) / 2 + 3}%` }}
            title="Remove this line"
            onClick={() => dropThread(line.id)}
          >
            ×
          </button>
        );
      })}
      {model.nodes.map((node) => (
        <button
          key={node.id}
          data-node={node.id}
          className="rel-node"
          style={{ left: `${node.x}%`, top: `${node.y}%`, ["--pip" as string]: COLOR[node.kind] || "#9aa7b2" }}
          aria-pressed={node.id === selectedId}
          onPointerDown={(event) => down(event, node.id)}
          onPointerMove={move}
          onPointerUp={up}
        >
          <i />
          <span>{KINDS[node.kind] || node.kind}</span>
          <strong>{node.label}</strong>
        </button>
      ))}
      {model.nodes.length ? null : <p className="rel-empty">{model.empty}</p>}
      </div>
    </div>
  );
}
