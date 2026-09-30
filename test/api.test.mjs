// Boots the real API against a throwaway cache with background warming off, and checks routes that need no network.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 18000 + Math.floor(Math.random() * 2000);
const cache = path.join(os.tmpdir(), `intel-test-${process.pid}.sqlite`);
const base = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), INTEL_CACHE: cache, INTEL_NO_WARM: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API did not start")), 10000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("intel api")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`API exited with ${code}`)));
  });
});

after(() => {
  server?.kill();
  for (const f of [cache, `${cache}-wal`, `${cache}-shm`]) fs.rmSync(f, { force: true });
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};

test("GET /api/health", async () => {
  assert.deepEqual(await get("/api/health"), { status: 200, body: { ok: true } });
});

test("GET /api/tickers exposes join flags and basis", async () => {
  const { body } = await get("/api/tickers");
  assert.ok(body.items.length >= 500);
  const amd = body.items.find((t) => t.symbol === "AMD");
  assert.equal(amd.core, true);
  assert.deepEqual(amd.districts, ["CA-17"]);
  assert.equal(amd.joinBasis.auto, true);
  const aapl = body.items.find((t) => t.symbol === "AAPL");
  assert.equal(aapl.joinBasis, null, "hand-curated rows have no derived basis");
});

test("GET /api/search matches tickers by symbol and name", async () => {
  const { body } = await get("/api/search?q=AM");
  assert.ok(body.tickers.length > 0 && body.tickers.length <= 6);
  for (const t of body.tickers) assert.ok(t.symbol.includes("AM") || /am/i.test(t.name), `${t.symbol} does not match "AM"`);
  assert.deepEqual(body.members, [], "member search needs three characters");
});

test("GET /api/markets/supply lists curated chains", async () => {
  const { body } = await get("/api/markets/supply");
  for (const s of ["AAPL", "TSM", "AMD", "UAL"]) assert.ok(body.items.includes(s), `${s} missing`);
});

test("GET /api/tickers/:symbol accepts hyphenated symbols and refuses unknown ones", async () => {
  const res = await get("/api/tickers/ZZ-Q");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: false, error: "Ticker is not in the join table" });
});

test("unknown routes are 404", async () => {
  const res = await get("/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.ok, false);
});
