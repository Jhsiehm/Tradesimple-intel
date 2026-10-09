/**
 * Relationship map: node ids, data categories, expansion caps, and the canvas graph reducer. Pure; the server
 * builds expansions with these ids and the browser merges them. Data edges and your theories never share a list.
 */
import { NEAR_DAYS, dayNum } from "./intel.mjs";

/** Node types. `note` is a node you added yourself; it never comes from a feed. */
export const NODE_TYPES = ["member", "ticker", "company", "committee", "hearing", "vote", "agency", "pac", "firm", "insider", "district", "note"];

/**
 * Data categories, in menu order. `from` lists the node types a category expands from. Sources are the feeds
 * the server reads; the response carries the live as-of and latency.
 */
export const CATEGORIES = [
  { id: "trade", label: "Trades", from: ["member", "ticker"], source: "House Clerk PTR · Senate eFD" },
  { id: "committee", label: "Committees", from: ["member", "committee"], source: "unitedstates/congress-legislators committee membership" },
  { id: "hearing", label: "Hearings", from: ["member", "committee", "hearing"], source: "Congress.gov committee meetings" },
  { id: "vote", label: "Roll calls", from: ["member", "vote"], source: "House Clerk EVS · Senate LIS" },
  { id: "contract", label: "Contracts", from: ["ticker", "agency", "district"], source: "USAspending.gov prime awards" },
  { id: "lobbying", label: "Lobbying", from: ["ticker"], source: "LDA.gov LD-2 filings" },
  { id: "pac", label: "PAC money", from: ["member", "ticker", "pac"], source: "FEC bulk itemized PAC contributions" },
  { id: "supply", label: "Supply chain", from: ["ticker", "company"], source: "data/supplychain.json (10-K, supplier lists)" },
  { id: "hq", label: "HQ · district", from: ["member", "ticker", "district"], source: "SEC EDGAR business address · Census 119th districts" },
  { id: "insider", label: "Form 4 insiders", from: ["ticker", "insider"], source: "SEC EDGAR Form 4" }
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Double-click expands these first. */
export const DEFAULT_EXPAND = { member: ["trade", "committee"], ticker: ["trade", "supply"], committee: ["committee"], district: ["hq"], agency: ["contract"], pac: ["pac"], company: ["supply"], insider: ["insider"], hearing: ["hearing"], vote: ["vote"] };

/** Neighbors per expansion page, and the hard ceiling a client may ask for. */
export const CAP = { page: 12, max: 60 };
/** Canvas ceiling; past it an expansion lands partly and says how many it dropped. */
export const MAX_NODES = 400;
export const MAX_EDGES = 1500;

const KEY_RE = /^[A-Za-z0-9 .,&'()/:\-_]{1,120}$/;

export const nodeId = (type, key) => `${type}:${key}`;

/** `member:P000197` → { type, key }; null for an unknown type or a key with odd characters. */
export function parseNode(id) {
  const raw = String(id || "");
  const at = raw.indexOf(":");
  if (at < 1) return null;
  const type = raw.slice(0, at);
  const key = raw.slice(at + 1);
  if (!NODE_TYPES.includes(type) || !KEY_RE.test(key)) return null;
  if (type === "member" && !/^[A-Z]\d{6}$/.test(key)) return null;
  if ((type === "ticker" || type === "company") && !/^[A-Z0-9.\-]{1,12}$/.test(key)) return null;
  if (type === "district" && !/^[A-Z]{2}(-(\d{2}|AL))?$/.test(key)) return null;
  return { type, key };
}

export const categoriesFor = (type) => CATEGORIES.filter((c) => c.from.includes(type));

export function clampLimit(raw, fallback = CAP.page) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(CAP.max, n);
}

export function clampOffset(raw) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 0;
}

/** One page of a ranked list, with the total and whether a next page exists. */
export function page(list, offset = 0, limit = CAP.page) {
  const items = list.slice(offset, offset + limit);
  return { items, total: list.length, offset, limit, more: offset + items.length < list.length };
}

/**
 * Collapse rows into one entry per neighbor. `keyOf` names the neighbor (empty drops the row); entries keep
 * the row count, the summed `amount`, the latest `date`, and the first row. Ranked by count, then amount.
 */
export function groupBy(rows, keyOf, { amount = () => 0, date = () => "" } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const g = groups.get(key) || { key, n: 0, amount: 0, last: "", rows: [] };
    g.n += 1;
    g.amount += Number(amount(row)) || 0;
    const d = String(date(row) || "");
    if (d > g.last) g.last = d;
    g.rows.push(row);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.n - a.n || Math.abs(b.amount) - Math.abs(a.amount) || a.key.localeCompare(b.key));
}

const PATH_CAP = 4;

function closestDated(list, traded, nearDays) {
  const d = dayNum(traded);
  if (!Number.isFinite(d)) return null;
  let best = null;
  for (const item of list) {
    const gap = dayNum(item.date) - d;
    if (!Number.isFinite(gap) || Math.abs(gap) > nearDays) continue;
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { item, gap };
  }
  return best;
}

/** Short mark for a filing lag, in days. Empty when the report has no filed date. */
export function lagMark(lag) {
  const n = Number(lag);
  return Number.isFinite(n) ? `${n}d` : "";
}

/** One sentence for the latest trade: what was done, when, and when the public learned it. */
export function tradeLabel(trade) {
  const side = trade.side === "buy" ? "Bought" : trade.side === "sell" ? "Sold" : "Traded";
  const amount = trade.amount ? ` ${trade.amount}` : "";
  const filed = trade.filed ? `filed ${String(trade.filed).slice(0, 10)}` : "filed date not on the report";
  const mark = lagMark(trade.lag);
  return `${side}${amount} · traded ${String(trade.traded).slice(0, 10)} · ${filed}${mark ? ` · ${mark} later` : ""}`;
}

/** Calendar distance from a trade to a hearing or contract. The caller already applied the 14-day cap. */
export function gapLabel(gap, symbol, traded, tail = "calendar only") {
  const when = gap === 0 ? "the same day as" : `${Math.abs(gap)}d ${gap > 0 ? "after" : "before"}`;
  return `${when} the ${symbol} trade on ${String(traded).slice(0, 10)} · ${tail}`;
}

/**
 * Arrival picture for one member or ticker. Neighbors collapse to their latest trade. A hearing or contract
 * is attached only when it falls within `nearDays` of that trade. Hearings passed in must already be limited
 * to the committees that member sits on. At most `cap` neighbors, most recent first.
 */
export function disclosurePath(trades, hearings = [], contracts = [], { nearDays = NEAR_DAYS, cap = PATH_CAP } = {}) {
  const latest = new Map();
  for (const trade of trades) {
    if (!trade?.neighbor || !trade.traded) continue;
    const cur = latest.get(trade.neighbor);
    if (!cur || String(trade.traded) > String(cur.traded)) latest.set(trade.neighbor, trade);
  }
  const picked = [...latest.values()].sort((a, b) => String(b.traded).localeCompare(String(a.traded))).slice(0, cap);
  const rows = picked.map((trade) => {
    const mine = hearings.filter((h) => !h.member || h.member === trade.member);
    const hearing = closestDated(mine, trade.traded, nearDays);
    const contract = closestDated(contracts.filter((c) => c.symbol && c.symbol === trade.symbol), trade.traded, nearDays);
    return { trade, hearing, contract };
  });
  return { rows, more: Math.max(0, latest.size - picked.length) };
}

/** One key per relationship, whichever side it was expanded from. */
export function edgeKey(cat, a, b) {
  return a < b ? `${cat}::${a}::${b}` : `${cat}::${b}::${a}`;
}

// ---------------------------------------------------------------------------------------------------------
// Canvas graph. State: { nodes, edges, theories }. Nodes carry x/y; `pinned` nodes stay where you dropped them.
// Edges are data only. Theories are yours and live in their own list.

export const EMPTY_GRAPH = Object.freeze({ nodes: [], edges: [], theories: [] });

const byId = (list) => new Map(list.map((x) => [x.id, x]));

/**
 * Merge one expansion. New nodes take `place(node, parentId)` positions; existing nodes never move. Edges
 * dedupe by edgeKey: a second sighting keeps the larger count and amount and the later date.
 * Returns { graph, added, dropped }.
 */
export function mergeExpansion(graph, exp, place = () => ({ x: 0, y: 0 })) {
  const nodes = byId(graph.nodes);
  const added = [];
  let dropped = 0;
  const origin = exp.node;
  if (origin && !nodes.has(origin.id)) {
    const p = place(origin, null);
    const n = { ...origin, x: p.x, y: p.y };
    nodes.set(n.id, n);
    added.push(n.id);
  }
  for (const node of exp.nodes || []) {
    if (nodes.has(node.id)) {
      const cur = nodes.get(node.id);
      if (!cur.sub && node.sub) nodes.set(node.id, { ...cur, sub: node.sub });
      continue;
    }
    if (nodes.size >= MAX_NODES) { dropped += 1; continue; }
    const p = place(node, origin?.id || null);
    nodes.set(node.id, { ...node, x: p.x, y: p.y });
    added.push(node.id);
  }
  const edges = byId(graph.edges);
  for (const edge of exp.edges || []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const id = edgeKey(edge.cat, edge.from, edge.to);
    const cur = edges.get(id);
    if (cur) {
      const marked = !cur.mark && edge.mark ? { ...cur, label: edge.label, mark: edge.mark, link: edge.link || cur.link, latency: edge.latency || cur.latency } : cur;
      edges.set(id, { ...marked, n: Math.max(marked.n || 0, edge.n || 0), amount: Math.abs(edge.amount || 0) > Math.abs(marked.amount || 0) ? edge.amount : marked.amount, last: (edge.last || "") > (marked.last || "") ? edge.last : marked.last });
      continue;
    }
    if (edges.size >= MAX_EDGES) { dropped += 1; continue; }
    edges.set(id, { ...edge, id });
  }
  return { graph: { ...graph, nodes: [...nodes.values()], edges: [...edges.values()] }, added, dropped };
}

/** Take a node off the canvas with its data edges. Theories touching it stay saved but are not drawn. */
export function removeNode(graph, id) {
  return { ...graph, nodes: graph.nodes.filter((n) => n.id !== id), edges: graph.edges.filter((e) => e.from !== id && e.to !== id) };
}

export function moveNodes(graph, moves) {
  if (!moves.size) return graph;
  return { ...graph, nodes: graph.nodes.map((n) => (moves.has(n.id) ? { ...n, ...moves.get(n.id), pinned: true } : n)) };
}

export function addNote(graph, note) {
  if (graph.nodes.some((n) => n.id === note.id)) return graph;
  return { ...graph, nodes: [...graph.nodes, { ...note, type: "note", user: true }] };
}

/** Add or replace a theory between two canvas nodes. A theory never joins `edges`. */
export function putTheory(graph, theory) {
  const rest = graph.theories.filter((t) => t.id !== theory.id);
  return { ...graph, theories: [...rest, theory] };
}

export function dropTheory(graph, id) {
  return { ...graph, theories: graph.theories.filter((t) => t.id !== id) };
}

/** Per-category data edge counts. Theories are counted apart and never added in. */
export function counts(graph) {
  const byCat = Object.fromEntries(CATEGORY_IDS.map((c) => [c, 0]));
  for (const e of graph.edges) if (e.cat in byCat) byCat[e.cat] += 1;
  return { byCat, data: graph.edges.length, theories: graph.theories.length, notes: graph.nodes.filter((n) => n.user).length };
}

/** Ids of a node and everything one data edge or theory away. */
export function neighborhood(graph, id) {
  const out = new Set([id]);
  for (const e of graph.edges) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  for (const t of graph.theories) {
    if (t.a.id === id) out.add(t.b.id);
    if (t.b.id === id) out.add(t.a.id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Undo / redo over whole graph snapshots. Snapshots share structure, so 60 steps stay cheap.

export const HISTORY_CAP = 60;

export const history = (present) => ({ past: [], present, future: [] });

export function commit(h, next) {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_CAP), present: next, future: [] };
}

export function undo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
