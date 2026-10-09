import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authConfig, base32Decode, base32Encode, checkTotp, clientIp, createLimiter, formOriginOk, hashPassword, isLocal,
  needsLogin, parseCookies, parseHash, readSession, safeNext, sessionCookie, signSession, totpAt, verifyPassword
} from "../server/lib/auth.mjs";
import { allowedOrigins, crossSiteRefusal } from "../server/lib/guard.mjs";

const SECRET = "s".repeat(40);
const req = (remoteAddress, headers = {}) => ({ headers, socket: { remoteAddress } });

test("scrypt hashes verify, reject wrong passwords, and survive env files", async () => {
  const hash = await hashPassword("correct horse battery", { N: 1024 });
  assert.match(hash, /^scrypt:1024:8:1:[\w-]+:[\w-]+$/);
  assert.ok(!/[$\s'"]/.test(hash));
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  assert.equal(await verifyPassword("correct horse batterY", hash), false);
  assert.equal(await verifyPassword("", hash), false);
  assert.equal(await verifyPassword("x", "scrypt:1000:8:1:abc:def"), false);
  assert.equal(parseHash("bcrypt$2b$..."), null);
  assert.notEqual(await hashPassword("same", { N: 1024 }), await hashPassword("same", { N: 1024 }));
});

test("session cookies: signed, tamper-proof, and expire", () => {
  const value = signSession({ sub: "owner", iat: 1000, exp: 5000 }, SECRET);
  assert.deepEqual(readSession(value, SECRET, 4999), { sub: "owner", iat: 1000, exp: 5000 });
  assert.equal(readSession(value, SECRET, 5000), null, "expired at exp");
  assert.equal(readSession(value, "t".repeat(40), 2000), null, "other secret");
  const [body, sig] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "owner", iat: 1000, exp: 9e15 })).toString("base64url");
  assert.equal(readSession(`${forged}.${sig}`, SECRET, 2000), null, "payload swapped");
  assert.equal(readSession(`${body}.${sig.slice(0, -1)}`, SECRET, 2000), null, "short mac");
  assert.equal(readSession(`${value}.x`, SECRET, 2000), null);
  assert.equal(readSession("", SECRET, 2000), null);
  assert.equal(readSession(value, "", 2000), null);
});

test("cookie header parsing and Set-Cookie attributes", () => {
  assert.deepEqual(parseCookies("a=1; intel_session=x.y; b"), { a: "1", intel_session: "x.y" });
  const https = authConfig({ PUBLIC_ORIGIN: "https://intel.example.com/", INTEL_SESSION_SECRET: SECRET });
  assert.equal(https.cookie, "__Host-intel_session");
  assert.equal(sessionCookie(https, "v", 60), "__Host-intel_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure");
  const http = authConfig({ PUBLIC_ORIGIN: "http://127.0.0.1:8815" });
  assert.equal(sessionCookie(http, "v", 0), "intel_session=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
});

test("TOTP matches RFC 6238 and refuses replays and drift beyond one step", () => {
  const key = Buffer.from("12345678901234567890");
  assert.equal(totpAt(key, 1), "287082");
  assert.equal(totpAt(key, Math.floor(1111111109 / 30)), "081804");
  const b32 = base32Encode(key);
  assert.deepEqual(base32Decode(b32), key);
  assert.equal(base32Decode("not base32!"), null);
  const now = 1111111109_000;
  const step = Math.floor(now / 30_000);
  assert.equal(checkTotp("081804", b32, now), step);
  assert.equal(checkTotp(totpAt(key, step - 1), b32, now), step - 1);
  assert.equal(checkTotp(totpAt(key, step + 2), b32, now), -1);
  assert.equal(checkTotp("081804", b32, now, step), -1, "replay");
  assert.equal(checkTotp("08180", b32, now), -1);
});

test("limiter: 5 failures per client, a global ceiling, and the window expires", () => {
  const lim = createLimiter({ perIp: 5, global: 8, windowMs: 1000 });
  for (let i = 0; i < 5; i++) {
    assert.ok(lim.check("1.1.1.1", 0).ok);
    lim.fail("1.1.1.1", 0);
  }
  const blocked = lim.check("1.1.1.1", 100);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterS, 1);
  assert.ok(lim.check("2.2.2.2", 100).ok, "others unaffected");
  for (let i = 0; i < 3; i++) lim.fail(`3.3.3.${i}`, 100);
  assert.equal(lim.check("9.9.9.9", 200).ok, false, "global ceiling");
  assert.ok(lim.check("1.1.1.1", 1200).ok, "window passed");
  lim.fail("4.4.4.4", 1200);
  lim.reset("4.4.4.4");
  assert.ok(lim.check("4.4.4.4", 1200).ok);
});

test("dev bypass only for direct loopback calls outside production", () => {
  const dev = authConfig({});
  const prod = authConfig({ NODE_ENV: "production" });
  assert.equal(needsLogin(req("127.0.0.1"), dev), false);
  assert.equal(needsLogin(req("::1"), dev), false);
  assert.equal(needsLogin(req("::ffff:127.0.0.1"), dev), false);
  assert.equal(needsLogin(req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }), dev), true, "proxied");
  assert.equal(needsLogin(req("127.0.0.1", { forwarded: "for=203.0.113.9" }), dev), true);
  assert.equal(needsLogin(req("192.168.1.4"), dev), true);
  assert.equal(needsLogin(req("127.0.0.1"), prod), true);
  assert.equal(needsLogin(req("127.0.0.1"), authConfig({ INTEL_AUTH: "on" })), true);
  assert.equal(isLocal(req("10.0.0.1")), false);
});

test("client ip: last X-Forwarded-For hop only behind a loopback proxy", () => {
  assert.equal(clientIp(req("127.0.0.1", { "x-forwarded-for": "1.2.3.4, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIp(req("198.51.100.1", { "x-forwarded-for": "1.2.3.4" })), "198.51.100.1");
  assert.equal(clientIp(req("127.0.0.1")), "127.0.0.1");
});

test("config lists every problem; production needs hash, secret and PUBLIC_ORIGIN", async () => {
  const hash = await hashPassword("pw-for-config", { N: 1024 });
  const prod = authConfig({ NODE_ENV: "production" });
  assert.equal(prod.problems.length, 3);
  const ok = authConfig({ NODE_ENV: "production", INTEL_PASSWORD_HASH: hash, INTEL_SESSION_SECRET: SECRET, PUBLIC_ORIGIN: "https://x.example" });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.configured, true);
  assert.equal(ok.ttlMs, 30 * 86_400_000);
  assert.match(authConfig({ INTEL_PASSWORD_HASH: hash, INTEL_SESSION_SECRET: "short" }).problems[0], /SESSION_SECRET/);
  assert.match(authConfig({ INTEL_PASSWORD_HASH: hash, INTEL_SESSION_SECRET: SECRET, INTEL_TOTP_SECRET: "abc" }).problems[0], /TOTP/);
  assert.equal(authConfig({ INTEL_PASSWORD_HASH: hash, INTEL_SESSION_SECRET: SECRET }).configured, true, "dev with keys");
});

test("the hosted origin may POST to the API; the demo (PUBLIC_URL) still may not", () => {
  const origins = allowedOrigins({ PUBLIC_ORIGIN: "https://intel.example.com/", PUBLIC_URL: "https://user.github.io/intel/" });
  assert.ok(origins.has("https://intel.example.com"));
  assert.ok(!origins.has("https://user.github.io"));
  const post = { method: "POST", headers: { origin: "https://intel.example.com", "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, socket: { remoteAddress: "127.0.0.1" } };
  assert.equal(crossSiteRefusal(post, origins), null);
});

test("form origin and next-path checks", () => {
  const cfg = authConfig({ PUBLIC_ORIGIN: "https://intel.example.com" });
  assert.ok(formOriginOk({ headers: { origin: "https://intel.example.com" } }, cfg));
  assert.ok(!formOriginOk({ headers: { origin: "https://evil.example" } }, cfg));
  assert.ok(!formOriginOk({ headers: { "sec-fetch-site": "cross-site" } }, cfg));
  assert.ok(formOriginOk({ headers: {} }, cfg));
  assert.ok(formOriginOk({ headers: { origin: "http://127.0.0.1:8815", host: "127.0.0.1:8815" } }, authConfig({})));
  assert.equal(safeNext("/#backtest"), "/#backtest");
  assert.equal(safeNext("/x?y=1"), "/x?y=1");
  for (const bad of ["//evil.example", "/\\evil", "https://evil.example", "javascript:alert(1)", "", "/login", "/ x"]) assert.equal(safeNext(bad), "/", bad);
});
