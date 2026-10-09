import type { RelNode } from "../../shared/relations.mjs";
import { PATHS } from "../ui/icons/paths";
import type { IconName } from "../ui/icons/names";

const ICONS = new Map<IconName, { path: Path2D; fill: boolean }[]>();
export function glyph(name: IconName) {
  if (!ICONS.has(name)) ICONS.set(name, PATHS[name].map((p) => (typeof p === "string" ? { path: new Path2D(p), fill: false } : { path: new Path2D(p.d), fill: true })));
  return ICONS.get(name)!;
}

export const radius = (n: RelNode, degree: number) => (n.user ? 13 : 10 + Math.min(9, Math.sqrt(degree) * 1.6));
export const MIN_K = 0.12;
export const MAX_K = 3.5;

export function shape(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, r: number) {
  ctx.beginPath();
  if (kind === "square") ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  else if (kind === "diamond") { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
  else if (kind === "hex") { for (let i = 0; i < 6; i += 1) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05); } ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
}

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
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

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
