import { EMPTY_GRAPH, MAX_EDGES, MAX_NODES, type Graph, type RelNode } from "../../shared/relations.mjs";
import { THEORY_KEY, cleanDoc, cleanTheory, decodeShare, encodeShare, mergeDocs, parseDoc, serialize, type TheoryDoc } from "../../shared/theories.mjs";

/** Data nodes and edges on the canvas, with where you left them. Feeds are re-asked on expand, not here. */
const CANVAS_KEY = "intel:relations:canvas:v1";

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function loadDoc(): TheoryDoc {
  return parseDoc(read(THEORY_KEY));
}

export function saveDoc(doc: TheoryDoc) {
  return write(THEORY_KEY, serialize(doc));
}

/** Ask writes one theory here. Not fired from saveDoc: the map saves on a timer and would loop. */
export const THEORY_SAVED = "intel:theory-saved";

/** Clean, store, and tell the open map. Theories stay in the theory document, apart from feed data. */
export function saveTheory(raw: unknown): "saved" | "invalid" | "refused" {
  const now = new Date().toISOString();
  if (!raw || typeof raw !== "object") return "invalid";
  const base: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (!base.created) base.created = now;
  base.updated = now;
  const theory = cleanTheory(base);
  if (!theory) return "invalid";
  const doc = loadDoc();
  if (!saveDoc({ ...doc, theories: [...doc.theories.filter((t) => t.id !== theory.id), theory] })) return "refused";
  window.dispatchEvent(new CustomEvent(THEORY_SAVED, { detail: theory }));
  return "saved";
}

/** The graph as stored: canvas data plus your notes and theories. Theory endpoints missing from the canvas come back too. */
export function loadGraph(): Graph {
  let canvas: { nodes?: RelNode[]; edges?: Graph["edges"] } = {};
  try { canvas = JSON.parse(read(CANVAS_KEY) || "{}"); } catch { canvas = {}; }
  const doc = loadDoc();
  return fromDoc({ ...EMPTY_GRAPH, nodes: (canvas.nodes || []).filter((n) => n && n.id && !n.user).slice(0, MAX_NODES), edges: (canvas.edges || []).filter((e) => e && e.id).slice(0, MAX_EDGES) }, doc);
}

/** Notes become user nodes; each theory endpoint not on the canvas is put back near the other end. */
export function fromDoc(graph: Graph, doc: TheoryDoc): Graph {
  const nodes = new Map(graph.nodes.filter((n) => !n.user).map((n) => [n.id, n]));
  const prior = new Map(graph.nodes.filter((n) => n.user).map((n) => [n.id, n]));
  let i = 0;
  const spot = () => {
    i += 1;
    return { x: Math.cos(i * 2.4) * (120 + i * 12), y: Math.sin(i * 2.4) * (120 + i * 12) };
  };
  for (const note of doc.notes) {
    const was = prior.get(note.id);
    nodes.set(note.id, { ...note, user: true, x: was?.x ?? spot().x, y: was?.y ?? spot().y, pinned: true });
  }
  for (const t of doc.theories) {
    for (const [end, other] of [[t.a, t.b], [t.b, t.a]] as const) {
      if (nodes.has(end.id)) continue;
      const near = nodes.get(other.id);
      const p = spot();
      nodes.set(end.id, { id: end.id, type: (end.type as RelNode["type"]) || "note", label: end.label, x: (near?.x ?? 0) + p.x * 0.6, y: (near?.y ?? 0) + p.y * 0.6 });
    }
  }
  return { ...graph, nodes: [...nodes.values()], theories: doc.theories };
}

export function docOf(graph: Graph): TheoryDoc {
  return cleanDoc({
    theories: graph.theories,
    notes: graph.nodes.filter((n) => n.user).map((n) => ({ id: n.id, type: "note", label: n.label, note: n.note || "", kind: n.kind || "other", created: "" }))
  });
}

/** Saves both halves. Returns false when storage refused (private mode or full). */
export function saveGraph(graph: Graph) {
  const data = { nodes: graph.nodes.filter((n) => !n.user), edges: graph.edges };
  const a = write(CANVAS_KEY, JSON.stringify(data));
  const b = saveDoc(docOf(graph));
  return a && b;
}

/** `#rel=` share token in the address, if any; the hash is cleared once read. */
export function takeShared(): TheoryDoc | null {
  const m = location.hash.match(/^#rel=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return decodeShare(m[1]);
}

export function shareUrl(graph: Graph) {
  const token = encodeShare(docOf(graph));
  return token ? `${location.origin}${location.pathname}#rel=${token}` : "";
}

export function downloadDoc(graph: Graph) {
  const blob = new Blob([JSON.stringify(docOf(graph), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tradesimple-theories-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readDocFile(file: File): Promise<TheoryDoc> {
  return parseDoc(await file.text());
}

export { mergeDocs };
