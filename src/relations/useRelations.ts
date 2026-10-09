import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EXPAND, addNote as addNoteTo, commit, dropTheory as dropTheoryFrom, history, mergeExpansion, moveNodes, putTheory as putTheoryIn,
  redo as redoOf, removeNode, undo as undoOf, type CategoryId, type Expansion, type Graph, type History, type NodeRef, type Theory
} from "../../shared/relations.mjs";
import { api } from "../lib/api";
import type { IntelScope } from "../intel/useIntel";
import { edgeDrawer, findEdge, listItems, nodeDrawer, status, theoryDrawer, type Loaded } from "./dossier";
import { fan, relax, settle, type Pt } from "./layout";
import { docOf, fromDoc, loadGraph, mergeDocs, saveGraph, takeShared } from "./store";
import type { TheoryDoc } from "../../shared/theories.mjs";

export type CategoryInfo = { id: CategoryId; label: string; count: number | null; source: string; asOf: string };
type NodeInfo = { ok: boolean; error?: string; node: NodeRef; categories: CategoryInfo[] };

const EMPTY_TEXT = "Search above the map to add a member, ticker, or committee, or open a member card and choose Map. Click a node for its relationships.";

/** Where an expansion's new nodes go: fanned away from the parent's links, then nudged apart. Old nodes stay put. */
function placer(graph: Graph, exp: Pick<Expansion, "node" | "nodes">, at: Pt) {
  const have = new Map(graph.nodes.map((n) => [n.id, n]));
  const parent = have.get(exp.node.id) || { ...at, id: exp.node.id };
  const fresh = exp.nodes.map((n) => n.id).filter((id) => !have.has(id) && id !== exp.node.id);
  const linked = graph.edges.filter((e) => e.from === parent.id || e.to === parent.id).map((e) => have.get(e.from === parent.id ? e.to : e.from)).filter(Boolean) as Pt[];
  const fanned = fan(parent, fresh, linked);
  const moved = relax(graph.nodes, new Map([...fanned].map(([k, p]) => [k, { ...p }])), fanned);
  return (node: NodeRef) => (node.id === exp.node.id && !have.has(node.id) ? { x: at.x, y: at.y } : moved.get(node.id) || { x: parent.x + 40, y: parent.y + 40 });
}

export function useRelations(scope: IntelScope, selectedId: string | null, on: boolean) {
  const [h, setH] = useState<History<Graph>>(() => history(loadGraph()));
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [infos, setInfos] = useState<Record<string, NodeInfo>>({});
  const [hidden, setHidden] = useState<Set<CategoryId>>(() => new Set());
  const [notice, setNotice] = useState("");
  const graph = h.present;
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const apply = useCallback((fn: (g: Graph) => Graph) => setH((cur) => commit(cur, fn(cur.present))), []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!saveGraph(graph)) setNotice("This browser refused to save the map (private mode or storage full). Export your theories to keep them.");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [graph]);

  useEffect(() => {
    const shared = takeShared();
    if (!shared) return;
    setH((cur) => commit(cur, fromDoc(cur.present, mergeDocs(docOf(cur.present), shared))));
    setNotice(`Opened ${shared.theories.length} theor${shared.theories.length === 1 ? "y" : "ies"} and ${shared.notes.length} note${shared.notes.length === 1 ? "" : "s"} from a share link. Saved in this browser only.`);
  }, []);

  const info = useCallback(async (id: string) => {
    if (infos[id]?.ok) return infos[id];
    try {
      const res = await api<NodeInfo>(`/api/relations/node?id=${encodeURIComponent(id)}`);
      setInfos((m) => ({ ...m, [id]: res }));
      return res;
    } catch (err) {
      setNotice((err as Error).message);
      return null;
    }
  }, [infos]);

  /** Put a node on the canvas (from search, a scope, or a menu) without expanding it. */
  const addNode = useCallback(async (id: string, at: Pt = { x: 0, y: 0 }) => {
    if (graphRef.current.nodes.some((n) => n.id === id)) return id;
    const res = await info(id);
    if (!res?.ok) return null;
    apply((g) => mergeExpansion(g, { node: res.node, nodes: [], edges: [] }, () => at).graph);
    return res.node.id;
  }, [apply, info]);

  const expand = useCallback(async (id: string, cat: CategoryId, more = false, at: Pt = { x: 0, y: 0 }) => {
    const key = `${id}|${cat}`;
    const prior = loadedRef.current[key];
    if (prior && !more) return;
    setBusy((s) => new Set(s).add(key));
    try {
      const offset = more && prior ? prior.shown : 0;
      const res = await api<Expansion>(`/api/relations/expand?node=${encodeURIComponent(id)}&category=${cat}&offset=${offset}`);
      const { dropped } = mergeExpansion(graphRef.current, res, placer(graphRef.current, res, at));
      setH((cur) => commit(cur, mergeExpansion(cur.present, res, placer(cur.present, res, at)).graph));
      setLoaded((m) => ({ ...m, [key]: { shown: offset + res.nodes.length, total: res.total, more: res.more, source: res.source, asOf: res.asOf, latency: res.latency, note: res.note } }));
      if (dropped) setNotice(`Canvas is full: ${dropped} more did not fit. Remove nodes or filter to keep exploring.`);
      else if (!res.total) setNotice(`${res.node.label}: no ${res.label?.toLowerCase() || cat} on file.${res.note ? ` ${res.note}` : ""}`);
    } catch (err) {
      setLoaded((m) => ({ ...m, [key]: { shown: 0, total: 0, more: false, source: "", asOf: "", latency: "", error: (err as Error).message } }));
      setNotice((err as Error).message);
    } finally {
      setBusy((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const expandDefaults = useCallback((id: string) => {
    const type = id.split(":")[0] as keyof typeof DEFAULT_EXPAND;
    for (const cat of DEFAULT_EXPAND[type] || []) void expand(id, cat);
  }, [expand]);

  const remove = useCallback((id: string) => {
    apply((g) => {
      const node = g.nodes.find((n) => n.id === id);
      const next = removeNode(g, id);
      return node?.user ? { ...next, theories: next.theories.filter((t) => t.a.id !== id && t.b.id !== id) } : next;
    });
    setLoaded((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith(`${id}|`))));
  }, [apply]);

  const move = useCallback((moves: Map<string, Pt>) => apply((g) => moveNodes(g, moves)), [apply]);

  const putTheory = useCallback((a: string, b: string, patch: Partial<Theory> = {}, id?: string) => {
    const g = graphRef.current;
    const end = (nid: string) => {
      const n = g.nodes.find((x) => x.id === nid);
      return { id: nid, type: n?.type || "note", label: n?.label || nid };
    };
    const now = new Date().toISOString();
    const prev = id ? g.theories.find((t) => t.id === id) : null;
    const theory: Theory = {
      id: prev?.id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      a: prev?.a || end(a),
      b: prev?.b || end(b),
      label: prev?.label || "",
      note: prev?.note || "",
      confidence: prev?.confidence || "medium",
      created: prev?.created || now,
      ...patch,
      updated: now
    };
    apply((cur) => putTheoryIn(cur, theory));
    return theory.id;
  }, [apply]);

  const dropTheory = useCallback((id: string) => apply((g) => dropTheoryFrom(g, id)), [apply]);

  const addNote = useCallback((label: string, kind: string, at: Pt) => {
    const id = `note:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    apply((g) => addNoteTo(g, { id, label: label.slice(0, 80) || "Untitled", kind, note: "", x: at.x, y: at.y, pinned: true }));
    return id;
  }, [apply]);

  const editNote = useCallback((id: string, patch: { label?: string; note?: string }) => {
    apply((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id && n.user ? { ...n, ...patch } : n)) }));
  }, [apply]);

  const relayout = useCallback(() => {
    apply((g) => {
      const pos = settle(g.nodes, [...g.edges.map((e) => [e.from, e.to] as [string, string]), ...g.theories.map((t) => [t.a.id, t.b.id] as [string, string])]);
      return { ...g, nodes: g.nodes.map((n) => ({ ...n, ...(pos.get(n.id) || {}) })) };
    });
  }, [apply]);

  const clear = useCallback(() => {
    apply((g) => ({ nodes: g.nodes.filter((n) => n.user || g.theories.some((t) => t.a.id === n.id || t.b.id === n.id)), edges: [], theories: g.theories }));
    setLoaded({});
  }, [apply]);

  const importDoc = useCallback((doc: TheoryDoc) => {
    setH((cur) => commit(cur, fromDoc(cur.present, mergeDocs(docOf(cur.present), doc))));
    setNotice(`Imported ${doc.theories.length} theor${doc.theories.length === 1 ? "y" : "ies"} and ${doc.notes.length} note${doc.notes.length === 1 ? "" : "s"}.`);
  }, []);

  const toggleHidden = useCallback((cat: CategoryId) => setHidden((s) => {
    const next = new Set(s);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    return next;
  }), []);

  const seed = scope.kind === "member" ? `member:${scope.id}` : scope.kind === "symbol" ? `ticker:${scope.id}` : "";
  useEffect(() => {
    if (!on || !seed) return;
    void addNode(seed);
  }, [on, seed, addNode]);

  const items = useMemo(() => listItems(graph), [graph]);
  const drawer = useMemo(() => {
    if (!selectedId) return null;
    if (selectedId.startsWith("theory:")) {
      const t = graph.theories.find((x) => x.id === selectedId.slice(7));
      return t ? theoryDrawer(graph, t) : null;
    }
    const e = findEdge(graph, selectedId);
    if (e) return edgeDrawer(graph, e);
    const n = graph.nodes.find((x) => x.id === selectedId);
    return n ? nodeDrawer(graph, n, loaded) : null;
  }, [graph, selectedId, loaded]);
  const line = useMemo(() => status(graph, loaded), [graph, loaded]);

  return {
    graph,
    items,
    empty: graph.nodes.length ? "" : EMPTY_TEXT,
    drawer,
    status: line,
    loaded,
    busy,
    infos,
    hidden,
    notice,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    setNotice,
    info,
    addNode,
    expand,
    expandDefaults,
    remove,
    move,
    putTheory,
    dropTheory,
    addNote,
    editNote,
    relayout,
    clear,
    importDoc,
    toggleHidden,
    undo: () => setH(undoOf),
    redo: () => setH(redoOf)
  };
}

export type Relations = ReturnType<typeof useRelations>;
