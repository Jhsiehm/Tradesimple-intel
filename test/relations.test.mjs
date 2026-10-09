import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAP, CATEGORIES, CATEGORY_IDS, DEFAULT_EXPAND, EMPTY_GRAPH, MAX_NODES, NODE_TYPES, addNote, categoriesFor, clampLimit, clampOffset, commit,
  counts, dropTheory, edgeKey, groupBy, history, mergeExpansion, moveNodes, neighborhood, page, parseNode, putTheory, redo, removeNode, undo
} from "../shared/relations.mjs";
import { MAX_THEORIES, cleanDoc, decodeShare, encodeShare, mergeDocs, migrate, parseDoc, serialize } from "../shared/theories.mjs";
import { CATEGORY_LOOK, NODE_LOOK, PANEL, THEORY_LOOK, contrast } from "../src/relations/palette.ts";
import { ICON_NAMES } from "../src/ui/icons/names.ts";
import { expand, nodeInfo } from "../server/domain/relations.mjs";

const src = { source: "S", asOf: "2026-10-01T00:00:00Z", latency: "L" };
const exp = (origin, pairs) => ({
  node: { id: origin, type: origin.split(":")[0], label: origin },
  nodes: pairs.map(([id]) => ({ id, type: id.split(":")[0], label: id })),
  edges: pairs.map(([id, cat, n = 1]) => ({ from: origin, to: id, cat, label: cat, n, ...src }))
});

test("parseNode accepts known shapes and rejects junk", () => {
  assert.deepEqual(parseNode("member:P000197"), { type: "member", key: "P000197" });
  assert.deepEqual(parseNode("ticker:BRK.B"), { type: "ticker", key: "BRK.B" });
  assert.deepEqual(parseNode("district:CA-11"), { type: "district", key: "CA-11" });
  assert.deepEqual(parseNode("insider:NVDA/Kress Colette"), { type: "insider", key: "NVDA/Kress Colette" });
  for (const bad of ["", "member:pelosi", "ticker:<script>", "nope:x", "district:California", ":x", "ticker:"]) assert.equal(parseNode(bad), null, bad);
});

test("every node type except notes has at least one category, and defaults are offered categories", () => {
  for (const type of NODE_TYPES.filter((t) => t !== "note" && t !== "firm")) assert.ok(categoriesFor(type).length, type);
  assert.equal(categoriesFor("note").length, 0, "notes are yours; no feed expands them");
  for (const [type, cats] of Object.entries(DEFAULT_EXPAND)) for (const c of cats) assert.ok(categoriesFor(type).some((x) => x.id === c), `${type}:${c}`);
});

test("expansion caps: limits clamp to the ceiling and pages report more", () => {
  assert.equal(clampLimit(undefined), CAP.page);
  assert.equal(clampLimit("0"), CAP.page);
  assert.equal(clampLimit("5"), 5);
  assert.equal(clampLimit("9999"), CAP.max);
  assert.equal(clampOffset("-3"), 0);
  const list = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(page(list, 0, 12), { items: list.slice(0, 12), total: 30, offset: 0, limit: 12, more: true });
  assert.equal(page(list, 24, 12).more, false);
  assert.equal(page(list, 24, 12).items.length, 6);
});

test("groupBy collapses rows per neighbor, sums, keeps the latest date, ranks by count", () => {
  const rows = [{ s: "A", v: 5, d: "2026-01-02" }, { s: "B", v: 100, d: "2026-03-01" }, { s: "A", v: 7, d: "2026-02-01" }, { s: "", v: 1, d: "2026-01-01" }];
  const g = groupBy(rows, (r) => r.s, { amount: (r) => r.v, date: (r) => r.d });
  assert.deepEqual(g.map((x) => [x.key, x.n, x.amount, x.last]), [["A", 2, 12, "2026-02-01"], ["B", 1, 100, "2026-03-01"]]);
});

test("merge dedupes nodes and edges across both directions and never moves placed nodes", () => {
  let place = 0;
  const at = () => ({ x: ++place * 10, y: 0 });
  const a = mergeExpansion(EMPTY_GRAPH, exp("member:P000197", [["ticker:NVDA", "trade", 3], ["ticker:AAPL", "trade", 4]]), at);
  assert.equal(a.graph.nodes.length, 3);
  assert.equal(a.graph.edges.length, 2);
  const nvdaX = a.graph.nodes.find((n) => n.id === "ticker:NVDA").x;
  const reverse = exp("ticker:NVDA", [["member:P000197", "trade", 5], ["member:F000110", "trade", 47]]);
  reverse.edges = reverse.edges.map((e) => ({ ...e, from: e.to, to: e.from }));
  const b = mergeExpansion(a.graph, reverse, at);
  assert.equal(b.graph.nodes.length, 4, "Pelosi and NVDA are not duplicated");
  assert.equal(b.graph.edges.length, 3, "Pelosi–NVDA trade edge is one edge");
  assert.equal(b.graph.edges.find((e) => e.id === edgeKey("trade", "member:P000197", "ticker:NVDA")).n, 5, "keeps the larger count");
  assert.equal(b.graph.nodes.find((n) => n.id === "ticker:NVDA").x, nvdaX, "existing node keeps its place");
  assert.deepEqual(b.added, ["member:F000110"]);
  const same = mergeExpansion(b.graph, exp("member:P000197", [["ticker:NVDA", "committee"]]), at);
  assert.equal(same.graph.edges.length, 4, "a different category between the same pair is its own edge");
});

test("merge stops at the canvas ceiling and reports what it dropped", () => {
  const many = Array.from({ length: MAX_NODES + 25 }, (_, i) => [`ticker:T${i}`, "trade"]);
  const r = mergeExpansion(EMPTY_GRAPH, exp("member:P000197", many));
  assert.equal(r.graph.nodes.length, MAX_NODES);
  assert.equal(r.dropped, 26, "the origin takes one slot; edges to dropped nodes are skipped");
  assert.equal(r.graph.edges.length, MAX_NODES - 1);
});

test("theories stay out of data counts; removing a node drops only its data edges", () => {
  let g = mergeExpansion(EMPTY_GRAPH, exp("member:P000197", [["ticker:NVDA", "trade"], ["committee:HSAS", "committee"]])).graph;
  g = addNote(g, { id: "note:abc", label: "Dinner", x: 0, y: 0 });
  g = putTheory(g, { id: "t1", a: { id: "member:P000197", type: "member", label: "P" }, b: { id: "note:abc", type: "note", label: "Dinner" }, label: "met", note: "", confidence: "low", created: "", updated: "" });
  const c = counts(g);
  assert.equal(c.data, 2);
  assert.equal(c.byCat.trade, 1);
  assert.equal(c.theories, 1);
  assert.equal(c.notes, 1);
  assert.deepEqual([...neighborhood(g, "member:P000197")].sort(), ["committee:HSAS", "member:P000197", "note:abc", "ticker:NVDA"]);
  const r = removeNode(g, "ticker:NVDA");
  assert.equal(r.edges.length, 1);
  assert.equal(r.theories.length, 1);
  assert.equal(dropTheory(r, "t1").theories.length, 0);
});

test("moving pins; undo and redo walk whole snapshots and cap the history", () => {
  const g0 = mergeExpansion(EMPTY_GRAPH, exp("member:P000197", [["ticker:NVDA", "trade"]])).graph;
  let h = history(EMPTY_GRAPH);
  h = commit(h, g0);
  const g1 = moveNodes(g0, new Map([["ticker:NVDA", { x: 99, y: 42 }]]));
  h = commit(h, g1);
  assert.equal(h.present.nodes.find((n) => n.id === "ticker:NVDA").pinned, true);
  h = undo(h);
  assert.equal(h.present, g0);
  h = undo(h);
  assert.equal(h.present, EMPTY_GRAPH);
  assert.equal(undo(h), h, "nothing left to undo");
  h = redo(redo(h));
  assert.equal(h.present, g1);
  for (let i = 0; i < 100; i += 1) h = commit(h, { ...g1, i });
  assert.equal(h.past.length, 60);
});

test("theory documents: clean, cap, migrate v1, survive junk, import merges, share round-trips", () => {
  assert.deepEqual(parseDoc("not json"), { v: 2, theories: [], notes: [] });
  assert.deepEqual(parseDoc(null), { v: 2, theories: [], notes: [] });
  const v1 = { v: 1, theories: [{ id: "x", from: "member:P000197", to: "ticker:NVDA" }, { id: "self", from: "a:1", to: "a:1" }] };
  const m = migrate(v1);
  assert.equal(m.v, 2);
  assert.equal(m.theories.length, 1, "a link to itself is dropped");
  assert.deepEqual(m.theories[0].a, { id: "member:P000197", type: "member", label: "member:P000197" });
  assert.equal(m.theories[0].confidence, "medium");
  const many = { v: 2, theories: Array.from({ length: MAX_THEORIES + 10 }, (_, i) => ({ id: `t${i}`, a: { id: "a:1" }, b: { id: `b:${i}` } })) };
  const capped = cleanDoc(many);
  assert.equal(capped.theories.length, MAX_THEORIES);
  assert.equal(capped.theories.at(-1).id, `t${MAX_THEORIES + 9}`, "newest kept");
  const doc = cleanDoc({ theories: [{ id: "t", a: { id: "member:P000197", label: "Pelosi" }, b: { id: "ticker:NVDA", label: "NVDA" }, label: "x".repeat(500), confidence: "high" }], notes: [{ id: "note:n1", label: "Lunch", kind: "event" }, { id: "evil", label: "x" }] });
  assert.equal(doc.theories[0].label.length, 80);
  assert.equal(doc.notes.length, 1);
  assert.deepEqual(parseDoc(serialize(doc)), doc);
  const token = encodeShare(doc);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeShare(token), doc);
  assert.equal(decodeShare("%%%"), null);
  const merged = mergeDocs(doc, cleanDoc({ theories: [{ ...doc.theories[0], label: "file wins" }], notes: [] }));
  assert.equal(merged.theories.length, 1);
  assert.equal(merged.theories[0].label, "file wins");
});

test("palette covers every category and node type, clears contrast, and keeps the theory color unique", () => {
  const icons = new Set(ICON_NAMES);
  for (const id of CATEGORY_IDS) {
    const look = CATEGORY_LOOK[id];
    assert.ok(look, `category ${id}`);
    assert.ok(icons.has(look.icon), `${id} icon ${look.icon}`);
    assert.ok(Array.isArray(look.dash));
    assert.ok(contrast(look.color, PANEL) >= 4.5, `${id} ${look.color} contrast ${contrast(look.color, PANEL).toFixed(2)}`);
  }
  assert.deepEqual(Object.keys(CATEGORY_LOOK).sort(), [...CATEGORY_IDS].sort());
  for (const type of NODE_TYPES) {
    assert.ok(NODE_LOOK[type], `node ${type}`);
    assert.ok(icons.has(NODE_LOOK[type].icon), `${type} icon`);
    assert.ok(contrast(NODE_LOOK[type].color, PANEL) >= 4.5, `${type} contrast`);
  }
  const catColors = CATEGORY_IDS.map((c) => CATEGORY_LOOK[c].color);
  assert.equal(new Set(catColors).size, catColors.length, "one color per category");
  assert.ok(!catColors.includes(THEORY_LOOK.color), "theory color is not a data color");
  assert.ok(THEORY_LOOK.dash.length, "theories are dashed");
  assert.ok(icons.has(THEORY_LOOK.icon));
  assert.match(THEORY_LOOK.label, /not from a data source/);
  assert.equal(CATEGORIES.length, CATEGORY_IDS.length);
});

test("expand and nodeInfo reject bad input before touching any feed", async () => {
  const q = (o) => new URLSearchParams(o);
  assert.equal((await expand(null, q({ node: "member:bad", category: "trade" }))).status, 400);
  assert.equal((await expand(null, q({ node: "member:P000197", category: "supply" }))).status, 400, "members have no supply chain");
  assert.equal((await expand(null, q({ node: "ticker:NVDA", category: "nope" }))).status, 400);
  assert.equal((await nodeInfo(null, q({ id: "x" }))).status, 400);
});
