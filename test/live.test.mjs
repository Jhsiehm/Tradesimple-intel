import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { LIVE_CHECKS, checkOf, dedupeHeadlines, detectionLag, durationLabel, filingLagLabel, liveAlertRow, nextDelay, predatesWatch } from "../shared/live.mjs";
import { openDb } from "../server/lib/db.mjs";
import { createLivePoller, SEC_COOL_MS } from "../server/jobs/live.mjs";
import { FORM4_PER_PASS, makeChecks } from "../server/domain/live/checks.mjs";
import { SWEEP_MS } from "../server/domain/live/secFast.mjs";
import { liveAlerts, mergeLive } from "../server/domain/live/alerts.mjs";
import * as store from "../server/domain/live/store.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const T0 = Date.parse("2026-10-09T14:00:00Z");

function tempDb() {
  const file = path.join(os.tmpdir(), `live-test-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  const prev = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = file;
  const db = openDb(root);
  if (prev == null) delete process.env.INTEL_CACHE;
  else process.env.INTEL_CACHE = prev;
  return { db, file, cleanup: () => { for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true }); } };
}

const ev = (id, symbol, extra = {}) => ({ id, symbol, source: "news", feed: "Yahoo Finance headline RSS", title: id, publishedAt: new Date(T0 - 60_000).toISOString(), eventAt: "", lag: null, link: `https://example.com/${id}`, ...extra });

/** Checks whose answers the test sets per id; every call is recorded. */
function fakeChecks() {
  const answers = Object.fromEntries(LIVE_CHECKS.map((c) => [c.id, () => ({ events: [], ok: [], errors: [] })]));
  const calls = [];
  const checks = Object.fromEntries(LIVE_CHECKS.map((c) => [c.id, async (args) => { calls.push({ id: c.id, ...args, symbols: [...args.symbols] }); return answers[c.id](args); }]));
  return { checks, answers, calls };
}

test("latency math: filing lag, detection lag by publish precision, durations", () => {
  assert.equal(durationLabel(42_000), "42s");
  assert.equal(durationLabel(192_000), "3m 12s");
  assert.equal(durationLabel(4 * 3600_000 + 5 * 60_000), "4h 5m");
  assert.equal(durationLabel(51 * 3600_000), "2d 3h");
  const sec = detectionLag({ publishedAt: "2026-10-09T13:54:17.000Z" }, Date.parse("2026-10-09T13:57:29Z"));
  assert.equal(sec.precision, "time");
  assert.equal(sec.ms, 192_000);
  assert.match(sec.label, /3m 12s after it was published/);
  const house = detectionLag({ publishedAt: "2026-10-07" }, Date.parse("2026-10-09T15:00:00Z"));
  assert.equal(house.precision, "day");
  assert.equal(house.days, 2);
  assert.match(house.label, /date, not a time/);
  const contract = detectionLag({ publishedAt: "", eventAt: "2026-07-01" }, Date.parse("2026-10-09T15:00:00Z"));
  assert.equal(contract.precision, "none");
  assert.equal(contract.days, 100);
  assert.equal(detectionLag({ publishedAt: "2026-10-09T13:54:17Z" }, T0, true).precision, "backfill");
  assert.equal(filingLagLabel({ source: "congress", lag: 21 }), "filed 21d after the trade");
  assert.equal(filingLagLabel({ source: "whales", lag: 44 }), "filed 44d after quarter end");
  assert.equal(filingLagLabel({ source: "lobbying", lag: 18 }), "posted 18d after the period ended");
  assert.equal(filingLagLabel({ source: "lobbying", lag: 14, detail: "3rd Quarter - Report · Defense" }), "posted 14d after the period ended");
  assert.equal(filingLagLabel({ source: "lobbying", lag: 106, detail: "2nd Quarter - Amendment · Taxation/Internal Revenue Code" }), "", "a stored amendment row from before the fix");
  assert.equal(filingLagLabel({ source: "news", lag: null }), "");
});

test("backoff doubles from the interval to the cap and honours Retry-After", () => {
  const sec = checkOf("sec");
  assert.equal(nextDelay(sec, 0), sec.everyMs);
  assert.equal(nextDelay(sec, 1), 2 * sec.everyMs);
  assert.equal(nextDelay(sec, 2), 4 * sec.everyMs);
  assert.equal(nextDelay(sec, 9), sec.maxMs);
  assert.equal(nextDelay(sec, 0, 600_000), 600_000);
  assert.equal(nextDelay(sec, 1, 1000), 2 * sec.everyMs);
  for (const c of LIVE_CHECKS) assert.ok(c.everyMs >= 30_000 && c.maxMs > c.everyMs, c.id);
});

test("alert rows keep the feed id, map to Alerts kinds and carry severity and lags", () => {
  const trade = liveAlertRow({ id: "trade:h-1-0", symbol: "NVDA", source: "congress", feed: "Senate eFD PTR", title: "x", who: "Jane Roe", chamber: "senate", side: "buy", amount: 15001, amountLabel: "$15,001 - $50,000", eventAt: "2026-09-18", publishedAt: "2026-10-09", lag: 21 }, { detectedAt: Date.parse("2026-10-09T15:00:00Z"), seq: 7 });
  assert.equal(trade.id, "trade:h-1-0");
  assert.equal(trade.kind, "symbol-trade");
  assert.equal(trade.action, "pos:NVDA");
  assert.match(trade.title, /^Sen\. Jane Roe bought .*NVDA$/);
  assert.equal(trade.severity, "elevated");
  assert.equal(trade.live.seq, 7);
  assert.equal(trade.live.filingLagDays, 21);
  assert.equal(trade.live.precision, "day");
  assert.match(trade.detail, /filed 21d after the trade/);
  const f4 = liveAlertRow({ id: "f4:NVDA:1", symbol: "NVDA", source: "insiders", title: "CEO", amount: 1.5e6, buys: 1, publishedAt: "2026-10-09T20:56:28.000Z", eventAt: "2026-10-08", lag: 1 }, { detectedAt: Date.parse("2026-10-09T20:58:00Z") });
  assert.equal(f4.kind, "form4");
  assert.equal(f4.severity, "high");
  assert.equal(f4.live.detectionLagMs, 92_000);
  assert.equal(liveAlertRow({ id: "8k:1", symbol: "LMT", source: "filings", title: "8-K", items: ["1.03"] }).severity, "high");
  assert.equal(liveAlertRow({ id: "8k:2", symbol: "LMT", source: "filings", title: "8-K", items: ["7.01"] }).severity, "routine");
  assert.equal(liveAlertRow({ id: "contract:1", symbol: "LMT", source: "contracts", title: "DoD", amount: 2e7 }).severity, "elevated");
  assert.equal(liveAlertRow(ev("news:AAPL:1", "AAPL")).kind, "news");
  assert.equal(liveAlertRow(ev("news:AAPL:1", "AAPL")).severity, "routine");
  const keys = Object.keys(trade).sort().join(",");
  assert.equal(keys, "action,at,date,detail,id,kind,late,link,live,pins,severity,source,title");
});

test("headlines dedupe on their words and keep the earliest copy", () => {
  const out = dedupeHeadlines([
    { title: "Nvidia beats estimates!", published: "2026-10-09T14:00:00Z", link: "b" },
    { title: "NVIDIA beats estimates", published: "2026-10-09T13:00:00Z", link: "a" },
    { title: "Something else", published: "2026-10-09T12:00:00Z", link: "c" }
  ]);
  assert.deepEqual(out.map((x) => x.link).sort(), ["a", "c"]);
});

test("watchlist accepts data/tickers.json symbols only, keeps order, and backfill never pushes", async () => {
  const { db, cleanup } = tempDb();
  try {
    const f = fakeChecks();
    f.answers.news = ({ symbols }) => ({ events: symbols.map((s) => ev(`news:${s}:old`, s)), ok: symbols, errors: [] });
    const pushed = [];
    const poller = createLivePoller({ db, checks: f.checks, now: () => T0, log: () => {} });
    poller.bus.on("alert", (row) => pushed.push(row));
    const out = poller.setList(["nvda", "ZZZZQ", "LMT", "NVDA", "<script>"]);
    assert.deepEqual(out.symbols, ["NVDA", "LMT"]);
    assert.deepEqual(out.invalid, ["ZZZZQ", "<SCRIPT>"]);
    await poller.idle();
    assert.deepEqual(pushed, []);
    const stored = store.seenRows(db, {});
    assert.equal(stored.length, 2);
    assert.ok(stored.every((r) => r.backfill));
    assert.ok(f.calls.filter((c) => c.id === "news").every((c) => c.fresh === true));
    assert.ok(f.calls.filter((c) => c.id === "congress").every((c) => c.fresh === false), "backfill reads the congress cache");
    assert.deepEqual(poller.setList(["LMT", "NVDA"]).symbols, ["LMT", "NVDA"]);
    assert.deepEqual(poller.watched(), ["LMT", "NVDA"]);
  } finally {
    cleanup();
  }
});

test("new events push once; seen ids and backoff survive a restart", async () => {
  const { db, file, cleanup } = tempDb();
  try {
    let now = T0;
    const f = fakeChecks();
    let news = [ev("news:NVDA:a", "NVDA")];
    f.answers.news = ({ symbols }) => ({ events: news.filter((e) => symbols.includes(e.symbol)), ok: symbols, errors: [] });
    const pushed = [];
    const poller = createLivePoller({ db, checks: f.checks, now: () => now, log: () => {} });
    poller.bus.on("alert", (row) => pushed.push(row));
    poller.setList(["NVDA"]);
    await poller.idle();
    assert.equal(pushed.length, 0, "first pass is backfill");

    news = [ev("news:NVDA:a", "NVDA"), ev("news:NVDA:b", "NVDA")];
    now += 1000;
    await poller.run("news");
    assert.deepEqual(pushed.map((r) => r.id), ["news:NVDA:b"]);
    assert.equal(pushed[0].live.backfill, false);
    assert.equal(pushed[0].live.detectionLagMs, 61_000);
    await poller.run("news");
    assert.equal(pushed.length, 1, "a seen id is not pushed again");

    f.answers.sec = () => ({ events: [], ok: [], errors: [{ symbol: "NVDA", message: "HTTP 503", status: 503 }] });
    await poller.run("sec");
    const secState = poller.status().find((s) => s.id === "sec");
    assert.equal(secState.failures, 1);
    assert.equal(Date.parse(secState.nextAt) - now, 2 * checkOf("sec").everyMs);

    const db2 = new DatabaseSync(file);
    const pushed2 = [];
    const again = createLivePoller({ db: db2, checks: f.checks, now: () => now, log: () => {} });
    again.bus.on("alert", (row) => pushed2.push(row));
    assert.equal(again.status().find((s) => s.id === "sec").failures, 1, "failures restored");
    news = [ev("news:NVDA:a", "NVDA"), ev("news:NVDA:b", "NVDA"), ev("news:NVDA:c", "NVDA")];
    await again.run("news");
    assert.deepEqual(pushed2.map((r) => r.id), ["news:NVDA:c"]);
    assert.ok(again.start());
    assert.equal(Date.parse(again.status().find((s) => s.id === "sec").nextAt), Date.parse(secState.nextAt), "backoff kept across restart");
    again.stop();
    db2.close();
  } finally {
    cleanup();
  }
});

test("records public before the ticker was primed stay backfill when a later pass first reads them", async () => {
  assert.equal(predatesWatch({ publishedAt: "2026-09-25T02:30:07Z" }, T0, "time"), true);
  assert.equal(predatesWatch({ publishedAt: new Date(T0 - 30 * 60_000).toISOString() }, T0, "time"), false, "within the indexing slack");
  assert.equal(predatesWatch({ publishedAt: "2026-10-08" }, T0, "day"), false);
  assert.equal(predatesWatch({ publishedAt: "2026-10-01" }, T0, "day"), true);
  assert.equal(predatesWatch({ publishedAt: "", eventAt: "2026-01-01" }, T0, "none"), false, "no publish date: cannot tell");

  const { db, cleanup } = tempDb();
  try {
    let now = T0;
    const f = fakeChecks();
    const f4 = (acc, publishedAt) => ({ id: `f4:NVDA:${acc}`, symbol: "NVDA", source: "insiders", title: acc, publishedAt, eventAt: publishedAt.slice(0, 10), lag: 1 });
    let events = [f4("new1", new Date(T0 - 120_000).toISOString())];
    f.answers.sec = ({ symbols }) => ({ events: events.filter((e) => symbols.includes(e.symbol)), ok: symbols, errors: [] });
    const pushed = [];
    const poller = createLivePoller({ db, checks: f.checks, now: () => now, log: () => {} });
    poller.bus.on("alert", (row) => pushed.push(row));
    poller.setList(["NVDA"]);
    await poller.idle();
    now += 90_000;
    events = [...events, f4("older", "2026-09-04T02:30:44.000Z"), f4("fresh", new Date(now - 20_000).toISOString())];
    await poller.run("sec");
    assert.deepEqual(pushed.map((r) => r.id), ["f4:NVDA:fresh"]);
    assert.equal(store.seenRows(db, { ids: ["f4:NVDA:older"] })[0].backfill, true);
  } finally {
    cleanup();
  }
});

test("scheduling: each check runs on its interval, never twice at once, and backs off", async () => {
  const { db, cleanup } = tempDb();
  try {
    let now = T0;
    const f = fakeChecks();
    let release;
    let slow = false;
    for (const c of LIVE_CHECKS) f.answers[c.id] = ({ symbols }) => (slow && c.id === "sec" ? new Promise((r) => { release = () => r({ events: [], ok: symbols, errors: [] }); }) : { events: [], ok: symbols, errors: [] });
    const poller = createLivePoller({ db, checks: f.checks, now: () => now, log: () => {} });
    poller.setList(["NVDA"]);
    await poller.idle();
    f.calls.length = 0;
    for (const c of LIVE_CHECKS) poller.state.get(c.id).nextAt = now;
    poller.tick();
    await poller.idle();
    assert.deepEqual(f.calls.map((c) => c.id).sort(), LIVE_CHECKS.map((c) => c.id).sort());
    f.calls.length = 0;
    now += checkOf("sec").everyMs - 1000;
    poller.tick();
    await poller.idle();
    assert.deepEqual(f.calls.map((c) => c.id), [], "nothing due before the SEC interval");
    now += 1000;
    poller.tick();
    await poller.idle();
    assert.deepEqual(f.calls.map((c) => c.id), ["sec"]);
    now += 90_000;
    slow = true;
    f.calls.length = 0;
    poller.tick();
    poller.tick();
    now += 5000;
    poller.tick();
    await new Promise((r) => setImmediate(r));
    assert.equal(f.calls.filter((c) => c.id === "sec").length, 1, "a running check is not started again");
    release();
    await poller.idle();

    slow = false;
    f.answers.sec = () => ({ events: [], ok: [], errors: [{ symbol: "NVDA", message: "HTTP 403", status: 403 }] });
    await poller.run("sec");
    assert.equal(Date.parse(poller.status().find((s) => s.id === "sec").nextAt) - now, SEC_COOL_MS, "SEC rate-limit answer cools down 10 min");
    f.answers.news = () => ({ events: [], ok: [], errors: [{ symbol: "NVDA", message: "429", status: 429, retryAfterMs: 20 * 60_000 }] });
    await poller.run("news");
    assert.equal(Date.parse(poller.status().find((s) => s.id === "news").nextAt) - now, 20 * 60_000, "Retry-After honoured");
    f.answers.lobbying = () => ({ events: [], ok: [], errors: [], off: "LDA_API_KEY not set in .env.local" });
    await poller.run("lobbying");
    const lda = poller.status().find((s) => s.id === "lobbying");
    assert.equal(lda.off, "LDA_API_KEY not set in .env.local");
    assert.equal(lda.failures, 0);
  } finally {
    cleanup();
  }
});

test("SEC check: one submissions request per ticker per pass, Form 4 at acceptance time, seen ids not re-read", async () => {
  const { db, cleanup } = tempDb();
  try {
    const subsCalls = [];
    const form4Calls = [];
    const filed = new Date().toISOString().slice(0, 10);
    const forms = ["4", "4", "8-K", "SC 13G", "4", ...Array.from({ length: 14 }, () => "4")];
    const body = {
      filings: {
        recent: {
          form: forms,
          accessionNumber: forms.map((_, i) => `0000000000-26-${String(i).padStart(6, "0")}`),
          filingDate: forms.map(() => filed),
          acceptanceDateTime: forms.map(() => `${filed}T20:56:28.000Z`),
          primaryDocument: forms.map(() => "xslF345X05/doc.xml"),
          reportDate: forms.map(() => filed),
          items: forms.map((f) => (f === "8-K" ? "1.01,9.01" : ""))
        }
      }
    };
    const checks = makeChecks({
      submissions: async (cik) => { subsCalls.push(cik); return body; },
      storeSubs: () => {},
      readForm4: async (_db, cik, pick) => {
        form4Calls.push(`${cik}:${pick.accession}`);
        const other = pick.accession.endsWith("000001");
        return { owner: "Jane Doe", title: "CFO", issuerCik: other ? "999" : "0001045810", lines: [{ code: "P", shares: 100, price: 10, date: filed, owned: 100, plan: false }] };
      },
      seen: (_db, id) => id === "f4:NVDA:0000000000-26-000004"
    });
    const out = await checks.secSweep({ db, symbols: ["NVDA", "LMT"] });
    assert.deepEqual(subsCalls, ["0001045810", "0000936468"], "one request per ticker, through the SEC feed (8 req/s gate)");
    assert.ok(form4Calls.length <= FORM4_PER_PASS * 2);
    assert.ok(!form4Calls.includes("0001045810:0000000000-26-000004"), "seen Form 4 is not re-read");
    assert.ok(form4Calls.includes("0000936468:0000000000-26-000004"), "seen ids are per ticker");
    const nv = out.events.filter((e) => e.symbol === "NVDA");
    const f4 = nv.filter((e) => e.source === "insiders");
    assert.ok(f4.every((e) => e.publishedAt === `${filed}T20:56:28.000Z`));
    assert.ok(!f4.some((e) => e.id.endsWith("000001")), "a form filed as owner of another issuer is skipped");
    assert.equal(nv.filter((e) => e.source === "filings").length, 1);
    assert.equal(nv.filter((e) => e.source === "stakes").length, 1);
    assert.deepEqual(out.ok, ["NVDA", "LMT"]);
    const perSecond = 4 / (checkOf("sec").everyMs / 1000) + 40 / (SWEEP_MS / 1000);
    assert.ok(perSecond < 1, `4 Atom feeds per pass plus a 40-ticker sweep cost ${perSecond.toFixed(2)} SEC req/s against an 8 req/s gate`);
  } finally {
    cleanup();
  }
});

test("lobbying without a key is off, news dedupes within a pass", async () => {
  const { db, cleanup } = tempDb();
  try {
    const checks = makeChecks({
      env: {},
      headlines: async () => [
        { title: "Apple unveils thing", link: "https://a.example/1", published: new Date().toISOString() },
        { title: "APPLE unveils thing", link: "https://b.example/2", published: new Date(Date.now() - 60_000).toISOString() }
      ]
    });
    const lda = await checks.lobbying({ db, symbols: ["AAPL"] });
    assert.equal(lda.off, "LDA_API_KEY not set in .env.local");
    const news = await checks.news({ db, symbols: ["AAPL"] });
    assert.equal(news.events.length, 1);
    assert.equal(news.events[0].link, "https://b.example/2");
    assert.match(news.events[0].id, /^news:AAPL:/);
  } finally {
    cleanup();
  }
});

test("Alerts rows gain live lags; live-only detections are appended once", () => {
  const { db, cleanup } = tempDb();
  try {
    store.setSymbols(db, ["NVDA"], T0 - 1000);
    store.remember(db, ev("f4:NVDA:1", "NVDA", { source: "insiders" }), { detectedAt: T0, backfill: false });
    store.remember(db, ev("news:NVDA:z", "NVDA"), { detectedAt: T0, backfill: false });
    store.remember(db, ev("news:NVDA:old", "NVDA"), { detectedAt: T0, backfill: true });
    const live = liveAlerts(db, ["NVDA"], "2026-10-01");
    assert.deepEqual(live.map((r) => r.id).sort(), ["f4:NVDA:1", "news:NVDA:z"]);
    const { rows, extra } = mergeLive([{ id: "f4:NVDA:1", kind: "form4", date: "2026-10-09" }], live);
    assert.ok(rows[0].live.detectedAt);
    assert.deepEqual(extra.map((r) => r.id), ["news:NVDA:z"]);
    assert.deepEqual(store.freshCounts(db, ["NVDA"]), { NVDA: { insiders: 1, news: 1 } });
    store.markSeen(db, "NVDA", "news", T0 + 1);
    assert.deepEqual(store.freshCounts(db, ["NVDA"]), { NVDA: { insiders: 1 } });
  } finally {
    cleanup();
  }
});
