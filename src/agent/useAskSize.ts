import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** Last Ask sheet box. A new chat does not clear it. */
export const SIZE_KEY = "intel:agent:size:v1";

export type Snap = "peek" | "half" | "most";
export type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Box = { x: number; y: number; w: number; h: number };
export type AskGeom = { box: Box; snap: Snap | null };

export const EDGES: Edge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const MARGIN = 20;
const PREFERRED_MIN_W = 340;
/** Header, chat row, saved list, and the question row. The log can shrink; the question cannot. */
const PREFERRED_MIN_H = 340;

const SIZING = ["ask-sizing", "ask-sizing-ns", "ask-sizing-ew", "ask-sizing-nwse", "ask-sizing-nesw"];

const CURSOR: Record<Edge, string> = {
  n: "ask-sizing-ns",
  s: "ask-sizing-ns",
  e: "ask-sizing-ew",
  w: "ask-sizing-ew",
  nw: "ask-sizing-nwse",
  se: "ask-sizing-nwse",
  ne: "ask-sizing-nesw",
  sw: "ask-sizing-nesw"
};

type Limits = {
  vw: number;
  vh: number;
  margin: number;
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
};

export function measure(): Limits {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.max(160, vw - MARGIN * 2);
  const maxH = Math.max(140, vh - MARGIN * 2);
  return {
    vw,
    vh,
    margin: MARGIN,
    minW: Math.min(PREFERRED_MIN_W, maxW),
    minH: Math.min(PREFERRED_MIN_H, maxH),
    maxW,
    maxH
  };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function clampBox(box: Box, m: Limits = measure()): Box {
  const w = Math.round(Math.min(m.maxW, Math.max(m.minW, box.w)));
  const h = Math.round(Math.min(m.maxH, Math.max(m.minH, box.h)));
  const x = Math.round(Math.min(m.vw - m.margin - w, Math.max(m.margin, box.x)));
  const y = Math.round(Math.min(m.vh - m.margin - h, Math.max(m.margin, box.y)));
  return { x, y, w, h };
}

function centerTop(w: number, h: number, m: Limits): Box {
  return clampBox({
    x: Math.round((m.vw - w) / 2),
    y: Math.max(m.margin, Math.round(m.vh * 0.08)),
    w,
    h
  }, m);
}

export function snapBox(snap: Snap, m: Limits = measure()): Box {
  if (snap === "peek") {
    return centerTop(
      Math.min(560, m.maxW),
      Math.min(m.maxH, Math.max(m.minH, Math.min(380, Math.round(m.vh * 0.36)))),
      m
    );
  }
  if (snap === "half") {
    return centerTop(
      Math.min(m.maxW, Math.max(m.minW, Math.round(m.vw * 0.5))),
      Math.min(m.maxH, Math.max(m.minH, Math.round(m.vh * 0.5))),
      m
    );
  }
  return clampBox({ x: m.margin, y: m.margin, w: m.maxW, h: m.maxH }, m);
}

export function defaultGeom(m: Limits = measure()): AskGeom {
  return {
    snap: null,
    box: centerTop(
      Math.min(680, m.maxW),
      Math.min(820, m.maxH, Math.max(m.minH, Math.round(m.vh * 0.78))),
      m
    )
  };
}

export function resizeBox(from: Box, edge: Edge, dx: number, dy: number, m: Limits = measure()): Box {
  const west = edge === "w" || edge === "nw" || edge === "sw";
  const east = edge === "e" || edge === "ne" || edge === "se";
  const north = edge === "n" || edge === "nw" || edge === "ne";
  const south = edge === "s" || edge === "sw" || edge === "se";
  let w = from.w + (east ? dx : 0) - (west ? dx : 0);
  let h = from.h + (south ? dy : 0) - (north ? dy : 0);
  w = Math.min(m.maxW, Math.max(m.minW, w));
  h = Math.min(m.maxH, Math.max(m.minH, h));
  if (east) w = Math.min(w, m.vw - m.margin - from.x);
  if (south) h = Math.min(h, m.vh - m.margin - from.y);
  if (west) w = Math.min(w, from.x + from.w - m.margin);
  if (north) h = Math.min(h, from.y + from.h - m.margin);
  w = Math.round(Math.max(m.minW, w));
  h = Math.round(Math.max(m.minH, h));
  const x = west ? from.x + from.w - w : from.x;
  const y = north ? from.y + from.h - h : from.y;
  return clampBox({ x, y, w, h }, m);
}

export function readGeom(): AskGeom {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return defaultGeom();
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return defaultGeom();
    const row = data as Record<string, unknown>;
    const snap = row.snap === "peek" || row.snap === "half" || row.snap === "most" ? row.snap : null;
    if (snap) return { snap, box: snapBox(snap) };
    const w = finite(row.w);
    const h = finite(row.h);
    if (w == null || h == null) return defaultGeom();
    return {
      snap: null,
      box: clampBox({
        x: finite(row.x) ?? 0,
        y: finite(row.y) ?? 0,
        w,
        h
      })
    };
  } catch {
    return defaultGeom();
  }
}

function writeGeom(geom: AskGeom) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ ...geom.box, snap: geom.snap }));
  } catch {
    // The sheet still resizes when this browser refuses storage.
  }
}

function clearSizing() {
  document.body.classList.remove(...SIZING);
}

export function useAskSize() {
  const [geom, setGeom] = useState<AskGeom>(readGeom);
  const geomRef = useRef(geom);
  geomRef.current = geom;

  useEffect(() => {
    writeGeom(geom);
  }, [geom]);

  useEffect(() => {
    const onResize = () => {
      setGeom((cur) => (
        cur.snap ? { snap: cur.snap, box: snapBox(cur.snap) } : { snap: null, box: clampBox(cur.box) }
      ));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearSizing();
    };
  }, []);

  const applySnap = (snap: Snap) => setGeom({ snap, box: snapBox(snap) });

  function drag(event: ReactPointerEvent, edge: Edge) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const from = geomRef.current.box;
    const sx = event.clientX;
    const sy = event.clientY;
    let moved = false;
    clearSizing();
    document.body.classList.add("ask-sizing", CURSOR[edge]);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      ev.preventDefault();
      setGeom({ snap: null, box: resizeBox(from, edge, dx, dy) });
    };
    const up = () => {
      clearSizing();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return { box: geom.box, snap: geom.snap, applySnap, drag };
}
