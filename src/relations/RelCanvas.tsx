import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CATEGORY_IDS, neighborhood, type CategoryId, type Graph, type RelEdge, type RelNode, type Theory } from "../../shared/relations.mjs";
import { PATHS } from "../ui/icons/paths";
import type { IconName } from "../ui/icons/names";
import { CATEGORY_LOOK, NODE_LOOK, PANEL, THEORY_LOOK } from "./palette";
import { edgeSel, theoryId } from "./dossier";
import type { Pt } from "./layout";

export type CanvasHandle = { fit: () => void; zoom: (f: number) => void; center: () => Pt; focus: (id: string) => void };

type Props = {
  graph: Graph;
  hidden: Set<CategoryId>;
  selectedId: string | null;
  theoryMode: boolean;
  pendingFrom: string | null;
  onSelect: (id: string | null) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onCloseMenu: () => void;
  onExpand: (id: string) => void;
  onMove: (moves: Map<string, Pt>) => void;
  onLinkClick: (id: string) => void;
  onLinkDrop: (from: string, to: string) => void;
  onRemove: (id: string) => void;
  onKey: (event: ReactKeyboardEvent) => void;
};

type View = { x: number; y: number; k: number };
type Hit = { kind: "node"; node: RelNode } | { kind: "edge"; edge: RelEdge } | { kind: "theory"; theory: Theory } | null;
type Gesture =
  | { mode: "pan"; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { mode: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; touch: boolean }
  | { mode: "link"; id: string; moved: boolean; sx: number; sy: number }
  | { mode: "pinch"; d: number; cx: number; cy: number; view: View }
  | null;

const ICONS = new Map<IconName, { path: Path2D; fill: boolean }[]>();
function glyph(name: IconName) {
  if (!ICONS.has(name)) ICONS.set(name, PATHS[name].map((p) => (typeof p === "string" ? { path: new Path2D(p), fill: false } : { path: new Path2D(p.d), fill: true })));
  return ICONS.get(name)!;
}

const radius = (n: RelNode, degree: number) => (n.user ? 13 : 10 + Math.min(9, Math.sqrt(degree) * 1.6));
const MIN_K = 0.12;
const MAX_K = 3.5;

function shape(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number) {
  ctx.beginPath();
  if (kind === "square") ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (kind === "diamond") { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
  else if (kind === "hex") { for (let i = 0; i < 6; i += 1) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05); } ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}

function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 16, size / 16);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const part of glyph(name)) {
    if (part.fill) ctx.fill(part.path);
    ctx.stroke(part.path);
  }
  ctx.restore();
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Relationship canvas. Draws on demand; your theories animate only while any are on screen. */
export const RelCanvas = forwardRef<CanvasHandle, Props>(function RelCanvas(props, ref) {
  const { graph, hidden, selectedId, theoryMode, pendingFrom } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: 0, y: 0, k: 1 });
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const drag = useRef(new Map<string, Pt>());
  const hover = useRef<Hit>(null);
  const pointer = useRef<Pt | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture>(null);
  const press = useRef<number | null>(null);
  const dirty = useRef(true);
  const fitted = useRef(false);
  /** The user panned or zoomed; resizes stop re-fitting from then on. */
  const moved = useRef(false);
  const fitRef = useRef(() => {});
  const perf = useRef({ n: 0, ms: 0 });
  const live = useRef(props);
  live.current = props;
  const reduced = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  const scene = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    const edges = graph.edges.filter((e) => !hidden.has(e.cat) && byId.has(e.from) && byId.has(e.to));
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) || 0) + 1);
      degree.set(e.to, (degree.get(e.to) || 0) + 1);
    }
    const shownDeg = new Map<string, number>();
    for (const e of edges) {
      shownDeg.set(e.from, (shownDeg.get(e.from) || 0) + 1);
      shownDeg.set(e.to, (shownDeg.get(e.to) || 0) + 1);
    }
    const theories = graph.theories.filter((t) => byId.has(t.a.id) && byId.has(t.b.id));
    const inTheory = new Set(theories.flatMap((t) => [t.a.id, t.b.id]));
    const nodes = graph.nodes.filter((n) => n.user || inTheory.has(n.id) || !degree.get(n.id) || shownDeg.get(n.id));
    const order = nodes.map((n) => n.id);
    return { byId, degree, edges, theories, nodes, order };
  }, [graph, hidden]);

  const focusSet = useRef<Set<string> | null>(null);
  const setHover = (h: Hit) => {
    const prevId = hover.current?.kind === "node" ? hover.current.node.id : null;
    hover.current = h;
    const id = h?.kind === "node" ? h.node.id : null;
    if (id !== prevId) focusSet.current = id ? neighborhood(live.current.graph, id) : null;
    dirty.current = true;
  };

  const posOf = (n: RelNode): Pt => drag.current.get(n.id) || n;

  const toWorld = (sx: number, sy: number): Pt => ({ x: (sx - view.current.x) / view.current.k, y: (sy - view.current.y) / view.current.k });

  const hit = (sx: number, sy: number): Hit => {
    const w = toWorld(sx, sy);
    const k = view.current.k;
    for (let i = scene.nodes.length - 1; i >= 0; i -= 1) {
      const n = scene.nodes[i];
      const p = posOf(n);
      if (Math.hypot(w.x - p.x, w.y - p.y) <= radius(n, scene.degree.get(n.id) || 0) + 4 / k) return { kind: "node", node: n };
    }
    const tol = 6 / k;
    for (const t of scene.theories) {
      const a = posOf(scene.byId.get(t.a.id)!);
      const b = posOf(scene.byId.get(t.b.id)!);
      if (segDist(w.x, w.y, a.x, a.y, b.x, b.y) <= tol + 2 / k) return { kind: "theory", theory: t };
    }
    let best: RelEdge | null = null;
    let bd = tol;
    for (const e of scene.edges) {
      const a = posOf(scene.byId.get(e.from)!);
      const b = posOf(scene.byId.get(e.to)!);
      const d = segDist(w.x, w.y, a.x, a.y, b.x, b.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { kind: "edge", edge: best } : null;
  };

  function fit() {
    const list = scene.nodes;
    const { w, h } = size.current;
    if (!list.length) { view.current = { x: w / 2, y: h / 2, k: 1 }; dirty.current = true; return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const pad = Math.min(70, Math.min(w, h) * 0.1);
    const k = Math.max(MIN_K, Math.min(1.6, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
    view.current = { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
    dirty.current = true;
  }

  function zoomAt(f: number, sx: number, sy: number) {
    const v = view.current;
    const k = Math.max(MIN_K, Math.min(MAX_K, v.k * f));
    view.current = { k, x: sx - ((sx - v.x) * k) / v.k, y: sy - ((sy - v.y) * k) / v.k };
    moved.current = true;
    dirty.current = true;
  }

  useImperativeHandle(ref, () => ({
    fit,
    zoom: (f) => zoomAt(f, size.current.w / 2, size.current.h / 2),
    center: () => toWorld(size.current.w / 2, size.current.h / 2),
    focus: (id) => {
      const n = scene.byId.get(id);
      if (!n) return;
      const { w, h } = size.current;
      const s = { x: n.x * view.current.k + view.current.x, y: n.y * view.current.k + view.current.y };
      if (s.x < 40 || s.y < 40 || s.x > w - 40 || s.y > h - 40) view.current = { ...view.current, x: w / 2 - n.x * view.current.k, y: h / 2 - n.y * view.current.k };
      dirty.current = true;
    }
  }));

  useEffect(() => { drag.current = new Map(); dirty.current = true; }, [scene]);
  useEffect(() => { dirty.current = true; }, [selectedId, theoryMode, pendingFrom]);

  useEffect(() => {
    fitRef.current = fit;
    if (!fitted.current && scene.nodes.length && size.current.w > 1 && size.current.h > 1) { fitted.current = true; fit(); }
  });

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      const was = size.current;
      size.current = { w, h, dpr };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      if (w > 1 && h > 1 && !moved.current && live.current.graph.nodes.length) {
        fitted.current = true;
        fitRef.current();
      } else if (was.w <= 1) view.current = { x: w / 2, y: h / 2, k: 1 };
      else view.current = { ...view.current, x: view.current.x + (w - was.w) / 2, y: view.current.y + (h - was.h) / 2 };
      dirty.current = true;
    });
    ro.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    cv.addEventListener("wheel", wheel, { passive: false });
    return () => { ro.disconnect(); cv.removeEventListener("wheel", wheel); };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const animate = !reduced && scene.theories.length > 0 && !document.hidden;
      if (!dirty.current && !(animate && t - last > 33)) return;
      last = t;
      dirty.current = false;
      draw(t);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

  function draw(t: number) {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const t0 = performance.now();
    const { w, h, dpr } = size.current;
    const { x, y, k } = view.current;
    const { selectedId: sel, pendingFrom: pend } = live.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PANEL;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    const focus = focusSet.current;
    const hoverEdge = hover.current?.kind === "edge" ? hover.current.edge.id : null;
    const selEdge = sel?.startsWith("edge:") ? sel.slice(5) : null;
    const selTheory = sel?.startsWith("theory:") ? sel.slice(7) : null;
    const lit = (e: { from: string; to: string }) => !focus || (focus.has(e.from) && focus.has(e.to) && (e.from === [...focus][0] || e.to === [...focus][0]));
    const hubId = focus ? [...focus][0] : null;

    // Data edges: one path per category and emphasis, so 1,000 edges are a dozen strokes.
    for (const dim of [true, false]) {
      for (const cat of CATEGORY_IDS) {
        const look = CATEGORY_LOOK[cat];
        ctx.beginPath();
        let any = false;
        for (const e of scene.edges) {
          if (e.cat !== cat) continue;
          const on = !focus || (hubId != null && (e.from === hubId || e.to === hubId));
          if (on === dim) continue;
          const a = posOf(scene.byId.get(e.from)!);
          const b = posOf(scene.byId.get(e.to)!);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          any = true;
        }
        if (!any) continue;
        ctx.strokeStyle = look.color;
        ctx.globalAlpha = dim ? 0.1 : focus ? 0.95 : 0.55;
        ctx.lineWidth = (focus && !dim ? 1.8 : 1.1) / k;
        ctx.setLineDash(look.dash.map((d) => d / k));
        ctx.stroke();
      }
    }
    for (const id of [hoverEdge, selEdge]) {
      const e = id ? scene.edges.find((x) => x.id === id) : null;
      if (!e) continue;
      const a = posOf(scene.byId.get(e.from)!);
      const b = posOf(scene.byId.get(e.to)!);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = CATEGORY_LOOK[e.cat].color;
      ctx.lineWidth = 3 / k;
      ctx.setLineDash(CATEGORY_LOOK[e.cat].dash.map((d) => d / k));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Your theories: magenta, long dash marching along the line, a bulb at the middle.
    const march = reduced ? 0 : -(t / 60) % 12;
    for (const th of scene.theories) {
      const a = posOf(scene.byId.get(th.a.id)!);
      const b = posOf(scene.byId.get(th.b.id)!);
      const on = lit({ from: th.a.id, to: th.b.id }) || th.id === selTheory;
      ctx.globalAlpha = on ? 0.25 : 0.06;
      ctx.strokeStyle = THEORY_LOOK.color;
      ctx.setLineDash([]);
      ctx.lineWidth = (th.id === selTheory ? 9 : 6) / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.globalAlpha = on ? 1 : 0.2;
      ctx.lineWidth = 2.2 / k;
      ctx.setLineDash(THEORY_LOOK.dash.map((d) => d / k));
      ctx.lineDashOffset = march / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineDashOffset = 0;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const r = 9 / k;
      ctx.setLineDash([]);
      ctx.fillStyle = PANEL;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
      drawIcon(ctx, "theory", mx, my, 12 / k, THEORY_LOOK.color);
    }

    // Draft link while drawing a theory.
    const g = gesture.current;
    const from = g?.mode === "link" ? g.id : pend;
    if (from && pointer.current && scene.byId.has(from)) {
      const a = posOf(scene.byId.get(from)!);
      const b = toWorld(pointer.current.x, pointer.current.y);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = THEORY_LOOK.color;
      ctx.lineWidth = 2 / k;
      ctx.setLineDash(THEORY_LOOK.dash.map((d) => d / k));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Nodes, then labels on top.
    const labels = k > 0.55;
    ctx.font = `${11 / k}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of scene.nodes) {
      const p = posOf(n);
      if ((p.x * k + x < -60) || (p.y * k + y < -60) || (p.x * k + x > w + 60) || (p.y * k + y > h + 60)) continue;
      const look = NODE_LOOK[n.type];
      const r = radius(n, scene.degree.get(n.id) || 0);
      const on = !focus || focus.has(n.id);
      const picked = n.id === sel || n.id === pend;
      ctx.globalAlpha = on ? 1 : 0.18;
      shape(ctx, look.shape, p.x, p.y, r);
      ctx.fillStyle = PANEL;
      ctx.fill();
      ctx.lineWidth = (picked ? 2.6 : 1.6) / k;
      ctx.strokeStyle = look.color;
      if (n.user) ctx.setLineDash([3 / k, 2 / k]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (picked) {
        shape(ctx, look.shape, p.x, p.y, r + 5 / k);
        ctx.strokeStyle = n.id === pend ? THEORY_LOOK.color : "#ffc14a";
        ctx.lineWidth = 2 / k;
        ctx.stroke();
      }
      drawIcon(ctx, look.icon, p.x, p.y, Math.min(r * 1.2, 16), look.color);
      if (n.pinned && !n.user) {
        ctx.fillStyle = look.color;
        ctx.beginPath(); ctx.arc(p.x + r * 0.8, p.y - r * 0.8, 2.2 / k, 0, Math.PI * 2); ctx.fill();
      }
      if (labels || picked || (focus && focus.has(n.id))) {
        const text = n.label.length > 28 ? `${n.label.slice(0, 27)}…` : n.label;
        ctx.lineWidth = 3 / k;
        ctx.strokeStyle = PANEL;
        ctx.strokeText(text, p.x, p.y + r + 4 / k);
        ctx.fillStyle = picked ? "#ffc14a" : n.user ? THEORY_LOOK.color : "#e4e7e6";
        ctx.fillText(text, p.x, p.y + r + 4 / k);
      }
    }
    ctx.globalAlpha = 1;
    const ms = performance.now() - t0;
    perf.current.n += 1;
    perf.current.ms = perf.current.ms * 0.9 + ms * 0.1;
    if (perf.current.n % 20 === 0) cv.dataset.drawMs = perf.current.ms.toFixed(2);
  }

  function showTip(h: Hit, sx: number, sy: number) {
    const el = tip.current;
    if (!el) return;
    if (!h || gesture.current) { el.hidden = true; return; }
    let html = "";
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    if (h.kind === "node") {
      const look = NODE_LOOK[h.node.type];
      html = `<b style="color:${look.color}">${esc(look.label)}</b> ${esc(h.node.label)}${h.node.sub ? `<small>${esc(h.node.sub)}</small>` : ""}${h.node.user ? "<small>Added by you · not from a data source</small>" : ""}`;
    } else if (h.kind === "edge") {
      const e = h.edge;
      const look = CATEGORY_LOOK[e.cat];
      const a = scene.byId.get(e.from)?.label || e.from;
      const b = scene.byId.get(e.to)?.label || e.to;
      html = `<b style="color:${look.color}">${esc(look.label)}</b> ${esc(a)} → ${esc(b)}<span>${esc(e.label)}</span><small>${esc(e.source)} · as of ${esc(e.asOf ? e.asOf.slice(0, 16).replace("T", " ") + " UTC" : "curated file")}</small><small>${esc(e.latency)}</small>`;
    } else {
      const th = h.theory;
      html = `<b style="color:${THEORY_LOOK.color}">Your theory</b> ${esc(th.a.label)} ↔ ${esc(th.b.label)}${th.label ? `<span>${esc(th.label)}</span>` : ""}<small>Not from a data source · ${th.confidence} confidence</small>`;
    }
    el.innerHTML = html;
    el.hidden = false;
    const { w } = size.current;
    el.style.left = `${Math.min(sx + 14, w - 300)}px`;
    el.style.top = `${sy + 14}px`;
  }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ok */ }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (press.current) window.clearTimeout(press.current);
      gesture.current = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...view.current } };
      return;
    }
    const h = hit(p.x, p.y);
    if (h?.kind === "node") {
      if (live.current.theoryMode) gesture.current = { mode: "link", id: h.node.id, moved: false, sx: p.x, sy: p.y };
      else {
        const at = posOf(h.node);
        gesture.current = { mode: "node", id: h.node.id, sx: p.x, sy: p.y, ox: at.x, oy: at.y, moved: false, touch: e.pointerType !== "mouse" };
        if (e.pointerType !== "mouse") {
          press.current = window.setTimeout(() => {
            const g = gesture.current;
            if (g?.mode === "node" && !g.moved) {
              gesture.current = null;
              live.current.onSelect(g.id);
              live.current.onMenu(g.id, { x: g.sx, y: g.sy });
            }
          }, 500);
        }
      }
    } else gesture.current = { mode: "pan", sx: p.x, sy: p.y, vx: view.current.x, vy: view.current.y, moved: false };
    showTip(null, 0, 0);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    pointer.current = p;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) {
      const h = hit(p.x, p.y);
      const same = h?.kind === hover.current?.kind && (h?.kind === "node" ? h.node.id === (hover.current as { node: RelNode }).node.id : h?.kind === "edge" ? h.edge.id === (hover.current as { edge: RelEdge }).edge.id : h?.kind === "theory" ? h.theory.id === (hover.current as { theory: Theory }).theory.id : true);
      if (!same) setHover(h);
      canvas.current!.style.cursor = h?.kind === "node" ? (live.current.theoryMode ? "crosshair" : "pointer") : h ? "help" : "grab";
      showTip(h, p.x, p.y);
      if (live.current.pendingFrom) dirty.current = true;
      return;
    }
    if (g.mode === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.max(MIN_K, Math.min(MAX_K, g.view.k * (d / g.d)));
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      view.current = { k, x: cx - ((g.cx - g.view.x) * k) / g.view.k, y: cy - ((g.cy - g.view.y) * k) / g.view.k };
      moved.current = true;
      dirty.current = true;
      return;
    }
    const far = Math.hypot(p.x - g.sx, p.y - g.sy) > (e.pointerType === "mouse" ? 3 : 8);
    if (far && !g.moved) {
      g.moved = true;
      if (press.current) window.clearTimeout(press.current);
      live.current.onCloseMenu();
    }
    if (!g.moved) return;
    if (g.mode === "pan") {
      view.current = { ...view.current, x: g.vx + p.x - g.sx, y: g.vy + p.y - g.sy };
      moved.current = true;
    } else if (g.mode === "node") drag.current.set(g.id, { x: g.ox + (p.x - g.sx) / view.current.k, y: g.oy + (p.y - g.sy) / view.current.k });
    dirty.current = true;
  }

  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = local(e);
    pointers.current.delete(e.pointerId);
    if (press.current) window.clearTimeout(press.current);
    const g = gesture.current;
    if (g?.mode === "pinch") { if (pointers.current.size === 0) gesture.current = null; return; }
    gesture.current = null;
    if (!g) return;
    const L = live.current;
    if (g.mode === "node") {
      if (g.moved) {
        const at = drag.current.get(g.id);
        if (at) L.onMove(new Map([[g.id, at]]));
      } else {
        L.onSelect(g.id);
        if (!g.touch) L.onMenu(g.id, p);
        else L.onCloseMenu();
      }
    } else if (g.mode === "link") {
      if (!g.moved) L.onLinkClick(g.id);
      else {
        const h = hit(p.x, p.y);
        if (h?.kind === "node" && h.node.id !== g.id) L.onLinkDrop(g.id, h.node.id);
      }
    } else if (g.mode === "pan" && !g.moved) {
      const h = hit(p.x, p.y);
      L.onCloseMenu();
      L.onSelect(h?.kind === "edge" ? edgeSel(h.edge.id) : h?.kind === "theory" ? theoryId(h.theory.id) : null);
    }
    dirty.current = true;
  }

  function dbl(e: ReactMouseEvent<HTMLCanvasElement>) {
    const p = local(e);
    const h = hit(p.x, p.y);
    if (h?.kind === "node") { live.current.onCloseMenu(); live.current.onExpand(h.node.id); }
    else zoomAt(1.6, p.x, p.y);
  }

  function key(e: ReactKeyboardEvent<HTMLCanvasElement>) {
    const L = live.current;
    if (e.key === "Tab" && scene.order.length) {
      const at = scene.order.indexOf(L.selectedId || "");
      const next = at + (e.shiftKey ? -1 : 1);
      if (at >= 0 && (next < 0 || next >= scene.order.length)) return;
      e.preventDefault();
      const id = scene.order[at < 0 ? (e.shiftKey ? scene.order.length - 1 : 0) : next];
      L.onSelect(id);
      const n = scene.byId.get(id)!;
      const s = { x: n.x * view.current.k + view.current.x, y: n.y * view.current.k + view.current.y };
      if (s.x < 40 || s.y < 40 || s.x > size.current.w - 40 || s.y > size.current.h - 40) view.current = { ...view.current, x: size.current.w / 2 - n.x * view.current.k, y: size.current.h / 2 - n.y * view.current.k };
      dirty.current = true;
      return;
    }
    const node = L.selectedId && scene.byId.get(L.selectedId);
    if (e.key === "Enter" && node) { e.preventDefault(); L.onExpand(node.id); return; }
    if ((e.key === " " || e.key === "ContextMenu") && node) {
      e.preventDefault();
      L.onMenu(node.id, { x: node.x * view.current.k + view.current.x, y: node.y * view.current.k + view.current.y });
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && node) { e.preventDefault(); L.onRemove(node.id); return; }
    if (e.key === "+" || e.key === "=") { zoomAt(1.25, size.current.w / 2, size.current.h / 2); return; }
    if (e.key === "-" || e.key === "_") { zoomAt(0.8, size.current.w / 2, size.current.h / 2); return; }
    if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) { fit(); return; }
    L.onKey(e);
  }

  return (
    <div ref={wrap} className="relmap-canvas">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="application"
        aria-label={`Relationship map: ${scene.nodes.length} nodes, ${scene.edges.length} data links, ${scene.theories.length} theories of yours. Tab moves between nodes, Enter expands, Space opens categories, Delete removes, F fits.`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={() => { if (!gesture.current) { setHover(null); showTip(null, 0, 0); } }}
        onDoubleClick={dbl}
        onKeyDown={key}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = local(e);
          const h = hit(p.x, p.y);
          if (h?.kind === "node") { live.current.onSelect(h.node.id); live.current.onMenu(h.node.id, p); }
        }}
      />
      <div ref={tip} className="relmap-tip" hidden />
    </div>
  );
});
