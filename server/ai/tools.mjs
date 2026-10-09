/**
 * Read-only tools for Ask. Each wraps a route handler or the backtest runner in process, so the model sees exactly
 * what the app's own boards see, with the same source, asOf, and latency. Nothing here writes, orders, or fetches.
 * Web tools (web_search / web_fetch) are only offered when sourcing is `web` or `both`.
 */
import { SOURCES, SECTOR_ETF, BENCHMARKS } from "../../shared/backtestSpec.mjs";
import { toolsForSourcing } from "../../shared/askModes.mjs";
import { handlers as system } from "../routes/system.mjs";
import { handlers as congress } from "../routes/congress.mjs";
import { handlers as markets } from "../routes/markets.mjs";
import { handlers as corporate } from "../routes/corporate.mjs";
import { handlers as world } from "../routes/world.mjs";
import { handlers as relations } from "../routes/relations.mjs";
import { handlers as backtest } from "../routes/backtest.mjs";
import { fillRoute } from "../routes/manifest.mjs";
import { queryOf } from "../router.mjs";
import { summarizeNews, summarizeSatellite, webFetch, webSearch } from "./web.mjs";

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

/** The compact answer a backtest gives a model: stats, the biggest names, every warning, each feed's label. */
export function summarizeBacktest(out) {
  if (!out || out.ok === false) return out;
  const warn = (out.caveats?.items || []).filter((c) => c.level === "warn").map((c) => c.text);
  const info = (out.caveats?.items || []).filter((c) => c.level !== "warn").map((c) => c.text);
  const s = out.stats || {};
  return {
    ok: true,
    description: out.description,
    spec: out.spec,
    counts: out.counts,
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
    cache: out.cache
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
  tool("contracts", "Federal contract actions from USAspending. Filter by joined ticker, place (TX-12 or a state), or the member whose district it is.", obj({ symbol: str("Ticker"), place: str("District or state"), member: str("Bioguide"), days: { type: "number", description: "Lookback, default 30" }, sort: { type: "string", enum: ["recent", "largest"] } }), (db, a, call) => call(db, "contracts.feed", {}, qs({
    symbol: symbolOf(a.symbol),
    place: String(a.place || "").trim().slice(0, 20),
    member: bioguideOf(a.member),
    days: Math.max(1, Math.min(365, Math.round(Number(a.days) || 30))),
    sort: a.sort === "largest" ? "largest" : "recent"
  })), "Contracts"),
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
  plain("insiders", "Recent Form 4 insider transactions.", "markets.insiders", "Insiders"),
  plain("congress_feed", "This week's congressional trade disclosures: newest filings, late filings, biggest, most-traded tickers.", "congress.feed", "Congress feed"),
  plain("congress_leaders", "Disclosed buys ranked against SPY. Equal-weighted, not a portfolio.", "congress.leaders", "Leaders"),
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
  }, "Theory"),

  /* ---------- news, X, world, satellite (platform feeds) ---------- */
  tool("news", "Latest headlines from the terminal's ~45 RSS wires (every region). Optional keyword filter. Publisher stamps, not TradeSimple invention.", obj({ q: str("Keyword in title/summary, optional"), limit: { type: "number", description: "Max headlines, default 12" } }), async (db, a, call) => {
    const wire = await call(db, "news");
    return summarizeNews(wire, { q: a.q, limit: Math.max(3, Math.min(20, Math.round(Number(a.limit) || 12))) });
  }, "News"),
  tool("news_desk", "Headlines from one desk or region on the RSS board (markets, politics, world, tech, x, or a region id).", obj({ desk: str("Desk or region id such as markets, world, china") }, ["desk"]), async (db, a, call) => {
    const desk = String(a.desk || "").trim().slice(0, 40);
    if (!desk) return bad("desk is required");
    const wire = await call(db, "news");
    return summarizeNews(wire, { desk, limit: 12 });
  }, "News desk"),
  tool("x_pulse", "X / Twitter pulse: US and world trending topics (hourly) plus posts from curated market accounts (X API when keyed, else Bluesky/Truth Social fallback).", obj({}), async (db, _a, call) => call(db, "news.xpulse"), "X pulse"),
  tool("x_posts", "Recent posts from the curated X / social column (same accounts as the News X board).", obj({}), async (db, _a, call) => call(db, "news.x"), "X posts"),
  tool("world_calendar", "Upcoming and recent macro releases (CPI, FOMC, jobs) and calendar strip context.", obj({ back: { type: "number" }, ahead: { type: "number" } }), (db, a, call) => call(db, "calendar.macro", {}, qs({
    back: Math.max(0, Math.min(30, Math.round(Number(a.back) || 0))),
    ahead: Math.max(1, Math.min(45, Math.round(Number(a.ahead) || 14)))
  })), "World calendar"),
  plain("macro_strip", "Macro strip: next CPI, FOMC, jobs and related markers the terminal shows.", "macro.strip", "Macro"),
  tool("satellite", "Parse live satellite imagery status: GOES-East/West, Himawari, VIIRS daily — latest frame times, coverage gaps, basemap as-of. No pixel data; metadata only.", obj({}), async (db, _a, call) => {
    const [live, imagery] = await Promise.all([call(db, "earth.live"), call(db, "earth.imagery")]);
    return summarizeSatellite(live, imagery);
  }, "Satellite"),
  tool("shipping", "Reference shipping lanes and chokepoints (not live AIS). Source and as-of on the feed.", obj({}), async (db, _a, call) => {
    const lanes = await call(db, "earth.lanes");
    const points = (lanes?.chokepoints?.features || []).map((f) => ({ name: f.properties?.name, lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }));
    return { ok: Boolean(lanes?.ok), source: lanes?.source, asOf: lanes?.asOf, latency: lanes?.latency || lanes?.license || "", chokepoints: points, laneCount: lanes?.lanes?.features?.length || 0, note: "Reference chart routes, not live traffic." };
  }, "Shipping"),
  plain("strait_news", "Taiwan Strait / theater news headlines the Strait board shows.", "strait.news", "Strait news"),
  plain("strait_ships", "Taiwan Strait AIS ship snapshot (needs AISSTREAM_API_KEY for live positions).", "strait.ais", "Strait ships"),
  tool("air_theater", "Live civil/military aircraft for a theater id (or default). Volunteer ADS-B; many military flights stay dark.", obj({ theater: str("Theater id from strait theaters, optional") }), (db, a, call) => call(db, "air", {}, qs({ theater: String(a.theater || "").trim().slice(0, 40) })), "Air"),

  /* ---------- open web (only when sourcing is web or both) ---------- */
  tool("web_search", "Search the open web. Returns titles, URLs, snippets. Prefer Brave when BRAVE_SEARCH_API_KEY is set; otherwise DuckDuckGo HTML. Not a TradeSimple filing.", obj({ q: str("Search query") }, ["q"]), async (db, a) => {
    const q = String(a.q || "").trim().slice(0, 200);
    return q ? webSearch(db, q) : bad("q is required");
  }, "Web search"),
  tool("web_fetch", "Fetch one public http(s) page and return stripped text to cite. Blocks localhost and private IPs.", obj({ url: str("https URL") }, ["url"]), async (db, a) => webFetch(db, a.url), "Web page")
];

/** Tool defs the model may see for a sourcing mode (platform / both / web). */
export const toolDefs = (sourcing = "platform") => {
  const allow = toolsForSourcing(sourcing);
  return TOOLS.filter((t) => allow.has(t.name)).map(({ name, description, parameters }) => ({ name, description, parameters }));
};

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
  const hint = args.symbol || args.id || args.q || args.client || args.name || args.place || args.desk || args.url || args.theater || (args.spec?.source ? args.spec.source : "");
  return hint ? `${base} · ${String(hint).slice(0, 40)}` : base;
};
