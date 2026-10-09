/**
 * The automatic revision pass, pure. After an answer, the grounding checks' flags become a list of items; one model
 * call gets those items with the cited tool results and returns a corrected answer, which is grounded again and kept
 * only when it clears at least one flag. What is left stays a warning. Nothing here calls a model or reads the clock.
 */
import { miscitedNote } from "./citations.mjs";
import { mislabelNote } from "./countLabels.mjs";

export const REVISE = { minMs: 15_000, excerptChars: 4_000, excerpts: 6, totalChars: 18_000, outputTokens: 1_800 };

const FIGURES = new Set(["unmatched", "miscited", "mislabeled"]);

/**
 * One item per flag: `{ kind, raw, refs, note, key }`. `check` is what run.mjs computes for an answer:
 * `{ grounding, unknown, uncited }`.
 */
export function flaggedItems(check) {
  const g = check?.grounding || {};
  const out = [];
  const add = (kind, raw, refs, note) => {
    const key = `${kind}:${raw}`;
    if (!out.some((x) => x.key === key)) out.push({ kind, raw, refs, note, key });
  };
  for (const raw of g.unmatched || []) add("unmatched", raw, [], `${raw} is in no tool result.`);
  for (const m of g.miscited || []) add("miscited", m.raw, [...m.cited, ...m.foundIn], miscitedNote(m));
  for (const m of g.mislabeled || []) add("mislabeled", m.raw, [], mislabelNote(m));
  for (const s of g.scope || []) add("scope", s.raw, s.refs || [], s.note);
  for (const row of g.uncitedRows || []) add("uncitedRow", row, [], `This table row has figures and no ref (add its [tN] in a Ref column): ${row}`);
  for (const id of check?.unknown || []) add("unknownRef", id, [], `[${id}] is not a tool result in this answer.`);
  if (check?.uncited) add("uncited", "", [], "Tools ran, but the answer cites none of them; add the [tN] ref after each figure.");
  return out;
}

const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** `{ ok, reason }`: skip when under 15 s are left or the call would push the turn past its token budget. */
export function revisionBudget({ spent = 0, tokenBudget = Infinity, msLeft = Infinity, need = 0 }) {
  if (msLeft < REVISE.minMs) return { ok: false, reason: `time budget nearly spent (${Math.max(0, Math.round(msLeft / 1000))} s left)` };
  if (spent + need > tokenBudget) return { ok: false, reason: `token budget nearly spent (${fmt(spent)} of ${fmt(tokenBudget)} tokens used)` };
  return { ok: true, reason: "" };
}

/** Refs whose results the reviser sees: the ones the flags name first, then the rest the answer cites, then any. */
export function excerptRefs(items, cited = [], evidence = []) {
  const ok = evidence.filter((e) => e && e.ok).map((e) => e.id);
  const ids = [...items.flatMap((i) => i.refs), ...cited, ...ok].filter((id) => ok.includes(id));
  return [...new Set(ids)].slice(0, REVISE.excerpts);
}

const SYSTEM = [
  "You correct one answer written by a read-only research terminal's assistant. You get the question, the tool results the answer may cite (each starts with its ref), the answer, and the figures and claims an automatic check flagged.",
  "Return the full corrected answer and nothing else: same language, structure, and tables, refs in the [tN] form.",
  "For each flagged item: change the figure to what the cited result states, move the ref to the result that holds the figure, or remove the figure or claim when no result supports it. A window or comparison claim the results do not cover is rewritten to say what they do cover. A count named as the wrong thing is renamed to what the result calls it.",
  "A table whose rows have no ref gets a last column \"Ref\" holding, in every row, the [tN] of the result that row comes from.",
  "Do not add figures, claims, or refs that the results below do not contain. Do not mention the check or that the answer was revised. No tool calls."
].join("\n");

/** The two messages of the revision call. Excerpts are capped per result and in total. */
export function revisionMessages({ question, answer, items, excerpts }) {
  let room = REVISE.totalChars;
  const parts = [];
  for (const x of excerpts) {
    if (room <= 0) break;
    const text = String(x.text || "").slice(0, Math.min(REVISE.excerptChars, room));
    room -= text.length;
    parts.push(`[${x.id}] ${x.label || ""}\n${text}`);
  }
  const user = [
    `Question: ${question}`,
    "",
    "Tool results:",
    parts.join("\n\n") || "(none)",
    "",
    "Answer to correct:",
    "<<<",
    answer,
    ">>>",
    "",
    "Flagged:",
    ...items.map((i) => `- ${i.note}`)
  ].join("\n");
  return [{ role: "system", content: SYSTEM }, { role: "user", content: user }];
}

/** The model's reply without an echoed <<< >>> fence or a "Corrected answer:" lead-in. */
export function cleanRevision(text) {
  let s = String(text || "").trim();
  const fenced = s.match(/<<<\s*\n?([\s\S]*?)\n?\s*>>>/);
  if (fenced) s = fenced[1].trim();
  return s.replace(/^(?:here is the )?corrected answer:?\s*\n/i, "").trim();
}

const REF = /\[t\d+(?:\s*,\s*t\d+)*\]/;

/**
 * A revision replaces the answer only when it clears at least one flag and is still the answer: not empty, not cut
 * to under 40% of the original, and still citing when the original cited.
 */
export function acceptRevision(before, after, text, original = "") {
  const s = String(text || "").trim();
  const o = String(original || "").trim();
  if (!s || after.length >= before.length) return false;
  if (o && s.length < 0.4 * o.length) return false;
  return !REF.test(o) || REF.test(s);
}

const lines = (s) => String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * What the revision changed: each flagged item as corrected, removed, or still flagged, and the answer's lines that
 * went or came (up to 12 each).
 */
export function revisionChanges(before, after, beforeItems, afterItems) {
  const left = new Set(afterItems.map((i) => i.key));
  const changes = beforeItems.map((i) => {
    if (left.has(i.key)) return { kind: i.kind, raw: i.raw, status: "still flagged", note: i.note };
    const gone = FIGURES.has(i.kind) && i.raw && !String(after).includes(i.raw);
    return { kind: i.kind, raw: i.raw, status: gone ? "removed" : "corrected", note: i.note };
  });
  const a = lines(before);
  const b = lines(after);
  return {
    fixed: changes.filter((c) => c.status !== "still flagged").length,
    remaining: afterItems.length,
    changes,
    removed: a.filter((l) => !b.includes(l)).slice(0, 12),
    added: b.filter((l) => !a.includes(l)).slice(0, 12)
  };
}

/** The one-line note under an answer: "Revised: fixed 3 figures", "Not revised: …", or "Checked figures: …". */
export function revisionSummary(rev) {
  if (!rev) return "";
  if (rev.status === "skipped") return `Not revised: ${rev.reason}.`;
  if (rev.status === "failed") return `Revision failed: ${rev.reason}`;
  if (rev.status === "kept") return "Checked figures: the revision cleared none of them, so the original answer is shown.";
  const fixed = (rev.changes || []).filter((c) => c.status !== "still flagged");
  const allFigures = fixed.length > 0 && fixed.every((c) => FIGURES.has(c.kind));
  const noun = allFigures ? (rev.fixed === 1 ? "figure" : "figures") : rev.fixed === 1 ? "flagged item" : "flagged items";
  return `Revised: fixed ${rev.fixed} ${noun}${rev.remaining ? ` · ${rev.remaining} still flagged` : ""}`;
}
