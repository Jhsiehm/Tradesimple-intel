import type { PointerEvent as ReactPointerEvent } from "react";

/** Track one pointer from `event` until release. `onEnd` gets whether it moved past a click's jitter. */
export function startDrag(event: ReactPointerEvent, onMove: (dx: number, dy: number) => void, onEnd: (moved: boolean) => void) {
  if (event.button !== 0) return;
  const el = event.currentTarget as HTMLElement;
  const sx = event.clientX;
  const sy = event.clientY;
  let moved = false;
  try {
    el.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or already-released pointers cannot be captured; element listeners still see the moves.
  }
  document.body.classList.add("card-dragging");
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    moved = true;
    onMove(dx, dy);
  };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.body.classList.remove("card-dragging");
    onEnd(moved);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
