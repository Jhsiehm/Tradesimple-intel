import { reply } from "../router.mjs";
import { readJson } from "../lib/body.mjs";
import { LIVE_CHECKS, liveAlertRow } from "../../shared/live.mjs";
import { WATCH_SOURCES, normSymbol } from "../../shared/watchlist.mjs";
import * as store from "../domain/live/store.mjs";
import { livePoller, pollerOn, simulateOn } from "../jobs/live.mjs";

const bad = (status, error) => reply(status, { ok: false, error, missing: "" });
const method = (req) => String(req?.method || "GET").toUpperCase();
const SOURCES = new Set(WATCH_SOURCES.map((s) => s.key));
/** Pushes a reconnecting stream replays: missed in the last 30 minutes, at most 20. */
const REPLAY_MS = 30 * 60 * 1000;
/** A named event, not an SSE comment: the browser must see it to notice a proxy that kept a dead stream open. */
const PING_MS = 15_000;

async function body(req) {
  const b = await readJson(req, 16 * 1024);
  return b.ok ? { ok: true, value: b.value } : { ok: false, res: bad(b.status, b.error) };
}

const rowOf = (r) => liveAlertRow(r.ev, { detectedAt: r.detectedAt, backfill: r.backfill, seq: r.seq });
const listParam = (v) => String(v || "").split(",").map(normSymbol).filter(Boolean);

function overview(db) {
  const poller = livePoller(db);
  const symbols = poller.watched();
  return {
    ok: true,
    asOf: new Date().toISOString(),
    poller: pollerOn() ? "on" : "off",
    symbols,
    checks: poller.status(),
    fresh: store.freshCounts(db, symbols)
  };
}

export const handlers = {
  /** GET: watched tickers, per-check status, new-since-seen counts. PUT { symbols }: replace the server's list. */
  live: async ({ db, req }) => {
    if (method(req) === "GET") return overview(db);
    if (method(req) !== "PUT") return bad(405, "Use GET or PUT.");
    const b = await body(req);
    if (!b.ok) return b.res;
    if (!Array.isArray(b.value.symbols)) return bad(400, "Body must be { symbols: [\"NVDA\", …] }.");
    const out = livePoller(db).setList(b.value.symbols);
    return { ...overview(db), invalid: out.invalid, added: out.added, removed: out.removed };
  },

  /** Detections with event, published and detected times and both lags. `?symbols=` `&ids=` `&live=1` `&after=seq`. */
  "live.events": ({ db, query }) => {
    const symbols = query.params.has("symbols") ? listParam(query.str("symbols")) : livePoller(db).watched();
    const ids = query.params.has("ids") ? query.str("ids").split(",").filter(Boolean).slice(0, 500) : null;
    const limit = Math.min(500, Math.max(1, Number(query.str("limit", "200")) || 200));
    const rows = store.seenRows(db, { symbols, ids, live: query.str("live") === "1", after: Number(query.str("after", "0")) || 0, limit });
    return { ok: true, asOf: new Date().toISOString(), items: rows.map(rowOf) };
  },

  /** POST { symbol, source? }: the user looked at this ticker (or one source of it); its new-since-seen count resets. */
  "live.seen": async ({ db, req }) => {
    if (method(req) !== "POST") return bad(405, "Use POST.");
    const b = await body(req);
    if (!b.ok) return b.res;
    const symbol = normSymbol(b.value.symbol);
    const source = String(b.value.source || "");
    if (!livePoller(db).watched().includes(symbol)) return bad(404, `${symbol || "That ticker"} is not on the watchlist.`);
    if (source && !SOURCES.has(source)) return bad(400, `Unknown source ${source.slice(0, 20)}.`);
    store.markSeen(db, symbol, source);
    return { ok: true, fresh: store.freshCounts(db, [symbol]) };
  },

  /** Server-Sent Events: `hello`, then `alert` (id = push sequence), `status`, `list` and `ping`. Reconnects replay missed alerts. */
  "live.stream": ({ db, req, res, url }) => {
    if (!String(req.headers.accept || "").includes("text/event-stream")) return bad(406, "This is an event stream; open it with EventSource (Accept: text/event-stream).");
    const poller = livePoller(db);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (event, data, id = 0) => res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write("retry: 3000\n\n");
    send("hello", { at: new Date().toISOString(), poller: pollerOn() ? "on" : "off", symbols: poller.watched(), checks: poller.status(), intervals: LIVE_CHECKS.map((c) => ({ id: c.id, everyMs: c.everyMs })) });
    const after = Number(req.headers["last-event-id"] || url.searchParams.get("after") || 0);
    if (after > 0) {
      const missed = store.seenRows(db, { after, live: true, since: Date.now() - REPLAY_MS, symbols: poller.watched(), limit: 20 });
      for (const r of missed.reverse()) send("alert", { ...rowOf(r), replay: true }, r.seq);
    }
    const onAlert = (row) => send("alert", row, row.live?.seq || 0);
    const onStatus = (checks) => send("status", { checks });
    const onList = (list) => send("list", list);
    poller.bus.on("alert", onAlert);
    poller.bus.on("status", onStatus);
    poller.bus.on("list", onList);
    const ping = setInterval(() => send("ping", { at: new Date().toISOString() }), PING_MS);
    ping.unref?.();
    req.on("close", () => {
      clearInterval(ping);
      poller.bus.off("alert", onAlert);
      poller.bus.off("status", onStatus);
      poller.bus.off("list", onList);
    });
    return undefined;
  },

  /** POST { symbol, source }: inject one labelled fake detection (WATCH_SIMULATE=1 only). */
  "live.simulate": async ({ db, req }) => {
    if (!simulateOn()) return bad(404, "The simulate hook is off. Start the API with WATCH_SIMULATE=1 to test pushes.");
    if (method(req) !== "POST") return bad(405, "Use POST.");
    const b = await body(req);
    if (!b.ok) return b.res;
    const symbol = normSymbol(b.value.symbol);
    if (!livePoller(db).watched().includes(symbol)) return bad(404, `${symbol || "That ticker"} is not on the watchlist.`);
    const source = SOURCES.has(String(b.value.source)) ? String(b.value.source) : "insiders";
    return reply(201, { ok: true, item: livePoller(db).simulate(symbol, source) });
  }
};
