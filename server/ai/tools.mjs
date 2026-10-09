/**
 * Read-only tools for Ask. Each wraps a route handler or the backtest runner in process, so the model sees exactly
 * what the app's own boards see, with the same source, asOf, and latency. Nothing here writes, orders, or fetches.
 */
import { SOURCES, SECTOR_ETF, BENCHMARKS } from "../../shared/backtestSpec.mjs";
import { handlers as system } from "../routes/system.mjs";
import { handlers as congress } from "../routes/congress.mjs";
import { handlers as markets } from "../routes/markets.mjs";
import { handlers as corporate } from "../routes/corporate.mjs";
import { handlers as world } from "../routes/world.mjs";
import { handlers as relations } from "../routes/relations.mjs";
import { handlers as backtest } from "../routes/backtest.mjs";
import { fillRoute } from "../routes/manifest.mjs";
import { queryOf } from "../router.mjs";
import { runMarketSnapshot } from "./marketTool.mjs";
import { runWorldMarkets } from "./worldTool.mjs";
import { runWebFetch, runWebSearch } from "./webTool.mjs";
import { REGION_IDS } from "../../shared/worldMarkets.mjs";
import { searchSignalsTool } from "./searchTool.mjs";

const handlers = { ...system, ...congress, ...markets, ...corporate, ...world, ...relations, ...backtest };

const str = (description) => ({ type: "string", description });
const obj = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });

const symbolOf = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z][A-Z0-9.\-]{0,11}$/.test(s) ? s : "";
};
const bioguideOf = (v) => {
  const s = String(v || "").trim().toUpperCase();
  return /^[A-Z]\d{6}$/.test(s) ? s : "";
};
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v != null && v !== "") p.set(k, String(v));
  return p.toString();
};

const unwrap = (out) => {
  if (!out || typeof out !== "object") return { ok: false, error: "Empty tool result." };
  if (typeof out.status === "number" && out.body && typeof out.body === "object" && out.ok === undefined) return out.body;
  return out;
};

/** In-process route call. A route with no source label gets one that says where it came from. */
export async function callRoute(db, id, params = {}, query = "") {
  const handler = handlers[id];
  if (!handler) return { ok: false, error: `Unknown route ${id}` };
  const started = Date.now();
  const url = new URL(fillRoute(id, params, query), "http://127.0.0.1");
  const body = unwrap(await handler({ db, root: "", params, url, query: queryOf(url.searchParams), req: null, res: null }));
  if (body && typeof body === "object" && !Array.isArray(body) && body.ok !== false && !body.source) {
    return { ...body, source: `TradeSimple /${fillRoute(id, params).replace(/^\//, "")}`, asOf: body.asOf || new Date().toISOString(), latency: body.latency || `${Date.now() - started} ms in process` };
  }
  return body;
}

const join = (...xs) => [...new Set(xs.filter(Boolean))].join(" + ");

const tool = (name, description, parameters, run, label) => ({ name, description, parameters, run, label });
const bad = (error) => ({ ok: false, error });

/**
 * A backtest's counts under names that say what each one counts, so "117" cannot be read as tickers when it is
 * paper filings. Absent counts are left out rather than shown as 0.
 */
export function countsForModel(c = {}) {
  const out = {
    matchedSignals: c.matched ?? c.offeredSignals,
    signalsOnChosenSides: c.signals,
    tradesPriced: c.used,
    signalsNotPriced: c.skipped,
    distinctTickersMatched: c.tickers,
    tickersWithPriceHistory: c.priced,
    unparsedPaperFilings: c.unparsedPaperFilings,
    unreadElectronicReports: c.unreadElectronicReports
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v === "number"));
}

/** The compact answer a backtest gives a model: stats, the biggest names, every warning, each feed's label. */
export function summarizeBacktest(out) {
  if (!out || out.ok === false) return out;
  const warn = (out.caveats?.items || []).filter((c) => c.level === "warn").map((c) => c.text);
  const info = (out.caveats?.items || []).filter((c) => c.level !== "warn").map((c) => c.text);
  const s = out.stats || {};
  const c = out.counts || {};
  return {
    ok: true,
    description: out.description,
    spec: out.spec,
    counts: countsForModel(c),
    stats: {
      trades: s.trades, totalReturn: s.total, annualized: s.annualized, benchmarkReturn: s.benchmarkTotal,
      benchmarkAnnualized: s.benchmarkAnnualized, excessReturn: s.excessTotal, hitRate: s.hitRate, beatBenchmarkRate: s.beatRate,
      avgTrade: s.avgTrade, medianTrade: s.medianTrade, avgExcessPerTrade: s.avgExcess, excessTStat: s.excessT,
      maxDrawdown: s.maxDrawdown, benchmarkMaxDrawdown: s.benchmarkMaxDrawdown, sharpeish: s.sharpeish, from: s.from, to: s.to, avgHoldDays: s.avgHoldDays
    },
    topMembers: (out.byMember?.rows || []).slice(0, 5),
    topTickers: (out.byTicker?.rows || []).slice(0, 5),
    caveatTexts: [...warn, ...info.slice(0, 3)].slice(0, 6),
    feeds: (out.feeds || []).map((f) => ({ label: f.label, source: f.source, asOf: f.asOf })),
    source: (out.feeds || []).map((f) => f.source).filter(Boolean).join(" · ") || out.source,
    asOf: out.asOf,
    latency: out.latency,
    cache: out.cache,
    isItReal: out.reality ? { verdict: out.reality.verdict?.text, excessCI95Lo: out.reality.bootstrap?.meanExcess.lo ?? null, excessCI95Hi: out.reality.bootstrap?.meanExcess.hi ?? null, placeboBeatShare: out.reality.placebo?.pct ?? null, placeboP: out.reality.placebo?.p ?? null, clusteredT: out.reality.cluster?.t ?? null, effectiveTrades: out.reality.cluster?.nEff ?? null } : null
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const daysArg = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const WINDOW_ARGS = {
  days: { type: "number", description: "Only the last N days. Pass it whenever the question says last N days, this week/month, or recent; leave it out for all available data." },
  from: str("First day, YYYY-MM-DD (instead of days)"),
  to: str("Last day, YYYY-MM-DD (instead of days)")
};

/**
 * Rows of a list result kept to a date window by `key`, with `window` saying what was applied (or `all: true` and the
 * span the rows cover). Counts after the cut are the window's; `itemsBeforeWindow` is the list's size before it.
 */
export function windowItems(body, { days = 0, from = "", to = "", key = "filed", basis = "filing date", unit = "rows", today = new Date().toISOString().slice(0, 10), coverage = "" } = {}) {
  if (!body || body.ok === false || !Array.isArray(body.items)) return body;
  const n = daysArg(days, 730);
  let lo = ISO_DAY.test(from) ? from : "";
  let hi = ISO_DAY.test(to) ? to : "";
  if (n) { hi = hi || today; lo = new Date(Date.parse(`${hi}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10); }
  const dayOf = (r) => String(r?.[key] || "").slice(0, 10);
  if (!lo && !hi) {
    const dates = body.items.map(dayOf).filter((d) => ISO_DAY.test(d)).sort();
    return { ...body, window: { all: true, from: dates[0] || "", to: dates.at(-1) || "", basis, ...(coverage ? { coverage } : {}) } };
  }
  const items = body.items.filter((r) => { const d = dayOf(r); return ISO_DAY.test(d) && (!lo || d >= lo) && (!hi || d <= hi); });
  return { ...body, items, itemsBeforeWindow: body.items.length, window: { all: false, from: lo, to: hi, ...(n ? { days: n } : {}), basis, [unit]: items.length, ...(coverage ? { coverage } : {}) } };
}

/** The [from, to] a window's args ask for (days counts back from `to` or today), or null for no window. */
export function windowRange({ days = 0, from = "", to = "" } = {}, today = new Date().toISOString().slice(0, 10)) {
  const n = daysArg(days, 730);
  let lo = ISO_DAY.test(from) ? from : "";
  let hi = ISO_DAY.test(to) ? to : "";
  if (n) { hi = hi || today; lo = new Date(Date.parse(`${hi}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10); }
  return lo || hi ? { ...(lo ? { from: lo } : {}), ...(hi ? { to: hi } : {}) } : null;
}

/** Form 4 rows are transaction lines; several lines share one form. Counts say which is which (`totals` when rows were cut). */
export function insiderCounts(body) {
  if (!body || body.ok === false || !Array.isArray(body.items)) return body;
  const distinct = (k) => new Set(body.items.map((r) => r[k]).filter(Boolean)).size;
  const { itemsBeforeWindow, totals, ...rest } = body;
  return { ...rest, counts: totals || { transactionLines: body.items.length, forms: distinct("accession"), issuers: distinct("symbol"), insiders: distinct("person") }, ...(itemsBeforeWindow != null && !totals ? { transactionLinesBeforeWindow: itemsBeforeWindow } : {}) };
}

/** What congress_leaders gives a model: the window and benchmark status first, then the boards, shortened. */
export function leadersForModel(out) {
  if (!out || out.ok === false) return out;
  return {
    ok: true,
    source: out.source,
    asOf: out.asOf,
    latency: out.latency,
    window: out.window,
    benchmarkComparison: out.benchmarkComparison ?? null,
    ...(out.benchmarkComparisonReason ? { benchmarkComparisonReason: out.benchmarkComparisonReason } : {}),
    basis: out.basis,
    building: out.building,
    minBuys: out.minBuys,
    scoredMembers: out.scoredMembers,
    excessTop: (out.excessTop || []).slice(0, 10),
    excessBottom: (out.excessBottom || []).slice(0, 5),
    active: (out.active || []).slice(0, 10),
    tickers: (out.tickers || []).slice(0, 10),
    late: (out.late || []).slice(0, 5)
  };
}

const SPEC_SCHEMA = obj({
  source: { type: "string", enum: SOURCES, description: "congress = congressional trades by filing date; form4 = insider buys/sells excluding 10b5-1; contracts = federal awards to joined contractors; lobbying = lobbying spikes (needs tickers)" },
  filters: {
    type: "object",
    additionalProperties: false,
    description: "Which public records become signals",
    properties: {
      committee: str("Committee name such as Armed Services; members currently seated"),
      member: str("Member name or bioguide"),
      party: { type: "string", enum: ["D", "R", "I"] },
      chamber: { type: "string", enum: ["house", "senate"] },
      tickers: { type: "array", items: { type: "string" }, description: "Symbols from the join table" },
      sector: { type: "string", enum: Object.keys(SECTOR_ETF) },
      from: str("First public date, YYYY-MM-DD"),
      to: str("Last public date, YYYY-MM-DD"),
      minAmount: { type: "number", description: "Minimum disclosed range floor in dollars" },
      nearHearingDays: { type: "number", description: "Keep only trades within N days of a hearing of the member's committee" },
      contractAgency: str("Awarding agency for source=contracts"),
      contractLagDays: { type: "number", description: "source=contracts: days from award to public date; 0 = agency default (DoD 90, civilian 7)" },
      include10b51: { type: "boolean", description: "source=form4: include 10b5-1 plan trades (excluded by default)" },
      excludeMembers: { type: "array", items: { type: "string" }, description: "Names or bioguides to leave out" }
    }
  },
  rules: {
    type: "object",
    additionalProperties: false,
    description: "How the replay trades",
    properties: {
      holdDays: { type: "number", description: "Calendar days to hold, 1 to 730. Default 90" },
      sides: { type: "string", enum: ["buy", "sell", "both"], description: "Sells are scored as shorts with no borrow cost" },
      benchmark: { type: "string", enum: BENCHMARKS },
      sizing: { type: "string", enum: ["equal", "amountMid"] },
      entry: { type: "string", enum: ["nextOpen", "nextClose"] },
      stopLossPct: { type: "number" },
      takeProfitPct: { type: "number" },
      slippageBps: { type: "number" },
      costBps: { type: "number" },
      openTrades: { type: "string", enum: ["exclude", "mark"], description: "exclude (default) drops positions that have not reached their exit; mark values them at the last close. Use mark for recent windows." }
    }
  }
}, ["source"]);

/** Two backtests at a time in this process; the rest wait their turn instead of failing. */
let btRunning = 0;
const btQueue = [];
async function btSlot(fn) {
  if (btRunning >= 2) await new Promise((r) => btQueue.push(r));
  btRunning += 1;
  try { return await fn(); } finally {
    btRunning -= 1;
    btQueue.shift()?.();
  }
}

const endpoint = str("Node id such as member:P000197, ticker:NVDA, or committee:HSAS");

const plain = (name, description, id, label) => tool(name, description, obj({}), (db, _a, call) => call(db, id), label);

export const TOOLS = [
  tool("search", "Find members, tickers, and sites by name or fragment. A ticker absent from the join table does not appear.", obj({ q: str("Name or ticker fragment") }, ["q"]), (db, a, call) => {
    const q = String(a.q || "").trim().slice(0, 80);
    return q ? call(db, "search", {}, qs({ q })) : bad("q is required");
  }, "Search"),
  tool("member_profile", "One member's profile and disclosed trades. Dates are filing dates; amounts are ranges.", obj({ id: str("Bioguide id such as P000197"), chamber: { type: "string", enum: ["house", "senate"] } }, ["id"]), async (db, a, call) => {
    const id = bioguideOf(a.id);
    if (!id) return bad("id must be a bioguide such as P000197. Use search to find it.");
    const [profile, trades] = await Promise.all([call(db, "congress.member", { id }, qs({ chamber: a.chamber === "senate" ? "senate" : "house" })), call(db, "congress.memberTrades", { id })]);
    if (profile?.ok === false && trades?.ok === false) return profile;
    return { ok: true, source: join(profile?.source, trades?.source), asOf: trades?.asOf || profile?.asOf, latency: trades?.latency || profile?.latency, profile, trades };
  }, "Member"),
  tool("member_timeline", "A member's trades against their committee's hearings and roll calls, plus buys against SPY. Timing only, not cause.", obj({ id: str("Bioguide id") }, ["id"]), (db, a, call) => {
    const id = bioguideOf(a.id);
    return id ? call(db, "congress.memberTimeline", { id }) : bad("id must be a bioguide");
  }, "Timeline"),
  tool("ticker_dossier", "Dossier for one joined ticker: quote, lobbying, PAC money, contracts, headquarters, seats. Says so if the symbol is not in the join table.", obj({ symbol: str("Ticker") }, ["symbol"]), (db, a, call) => {
    const s = symbolOf(a.symbol);
    return s ? call(db, "ticker", { symbol: s }) : bad("symbol is required");
  }, "Ticker"),
  tool("case_file", "The case file for a member, ticker, or district: what is joined to it and from which feeds.", obj({ kind: { type: "string", enum: ["member", "ticker", "district"] }, id: str("Bioguide, ticker, or district code such as TX-12") }, ["kind", "id"]), (db, a, call) => {
    const id = String(a.id || "").trim().slice(0, 40);
    return ["member", "ticker", "district"].includes(a.kind) && /^[A-Za-z0-9.\-]+$/.test(id) ? call(db, "intel.case", { kind: a.kind, id }) : bad("kind and id are required");
  }, "Case file"),
  tool("committee", "Committees and their members, or one committee's members, meetings, and hearings.", obj({ id: str("Committee id such as HSAS, optional") }), (db, a, call) => {
    const id = String(a.id || "").trim();
    return /^[A-Za-z0-9]+$/.test(id) ? call(db, "congress.committee", { id }) : call(db, "congress.committees");
  }, "Committee"),
  plain("hearings", "Upcoming and recent committee meetings and hearings.", "congress.calendar", "Hearings"),
  tool("bill", "One bill: sponsor, actions, and status.", obj({ id: str("Bill id such as hr5334-119") }, ["id"]), (db, a, call) => {
    const id = String(a.id || "").trim().toLowerCase();
    return /^[a-z]+\d+-\d+$/.test(id) ? call(db, "congress.bill", { rest: id }) : bad("id must look like hr5334-119");
  }, "Bill"),
  tool("bill_votes", "The roll calls held on a bill, with the vote split. Use votes or case_file for one roll call's party split.", obj({ id: str("Bill id such as hr5334-119") }, ["id"]), (db, a, call) => {
    const id = String(a.id || "").trim().toLowerCase();
    return /^[a-z]+\d+-\d+$/.test(id) ? call(db, "congress.billRolls", { id }) : bad("id must look like hr5334-119");
  }, "Bill votes"),
  tool("votes", "The most recent roll calls in one chamber.", obj({ chamber: { type: "string", enum: ["house", "senate"] } }), (db, a, call) => call(db, "congress.votes", {}, qs({ chamber: a.chamber === "senate" ? "senate" : "house" })), "Votes"),
  tool("contracts", "Federal contract actions from USAspending by action date. Filter by joined ticker, place (TX-12 or a state), or the member whose district it is. `window` says the days covered.", obj({ symbol: str("Ticker"), place: str("District or state"), member: str("Bioguide"), days: { type: "number", description: "Lookback, default 30" }, sort: { type: "string", enum: ["recent", "largest"] } }), async (db, a, call) => {
    const out = await call(db, "contracts.feed", {}, qs({
      symbol: symbolOf(a.symbol),
      place: String(a.place || "").trim().slice(0, 20),
      member: bioguideOf(a.member),
      days: Math.max(1, Math.min(365, Math.round(Number(a.days) || 30))),
      sort: a.sort === "largest" ? "largest" : "recent"
    }));
    return out?.window && typeof out.window === "object" ? { ...out, window: { ...out.window, basis: "action date" } } : out;
  }, "Contracts"),
  tool("corporate", "Lobbying, PAC receipts, contracts, or earnings for one joined ticker.", obj({ kind: { type: "string", enum: ["lobbying", "pac", "contracts", "earnings"] }, symbol: str("Ticker") }, ["kind", "symbol"]), (db, a, call) => {
    const s = symbolOf(a.symbol);
    return ["lobbying", "pac", "contracts", "earnings"].includes(a.kind) && s ? call(db, "corporate", { kind: a.kind, symbol: s }) : bad("kind and symbol are required");
  }, "Corporate"),
  tool("lobbying_client", "Lobbying disclosures for a client name, straight from the LDA search.", obj({ client: str("Client or company name") }, ["client"]), (db, a, call) => {
    const client = String(a.client || "").trim().slice(0, 80);
    return client ? call(db, "lobby", {}, qs({ client })) : bad("client is required");
  }, "Lobbying"),
  tool("pac_committee", "FEC committee and receipts search by name.", obj({ name: str("PAC or company name") }, ["name"]), (db, a, call) => {
    const name = String(a.name || "").trim().slice(0, 80);
    return name ? call(db, "fec", {}, qs({ name })) : bad("name is required");
  }, "PAC receipts"),
  tool("positions", "Congress, Form 4 insider, 13F, and short-interest positions. One ticker, or the board when omitted.", obj({ symbol: str("Ticker, optional") }), (db, a, call) => {
    const s = symbolOf(a.symbol);
    return s ? call(db, "markets.position", { symbol: s }) : call(db, "markets.positions");
  }, "Positions"),
  tool("insiders", "Form 4 insider transactions, newest filed first. With days (or from/to) it reads every Form 4 filed in that window from the SEC insider history (back to 2020) when that store is loaded; with no window, the latest eight Form 4s per join-table issuer. `window` says what the rows cover; `counts` count the whole window even when rows are cut.", obj(WINDOW_ARGS), async (db, a, call) => {
    const range = windowRange(a);
    const body = await call(db, "markets.insiders", {}, range ? qs(range) : "");
    return insiderCounts(windowItems(body, {
      days: a.days, from: a.from, to: a.to, key: "filed", basis: "Form 4 filing date", unit: "transactionLines",
      coverage: body?.history ? `every Form 4 filed in the window (${body.history.source}, complete ${body.history.coveredFrom} to ${body.history.coveredThrough}${body.truncated ? `; newest ${body.items.length} lines listed` : ""})` : "latest eight Form 4s per join-table issuer"
    }));
  }, "Insiders"),
  tool("congress_feed", "Congressional trade disclosures by filing date: newest filings, biggest, most-traded tickers, late filings. Default window is the last 7 days, widened to 14 or 30 when few members filed; days sets the starting window (up to 90). `window` says what was used.", obj({ days: { type: "number", description: "Starting window in days (default 7, up to 90). Pass N for a last-N-days question." } }), (db, a, call) => {
    const days = daysArg(a.days, 90);
    return call(db, "congress.feed", {}, days ? qs({ days }) : "");
  }, "Congress feed"),
  tool("congress_leaders", "Members ranked by their disclosed buys' return against SPY (equal-weighted, not a portfolio), plus most active traders, most-traded tickers, and late filers. With no window it covers every disclosure the app holds (back to 2025); days or from/to keep disclosures in that window, by disclosure (filed) date unless basis is traded. `window` says what was covered; `benchmarkComparison` is null with a reason when no buy has an SPY figure.", obj({
    ...WINDOW_ARGS,
    basis: { type: "string", enum: ["filed", "traded"], description: "Which date the window applies to: filed (disclosure date, default) or traded" }
  }), async (db, a, call) => {
    const days = daysArg(a.days, 730);
    const out = await call(db, "congress.leaders", {}, qs({
      days: days || "",
      from: ISO_DAY.test(String(a.from || "")) ? a.from : "",
      to: ISO_DAY.test(String(a.to || "")) ? a.to : "",
      basis: a.basis === "traded" ? "traded" : "",
      wait: 1
    }));
    return leadersForModel(out);
  }, "Leaders"),
  tool("market_snapshot", "How US markets are doing now: S&P 500, Nasdaq Composite, Dow, Russell 2000, VIX, benchmark and sector ETFs (last, change % from the previous close), and the 10-year and 2-year Treasury yields. Delayed Yahoo Finance quotes and FRED yields, each with as-of. Call it for any question about how the market, stocks overall, indices, volatility, or yields are doing today. Ends with a disclaimer sentence to quote.", obj({}), (db, _a, call) => runMarketSnapshot(db, call), "Markets"),
  tool("world_markets", "International stock indices from Yahoo Finance (delayed): last level, change % from the previous close, and whether each exchange is open now, with the last trade time in exchange time and ET. Regions: taiwan (TAIEX), japan (Nikkei 225), hongkong (Hang Seng), china (Shanghai, Shenzhen), korea (KOSPI), india (Nifty 50, Sensex), uk (FTSE 100), germany (DAX), france (CAC 40), europe (Euro Stoxx 50 + DAX, FTSE, CAC), australia (ASX 200), canada (TSX), brazil (Ibovespa), mexico (IPC), asia, global. symbols takes any Yahoo symbol the user names (e.g. 2330.TW); Yahoo says if it does not exist. Call it for any question about a non-US market.", obj({
    regions: { type: "array", items: { type: "string", enum: REGION_IDS }, description: "Regions to quote" },
    symbols: { type: "array", items: { type: "string" }, description: "Extra Yahoo symbols the user named, such as 2330.TW or 7203.T" }
  }), (_db, a) => runWorldMarkets(a), "World markets"),
  tool("web_search", "Search the public web (not a TradeSimple feed) for news and context the app's own tools do not hold: non-US markets, macro events, central banks, company news. Each result comes back with its own ref, URL, title and a text excerpt; cite the result's ref. Use TradeSimple tools first; at most 3 searches per question.", obj({ query: str("Search query, specific: names, places, dates") }, ["query"]), (_db, a) => runWebSearch(a), "Web search"),
  tool("web_fetch", "Read one public web page as plain text (scripts and markup stripped, first 6,000 characters), usually a URL from web_search. Not a TradeSimple feed. At most 3 pages per question.", obj({ url: str("http(s) URL") }, ["url"]), (_db, a) => runWebFetch(a), "Web page"),
  tool("alerts", "Late filings and anything on a watch list of tickers or members.", obj({ symbols: str("Comma-separated tickers"), members: str("Comma-separated bioguides"), late: { type: "string", enum: ["all", ""] } }), (db, a, call) => call(db, "alerts", {}, qs({
    symbols: String(a.symbols || "").slice(0, 200),
    members: String(a.members || "").slice(0, 200),
    late: a.late === "all" ? "all" : ""
  })), "Alerts"),
  tool("intel_scope", "Joins for one member or one ticker over the scrubber window: trades, contracts, PAC arcs.", obj({ member: str("Bioguide"), symbol: str("Ticker") }), (db, a, call) => call(db, "intel.scope", {}, qs({ member: bioguideOf(a.member), symbol: symbolOf(a.symbol) })), "Scope"),
  tool("run_backtest", "Replay public records as if acted on the day after they became public, against a benchmark. Returns return, excess, hit rate, drawdown, the biggest members and tickers, and every data caveat. One source per call; call it once per source for several. Takes 5 to 40 seconds the first time.", obj({ spec: SPEC_SCHEMA }, ["spec"]), async (db, a, call) => {
    if (!a.spec || typeof a.spec !== "object") return bad("spec is required");
    const out = await btSlot(() => call(db, "backtest", {}, qs({ spec: JSON.stringify(a.spec) })));
    return summarizeBacktest(out);
  }, "Backtest"),
  searchSignalsTool,
  tool("propose_theory", "Propose a link between two things as the user's own theory. Writes nothing: the user sees it and may accept it into their map. Not a filing and not evidence.", obj({
    a: endpoint,
    b: endpoint,
    aLabel: str("Label for a, such as Nancy Pelosi"),
    bLabel: str("Label for b, such as NVDA"),
    label: str("Short name of the theory"),
    note: str("Why the user might think so, citing refs"),
    confidence: { type: "string", enum: ["low", "medium", "high"] }
  }, ["a", "b", "label"]), (_db, a) => {
    const node = (id, label) => {
      const s = String(id || "").trim().slice(0, 160);
      return /^[a-z]+:[A-Za-z0-9.\-_]+$/.test(s) ? { id: s, type: s.split(":")[0], label: String(label || s).slice(0, 120) } : null;
    };
    const ea = node(a.a, a.aLabel);
    const eb = node(a.b, a.bLabel);
    if (!ea || !eb || ea.id === eb.id) return bad("a and b must be two different node ids such as member:P000197 and ticker:NVDA");
    return {
      ok: true,
      source: "Your proposal (not a filing)",
      asOf: "",
      latency: "Nothing is written until you press Accept.",
      theory: { a: ea, b: eb, label: String(a.label || "").slice(0, 80), note: String(a.note || "").slice(0, 280), confidence: ["low", "medium", "high"].includes(a.confidence) ? a.confidence : "medium" }
    };
  }, "Theory")
];

export const toolDefs = () => TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }));

/**
 * Run one tool. Never throws: a failure is a result with `ok: false` so the model can say what went wrong.
 * `onRoute(path)` hears each in-process route the tool calls, for the live step timeline.
 */
export async function runTool(db, name, args, call = callRoute, onRoute = null) {
  const found = TOOLS.find((t) => t.name === name);
  if (!found) return { ok: false, error: `No such tool ${name}.` };
  const traced = onRoute
    ? (d, id, params = {}, query = "") => {
        try { onRoute(`GET ${fillRoute(id, params, query)}`); } catch { /* a listener never breaks a tool */ }
        return call(d, id, params, query);
      }
    : call;
  try {
    return (await found.run(db, args && typeof args === "object" ? args : {}, traced)) ?? { ok: false, error: "Empty tool result." };
  } catch (err) {
    return { ok: false, error: err?.message || "Tool failed." };
  }
}

export const labelOf = (name, args = {}) => {
  const t = TOOLS.find((x) => x.name === name);
  const base = t?.label || name;
  const hint = args.symbol || args.id || args.q || args.client || args.name || args.place || (args.spec?.source ? args.spec.source : "");
  return hint ? `${base} · ${String(hint).slice(0, 40)}` : base;
};
