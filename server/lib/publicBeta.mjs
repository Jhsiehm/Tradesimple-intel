/**
 * Explicit, fail-closed anonymous access for a separately hosted public beta.
 * This does NOT provide multi-user accounts. Saved research, tasks, alerts,
 * notification settings, and server-side tools remain owner-only.
 *
 * INTEL_PUBLIC_BETA=on enables this only in production with owner auth.
 */
import crypto from "node:crypto";
import { MANIFEST } from "../routes/manifest.mjs";
import { compile } from "../router.mjs";
import { clientIp } from "./auth.mjs";
import { makeLimiter } from "../../shared/ask.mjs";

const READ_ROUTE_IDS = new Set([
  "health",
  "geo",
  "universe",
  "tickers",
  "ticker",
  "sites",
  "congress.bills",
  "congress.billRolls",
  "congress.billVote",
  "congress.bill",
  "congress.calendar",
  "congress.votes",
  "congress.vote",
  "congress.members",
  "congress.compare",
  "congress.roster",
  "congress.committees",
  "congress.committee",
  "congress.memberTrades",
  "congress.memberTimeline",
  "congress.member",
  "congress.leaders",
  "congress.feed",
  "lobby",
  "fec",
  "contracts",
  "contracts.feed",
  "contracts.board",
  "contracts.dod",
  "markets.politicians",
  "markets.insiders",
  "markets.whales",
  "markets.shorts",
  "markets.positions",
  "markets.position",
  "markets.globals",
  "markets.supply",
  "markets.supplyChain",
  "markets.board",
  "markets.chart",
  "markets.events",
  "news",
  "news.xpulse",
  "news.x",
  "fx.board",
  "crypto.board",
  "macro.strip",
  "macro.fomc",
  "calendar.macro",
  "calendar.earnings",
  "calendar.lobbying",
  "calendar.pacs",
  "weather.hazards",
  "weather.forecast",
  "air",
  "air.near",
  "air.route",
  "strait.news",
  "strait.ais",
  "strait.theaters",
  "earth.imagery",
  "earth.live",
  "earth.lanes",
  "corporate",
  "search",
]);

/** Public Ask is restricted to known public-feed tools and bounded backtests. */
export const PUBLIC_BETA_ASK_TOOLS = new Set([
  "search",
  "member_profile",
  "member_timeline",
  "ticker_dossier",
  "case_file",
  "committee",
  "hearings",
  "bill",
  "bill_votes",
  "votes",
  "contracts",
  "corporate",
  "lobbying_client",
  "pac_committee",
  "positions",
  "insiders",
  "congress_feed",
  "congress_leaders",
  "market_snapshot",
  "world_markets",
  "run_backtest",
  "news",
  "news_desk",
  "x_pulse",
  "x_posts",
  "world_calendar",
  "satellite",
  "shipping",
  "air_theater",
  "macro_strip",
  "strait_news",
  "strait_ships",
]);

const ROUTES = MANIFEST.map((route) => ({ id: route.id, match: compile(route.path) }));
export const publicBetaRouteId = (pathname) => ROUTES.find((route) => route.match(pathname))?.id || "";

/**
 * Only GET on explicitly public feed routes, GET /api/ask status,
 * GET /api/backtest options (without spec), and POST to Ask/backtest.
 * A default-deny method AND route check prevents accidentally exposing
 * new research APIs added to the manifest later.
 */
export function publicBetaPermission(req) {
  const method = String(req.method || "GET").toUpperCase();
  let url;
  try {
    url = new URL(req.url || "/", "http://beta.invalid");
  } catch {
    return { ok: false, status: 400, error: "Invalid request URL." };
  }
  const id = publicBetaRouteId(url.pathname);
  if (method === "GET" || method === "HEAD") {
    if (READ_ROUTE_IDS.has(id) || id === "ask") return { ok: true, id };
    if (id === "backtest" && !url.searchParams.has("spec")) return { ok: true, id };
  } else if (method === "POST" && (id === "ask" || id === "backtest")) {
    return { ok: true, id };
  }
  return {
    ok: false,
    status: 403,
    error:
      "This feature is not available in the public beta. Saved research and administrative actions require owner sign-in.",
  };
}

/** Conservative IP caps in addition to Ask's own limits and the monthly hard stop. */
export function createPublicBetaGate({ now = Date.now } = {}) {
  const reads = makeLimiter({ max: 120, windowMs: 60_000 });
  const globalWork = makeLimiter({ max: 120, windowMs: 10 * 60_000 });
  const secret = process.env.INTEL_PROXY_SECRET || "";
  const visitorOf = (req) => {
    const v = String(req.headers?.["x-intel-beta-visitor"] || "");
    const sig = String(req.headers?.["x-intel-beta-signature"] || "");
    if (secret.length < 32 || !/^[a-f0-9]{64}$/.test(v) || !/^[a-f0-9]{64}$/.test(sig)) return clientIp(req);
    const expected = crypto.createHmac("sha256", secret).update(v).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? v : clientIp(req);
  };
  const work = makeLimiter({ max: 8, windowMs: 10 * 60_000 });
  return (req) => {
    const access = publicBetaPermission(req);
    if (!access.ok) return access;
    const method = String(req.method || "GET").toUpperCase();
    const workRequest = method === "POST";
    const limiter = workRequest ? work : reads;
    const visitor = visitorOf(req);
    const slot = limiter.take(visitor, now());
    // Independently cap total expensive work, including through multiple visitors.
    const global = workRequest ? globalWork.take("all", now()) : { ok: true };
    if (workRequest && !global.ok) {
      return {
        ok: false,
        status: 429,
        error: "Public beta compute capacity reached. Please try again later.",
        retryAfterS: Math.max(1, Math.ceil(global.retryMs / 1000)),
      };
    }
    if (!slot.ok) {
      return {
        ok: false,
        status: 429,
        error: "Public beta traffic limit reached. Please try again later.",
        retryAfterS: Math.max(1, Math.ceil(slot.retryMs / 1000)),
      };
    }
    return { ok: true, id: access.id };
  };
}
