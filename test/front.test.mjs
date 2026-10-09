import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFront } from "../server/front.mjs";
import { hashPassword, signSession } from "../server/lib/auth.mjs";

const SECRET = "k".repeat(48);
const PASSWORD = "a long test passphrase";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "intel-front-"));
fs.mkdirSync(path.join(root, "dist", "assets"), { recursive: true });
fs.writeFileSync(path.join(root, "dist", "index.html"), "<!doctype html><div id=root></div>");
fs.writeFileSync(path.join(root, "dist", "assets", "index-AbCd1234.js"), `console.log(${JSON.stringify("x".repeat(4000))});`);
fs.writeFileSync(path.join(root, "secret.txt"), "outside dist");

let clock = Date.now();
const logs = [];
let servers = [];

async function serve(env, opts = {}) {
  const front = createFront({
    handle: (req, res) => {
      if (req.url.startsWith("/api/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write("data: hi\n\n");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    },
    root,
    env,
    now: () => clock,
    log: (line) => logs.push(line),
    ...opts
  });
  const server = http.createServer(front);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let hash;
let prod;
let dev;
const PROXY = { "x-forwarded-for": "203.0.113.7" };

before(async () => {
  hash = await hashPassword(PASSWORD, { N: 1024 });
  const base = { INTEL_PASSWORD_HASH: hash, INTEL_SESSION_SECRET: SECRET };
  prod = await serve({ ...base, NODE_ENV: "production", PUBLIC_ORIGIN: "http://127.0.0.1:1" });
  dev = await serve({});
});
after(() => {
  for (const s of servers) s.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const get = (url, headers = {}) => fetch(url, { headers, redirect: "manual" });
const loginForm = (base, password, extra = {}) =>
  fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...extra },
    body: new URLSearchParams({ password, next: "/#backtest" })
  });
const cookieOf = (res) => (res.headers.get("set-cookie") || "").split(";")[0];

test("production refuses to start without a complete sign-in config", () => {
  assert.throws(() => createFront({ handle: () => {}, root, env: { NODE_ENV: "production" } }), /INTEL_PASSWORD_HASH[\s\S]*SESSION_SECRET[\s\S]*PUBLIC_ORIGIN/);
});

test("health is open; the app redirects to sign-in; the API answers 401 JSON", async () => {
  assert.equal(await (await get(`${prod}/healthz`)).text(), "ok");
  assert.equal((await get(`${prod}/api/health`)).status, 200);
  const page = await get(`${prod}/some/view?x=1`);
  assert.equal(page.status, 303);
  assert.equal(page.headers.get("location"), "/login?next=%2Fsome%2Fview%3Fx%3D1");
  const api = await get(`${prod}/api/congress/feed`);
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { ok: false, error: "Sign in required.", login: "/login", missing: "" });
  assert.equal((await get(`${prod}/geo/states.geojson`)).status, 401);
  assert.equal((await fetch(`${prod}/api/ask`, { method: "POST", body: "{}" })).status, 401);
  const login = await get(`${prod}/login?next=/%23backtest`);
  assert.equal(login.status, 200);
  assert.match(login.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await login.text(), /name="next" value="\/#backtest"/);
});

test("sign in, use the app and the API (including a stream), sign out", async () => {
  const res = await loginForm(prod, PASSWORD, { origin: "http://127.0.0.1:1" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/#backtest");
  assert.match(res.headers.get("set-cookie"), /^intel_session=[\w-]+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const cookie = cookieOf(res);
  assert.ok(logs.some((l) => l === "intel auth: signed in from 127.0.0.1"));

  const app = await get(`${prod}/`, { cookie });
  assert.equal(app.status, 200);
  assert.match(app.headers.get("content-type"), /text\/html/);
  assert.equal(app.headers.get("cache-control"), "no-cache");
  assert.equal((await get(`${prod}/deep/link`, { cookie })).status, 200, "SPA fallback");
  const api = await get(`${prod}/api/congress/feed`, { cookie });
  assert.deepEqual(await api.json(), { ok: true, path: "/api/congress/feed" });
  const stream = await get(`${prod}/api/stream`, { cookie });
  assert.equal(stream.headers.get("content-type"), "text/event-stream");
  assert.equal(await stream.text(), "data: hi\n\n");
  assert.equal((await get(`${prod}/login`, { cookie })).status, 303, "already signed in");

  const out = await fetch(`${prod}/logout`, { method: "POST", redirect: "manual", headers: { origin: "http://127.0.0.1:1" } });
  assert.equal(out.status, 303);
  assert.match(out.headers.get("set-cookie"), /^intel_session=; .*Max-Age=0/);
});

test("wrong password, cross-site form, forged cookie and expiry are refused", async () => {
  const wrong = await loginForm(prod, "nope", PROXY);
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get("set-cookie"), null);
  assert.ok(logs.includes("intel auth: failed login from 203.0.113.7"));
  assert.equal((await loginForm(prod, PASSWORD, { origin: "https://evil.example" })).status, 403);
  const forged = signSession({ sub: "owner", iat: clock, exp: clock + 1e9 }, "x".repeat(48));
  assert.equal((await get(`${prod}/api/x`, { cookie: `intel_session=${forged}` })).status, 401);
  const expired = signSession({ sub: "owner", iat: clock - 10, exp: clock - 1 }, SECRET);
  assert.equal((await get(`${prod}/api/x`, { cookie: `intel_session=${expired}` })).status, 401);
});

test("a session past half its life is renewed; a fresh one is not", async () => {
  const fresh = signSession({ sub: "owner", iat: clock, exp: clock + 30 * 86_400_000 }, SECRET);
  assert.equal((await get(`${prod}/api/x`, { cookie: `intel_session=${fresh}` })).headers.get("set-cookie"), null);
  const old = signSession({ sub: "owner", iat: clock - 20 * 86_400_000, exp: clock + 10 * 86_400_000 }, SECRET);
  assert.match((await get(`${prod}/api/x`, { cookie: `intel_session=${old}` })).headers.get("set-cookie"), /Max-Age=2592000/);
});

test("login attempts are rate limited per client", async () => {
  const ip = { "x-forwarded-for": "198.51.100.23" };
  for (let i = 0; i < 5; i++) assert.equal((await loginForm(prod, "bad guess", ip)).status, 401);
  const limited = await loginForm(prod, PASSWORD, ip);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await loginForm(prod, PASSWORD, { "x-forwarded-for": "198.51.100.24" })).status, 303, "other clients still sign in");
  clock += 16 * 60_000;
  assert.equal((await loginForm(prod, PASSWORD, ip)).status, 303, "window passed");
});

test("static: immutable hashed assets, compression, 304, 404 for missing files, no traversal", async () => {
  const cookie = cookieOf(await loginForm(prod, PASSWORD));
  const js = await get(`${prod}/assets/index-AbCd1234.js`, { cookie, "accept-encoding": "br" });
  assert.equal(js.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(js.headers.get("content-encoding"), "br");
  assert.match(js.headers.get("content-type"), /javascript/);
  const etag = js.headers.get("etag");
  assert.equal((await get(`${prod}/assets/index-AbCd1234.js`, { cookie, "if-none-match": etag })).status, 304);
  assert.equal((await get(`${prod}/assets/missing-12345678.js`, { cookie })).status, 404);
  const sneaky = await get(`${prod}/%2e%2e/secret.txt`, { cookie });
  assert.notEqual(await sneaky.text(), "outside dist");
});

test("development on loopback is unchanged: no sign-in, no static, router answers", async () => {
  const res = await get(`${dev}/api/congress/feed`);
  assert.deepEqual(await res.json(), { ok: true, path: "/api/congress/feed" });
  assert.deepEqual(await (await get(`${dev}/`)).json(), { ok: true, path: "/" });
  assert.equal((await get(`${dev}/api/congress/feed`, PROXY)).status, 401, "proxied requests still sign in");
  assert.equal((await loginForm(dev, "anything", PROXY)).status, 503, "no keys, no sign-in");
});
