/**
 * Citations, pure. A ref such as [t3] names one tool call inside one answer: refs restart at t1 every turn, so an
 * earlier turn's refs are stripped before its text goes back to the model, and each answer resolves refs against its
 * own steps only. The per-citation check tests every figure against the tool the sentence or row cites, not the pool.
 */
import { evidenceNumbers, grounded, numbersIn } from "./ask.mjs";

export const REF_SOURCE = String.raw`\[(t\d+(?:\s*,\s*t\d+)*)\]`;
const refRe = () => new RegExp(REF_SOURCE, "g");
const idsOf = (group) => group.split(/\s*,\s*/);

/** Refs a text uses, first appearance order, no repeats. */
export function refsIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(refRe())) for (const id of idsOf(m[1])) if (!out.includes(id)) out.push(id);
  return out;
}

/** Text and refs in order, for rendering chips: `[{ text }, { ref: "t1" }, …]`. */
export function splitRefs(text) {
  const s = String(text || "");
  const out = [];
  let last = 0;
  for (const m of s.matchAll(refRe())) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    for (const id of idsOf(m[1])) out.push({ ref: id });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

/** An earlier answer's text without its refs; in a new turn t1 is a different tool call. */
export function stripRefs(text) {
  return String(text || "")
    .replace(refRe(), "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "");
}

/** The DOM id of one step row; turn ids keep two turns' t1 apart. */
export const stepAnchor = (turnId, id) => `st-${turnId}-${id}`;

/** A chip's hover text: the tool, its source, as-of time, and latency, each said even when the tool did not report it. */
export function chipTitle(step) {
  const s = step || {};
  const parts = [
    s.label || s.tool || "tool",
    s.source || "no source reported",
    s.asOf ? `as of ${s.asOf}` : "as-of time not reported",
    s.latency || "latency not reported"
  ];
  if (s.state === "running") parts.push("still running");
  if (s.state === "error") parts.push(`failed${s.note ? `: ${s.note}` : ""}`);
  parts.push(s.open ? "click to show the step and open the board" : "click to show the step");
  return parts.join(" · ");
}

const ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*\|?\s*:?-{2,}/;
const LEADING_REFS = new RegExp(String.raw`^\s*(?:${REF_SOURCE}\s*)+`);

/**
 * The pieces a ref covers: each table row, and each sentence of prose or a list item. A sentence that starts with refs
 * ("… 8.4%. [t1] Next …") hands them back to the sentence before it.
 */
export function citationUnits(answer) {
  const out = [];
  for (const line of String(answer || "").split("\n")) {
    if (!line.trim()) continue;
    if (ROW.test(line)) {
      if (!RULE.test(line)) out.push({ kind: "row", text: line.trim(), refs: refsIn(line) });
      continue;
    }
    const body = line.replace(/^\s*([-*]|\d+\.)\s+/, "");
    const first = out.length;
    for (const part of body.split(/(?<=[.!?])\s+(?=[A-Z(\[])/)) {
      const lead = part.match(LEADING_REFS);
      if (lead && out.length > first) {
        const prev = out[out.length - 1];
        for (const id of refsIn(lead[0])) if (!prev.refs.includes(id)) prev.refs.push(id);
        prev.text += ` ${lead[0].trim()}`;
        const rest = part.slice(lead[0].length);
        if (rest.trim()) out.push({ kind: "sentence", text: rest.trim(), refs: refsIn(rest) });
        continue;
      }
      if (part.trim()) out.push({ kind: "sentence", text: part.trim(), refs: refsIn(part) });
    }
  }
  return out;
}

const SYMBOL_IN_JSON = /"(?:symbol|ticker)"\s*:\s*"([A-Z][A-Z0-9.\-]{0,7})"/g;
const SYMBOL_IN_TEXT = /(?<![\w.-])[A-Z][A-Z0-9]{0,4}(?:[.-][A-Z]{1,2})?(?![\w-])/g;

/**
 * Figures and table-row symbols that the cited tool does not contain but another tool in this answer does
 * (`miscited`), and table rows with figures and no ref (`uncitedRows`). Numbers no tool contains are `unmatched` in
 * groundingCheck; refs no tool has are `unknown` in citationRefs. Warnings, not a block.
 */
export function citationCheck(answer, evidence) {
  const ok = evidence.filter((e) => e && e.ok);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const nums = new Map(ok.map((e) => [e.id, evidenceNumbers(e.json)]));
  const syms = new Map(ok.map((e) => [e.id, new Set([...String(e.json).matchAll(SYMBOL_IN_JSON)].map((m) => m[1]))]));
  const miscited = [];
  const uncitedRows = [];
  const flag = (raw, refs, foundIn) => {
    if (foundIn.length && !miscited.some((m) => m.raw === raw && m.cited.join() === refs.join())) miscited.push({ raw, cited: refs, foundIn });
  };
  for (const unit of citationUnits(answer)) {
    const figures = numbersIn(unit.text).filter((n) => !grounded(n, []));
    const refs = unit.refs.filter((id) => byId.has(id));
    if (!unit.refs.length) {
      if (unit.kind === "row" && figures.length) uncitedRows.push(unit.text.slice(0, 160));
      continue;
    }
    if (!refs.length) continue;
    const cited = refs.filter((id) => nums.has(id));
    const pool = cited.flatMap((id) => nums.get(id));
    for (const n of figures) {
      if (grounded(n, pool)) continue;
      flag(n.raw, refs, ok.filter((e) => !refs.includes(e.id) && grounded(n, nums.get(e.id))).map((e) => e.id));
    }
    if (unit.kind !== "row") continue;
    for (const [sym] of unit.text.replace(new RegExp(REF_SOURCE, "g"), " ").matchAll(SYMBOL_IN_TEXT)) {
      if (cited.some((id) => syms.get(id).has(sym))) continue;
      flag(sym, refs, ok.filter((e) => !refs.includes(e.id) && syms.get(e.id).has(sym)).map((e) => e.id));
    }
  }
  return { miscited: miscited.slice(0, 12), uncitedRows: uncitedRows.slice(0, 8) };
}

/** One line per miscited figure, for the answer's warnings. */
export function miscitedNote(m) {
  return `${m.raw} is cited to ${m.cited.join(", ")}, but only ${m.foundIn.join(", ")} returned it.`;
}
