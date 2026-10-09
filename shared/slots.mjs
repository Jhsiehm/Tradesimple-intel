/**
 * Code-filled figures, pure. The model writes `{{t1.rows[0].excessReturn|spct}}` (a value slot) or
 * `{{table t1.rows cols=member,ticker,excessReturn:spct limit=8}}` (a table directive), and the server fills them from
 * the tool results before the answer is shown, so the digits come from data, not from the model. A slot that does not
 * resolve renders as "[missing]" and is reported. Plain numbers stay allowed; the grounding checks still read them.
 */

export const MISSING = "[missing]";
export const SLOT_FORMATS = ["auto", "pct", "spct", "pp", "usd", "num", "int", "date", "text"];
const TABLE_MAX = 20;
const TABLE_DEFAULT = 8;
const SLOT = /\{\{([^{}]{1,400}?)\}\}/g;
const OPEN_LIMIT = 420;

export const SLOT_NOTE = [
  "Figures come from code, not from you: instead of typing a number from a tool result, write a slot and the app fills in the exact value before the answer is shown.",
  "Value slot: {{tN.path|format}}. The path follows the JSON of result tN, for example {{t1.stats.excess|spct}}, {{t2.rows[0].amount|usd}}, {{t1.rows.length}}. Formats: pct (a fraction such as 0.0834 shown as 8.3%), spct (signed, +8.3%), pp (already in percent units), usd, num, int, date, text. Leave the format off and the app picks one from the field name.",
  "Table: put {{table tN.path cols=field1,field2:format limit=8 sort=-field}} on its own line; the app writes the rows, the header, and the ref column. Use the field names exactly as the result spells them. sort=-field is largest first.",
  "Still cite every sentence with its ref, as in: Members' buys beat SPY by {{t1.stats.excess|spct}} on average [t1].",
  "Example. Result t1 = {\"ref\":\"t1\",\"rows\":[{\"member\":\"Jane Doe\",\"ticker\":\"NVDA\",\"excessReturn\":0.0834,\"amount\":15000}],\"total\":12}. A good answer:",
  "Jane Doe's NVDA buy beat SPY by {{t1.rows[0].excessReturn|spct}} [t1].",
  "{{table t1.rows cols=member,ticker,excessReturn:spct,amount:usd limit=5}}",
  "Never invent a path: a slot that does not match the result shows as [missing] to the user. If a value is not in any result, say it is not available."
].join("\n");

/* ---------- paths ---------- */

const SEGMENT = /\.([A-Za-z_$][\w$-]*)|\.(-?\d+)|\[\s*(-?\d+)\s*\]|\[\s*["']([^"'\]]+)["']\s*\]/y;

/** "t1.rows[0].excessReturn" → { ref: "t1", keys: ["rows", 0, "excessReturn"] }, or null. */
export function parsePath(raw) {
  const s = String(raw || "").trim();
  const head = s.match(/^(t\d+)/);
  if (!head) return null;
  const keys = [];
  SEGMENT.lastIndex = head[0].length;
  while (SEGMENT.lastIndex < s.length) {
    const at = SEGMENT.lastIndex;
    const m = SEGMENT.exec(s);
    if (!m || m.index !== at) return null;
    keys.push(m[1] ?? (m[2] != null ? Number(m[2]) : m[3] != null ? Number(m[3]) : m[4]));
  }
  return { ref: head[1], keys };
}

/** Lists the model saw cut to `{ items, total, truncated }` are walked as the list they stand for. */
const cutList = (v) => v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.items) && v.truncated === true;

/** `{ found, value }` for `keys` under `root`. `length` counts a list (its true total when it was cut). */
export function lookup(root, keys) {
  let node = root;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === 0 && key === "result" && Array.isArray(root)) continue;
    if (key === "length") {
      if (cutList(node)) { node = Number(node.total) || node.items.length; continue; }
      if (Array.isArray(node)) { node = node.length; continue; }
    }
    if (cutList(node) && (typeof key === "number" || key === "items")) {
      if (key === "items") { node = node.items; continue; }
      node = node.items;
    }
    if (node == null || typeof node !== "object") return { found: false, value: undefined };
    if (typeof key === "number" && Array.isArray(node)) {
      const at = key < 0 ? node.length + key : key;
      if (at < 0 || at >= node.length) return { found: false, value: undefined };
      node = node[at];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(node, key)) return { found: false, value: undefined };
    node = node[key];
  }
  return { found: true, value: node };
}

/* ---------- formatting ---------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const minus = (v) => (v < 0 ? "−" : "");
const group = (v, digits) => Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const FRACTION_WORDS = new Set(["return", "returns", "excess", "alpha", "hit", "drawdown", "cagr", "weight", "winrate"]);
const DOLLAR_WORDS = new Set(["amount", "usd", "dollar", "dollars", "obligated", "obligation", "obligations", "spend", "spending", "cost", "price", "award", "awarded", "notional", "income", "revenue"]);
/** "hitRate" → ["hit", "rate"]; whole words only, so "priced" (a count) is not "price". */
const words = (key) => String(key ?? "").replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z\d]+/).filter(Boolean);

/** The format a field gets when the slot names none, from its name and value. */
export function autoFormat(key, value) {
  const w = words(key);
  if (typeof value === "boolean") return "text";
  if (typeof value === "string") return ISO_DATE.test(value) ? "date" : "text";
  if (typeof value !== "number") return "text";
  if (["pct", "percent"].includes(w.at(-1))) return "pp";
  if (w.some((x) => FRACTION_WORDS.has(x)) && Math.abs(value) <= 50) return "pct";
  if (w.some((x) => DOLLAR_WORDS.has(x))) return "usd";
  return Number.isInteger(value) ? "int" : "num";
}

function usd(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${minus(v)}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${minus(v)}$${(a / 1e6).toFixed(1)}M`;
  return `${minus(v)}$${group(v, a >= 100 || Number.isInteger(v) ? 0 : 2)}`;
}

/**
 * `{ ok, text, reason }` for one value. `fmt` is a name from SLOT_FORMATS with an optional digit count ("pct:2").
 * Numbers given as numeric strings ("0.12") are read as numbers.
 */
export function formatValue(value, fmt = "auto", key = "") {
  const [name0, digitsRaw] = String(fmt || "auto").toLowerCase().split(":");
  if (!SLOT_FORMATS.includes(name0)) return { ok: false, text: MISSING, reason: `unknown format "${fmt}"` };
  if (value === undefined) return { ok: false, text: MISSING, reason: "no such field" };
  if (value === null) return { ok: false, text: MISSING, reason: "the tool returned null" };
  if (typeof value === "object") return { ok: false, text: MISSING, reason: Array.isArray(value) ? "a list, not one value (add .length or an index)" : "an object, not one value" };
  const num = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const asked = name0 === "auto" ? autoFormat(key, Number.isFinite(num) && typeof value === "string" ? num : value) : name0;
  // A field named …Pct / …Percent is already in percent units (changePct 1.13 is 1.13%), whatever format was asked.
  const percentUnits = ["pct", "percent"].includes(words(key).at(-1));
  const name = percentUnits && asked === "pct" ? "pp" : percentUnits && asked === "spct" ? "spp" : asked;
  const digits = digitsRaw != null && /^\d$/.test(digitsRaw) ? Number(digitsRaw) : null;
  const needNum = ["pct", "spct", "pp", "spp", "usd", "num", "int"].includes(name);
  if (needNum && !Number.isFinite(num)) return { ok: false, text: MISSING, reason: `"${String(value).slice(0, 40)}" is not a number` };
  switch (name) {
    case "pct": return { ok: true, text: `${minus(num)}${group(num * 100, digits ?? 1)}%` };
    case "spct": return { ok: true, text: `${num > 0 ? "+" : minus(num)}${group(num * 100, digits ?? 1)}%` };
    case "pp": return { ok: true, text: `${minus(num)}${group(num, digits ?? 1)}%` };
    case "spp": return { ok: true, text: `${num > 0 ? "+" : minus(num)}${group(num, digits ?? 1)}%` };
    case "usd": return { ok: true, text: digits != null ? `${minus(num)}$${group(num, digits)}` : usd(num) };
    case "int": return { ok: true, text: `${minus(Math.round(num))}${group(Math.round(num), 0)}` };
    case "num": return { ok: true, text: `${minus(num)}${group(num, digits ?? (Number.isInteger(num) ? 0 : Math.abs(num) < 1 ? 4 : 2)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}` };
    case "date": {
      if (typeof value === "number" && value > 1e11) return { ok: true, text: new Date(value).toISOString().slice(0, 10) };
      if (typeof value === "string" && ISO_DATE.test(value.trim())) return { ok: true, text: value.trim().slice(0, 10) };
      return { ok: false, text: MISSING, reason: `"${String(value).slice(0, 40)}" is not a date` };
    }
    default: return { ok: true, text: typeof value === "boolean" ? (value ? "yes" : "no") : String(value).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 200) };
  }
}

/* ---------- sources ---------- */

/**
 * What slots read: `evidence` (id, ok), `bodies` (what the model saw, by ref) and `raws` (the untrimmed result, by ref).
 * A value slot reads what the model saw first; a table reads the full result first, so it can sort every row.
 */
function resolve(ref, keys, src, order) {
  const ev = (src.evidence || []).find((e) => e.id === ref);
  if (!ev) return { found: false, reason: `no tool result ${ref}` };
  if (!ev.ok) return { found: false, reason: `${ref} failed` };
  for (const which of order) {
    const root = src[which]?.get?.(ref);
    if (root === undefined) continue;
    const hit = lookup(root, keys);
    if (hit.found) return hit;
  }
  return { found: false, reason: "no such field" };
}

const listsIn = (v, depth = 0, out = []) => {
  if (depth > 3 || v == null || typeof v !== "object") return out;
  if (Array.isArray(v)) {
    if (v.some((x) => x && typeof x === "object" && !Array.isArray(x))) out.push(v);
    return out;
  }
  if (cutList(v)) return listsIn(v.items, depth, out);
  for (const x of Object.values(v)) listsIn(x, depth + 1, out);
  return out;
};

/** "excessReturn" → "Excess return", "returnPct" → "Return %", "stats.n" → "N". */
export function columnLabel(col) {
  const last = String(col).split(".").pop() || "";
  const words = last.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().replace(/\bpct\b/g, "%").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : String(col);
}

const tableArgs = (body) => {
  const parts = body.trim().split(/\s+/);
  const out = { path: parts[1] || "", opts: {} };
  for (const p of parts.slice(2)) {
    const m = p.match(/^(cols|columns|limit|rows|sort)=(.+)$/i);
    if (m) out.opts[m[1].toLowerCase()] = m[2];
    else out.opts.bad = p;
  }
  return out;
};

/* ---------- rendering ---------- */

function renderValue(body, src, used) {
  const [pathRaw, fmt = "auto"] = body.split("|").map((s) => s.trim());
  const path = parsePath(pathRaw);
  if (!path) return { ok: false, text: MISSING, reason: "not a slot path (expected tN.field)" };
  const hit = resolve(path.ref, path.keys, src, ["bodies", "raws"]);
  if (!hit.found) return { ok: false, text: MISSING, reason: hit.reason, ref: path.ref };
  const out = formatValue(hit.value, fmt, path.keys.filter((k) => typeof k === "string").at(-1) || "");
  if (out.ok) note(used, path.ref, hit.value);
  return { ...out, ref: path.ref };
}

function renderTable(body, src, used) {
  const { path: pathRaw, opts } = tableArgs(body);
  if (opts.bad) return { ok: false, text: MISSING, reason: `unknown table option "${opts.bad}"` };
  const path = parsePath(pathRaw);
  if (!path) return { ok: false, text: MISSING, reason: "not a table path (expected tN or tN.list)" };
  let list = null;
  let reason = "no such list";
  for (const which of ["raws", "bodies"]) {
    if (!path.keys.length) {
      const ev = (src.evidence || []).find((e) => e.id === path.ref);
      if (!ev) { reason = `no tool result ${path.ref}`; break; }
      if (!ev.ok) { reason = `${path.ref} failed`; break; }
      const root = src[which]?.get?.(path.ref);
      list = listsIn(root).sort((a, b) => b.length - a.length)[0] || null;
    } else {
      const hit = resolve(path.ref, path.keys, src, [which]);
      if (hit.found) list = cutList(hit.value) ? hit.value.items : hit.value;
      else reason = hit.reason;
      if (hit.found && !Array.isArray(list)) reason = `${pathRaw} is not a list`;
    }
    if (Array.isArray(list)) break;
    list = null;
  }
  if (!list) return { ok: false, text: MISSING, reason, ref: path.ref };
  let rows = list.filter((r) => r && typeof r === "object" && !Array.isArray(r));
  if (!rows.length) return { ok: false, text: MISSING, reason: "the list has no rows", ref: path.ref };
  const cols = String(opts.cols || opts.columns || Object.keys(rows[0]).filter((k) => ["number", "string"].includes(typeof rows[0][k])).slice(0, 5).join(","))
    .split(",").map((c) => c.trim()).filter(Boolean).slice(0, 8).map((c) => {
      const [field, fmt = "auto"] = c.split(":");
      return { field, fmt, keys: parsePath(`t0.${field}`)?.keys || null };
    });
  const bad = cols.filter((c) => !c.keys || !rows.some((r) => lookup(r, c.keys).found));
  const sort = String(opts.sort || "").trim();
  if (sort) {
    const desc = sort.startsWith("-");
    const keys = parsePath(`t0.${sort.replace(/^[-+]/, "")}`)?.keys;
    if (keys) {
      const val = (r) => { const v = lookup(r, keys).value; const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : typeof v === "string" ? v : null; };
      rows = [...rows].sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return desc ? -c : c;
      });
    }
  }
  const limit = Math.max(1, Math.min(TABLE_MAX, Number(opts.limit || opts.rows) || TABLE_DEFAULT));
  const shown = rows.slice(0, limit);
  const total = cutList(list) ? Number(list.total) || rows.length : rows.length;
  const lines = [`| ${cols.map((c) => columnLabel(c.field)).join(" | ")} | Ref |`, `|${cols.map(() => "---").join("|")}|---|`];
  for (const r of shown) {
    const cells = cols.map((c) => {
      if (!c.keys || bad.includes(c)) return MISSING;
      const hit = lookup(r, c.keys);
      if (!hit.found || hit.value == null || hit.value === "") return "—";
      const f = formatValue(hit.value, c.fmt, String(c.keys.filter((k) => typeof k === "string").at(-1) || ""));
      if (f.ok) note(used, path.ref, hit.value);
      return f.text;
    });
    lines.push(`| ${cells.join(" | ")} | [${path.ref}] |`);
  }
  note(used, path.ref, shown.length);
  note(used, path.ref, total);
  const tail = total > shown.length ? `\n${shown.length} of ${total} rows shown [${path.ref}].` : "";
  const reasonBad = bad.length ? `unknown column${bad.length > 1 ? "s" : ""} ${bad.map((c) => c.field).join(", ")}` : "";
  const fmtBad = cols.filter((c) => !SLOT_FORMATS.includes(String(c.fmt).toLowerCase().split(":")[0])).map((c) => c.fmt);
  return { ok: !reasonBad && !fmtBad.length, text: lines.join("\n") + tail, reason: reasonBad || (fmtBad.length ? `unknown format "${fmtBad[0]}"` : ""), ref: path.ref, table: true };
}

function note(used, ref, value) {
  if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()))) return;
  const list = used.get(ref) || [];
  list.push(Number(value));
  used.set(ref, list);
}

/** One `{{…}}` (braces included) → `{ ok, text, reason, ref }`. */
export function renderSlot(slot, src, used = new Map()) {
  const body = String(slot).replace(/^\{\{|\}\}$/g, "").trim();
  return /^table\b/i.test(body) ? renderTable(body, src, used) : renderValue(body, src, used);
}

/**
 * Every slot in `text`, filled. `{ text, count, missing: [{ slot, reason, ref }], used: Map<ref, number[]> }`; `used`
 * holds the values the slots printed, so the grounding checks count them as coming from their ref.
 */
export function renderSlots(text, src) {
  const used = new Map();
  const missing = [];
  let count = 0;
  const out = String(text || "").replace(SLOT, (whole) => {
    count += 1;
    const r = renderSlot(whole, src, used);
    if (!r.ok) missing.push({ slot: whole.slice(0, 160), reason: r.reason || "invalid slot", ref: r.ref || "" });
    // A table gets lines of its own, or the markdown table would not parse next to prose.
    // The same text whether filled whole or slot by slot while streaming.
    return r.table ? `\n${r.text}\n` : r.text;
  });
  return { text: out, count, missing: missing.slice(0, 20), used };
}

/**
 * Renders a stream as it arrives: text before an open `{{` goes out at once, a slot goes out filled when its `}}`
 * arrives, and a `{{` that never closes within a few hundred characters goes out as typed.
 */
export function slotStream(fill) {
  let buf = "";
  const drain = (final) => {
    let out = "";
    for (;;) {
      const i = buf.indexOf("{{");
      if (i < 0) {
        const keep = !final && buf.endsWith("{") ? 1 : 0;
        out += buf.slice(0, buf.length - keep);
        buf = buf.slice(buf.length - keep);
        return out;
      }
      out += buf.slice(0, i);
      buf = buf.slice(i);
      const j = buf.indexOf("}}");
      if (j >= 0) {
        out += fill(buf.slice(0, j + 2));
        buf = buf.slice(j + 2);
        continue;
      }
      if (final || buf.length > OPEN_LIMIT) {
        out += buf.slice(0, 2);
        buf = buf.slice(2);
        continue;
      }
      return out;
    }
  };
  return {
    push(delta) { buf += String(delta || ""); return drain(false); },
    flush() { return drain(true); }
  };
}

/**
 * Evidence whose `json` also carries the values the slots printed from it, for the grounding and citation checks.
 * The tool still returned them (the table may read rows past the ones the model saw), so they count as that ref's.
 */
export function slotEvidence(evidence, used) {
  if (!used || !used.size) return evidence;
  // Space-separated: the grounding reader takes "1,234" as one number, so a JSON array would merge its values.
  return evidence.map((e) => (used.has(e.id) ? { ...e, json: `${e.json || ""} ${used.get(e.id).join(" ")}` } : e));
}

/** One warning line for slots that did not fill, or "". */
export function missingNote(missing) {
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return "";
  const shown = list.slice(0, 3).map((m) => `${m.slot} (${m.reason})`).join("; ");
  return `${list.length} figure${list.length === 1 ? "" : "s"} could not be filled from the data and show as ${MISSING}: ${shown}${list.length > 3 ? "; …" : ""}.`;
}
