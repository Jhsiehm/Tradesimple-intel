import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { buildMessage, envSettings, inQuiet, maskTopic, mergeSettings, parseQuiet, publicSettings, shouldNotify, topicFrom } from "../shared/notify.mjs";
import { createNotifier, startNotify } from "../server/domain/notify/index.mjs";
import { openDb } from "../server/lib/db.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-09T14:30:00Z"); // 10:30 ET
const TOPIC = "tsi-k3v9qz7m2w8r5t1x6c4b0n";

function tempDb() {
  const file = path.join(os.tmpdir(), `ntfy-test-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
  const prev = process.env.INTEL_CACHE;
  process.env.INTEL_CACHE = file;
  const db = openDb(root);
  if (prev == null) delete process.env.INTEL_CACHE;
  else process.env.INTEL_CACHE = prev;
  return { db, cleanup: () => { for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true }); } };
}

/** A fake ntfy server that records every publish; `status` sets the next answers. */
async function fakeNtfy() {
  const got = [];
  const state = { status: 200 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push({ method: req.method, url: req.url, auth: req.headers.authorization || "", type: req.headers["content-type"], body: JSON.parse(body || "{}") });
      res.writeHead(state.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.status === 200 ? { id: `m${got.length}`, event: "message" } : { error: "nope" }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { got, state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

const row = (id, extra = {}) => ({
  id,
  kind: "form4",
  date: "2026-10-09",
  title: "Form 4 · NVDA · Jane Doe (CFO) · P · 1 open-market buy",
  severity: "elevated",
  source: "SEC EDGAR Form 4",
  link: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/0001045810-26-000001-index.htm",
  pins: [{ kind: "symbol", id: "NVDA", label: "NVDA" }],
  live: { symbol: "NVDA", eventAt: "2026-10-08", publishedAt: "2026-10-09T14:20:00Z", detection: "detected 41s after it was published", backfill: false },
  ...extra
});

test("settings from env: defaults, quiet hours, click URL from the hosted origin", () => {
  const s = envSettings({ NTFY_TOPIC: TOPIC, NTFY_QUIET: "22:00-07:00", PUBLIC_ORIGIN: "https://intel.example.com/", PUBLIC_URL: "https://demo.example.com" });
  assert.equal(s.server, "https://ntfy.sh");
  assert.equal(s.minSeverity, "elevated");
  assert.deepEqual(s.quiet, { start: 1320, end: 420 });
  assert.equal(s.clickUrl, "https://intel.example.com");
  assert.ok(s.kinds.includes("form4") && !s.kinds.includes("news"));
  assert.equal(envSettings({}).clickUrl, "");
  assert.equal(envSettings({ NTFY_MIN_SEVERITY: "bogus" }).minSeverity, "elevated");
  assert.equal(parseQuiet("25:00-07:00"), null);
  assert.equal(parseQuiet(""), null);
});

test("the browser view never holds the topic or the token", () => {
  const s = mergeSettings(envSettings({ NTFY_TOPIC: TOPIC, NTFY_TOKEN: "tk_secret" }), {});
  const pub = publicSettings(s);
  const text = JSON.stringify(pub);
  assert.ok(!text.includes(TOPIC));
  assert.ok(!text.includes("tk_secret"));
  assert.equal(pub.topic, "tsi-…0n");
  assert.equal(pub.token, true);
  assert.equal(maskTopic("short"), "••••••");
  assert.match(topicFrom(new Uint8Array(24).map((_, i) => i * 7)), /^tsi-[a-z0-9]{24}$/);
});

test("which rows qualify: severity floor, kind toggles, quiet hours in New York time", () => {
  const s = mergeSettings(envSettings({ NTFY_TOPIC: TOPIC, NTFY_QUIET: "22:00-07:00" }), {});
  assert.equal(shouldNotify(row("a"), s, NOW).send, true);
  assert.equal(shouldNotify(row("b", { severity: "routine" }), s, NOW).why, "below elevated");
  assert.equal(shouldNotify(row("c", { kind: "news" }), s, NOW).why, "news is switched off");
  assert.equal(shouldNotify(row("d", { live: { backfill: true } }), s, NOW).why, "backfill");
  const night = Date.parse("2026-10-09T03:30:00Z"); // 23:30 ET
  assert.equal(inQuiet(night, s.quiet), true);
  assert.equal(inQuiet(NOW, s.quiet), false);
  assert.equal(shouldNotify(row("e"), s, night).why, "quiet hours");
  assert.equal(shouldNotify(row("f", { severity: "high" }), s, night).send, true, "HIGH passes quiet hours by default");
  assert.equal(shouldNotify(row("g", { severity: "high" }), mergeSettings(s, { quietHigh: false }), night).why, "quiet hours");
  assert.equal(shouldNotify(row("h"), mergeSettings(s, { enabled: false }), NOW).why, "phone notifications are off");
  assert.equal(shouldNotify(row("i"), mergeSettings(envSettings({}), { enabled: true }), NOW).why, "no NTFY_TOPIC");
});

test("message: ticker, who/what, traded and filed ages, latency, priority, tags, click", () => {
  const m = buildMessage(row("a"), { clickUrl: "https://intel.example.com", now: NOW });
  assert.equal(m.title, "ELEVATED · NVDA · Form 4");
  assert.match(m.message, /Jane Doe \(CFO\)/);
  assert.match(m.message, /filed 10m ago · traded yesterday · 1d filing lag/);
  assert.match(m.message, /detected 41s after it was published/);
  assert.match(m.message, /Source: SEC EDGAR Form 4/);
  assert.equal(m.priority, 3);
  assert.deepEqual(m.tags, ["warning", "nvda"]);
  assert.equal(m.click, "https://intel.example.com/");
  assert.equal(m.actions[0].url, row("a").link);
  assert.equal(buildMessage(row("b", { severity: "high" }), { now: NOW }).priority, 4);
  assert.equal(buildMessage(row("c"), { now: NOW }).click, "", "no click link without a hosted URL");
});

test("notifier: posts to the fake ntfy server once per alert, across restarts", async () => {
  const fake = await fakeNtfy();
  const { db, cleanup } = tempDb();
  try {
    const env = { NTFY_TOPIC: TOPIC, NTFY_SERVER: fake.url, NTFY_TOKEN: "tk_secret" };
    const n = createNotifier(db, { env, now: () => NOW, log: () => {} });
    assert.deepEqual(await n.handle(row("f4:NVDA:1")), { sent: true, why: "" });
    assert.equal(fake.got.length, 1);
    const req = fake.got[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/");
    assert.equal(req.auth, "Bearer tk_secret");
    assert.equal(req.body.topic, TOPIC);
    assert.equal(req.body.title, "ELEVATED · NVDA · Form 4");
    assert.equal(req.body.priority, 3);
    assert.equal((await n.handle(row("f4:NVDA:1"))).why, "already sent");
    const again = createNotifier(db, { env, now: () => NOW + 60_000, log: () => {} });
    assert.equal((await again.handle(row("f4:NVDA:1"))).why, "already sent", "sent ids persist in sqlite");
    assert.equal((await again.handle(row("x", { severity: "routine" }))).sent, false);
    assert.equal(fake.got.length, 1);
    assert.ok(again.sentIds().has("f4:NVDA:1"));
  } finally {
    cleanup();
    await fake.close();
  }
});

test("notifier: hourly limit holds the rest and the next message says how many", async () => {
  const fake = await fakeNtfy();
  const { db, cleanup } = tempDb();
  try {
    let t = NOW;
    const n = createNotifier(db, { env: { NTFY_TOPIC: TOPIC, NTFY_SERVER: fake.url, NTFY_MAX_PER_HOUR: "2" }, now: () => t, log: () => {} });
    const results = await Promise.all(["a", "b", "c", "d"].map((id) => n.handle(row(id))));
    assert.deepEqual(results.map((r) => r.sent), [true, true, false, false]);
    assert.equal(results[2].why, "hourly limit");
    assert.equal(n.view().held, 2);
    t += 61 * 60_000;
    assert.equal((await n.handle(row("e"))).sent, true);
    assert.match(fake.got[2].body.message, /\+2 more alerts held by the hourly limit/);
    assert.equal((await n.handle(row("c"))).why, "already sent", "a held alert is never sent later");
  } finally {
    cleanup();
    await fake.close();
  }
});

test("notifier: a failing server marks the alert failed; settings save; test message; bus hook", async () => {
  const fake = await fakeNtfy();
  const { db, cleanup } = tempDb();
  try {
    let t = NOW;
    const env = { NTFY_TOPIC: TOPIC, NTFY_SERVER: fake.url };
    const n = createNotifier(db, { env, now: () => t, log: () => {} });
    fake.state.status = 500;
    assert.match((await n.handle(row("bad"))).why, /HTTP 500/);
    assert.equal(n.view().recent[0].status, "failed");
    fake.state.status = 200;

    const saved = n.save({ enabled: true, minSeverity: "high", kinds: ["form4", "nope"], quiet: "21:30-06:00" });
    assert.equal(saved.settings.minSeverity, "high");
    assert.deepEqual(saved.settings.kinds, ["form4"]);
    assert.equal(saved.settings.quiet, "21:30-06:00");
    assert.equal((await n.handle(row("mid"))).why, "below high");

    const r = await n.test();
    assert.equal(r.ok, true);
    assert.equal(fake.got.at(-1).body.title, "TradeSimple Intel · test");
    assert.equal((await n.test()).status, 429, "one test per 10 s");
    assert.ok(!JSON.stringify(n.view()).includes(TOPIC));

    const off = createNotifier(db, { env: {}, now: () => t, log: () => {} });
    assert.equal((await off.test()).status, 409);

    t += 20_000;
    const bus = new EventEmitter();
    const stop = startNotify(db, bus, { env, now: () => t, log: () => {} });
    const before = fake.got.length;
    bus.emit("alert", row("bus-1", { severity: "high" }));
    await new Promise((res) => setTimeout(res, 100));
    assert.equal(fake.got.length, before + 1);
    stop();
  } finally {
    cleanup();
    await fake.close();
  }
});
