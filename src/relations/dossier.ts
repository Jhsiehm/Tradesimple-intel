import { CATEGORIES, counts, parseNode, type CategoryId, type Graph, type RelEdge, type RelNode, type Theory } from "../../shared/relations.mjs";
import { when } from "../lib/api";
import type { DrawerLink, DrawerModel, DrawerTable, ListItem, StatusLine } from "../types";
import type { IconName } from "../ui/icons/names";
import { CATEGORY_LOOK, NODE_LOOK, THEORY_LOOK } from "./palette";

export type RelItem = ListItem & { icon: IconName; tint: string };
export type Loaded = { shown: number; total: number; more: boolean; source: string; asOf: string; latency: string; note?: string; error?: string };

const CONF = { low: "Low", medium: "Medium", high: "High" };
export const theoryId = (id: string) => `theory:${id}`;
export const edgeSel = (id: string) => `edge:${id}`;

/** The canvas as the one list: your theories first, then nodes by kind. */
export function listItems(graph: Graph): RelItem[] {
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const theories: RelItem[] = graph.theories.map((t) => ({
    id: theoryId(t.id),
    title: `${label.get(t.a.id) || t.a.label} ↔ ${label.get(t.b.id) || t.b.label}`,
    meta: `Your theory${t.label ? ` · ${t.label}` : ""} · ${CONF[t.confidence]} confidence`,
    tag: "THEORY",
    icon: THEORY_LOOK.icon,
    tint: THEORY_LOOK.color
  }));
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const order = Object.keys(NODE_LOOK);
  const nodes: RelItem[] = [...graph.nodes]
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.label.localeCompare(b.label))
    .map((n) => ({
      id: n.id,
      title: n.label,
      meta: `${NODE_LOOK[n.type].label}${n.sub ? ` · ${n.sub}` : ""} · ${n.user ? "added by you" : `${degree.get(n.id) || 0} links`}`,
      icon: NODE_LOOK[n.type].icon,
      tint: NODE_LOOK[n.type].color
    }));
  return [...theories, ...nodes];
}

/** Dossier links a node can open elsewhere in the terminal. */
function opens(node: RelNode): DrawerLink[] {
  const p = parseNode(node.id);
  if (!p) return [];
  if (p.type === "member") return [{ label: "Member", value: "Card, trades, votes", action: `member:${p.key}` }, { label: "Timeline", value: "Trades against hearings", action: `timeline:${p.key}` }];
  if (p.type === "ticker") return [{ label: "Dossier", value: `${p.key} chart and case file`, action: `ticker:${p.key}` }, { label: "Supply chain", value: "SPLC board", action: `supply:${p.key}` }, { label: "Contracts", value: "USAspending actions", action: `contracts:symbol:${p.key}` }];
  if (p.type === "district" && p.key.includes("-")) return [{ label: "District", value: `${p.key} dossier`, action: `district:${p.key}` }];
  return [];
}

function edgeRow(e: RelEdge, other: RelNode | undefined): DrawerTable["rows"][number] {
  return { cells: [other?.label || "—", e.label, e.last || (e.asOf ? when(e.asOf).slice(0, 10) : "—")], ...(e.link ? { href: e.link } : {}) };
}

export function nodeDrawer(graph: Graph, node: RelNode, loaded: Record<string, Loaded>): DrawerModel {
  const look = NODE_LOOK[node.type];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const mine = graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  const tables: DrawerTable[] = [];
  for (const cat of CATEGORIES) {
    const list = mine.filter((e) => e.cat === cat.id);
    const meta = loaded[`${node.id}|${cat.id}`];
    if (!list.length && !meta) continue;
    const first = list[0];
    tables.push({
      title: `${CATEGORY_LOOK[cat.id].label} · ${list.length}${meta ? ` of ${meta.total}` : ""} on canvas`,
      cols: ["With", "Relationship", "Date"],
      rows: list.slice(0, 40).map((e) => edgeRow(e, byId.get(e.from === node.id ? e.to : e.from))),
      note: `${first?.source || meta?.source || cat.source} · as of ${first?.asOf || meta?.asOf ? when(first?.asOf || meta!.asOf) : "—"} · ${first?.latency || meta?.latency || ""}${meta?.note ? ` · ${meta.note}` : ""}`
    });
  }
  const theories = graph.theories.filter((t) => t.a.id === node.id || t.b.id === node.id);
  return {
    title: node.label,
    meta: node.user ? `Added by you · ${node.kind || "note"} · not from a data source` : `${look.label}${node.sub ? ` · ${node.sub}` : ""}`,
    icon: look.icon,
    tint: look.color,
    rows: [
      { label: "Kind", value: node.user ? "Your node" : look.label },
      { label: "Data links", value: String(mine.length) },
      ...(node.note ? [{ label: "Note", value: node.note }] : []),
      ...(theories.length ? [{ label: "Your theories", value: `${theories.length} (not counted as data)` }] : [])
    ],
    tables,
    blocks: theories.length ? [{ title: "Your theories · not from a data source", lines: theories.map((t) => theoryLine(t, byId)) }] : undefined,
    links: opens(node),
    source: node.user ? "Added by you in this browser" : "Each table names its feed, as-of time, and lag"
  };
}

function theoryLine(t: Theory, byId: Map<string, RelNode>) {
  return `${byId.get(t.a.id)?.label || t.a.label} ↔ ${byId.get(t.b.id)?.label || t.b.label}${t.label ? ` · ${t.label}` : ""} · ${CONF[t.confidence]}${t.note ? ` · ${t.note}` : ""}`;
}

export function theoryDrawer(graph: Graph, t: Theory): DrawerModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return {
    title: t.label || "Untitled theory",
    meta: "Your theory · not from a data source",
    icon: THEORY_LOOK.icon,
    tint: THEORY_LOOK.color,
    rows: [
      { label: "Between", value: `${byId.get(t.a.id)?.label || t.a.label} ↔ ${byId.get(t.b.id)?.label || t.b.label}` },
      { label: "Confidence", value: CONF[t.confidence] },
      { label: "Note", value: t.note || "—" },
      { label: "Saved", value: t.updated ? `${when(t.updated)} UTC · this browser only` : "This browser only" }
    ],
    source: "Drawn by you. Never counted with feed data or case files. Edit or delete it on the map."
  };
}

export function edgeDrawer(graph: Graph, e: RelEdge): DrawerModel {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const look = CATEGORY_LOOK[e.cat];
  return {
    title: `${byId.get(e.from)?.label || e.from} → ${byId.get(e.to)?.label || e.to}`,
    meta: look.label,
    icon: look.icon,
    tint: look.color,
    rows: [
      { label: "Relationship", value: e.label },
      ...(e.last ? [{ label: "Latest", value: e.last }] : []),
      { label: "Source", value: e.source },
      { label: "As of", value: e.asOf ? `${when(e.asOf)} UTC` : "Curated file" },
      { label: "Lag", value: e.latency || "—" }
    ],
    links: e.link ? [{ label: "Filing", value: "Open the source record", href: e.link }] : [],
    source: e.source
  };
}

export function findEdge(graph: Graph, sel: string) {
  return sel.startsWith("edge:") ? graph.edges.find((e) => e.id === sel.slice(5)) || null : null;
}

export function status(graph: Graph, loaded: Record<string, Loaded>): StatusLine {
  const c = counts(graph);
  const feeds = new Set(graph.edges.map((e) => e.source));
  const latest = Object.values(loaded).map((l) => l.asOf).filter(Boolean).sort().at(-1) || graph.edges.map((e) => e.asOf).filter(Boolean).sort().at(-1) || "";
  const cats = (Object.entries(c.byCat) as [CategoryId, number][]).filter(([, n]) => n).map(([k, n]) => `${CATEGORY_LOOK[k].label} ${n}`).join(" · ");
  return {
    source: graph.nodes.length ? `Relationship map · ${c.data} data links from ${feeds.size} feed${feeds.size === 1 ? "" : "s"}${cats ? ` (${cats})` : ""} · ${c.theories} theor${c.theories === 1 ? "y" : "ies"} of yours, not counted` : "Relationship map",
    asOf: latest ? `${when(latest)} UTC` : "",
    latency: "The mark on a line is the filing lag, or the days between a trade and a hearing. Hover for the feed and as-of time. Magenta dashed lines are your theories, saved only in this browser."
  };
}
