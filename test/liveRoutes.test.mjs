import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter } from "../server/router.mjs";
import { MANIFEST, handlers } from "../server/routes/index.mjs";
import { openDb } from "../server/lib/db.mjs";
import { LIVE_CHECKS } from "../shared/live.mjs";
import { livePoller } from "../server/jobs/live.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "http://127.0.0.1:5173";
const file = path.join(os.tmpdir(), `live-routes-${process.pid}.sqlite`);
let db;
let server;
let base;

before(async () => {
  process.env.INTEL_CACHE = file;
  db = openDb(root);
  delete process.env.INTEL_CACHE;
  const checks = Object.fromEntries(LIVE_CHECKS.map((c) => [c.id, async ({ symbols }) => ({ events: [], ok: symbols, errors: [] })]));
  livePoller(db, { checks, log: () => {} });
  const routes = createRouter(MANIFEST, handlers);
  server = http.createServer((req, res) => routes.handle(req, res, { db, root }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
  delete process.env.WATCH_SIMULATE;
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
});

const send = (method, p, body, headers = {}) =>
  fetch(base + p, { method, headers: { origin: APP, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: (r.headers.get("content-type") || "").includes("json") ? await r.json() : await r.text() }));

/** Reads SSE frames until `stop(frames)` is true or the timeout passes. */
async function readStream(headers, stop, ms = 3000) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/live/stream`, { headers: { accept: "text/event-stream", ...headers }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const reader = res.body.getReader();
  const frames = [];
  let buf = "";
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    while (!stop(frames)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString("utf8");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const f = { id: "", event: "message", data: "" };
        for (const line of raw.split("\n")) {
          if (line.startsWith("id: ")) f.id = line.slice(4);
          else if (line.startsWith("event: ")) f.event = line.slice(7);
          else if (line.startsWith("data: ")) f.data = JSON.parse(line.slice(6));
        }
        if (f.data !== "") frames.push(f);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") throw err;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
  return frames;
}

test("mutations from another site or without JSON are refused", async () => {
  assert.equal((await send("PUT", "/api/live", { symbols: ["NVDA"] }, { origin: "https://evil.example" })).status, 403);
  const form = await fetch(`${base}/api/live`, { method: "PUT", headers: { origin: APP, "content-type": "text/plain" }, body: JSON.stringify({ symbols: ["NVDA"] }) });
  assert.equal(form.status, 403);
  assert.equal((await send("POST", "/api/live/seen", { symbol: "NVDA" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await send("POST", "/api/live/simulate", { symbol: "NVDA" }, { origin: "https://evil.example" })).status, 403);
  assert.deepEqual((await send("GET", "/api/live")).body.symbols, []);
});

test("PUT validates against data/tickers.json and keeps the user's order", async () => {
  assert.equal((await send("PUT", "/api/live", { symbols: "NVDA" })).status, 400);
  assert.equal((await send("POST", "/api/live", { symbols: [] })).status, 405);
  const put = await send("PUT", "/api/live", { symbols: ["lmt", "NOPEQ", "NVDA", "AAPL"] });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.symbols, ["LMT", "NVDA", "AAPL"]);
  assert.deepEqual(put.body.invalid, ["NOPEQ"]);
  assert.deepEqual(put.body.added, ["LMT", "NVDA", "AAPL"]);
  assert.equal(put.body.checks.length, LIVE_CHECKS.length);
  await livePoller(db).idle();
  const get = await send("GET", "/api/live");
  assert.deepEqual(Object.keys(get.body).sort(), ["asOf", "checks", "fresh", "ok", "poller", "symbols"]);
  assert.equal(get.body.poller, "off", "the poller does not run under the test runner");
});

test("the stream refuses plain requests; the simulate hook is off unless WATCH_SIMULATE=1", async () => {
  const plain = await send("GET", "/api/live/stream");
  assert.equal(plain.status, 406);
  assert.equal((await send("POST", "/api/live/simulate", { symbol: "NVDA" })).status, 404);
  assert.equal((await send("GET", "/api/live/seen")).status, 405);
});

test("SSE says hello, pushes a detection with its sequence id, and replays it after a reconnect", async () => {
  process.env.WATCH_SIMULATE = "1";
  assert.equal((await send("POST", "/api/live/simulate", { symbol: "ZZZZQ" })).status, 404);
  let posted = null;
  const frames = await readStream({}, (fs) => {
    if (fs.some((f) => f.event === "hello") && !posted) posted = send("POST", "/api/live/simulate", { symbol: "NVDA", source: "insiders" });
    return fs.some((f) => f.event === "alert");
  });
  const made = await posted;
  assert.equal(made.status, 201);
  const hello = frames.find((f) => f.event === "hello");
  assert.deepEqual(hello.data.symbols, ["LMT", "NVDA", "AAPL"]);
  const alert = frames.find((f) => f.event === "alert");
  assert.equal(alert.data.id, made.body.item.id);
  assert.match(alert.data.title, /^TEST · Form 4 · NVDA/);
  assert.equal(alert.data.kind, "form4");
  assert.equal(alert.data.live.simulated, true);
  assert.equal(alert.data.live.detectionLagMs, 37_000);
  assert.equal(alert.id, String(alert.data.live.seq));

  const missed = await send("POST", "/api/live/simulate", { symbol: "NVDA", source: "news" });
  const replay = await readStream({ "last-event-id": String(alert.data.live.seq) }, (fs) => fs.some((f) => f.event === "alert"));
  const again = replay.filter((f) => f.event === "alert");
  assert.deepEqual(again.map((f) => f.data.id), [missed.body.item.id], "only what the client missed is replayed");
  assert.equal(again[0].data.replay, true);

  const live = await send("GET", "/api/live");
  assert.deepEqual(live.body.fresh.NVDA, { insiders: 1, news: 1 });
  const seen = await send("POST", "/api/live/seen", { symbol: "NVDA", source: "insiders" });
  assert.deepEqual(seen.body.fresh, { NVDA: { news: 1 } });
  assert.equal((await send("POST", "/api/live/seen", { symbol: "NVDA", source: "bogus" })).status, 400);
  const events = await send("GET", "/api/live/events?symbols=NVDA&live=1");
  assert.deepEqual(events.body.items.map((r) => r.id), [missed.body.item.id, made.body.item.id]);
});
