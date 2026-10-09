import { EventEmitter } from "node:events";
import { LIVE_CHECKS, checkOf, liveAlertRow, nextDelay, predatesWatch } from "../../shared/live.mjs";
import { cleanTickers } from "../../shared/watchlist.mjs";
import { nyDaysAgo } from "../../shared/dates.mjs";
import { listTickers } from "../lib/db.mjs";
import * as store from "../domain/live/store.mjs";
import { makeChecks } from "../domain/live/checks.mjs";

export const TICK_MS = 2000;
/** SEC answers 403 ("Request Rate Threshold Exceeded") or 429 when a client goes over fair access; back off 10 min. */
export const SEC_COOL_MS = 10 * 60 * 1000;

/** Off with LIVE_POLLER=off, under the test runner (INTEL_TEST=1) and with background jobs off (INTEL_NO_WARM). */
export const pollerOn = (env = process.env) => !["off", "0", "false"].includes(String(env.LIVE_POLLER || "").toLowerCase()) && env.INTEL_TEST !== "1" && !env.INTEL_NO_WARM;

/** The test hook that injects a fake event; on only with WATCH_SIMULATE=1. */
export const simulateOn = (env = process.env) => env.WATCH_SIMULATE === "1";

const iso = (ms) => (ms ? new Date(ms).toISOString() : "");

const SIM = {
  insiders: { title: "Jane Doe (CFO) · P · 1 open-market buy", detail: "12,000 sh · $1.4M · 1 line", amount: 1.4e6, buys: 1, side: "buy", lag: 2 },
  congress: { title: "Jane Doe bought $15,001 - $50,000", who: "Jane Doe", chamber: "senate", side: "buy", amount: 15001, amountLabel: "$15,001 - $50,000", lag: 21 },
  whales: { title: "Example Fund new position", change: "new", amount: 2.5e8, lag: 44 },
  filings: { title: "8-K · Material agreement", items: ["1.01"], lag: 1 },
  contracts: { title: "Department of Defense · $42.0M", amount: 4.2e7, lag: null },
  lobbying: { title: "Example Strategies LLC · $120K", amount: 1.2e5, lag: 18 },
  news: { title: "Example headline for the live pipeline test", lag: null },
  stakes: { title: "Example Capital · 13D · 5.2% of class", activist: true, lag: 9 }
};

/**
 * In-process poller. Each check (shared/live.mjs LIVE_CHECKS) runs on its own interval, never twice at once, with
 * exponential backoff after failures and an upstream Retry-After honoured. Every event id is stored the first time it
 * is seen; events from a (symbol, check) pair that has not finished a first pass are stored as backfill and not pushed,
 * so adding a ticker or restarting the server never pops old filings. Everything is injectable.
 */
export function createLivePoller({ db, checks = makeChecks(), now = Date.now, bus = new EventEmitter(), log = (m) => console.log(m) }) {
  bus.setMaxListeners(200);
  const stored = store.loadStatus(db);
  const state = new Map(LIVE_CHECKS.map((c) => {
    const s = stored.get(c.id) || {};
    return [c.id, { id: c.id, label: c.label, source: c.source, everyMs: c.everyMs, publishes: c.publishes, lastChecked: s.lastChecked || "", lastOk: s.lastOk || "", nextAt: Date.parse(s.nextAt || "") || 0, failures: s.failures || 0, lastError: s.lastError || "", ms: s.ms ?? null, note: s.note || "", off: s.off || "", running: false, symbols: s.symbols || 0, data: s.data || {} }];
  }));
  const chains = new Map();
  const queued = new Set();
  let timer = null;
  let known = null;

  const knownSet = () => (known ||= new Set(listTickers(db).map((t) => t.symbol)));

  /** The server list in the user's order, join-table tickers only. */
  const watched = () => cleanTickers(store.listSymbols(db), knownSet(), 100).valid;

  function view(s) {
    const { data, nextAt, ...rest } = s;
    return { ...rest, nextAt: iso(nextAt) };
  }

  const status = () => LIVE_CHECKS.map((c) => view(state.get(c.id)));
  const emitStatus = () => bus.emit("status", status());

  function save(s) {
    store.saveStatus(db, s.id, { ...view(s), data: s.data });
  }

  async function execute(id, only, fresh) {
    const check = checkOf(id);
    const s = state.get(id);
    const symbols = only || watched();
    if (!symbols.length) {
      if (!only) { s.nextAt = now() + check.everyMs; s.note = "No tickers on the watchlist."; save(s); }
      return { pushed: [], errors: [] };
    }
    const primed = store.primedAt(db, id);
    s.running = true;
    emitStatus();
    const t0 = now();
    let res;
    try {
      res = await checks[id]({ db, symbols, fresh, state: s.data || {}, backfill: Boolean(only) });
    } catch (err) {
      res = { events: [], ok: [], errors: [{ symbol: "", message: String(err?.message || err).slice(0, 200), status: err?.status || 0, retryAfterMs: err?.retryAfterMs || 0 }] };
    }
    s.running = false;
    const detectedAt = now();
    const want = new Set(symbols);
    const pushed = [];
    for (const ev of res.events || []) {
      if (!ev?.id || !want.has(ev.symbol)) continue;
      const backfill = !primed.has(ev.symbol) || predatesWatch(ev, primed.get(ev.symbol), check.precision);
      const seq = store.remember(db, ev, { detectedAt, backfill });
      if (seq && !backfill) pushed.push(liveAlertRow(ev, { detectedAt, backfill, seq }));
    }
    const okSymbols = (res.ok || []).filter((x) => want.has(x));
    store.prime(db, id, okSymbols, detectedAt);
    if (res.state) s.data = res.state;
    s.off = res.off || "";
    s.note = res.note || "";
    const errors = res.errors || [];
    if (!only) {
      const failed = errors.length > 0 && okSymbols.length === 0 && !s.off;
      s.lastChecked = iso(detectedAt);
      s.ms = detectedAt - t0;
      s.symbols = symbols.length;
      if (failed) {
        s.failures += 1;
        s.lastError = `${errors[0].symbol ? `${errors[0].symbol}: ` : ""}${errors[0].message}`;
      } else {
        s.failures = 0;
        if (!s.off) s.lastOk = iso(detectedAt);
        s.lastError = errors.length ? `${errors.length} of ${symbols.length} unreadable · ${errors[0].symbol ? `${errors[0].symbol}: ` : ""}${errors[0].message}` : "";
      }
      const cool = id === "sec" || id === "whales" ? (errors.some((e) => e.status === 403 || e.status === 429) ? SEC_COOL_MS : 0) : 0;
      const retryAfter = Math.max(cool, ...errors.map((e) => e.retryAfterMs || 0));
      s.nextAt = detectedAt + nextDelay(check, failed ? s.failures : 0, retryAfter);
    }
    save(s);
    emitStatus();
    for (const row of pushed.reverse()) bus.emit("alert", row);
    if (pushed.length) log(`live ${id}: ${pushed.length} new`);
    return { pushed, errors };
  }

  /** Queues one run of a check after any run already in flight. `only` limits it to those symbols (a backfill). */
  function run(id, { only = null, fresh = true } = {}) {
    const prev = chains.get(id) || Promise.resolve();
    const job = prev.then(() => execute(id, only, fresh));
    chains.set(id, job.catch(() => {}));
    return job;
  }

  function tick() {
    const t = now();
    for (const c of LIVE_CHECKS) {
      const s = state.get(c.id);
      if (queued.has(c.id) || t < s.nextAt) continue;
      queued.add(c.id);
      run(c.id).catch((err) => log(`live ${c.id}: ${err.message}`)).finally(() => queued.delete(c.id));
    }
  }

  /** First pass for new tickers: everything found is stored as already seen. Costly checks read caches only. */
  function backfill(symbols) {
    return Promise.all(LIVE_CHECKS.map((c) => run(c.id, { only: symbols, fresh: c.id !== "congress" && c.id !== "whales" }).catch(() => null)));
  }

  /** Replaces the watched list (validated against data/tickers.json); new tickers are backfilled without pushes. */
  function setList(raw) {
    const { valid, invalid } = cleanTickers(raw, knownSet());
    const { added, removed } = store.setSymbols(db, valid, now());
    if (added.length) void backfill(added);
    bus.emit("list", { symbols: valid });
    return { symbols: valid, invalid, added, removed };
  }

  /** Test hook: one fake event that goes through the same store and push path, labelled as simulated. */
  function simulate(symbol, source = "insiders") {
    const base = SIM[source] || SIM.insiders;
    const t = now();
    const ev = {
      ...base,
      id: `sim:${source}:${symbol}:${t}`,
      symbol,
      source: SIM[source] ? source : "insiders",
      feed: "Simulated event (WATCH_SIMULATE=1 test hook, not a real filing)",
      detail: `${base.detail ? `${base.detail} · ` : ""}injected to test the live pipeline`,
      eventAt: base.lag != null ? nyDaysAgo(base.lag) : nyDaysAgo(0),
      publishedAt: iso(t - 37_000),
      late: false,
      link: "",
      simulated: true
    };
    const detectedAt = t;
    const seq = store.remember(db, ev, { detectedAt, backfill: false });
    const row = liveAlertRow(ev, { detectedAt, backfill: false, seq });
    bus.emit("alert", row);
    return row;
  }

  function start() {
    if (timer) return false;
    const t = now();
    LIVE_CHECKS.forEach((c, i) => {
      const s = state.get(c.id);
      if (!(s.nextAt > t && s.nextAt - t <= c.maxMs)) s.nextAt = t + 2000 + i * 3000;
    });
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
    return true;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  const idle = () => Promise.all([...chains.values()]);

  return { bus, status, watched, setList, backfill, run, tick, start, stop, idle, simulate, state };
}

const pollers = new WeakMap();

/** The poller for this database, created on first use (routes and boot share it). */
export function livePoller(db, opts = {}) {
  if (!pollers.has(db)) pollers.set(db, createLivePoller({ db, ...opts }));
  return pollers.get(db);
}

export function startLive(db, env = process.env) {
  const poller = livePoller(db);
  if (!pollerOn(env)) return false;
  poller.start();
  console.log(`live poller: ${poller.watched().length} tickers · ${LIVE_CHECKS.map((c) => `${c.id} ${Math.round(c.everyMs / 1000)}s`).join(" · ")}`);
  return true;
}
