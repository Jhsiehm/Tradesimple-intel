/**
 * Stable placement for the relationship canvas. New nodes fan out around the node they came from, into the
 * side facing away from its existing neighbors; then a short relaxation moves only the new nodes. Nodes
 * already on the canvas never move, so an expansion does not shake the picture.
 */
export type Pt = { x: number; y: number };
type Placed = { id: string; x: number; y: number; pinned?: boolean };

const RING = 150;
const STEP = 64;
const GAP = 46;

/** Positions for `ids` around `parent`. `neighbors` are where the parent's current links already point. */
export function fan(parent: Pt, ids: string[], neighbors: Pt[]): Map<string, Pt> {
  const out = new Map<string, Pt>();
  if (!ids.length) return out;
  let away = -Math.PI / 2;
  if (neighbors.length) {
    const sx = neighbors.reduce((s, p) => s + (p.x - parent.x), 0);
    const sy = neighbors.reduce((s, p) => s + (p.y - parent.y), 0);
    if (Math.hypot(sx, sy) > 1) away = Math.atan2(-sy, -sx);
  }
  const spread = Math.min(Math.PI * 2, Math.max(Math.PI * 0.6, ids.length * 0.32));
  let ring = 0;
  let placed = 0;
  while (placed < ids.length) {
    const r = RING + ring * STEP;
    const fits = Math.max(1, Math.floor((spread * r) / GAP));
    const take = Math.min(fits, ids.length - placed);
    for (let i = 0; i < take; i += 1) {
      const t = take === 1 ? 0 : i / (take - 1) - 0.5;
      const a = away + t * spread * (spread >= Math.PI * 2 ? (take - 1) / take : 1) + (ring % 2) * 0.08;
      out.set(ids[placed + i], { x: parent.x + Math.cos(a) * r, y: parent.y + Math.sin(a) * r });
    }
    placed += take;
    ring += 1;
  }
  return out;
}

/**
 * Push `moving` apart from everything (grid-bucketed, so ~300 nodes stay cheap) while a spring keeps each one
 * near its anchor. Fixed nodes are obstacles only.
 */
export function relax(all: Placed[], moving: Map<string, Pt>, anchors: Map<string, Pt>, rounds = 40): Map<string, Pt> {
  const pos = new Map(moving);
  const cell = 60;
  for (let r = 0; r < rounds; r += 1) {
    const grid = new Map<string, Pt[]>();
    const put = (p: Pt) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (grid.get(k) || grid.set(k, []).get(k)!).push(p);
    };
    for (const n of all) if (!pos.has(n.id)) put(n);
    for (const p of pos.values()) put(p);
    const cool = 1 - r / rounds;
    for (const [id, p] of pos) {
      let fx = 0;
      let fy = 0;
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (q === p) continue;
          const ddx = p.x - q.x;
          const ddy = p.y - q.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > cell * cell) continue;
          const d = Math.sqrt(d2) || 0.01;
          const push = (cell - d) / d;
          fx += ddx * push * 0.5;
          fy += ddy * push * 0.5;
        }
      }
      const a = anchors.get(id);
      if (a) {
        fx += (a.x - p.x) * 0.04;
        fy += (a.y - p.y) * 0.04;
      }
      p.x += Math.max(-12, Math.min(12, fx * cool));
      p.y += Math.max(-12, Math.min(12, fy * cool));
      pos.set(id, p);
    }
  }
  return pos;
}

/** Full re-layout on request: a small force pass over unpinned nodes with springs along links. */
export function settle(nodes: Placed[], links: [string, string][], rounds = 120): Map<string, Pt> {
  const pos = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const pinned = new Set(nodes.filter((n) => n.pinned).map((n) => n.id));
  const ids = [...pos.keys()];
  for (let r = 0; r < rounds; r += 1) {
    const cool = 1 - r / rounds;
    const force = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    const cell = 120;
    const grid = new Map<string, string[]>();
    for (const id of ids) {
      const p = pos.get(id)!;
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (grid.get(k) || grid.set(k, []).get(k)!).push(id);
    }
    for (const id of ids) {
      const p = pos.get(id)!;
      const f = force.get(id)!;
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (other === id) continue;
          const q = pos.get(other)!;
          const ddx = p.x - q.x;
          const ddy = p.y - q.y;
          const d2 = Math.max(25, ddx * ddx + ddy * ddy);
          if (d2 > cell * cell) continue;
          f.x += (ddx / d2) * 900;
          f.y += (ddy / d2) * 900;
        }
      }
    }
    for (const [a, b] of links) {
      const p = pos.get(a);
      const q = pos.get(b);
      if (!p || !q) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const k = ((d - RING) / d) * 0.03;
      force.get(a)!.x += dx * k;
      force.get(a)!.y += dy * k;
      force.get(b)!.x -= dx * k;
      force.get(b)!.y -= dy * k;
    }
    for (const id of ids) {
      if (pinned.has(id)) continue;
      const p = pos.get(id)!;
      const f = force.get(id)!;
      p.x += Math.max(-20, Math.min(20, f.x * cool));
      p.y += Math.max(-20, Math.min(20, f.y * cool));
    }
  }
  return pos;
}
