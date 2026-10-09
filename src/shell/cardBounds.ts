import { useEffect, useState } from "react";

export type Box = { left: number; top: number; right: number; bottom: number };
export type Rect = { x: number; y: number; w: number; h: number };

const PAD = 8;
const MIN_W = 260;
const MIN_H = 160;
export const CHIP_H = 34;
export const OPEN_LIMIT = 3;
const SPOTS = "intel:cardpos:v1";

/** Cards live inside the map stage: below the top nav and the section bar, left of the list rail. */
export function stageBox(): Box {
  const r = document.querySelector(".map-body")?.getBoundingClientRect();
  if (r && r.width > 240 && r.height > 160) return { left: r.left + PAD, top: r.top + PAD, right: r.right - PAD, bottom: r.bottom - PAD };
  const bar = document.querySelector(".topbar")?.getBoundingClientRect();
  return { left: PAD, top: (bar?.bottom ?? 64) + PAD, right: window.innerWidth - PAD, bottom: window.innerHeight - PAD };
}

export function useStageBox() {
  const [box, setBox] = useState<Box>(stageBox);
  useEffect(() => {
    const measure = () => setBox((cur) => {
      const next = stageBox();
      return cur.left === next.left && cur.top === next.top && cur.right === next.right && cur.bottom === next.bottom ? cur : next;
    });
    const ro = new ResizeObserver(measure);
    const body = document.querySelector(".map-body");
    if (body) ro.observe(body);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return box;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/** Snap a card (or its collapsed chip) back inside the stage. The stored position is left alone. */
export function fitCard(r: Rect, box: Box, chip = false): Rect {
  const w = Math.min(Math.max(MIN_W, r.w), box.right - box.left);
  const h = Math.min(Math.max(MIN_H, r.h), box.bottom - box.top);
  const x = clamp(r.x, box.left, box.right - (chip ? Math.min(w, 240) : w));
  const y = clamp(r.y, box.top, box.bottom - (chip ? CHIP_H : h));
  return { x, y, w, h };
}

/** Default size: narrow, at most half the viewport tall; the body scrolls. */
export function defaultSize(w: number, h: number) {
  return { w: Math.min(w, 420), h: Math.min(h, Math.round(window.innerHeight * 0.5)) };
}

/** New cards stack down and left from the stage's top-right corner, clear of the legends, credits, time bar and zoom controls. */
export function cornerSpot(id: string, size: { w: number; h: number }, n: number): Rect {
  const kept = recallSpot(id);
  if (kept) return kept;
  const box = stageBox();
  const step = (n % 4) * 26;
  return { x: box.right - size.w - 8 - step, y: box.top + 8 + step, ...size };
}

function spots(): Record<string, Rect> {
  try {
    const raw = JSON.parse(localStorage.getItem(SPOTS) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function recallSpot(id: string): Rect | null {
  const r = spots()[id];
  return r && [r.x, r.y, r.w, r.h].every(Number.isFinite) ? r : null;
}

export function rememberSpot(id: string, r: Rect) {
  const all = spots();
  all[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
  const ids = Object.keys(all);
  for (const old of ids.slice(0, Math.max(0, ids.length - 40))) delete all[old];
  localStorage.setItem(SPOTS, JSON.stringify(all));
}
