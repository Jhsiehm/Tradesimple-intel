import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

export type Rail = { w: number; open: boolean };

const KEY = "intel:rail:v1";
const DEFAULT: Rail = { w: 360, open: true };

function storedRail(): Rail {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function useRail() {
  const [rail, setRail] = useState<Rail>(storedRail);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(rail));
  }, [rail]);

  const toggle = () => setRail((r) => ({ ...r, open: !r.open }));
  const show = () => setRail((r) => (r.open ? r : { ...r, open: true }));
  const reset = () => setRail(DEFAULT);

  function drag(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = rail.open ? rail.w : 0;
    document.body.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.round(window.innerWidth * 0.7), Math.max(0, startW - (ev.clientX - startX)));
      setRail((r) => (w < 180 ? { ...r, open: false } : { w: Math.round(w), open: true }));
    };
    const up = () => {
      document.body.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return { rail, toggle, show, reset, drag, columns: `minmax(0, 1fr) 8px ${rail.open ? rail.w : 0}px` };
}
