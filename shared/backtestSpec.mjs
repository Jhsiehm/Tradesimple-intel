/**
 * Backtest spec: what a run is asked, cleaned and bounded. Pure; the server and the browser both read it.
 * A spec is { source, filters, rules }. The signal date is always the public date of the record (a filing
 * date, a Form 4 filing, a contract publication), never the trade date, so no entry can precede the news.
 */

export const SOURCES = ["congress", "form4", "contracts", "lobbying"];
export const SOURCE_LABEL = {
  congress: "Congressional trades",
  form4: "Form 4 insider trades",
  contracts: "Contract awards",
  lobbying: "Lobbying spikes"
};

/** GICS sector (data/tickers.json) → SPDR sector ETF. */
export const SECTOR_ETF = {
  "Information Technology": "XLK",
  "Health Care": "XLV",
  Financials: "XLF",
  Energy: "XLE",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Industrials: "XLI",
  Materials: "XLB",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  "Communication Services": "XLC"
};
export const SECTOR_ETFS = Object.values(SECTOR_ETF);
export const BENCHMARKS = ["SPY", "^GSPC", "SECTOR", ...SECTOR_ETFS];
export const BENCHMARK_LABEL = { SPY: "SPY (S&P 500 ETF)", "^GSPC": "^GSPC (S&P 500 index, price only)", SECTOR: "Sector ETF of each ticker" };

export const LIMITS = { holdDays: [1, 730], pct: [1, 95], bps: [0, 300], hearingDays: [1, 60], signals: 1500, tickers: 40, minAmount: 1e10 };

export const DEFAULT_RULES = {
  entry: "nextOpen",
  holdDays: 90,
  stopLossPct: null,
  takeProfitPct: null,
  sides: "buy",
  sizing: "equal",
  benchmark: "SPY",
  costBps: 0,
  slippageBps: 5,
  openTrades: "exclude"
};

export const DEFAULT_FILTERS = {
  member: "",
  party: "",
  chamber: "",
  committee: "",
  tickers: [],
  sector: "",
  from: "",
  to: "",
  minAmount: 0,
  nearHearingDays: 0,
  hearingKnown: false,
  minLagDays: 0,
  maxLagDays: 0,
  contractAgency: "",
  spikePct: 50
};

const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const isoDay = (v) => {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? s : "";
};

export function cleanRules(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const optionalPct = (v) => (v === "" || v == null || Number(v) === 0 ? null : num(v, LIMITS.pct[0], LIMITS.pct[1], null));
  return {
    entry: pick(r.entry, ["nextOpen", "nextClose"], DEFAULT_RULES.entry),
    holdDays: Math.round(num(r.holdDays, LIMITS.holdDays[0], LIMITS.holdDays[1], DEFAULT_RULES.holdDays)),
    stopLossPct: optionalPct(r.stopLossPct),
    takeProfitPct: optionalPct(r.takeProfitPct),
    sides: pick(r.sides, ["buy", "sell", "both"], DEFAULT_RULES.sides),
    sizing: pick(r.sizing, ["equal", "amountMid"], DEFAULT_RULES.sizing),
    benchmark: pick(r.benchmark, BENCHMARKS, DEFAULT_RULES.benchmark),
    costBps: num(r.costBps, LIMITS.bps[0], LIMITS.bps[1], DEFAULT_RULES.costBps),
    slippageBps: num(r.slippageBps, LIMITS.bps[0], LIMITS.bps[1], DEFAULT_RULES.slippageBps),
    openTrades: pick(r.openTrades, ["exclude", "mark"], DEFAULT_RULES.openTrades)
  };
}

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function cleanFilters(raw) {
  const f = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(f.tickers) ? f.tickers : String(f.tickers || "").split(/[\s,]+/);
  const tickers = [...new Set(list.map((s) => String(s).trim().toUpperCase()).filter((s) => SYMBOL.test(s)))].slice(0, LIMITS.tickers);
  const from = isoDay(f.from);
  const to = isoDay(f.to);
  return {
    member: text(f.member, 60),
    party: pick(String(f.party || "").toUpperCase(), ["D", "R", "I"], ""),
    chamber: pick(f.chamber, ["house", "senate"], ""),
    committee: text(f.committee, 60),
    tickers,
    sector: pick(f.sector, Object.keys(SECTOR_ETF), ""),
    from,
    to: from && to && to < from ? from : to,
    minAmount: Math.round(num(f.minAmount, 0, LIMITS.minAmount, 0)),
    nearHearingDays: Math.round(num(f.nearHearingDays, 0, LIMITS.hearingDays[1], 0)),
    hearingKnown: Boolean(f.hearingKnown),
    minLagDays: Math.round(num(f.minLagDays, 0, 3650, 0)),
    maxLagDays: Math.round(num(f.maxLagDays, 0, 3650, 0)),
    contractAgency: text(f.contractAgency, 80),
    spikePct: Math.round(num(f.spikePct, 1, 10000, DEFAULT_FILTERS.spikePct))
  };
}

/** `{ ok, spec }` or `{ ok:false, error }`. Unknown keys are dropped; numbers are clamped, not rejected. */
export function cleanSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "A spec object is required." };
  const source = String(raw.source || "congress");
  if (!SOURCES.includes(source)) return { ok: false, error: `source must be one of ${SOURCES.join(", ")}.` };
  const spec = { source, filters: cleanFilters(raw.filters), rules: cleanRules(raw.rules) };
  if (source === "lobbying" && !spec.filters.tickers.length) {
    return { ok: false, error: "Lobbying spikes are read per ticker. Add up to 40 tickers from data/tickers.json." };
  }
  return { ok: true, spec };
}

/** Same spec, same string: sorted keys, defaults kept, so the cache and the share link agree. */
export function specKey(spec) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort(spec));
}

/** cyrb53: a short stable hash. Not for secrets; for cache keys and share ids. */
export function specHash(spec) {
  const s = specKey(spec);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function toB64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s) {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const nonDefault = (obj, base) => Object.fromEntries(Object.entries(obj).filter(([k, v]) => !sameValue(v, base[k])));

/** URL token for `#bt=…`: only what differs from the defaults, so links stay short. */
export function encodeSpec(spec) {
  const c = cleanSpec(spec);
  if (!c.ok) return "";
  const { source, filters, rules } = c.spec;
  return toB64url(specKey({ source, filters: nonDefault(filters, DEFAULT_FILTERS), rules: nonDefault(rules, DEFAULT_RULES) }));
}

export function decodeSpec(token) {
  try {
    const out = cleanSpec(JSON.parse(fromB64url(token)));
    return out.ok ? out.spec : null;
  } catch {
    return null;
  }
}

const fmtUsd = (n) => (n >= 1e6 ? `$${n / 1e6}M` : n >= 1e3 ? `$${n / 1e3}k` : `$${n}`);

/** One plain sentence for the board header, share text, and Ask. */
export function describeSpec(spec) {
  const f = spec.filters;
  const r = spec.rules;
  const who = [
    f.committee && `${f.committee} members`,
    f.member && `member “${f.member}”`,
    f.party && ({ D: "Democrats", R: "Republicans", I: "Independents" })[f.party],
    f.chamber && `${f.chamber === "senate" ? "Senate" : "House"}`
  ].filter(Boolean).join(", ");
  const side = r.sides === "buy" ? "buys" : r.sides === "sell" ? "sells (shorted)" : "buys and sells";
  const bits = [
    `${SOURCE_LABEL[spec.source]}${who ? ` · ${who}` : ""} · ${side}`,
    f.tickers.length ? `tickers ${f.tickers.slice(0, 6).join(", ")}${f.tickers.length > 6 ? "…" : ""}` : "",
    f.sector,
    f.minAmount ? `≥ ${fmtUsd(f.minAmount)}` : "",
    f.nearHearingDays ? `within ${f.nearHearingDays} d of a hearing` : "",
    f.from || f.to ? `${f.from || "start"} → ${f.to || "now"} (public date)` : ""
  ].filter(Boolean);
  const exit = `hold ${r.holdDays} d${r.stopLossPct ? `, stop −${r.stopLossPct}%` : ""}${r.takeProfitPct ? `, take +${r.takeProfitPct}%` : ""}`;
  const entry = r.entry === "nextOpen" ? "open after the public date" : "close after the public date";
  return `${bits.join(" · ")} · enter at the ${entry} · ${exit} · vs ${r.benchmark === "SECTOR" ? "sector ETF" : r.benchmark}`;
}
