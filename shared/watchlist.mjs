/**
 * Pure shaping for the Today watchlist, shared by server/ and src/: ticker checks against the join table, list order,
 * one event shape for every activity source, disclosure latency, per-source badges, and watch alert rows.
 */
import { alertSeverity } from "./intel.mjs";

export const WATCH_MAX = 40;
export const BADGE_DAYS = [7, 30, 90];
/** How far back the per-ticker feed reaches, by disclosure date. */
export const FEED_DAYS = 120;
/** STOCK Act limit for a periodic transaction report. */
export const LATE_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Feed sections in display order. `short` is the badge text on a watchlist row. */
export const WATCH_SOURCES = [
  { key: "congress", label: "Congress trades", short: "CONG" },
  { key: "insiders", label: "Insiders · Form 4", short: "F4" },
  { key: "whales", label: "Funds · 13F", short: "13F" },
  { key: "stakes", label: ">5% stakes · 13D/13G", short: "13D/G" },
  { key: "contracts", label: "Gov contracts", short: "GOV" },
  { key: "lobbying", label: "Lobbying · LDA", short: "LDA" },
  { key: "filings", label: "Material events · 8-K", short: "8-K" },
  { key: "news", label: "News", short: "NEWS" }
];

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,7}$/;

export const normSymbol = (s) => String(s ?? "").trim().toUpperCase();

/** Known symbols in request order (deduped, capped at `max`) and everything else, so a bad entry is named, not dropped. */
export function cleanTickers(list, known, max = WATCH_MAX) {
  const valid = [];
  const invalid = [];
  for (const raw of list || []) {
    const s = normSymbol(raw);
    if (!s || valid.includes(s) || invalid.includes(s)) continue;
    if (SYMBOL_RE.test(s) && known.has(s) && valid.length < max) valid.push(s);
    else invalid.push(s);
  }
  return { valid, invalid };
}

export function addSymbol(list, symbol, max = WATCH_MAX) {
  const s = normSymbol(symbol);
  if (!s || list.includes(s) || list.length >= max) return list;
  return [...list, s];
}

export function removeSymbol(list, symbol) {
  const s = normSymbol(symbol);
  return list.filter((x) => x !== s);
}

/** Moves `symbol` by `delta` places, clamped to the list. Unknown symbols leave the list as it was. */
export function moveSymbol(list, symbol, delta) {
  const i = list.indexOf(normSymbol(symbol));
  if (i < 0) return list;
  const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (j === i) return list;
  const out = [...list];
  out.splice(j, 0, ...out.splice(i, 1));
  return out;
}

/** Typeahead over join-table tickers: exact symbol, symbol prefix, name word prefix, then name substring. */
export function matchTickers(tickers, query, n = 8) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const rank = (t) => {
    const sym = t.symbol.toLowerCase();
    const name = String(t.name || "").toLowerCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
    if (name.includes(q)) return 3;
    return -1;
  };
  return tickers
    .map((t) => ({ t, r: rank(t) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.t.symbol.localeCompare(b.t.symbol))
    .slice(0, n)
    .map((x) => x.t);
}

const msOf = (v) => {
  if (!v) return NaN;
  const s = String(v);
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
};
const dayOf = (v) => {
  const t = msOf(v);
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
};

/** Whole calendar days (UTC) from the event to its disclosure; null when either date is missing. */
export function lagDays(eventAt, publishedAt) {
  const a = dayOf(eventAt);
  const b = dayOf(publishedAt);
  return a == null || b == null ? null : b - a;
}

/** "45m", "6h", "3d", "5mo", "2y" from `iso` to `now`; "" when unknown. A future stamp reads "0m". */
export function ageLabel(iso, now = Date.now()) {
  const t = msOf(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  const d = Math.round(m / 1440);
  if (d < 60) return `${d}d`;
  if (d < 730) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
}

/** The time an event became public, falling back to the event time for feeds without a separate disclosure. */
export const shownAt = (e) => e.publishedAt || e.eventAt || "";

const usd = (v) => (v == null || !Number.isFinite(v) ? "" : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`);
const num = (v) => (v == null || !Number.isFinite(v) ? "" : Math.round(v).toLocaleString("en-US"));

/** House PTR / Senate eFD row (server/domain/positions/congress.mjs). Id matches the Alerts row so both dedupe. */
export function congressEvent(t) {
  const lag = t.lag ?? lagDays(t.traded, t.filed);
  const late = lag != null && lag > LATE_DAYS;
  const verb = t.side === "buy" ? "bought" : t.side === "sell" ? "sold" : t.type || "traded";
  return {
    id: `trade:${t.id}`,
    symbol: t.symbol,
    source: "congress",
    feed: t.chamber === "senate" ? "Senate eFD PTR" : "House Clerk PTR",
    title: `${t.person} ${verb} ${t.amount || ""}`.trim(),
    detail: [t.chamber === "senate" ? "Senate" : "House", [t.party, t.state].filter(Boolean).join("-"), t.owner ? `owner ${t.owner}` : ""].filter(Boolean).join(" · "),
    who: t.person,
    bioguide: t.bioguide || "",
    chamber: t.chamber || "",
    party: t.party || "",
    state: t.state || "",
    side: t.side === "buy" || t.side === "sell" ? t.side : "",
    amount: t.amountLow ?? null,
    amountLabel: t.amount || "",
    eventAt: t.traded || "",
    publishedAt: t.filed || "",
    lag,
    late,
    link: t.link || ""
  };
}

const F4_SIDE = { P: "buy", S: "sell" };

/**
 * One event per Form 4 filing from per-line rows (server/domain/positions/insiders.mjs). `openValue` sums open-market
 * buys and sells (P/S) outside a 10b5-1 plan; `side` is buy/sell only when every open-market line agrees.
 */
export function insiderEvents(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    const acc = r.accession || String(r.id);
    const key = `${r.symbol}:${acc}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { symbol: r.symbol, accession: acc, person: r.person, title: r.title || "", filed: r.filed, link: r.link, lines: [] }));
    g.lines.push({ code: r.code, side: r.side, shares: r.shares ?? null, price: r.price ?? null, value: r.value ?? (r.shares && r.price ? Math.round(r.shares * r.price) : null), plan: Boolean(r.plan), traded: r.traded || "", owned: r.owned ?? null });
  }
  return [...groups.values()].map((g) => {
    const open = g.lines.filter((l) => F4_SIDE[l.code]);
    const sides = new Set(open.map((l) => F4_SIDE[l.code]));
    const buys = open.filter((l) => l.code === "P").length;
    const unplanned = open.filter((l) => !(l.code === "S" && l.plan));
    const openValue = Math.round(unplanned.reduce((s, l) => s + (l.value || 0), 0));
    const planned = open.length > 0 && buys === 0 && open.every((l) => l.plan);
    const traded = g.lines.map((l) => l.traded).filter(Boolean).sort();
    const eventAt = traded[0] || "";
    const codes = [...new Set(g.lines.map((l) => l.code))].join("/");
    const shares = g.lines.reduce((s, l) => s + (l.shares || 0), 0);
    const value = Math.round(g.lines.reduce((s, l) => s + (l.value || 0), 0));
    return {
      id: `f4:${g.symbol}:${g.accession}`,
      symbol: g.symbol,
      source: "insiders",
      feed: "SEC EDGAR Form 4",
      title: `${g.person}${g.title ? ` (${g.title})` : ""} · ${codes}${buys ? ` · ${buys} open-market buy${buys === 1 ? "" : "s"}` : ""}`,
      detail: `${num(shares)} sh${value ? ` · ${usd(value)}` : ""} · ${g.lines.length} line${g.lines.length === 1 ? "" : "s"}${planned ? " · 10b5-1 plan" : ""}`,
      who: g.person,
      role: g.title,
      side: sides.size === 1 ? [...sides][0] : "",
      amount: openValue || null,
      amountLabel: value ? usd(value) : "",
      eventAt,
      publishedAt: g.filed || "",
      lag: lagDays(eventAt, g.filed),
      late: false,
      planned,
      buys,
      lines: g.lines,
      link: g.link || ""
    };
  });
}

const WHALE_ACTION = { new: "new position", add: "increased", trim: "decreased", exit: "exited", held: "holds", hold: "unchanged" };

/** 13F holder change (server/domain/positions/whales.mjs). Quarter-end holdings, so the event date is the quarter end. */
export function whaleEvent(r) {
  const change = { add: "increase", trim: "decrease" }[r.action] || r.action;
  return {
    id: `whale:${r.id}`,
    symbol: r.symbol,
    source: "whales",
    feed: "SEC EDGAR 13F-HR",
    title: `${r.person} ${WHALE_ACTION[r.action] || r.action}`,
    detail: `${num(r.shares)} sh${r.value ? ` · ${usd(r.value)}` : ""}${r.delta ? ` · ${r.delta > 0 ? "+" : ""}${num(r.delta)} sh vs ${r.priorPeriod || "prior 13F"}` : ""} · quarter ${r.period || "?"}`,
    who: r.person,
    change,
    side: r.side === "buy" || r.side === "sell" ? r.side : "",
    shares: r.shares ?? null,
    delta: r.delta ?? null,
    amount: r.value ?? null,
    amountLabel: usd(r.value),
    quarter: r.period || "",
    eventAt: r.period || "",
    publishedAt: r.filed || "",
    lag: r.lag ?? lagDays(r.period, r.filed),
    late: false,
    link: r.link || ""
  };
}

/** Schedule 13D/13G filing about the issuer. `activist` is 13D (intent to influence); 13G is a passive stake. */
export function stakeEvent(f) {
  const activist = /13D/i.test(f.form);
  const amend = /\/A$/i.test(f.form);
  const who = f.person || "Filer named in the filing";
  return {
    id: `stake:${f.accession}`,
    symbol: f.symbol,
    source: "stakes",
    feed: "SEC EDGAR Schedule 13D/13G",
    title: `${who} · ${activist ? "13D" : "13G"}${amend ? " amendment" : ""}${f.percent != null ? ` · ${f.percent}% of class` : ""}`,
    detail: `${f.form}${f.shares ? ` · ${num(f.shares)} sh` : ""}${activist ? " · active stake (may seek to influence)" : " · passive stake"}`,
    who,
    form: f.form,
    activist,
    amend,
    percent: f.percent ?? null,
    shares: f.shares ?? null,
    side: "",
    amount: null,
    amountLabel: "",
    eventAt: f.eventDate || "",
    publishedAt: f.accepted || f.filed || "",
    lag: lagDays(f.eventDate, f.accepted || f.filed),
    late: false,
    link: f.link || ""
  };
}

/** USAspending prime contract action (server/contracts.mjs contractFeed). USAspending gives no publish date per action. */
export function contractEvent(a, symbol) {
  return {
    id: `contract:${a.id}`,
    symbol,
    source: "contracts",
    feed: "USAspending.gov prime contract transactions",
    title: `${a.agency || "Federal agency"}${a.subAgency && a.subAgency !== a.agency ? ` · ${a.subAgency}` : ""} · ${usd(a.amount)}`,
    detail: [a.description, a.recipient, a.mod ? `mod ${a.mod}` : ""].filter(Boolean).join(" · ").slice(0, 280),
    who: a.agency || "",
    side: "",
    amount: a.amount ?? null,
    amountLabel: usd(a.amount),
    eventAt: a.date || "",
    publishedAt: "",
    lag: null,
    late: false,
    link: a.link || ""
  };
}

/** LDA filing (server/domain/corporate/lobbying.mjs). Id matches the Alerts lobbying row. */
export function lobbyingEvent(l, symbol) {
  return {
    id: `lda:${l.id}`,
    symbol,
    source: "lobbying",
    feed: "LDA.gov",
    title: `${l.registrant || "Registrant"}${l.amount ? ` · ${usd(l.amount)}` : ""}`,
    detail: [l.typeLabel || l.period, l.inHouse ? "in-house" : "", (l.issues || []).slice(0, 3).join(", ")].filter(Boolean).join(" · "),
    who: l.registrant || "",
    issues: l.issues || [],
    period: l.period || "",
    side: "",
    amount: l.amount ?? null,
    amountLabel: usd(l.amount),
    eventAt: l.periodEnd || "",
    publishedAt: l.posted || "",
    lag: l.lag ?? lagDays(l.periodEnd, l.posted),
    late: false,
    link: l.link || ""
  };
}

export const ITEMS_8K = {
  "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy or receivership", "1.04": "Mine safety", "1.05": "Cybersecurity incident",
  "2.01": "Acquisition or disposal completed", "2.02": "Results of operations", "2.03": "New debt obligation", "2.04": "Debt acceleration", "2.05": "Exit or restructuring costs", "2.06": "Impairment",
  "3.01": "Delisting notice", "3.02": "Unregistered equity sale", "3.03": "Shareholder rights changed",
  "4.01": "Auditor change", "4.02": "Prior financials unreliable",
  "5.01": "Change in control", "5.02": "Director or officer change", "5.03": "Bylaws or fiscal year changed", "5.07": "Shareholder vote results", "5.08": "Director nominations",
  "7.01": "Reg FD disclosure", "8.01": "Other events", "9.01": "Exhibits"
};

/** 8-K from the issuer's submissions: event date is SEC's report date, publish time the EDGAR acceptance time. */
export function filingEvent(f) {
  const items = String(f.items || "").split(",").map((s) => s.trim()).filter(Boolean);
  const named = items.filter((i) => i !== "9.01").map((i) => ITEMS_8K[i] || `Item ${i}`);
  return {
    id: `8k:${f.accession}`,
    symbol: f.symbol,
    source: "filings",
    feed: "SEC EDGAR 8-K",
    title: `${f.form}${named.length ? ` · ${named.join(", ")}` : ""}`,
    detail: items.length ? `Items ${items.join(", ")}` : "Item list not in the SEC index",
    who: "",
    items,
    side: "",
    amount: null,
    amountLabel: "",
    eventAt: f.reportDate || "",
    publishedAt: f.accepted || f.filed || "",
    lag: lagDays(f.reportDate, f.accepted || f.filed),
    late: false,
    link: f.link || ""
  };
}

/** Headline from the publisher feed. A headline is its own event, so there is no disclosure lag. */
export function newsEvent(n, symbol) {
  return {
    id: `news:${symbol}:${n.id}`,
    symbol,
    source: "news",
    feed: n.feed || "Yahoo Finance RSS",
    title: n.title,
    detail: String(n.summary || "").slice(0, 240),
    who: n.publisher || "",
    side: "",
    amount: null,
    amountLabel: "",
    eventAt: n.published || "",
    publishedAt: n.published || "",
    lag: null,
    late: false,
    link: n.link || ""
  };
}

/** First copy of each id wins, then newest public time first (ties by id, so the order is stable). */
export function mergeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (!e?.id || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => (msOf(shownAt(b)) || 0) - (msOf(shownAt(a)) || 0) || a.id.localeCompare(b.id));
}

/** Events whose public time is within `days` of `now`. */
export function withinDays(events, days, now = Date.now()) {
  const from = now - days * DAY_MS;
  return events.filter((e) => {
    const t = msOf(shownAt(e));
    return Number.isFinite(t) && t >= from;
  });
}

/** Per-source `{ count, newest, age }` for events made public in the last `days`; sources without events are omitted. */
export function badgesOf(events, days, now = Date.now()) {
  const out = {};
  for (const e of withinDays(events, days, now)) {
    const b = (out[e.source] ||= { count: 0, newest: "" });
    b.count += 1;
    if ((msOf(shownAt(e)) || 0) > (msOf(b.newest) || 0)) b.newest = shownAt(e);
  }
  for (const b of Object.values(out)) b.age = ageLabel(b.newest, now);
  return out;
}

const ALERT_KIND = { stakes: "stake", contracts: "contract", whales: "whale", filings: "8-k" };
/** Contract modifications under this size (either sign) stay in the feed but never alert; large contractors post dozens a month. */
export const CONTRACT_ALERT_MIN = 1e6;
/** A 13F increase or decrease alerts only at this share of the prior holding; funds rebalance every quarter. */
export const WHALE_ALERT_SHARE = 0.2;
const bigChange = (e) => {
  const prior = (e.shares || 0) - (e.delta || 0);
  return prior > 0 && Math.abs(e.delta || 0) / prior >= WHALE_ALERT_SHARE;
};
const ALERT_SOURCE = { stakes: "SEC EDGAR Schedule 13D/13G", contracts: "USAspending.gov", whales: "SEC EDGAR 13F-HR", filings: "SEC EDGAR 8-K" };

/**
 * Alert rows for the watchlist sources the Alerts feed did not already cover (Congress, Form 4 and lobbying rows come
 * from server/alerts.mjs buildAlerts with the same ids). `since` (YYYY-MM-DD) filters on the public date; contract
 * actions have none, so their action date is used. Unchanged 13F holdings, 13F changes under WHALE_ALERT_SHARE of the
 * prior holding, and contract actions under CONTRACT_ALERT_MIN never alert. Headlines alert (ROUTINE) only with `news: true`: a busy ticker posts ~20 a day.
 */
export function watchAlertRows(events, since = "", { news = false } = {}) {
  const out = [];
  for (const e of events) {
    const kind = e.source === "news" && news ? "news" : ALERT_KIND[e.source];
    if (!kind) continue;
    if (kind === "whale" && !(e.change === "new" || e.change === "exit" || ((e.change === "increase" || e.change === "decrease") && bigChange(e)))) continue;
    if (kind === "contract" && !(Math.abs(e.amount || 0) >= CONTRACT_ALERT_MIN)) continue;
    const date = String(shownAt(e)).slice(0, 10);
    if (since && date < since) continue;
    out.push({
      id: e.id,
      kind,
      date,
      eventAt: e.eventAt || "",
      filedAt: e.publishedAt || "",
      title: `${{ "8-k": "8-K", stake: e.activist ? "13D" : "13G", whale: "13F", contract: "Contract", news: "News" }[kind]} · ${e.symbol} · ${e.title}`,
      detail: [e.detail, e.eventAt ? `event ${String(e.eventAt).slice(0, 10)}` : "", e.lag != null ? `disclosed ${e.lag}d later` : ""].filter(Boolean).join(" · "),
      link: e.link,
      action: `pos:${e.symbol}`,
      late: false,
      severity: alertSeverity({ kind, amount: e.amount, activist: e.activist, change: e.change, value: e.amount, items: e.items }),
      source: ALERT_SOURCE[e.source] || e.feed,
      pins: [{ kind: "symbol", id: e.symbol, label: e.symbol }]
    });
  }
  return out;
}
