import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { allowedOrigins, crossSiteRefusal } from "../server/lib/guard.mjs";
import { createRouter } from "../server/router.mjs";

const ORIGINS = allowedOrigins({ PUBLIC_URL: "https://demo.example/intel/" });
const req = (method, headers = {}, remoteAddress = "127.0.0.1") => ({ method, headers, socket: { remoteAddress } });
const JSON_TYPE = { "content-type": "application/json" };

test("allowed origins: the Vite app on both loopback names, PUBLIC_URL, extra origins", () => {
  assert.deepEqual([...ORIGINS].sort(), ["http://127.0.0.1:5173", "http://localhost:5173", "https://demo.example"]);
  const extra = allowedOrigins({ VITE_PORT: "5174", INTEL_ALLOWED_ORIGINS: "http://10.0.0.5:5173, nope" });
  assert.ok(extra.has("http://127.0.0.1:5174") && extra.has("http://10.0.0.5:5173"));
  assert.ok(!extra.has("null") && !extra.has(""));
});

test("reads are never blocked", () => {
  assert.equal(crossSiteRefusal(req("GET", { origin: "https://evil.example" }), ORIGINS), null);
  assert.equal(crossSiteRefusal(req("HEAD"), ORIGINS), null);
});

test("POST from the app origin with JSON passes", () => {
  assert.equal(crossSiteRefusal(req("POST", { origin: "http://127.0.0.1:5173", ...JSON_TYPE }), ORIGINS), null);
  assert.equal(crossSiteRefusal(req("POST", { origin: "http://localhost:5173", "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" }), ORIGINS), null);
  assert.equal(crossSiteRefusal(req("POST", { referer: "http://localhost:5173/#backtest", ...JSON_TYPE }), ORIGINS), null);
});

test("a foreign origin, referer, or Sec-Fetch-Site is refused", () => {
  assert.match(crossSiteRefusal(req("POST", { origin: "https://evil.example", ...JSON_TYPE }), ORIGINS), /origin https:\/\/evil\.example is not allowed/);
  assert.match(crossSiteRefusal(req("POST", { origin: "null", ...JSON_TYPE }), ORIGINS), /not allowed/);
  assert.match(crossSiteRefusal(req("POST", { referer: "https://evil.example/x", ...JSON_TYPE }), ORIGINS), /referer https:\/\/evil\.example/);
  assert.match(crossSiteRefusal(req("POST", { "sec-fetch-site": "cross-site", ...JSON_TYPE }), ORIGINS), /Sec-Fetch-Site/);
  assert.match(crossSiteRefusal(req("DELETE", { origin: "http://127.0.0.1:8080" }), ORIGINS), /not allowed/);
});

test("form content types are refused even from the app origin", () => {
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
    assert.match(crossSiteRefusal(req("POST", { origin: "http://127.0.0.1:5173", "content-type": type }), ORIGINS), /Content-Type must be application\/json/, type);
  }
});

test("no Origin and no Referer: loopback CLI tools pass, anything else is refused", () => {
  assert.equal(crossSiteRefusal(req("POST", JSON_TYPE), ORIGINS), null);
  assert.equal(crossSiteRefusal(req("POST", JSON_TYPE, "::ffff:127.0.0.1"), ORIGINS), null);
  assert.match(crossSiteRefusal(req("POST", JSON_TYPE, "192.168.1.20"), ORIGINS), /not on this machine/);
  assert.match(crossSiteRefusal(req("POST", { "content-type": "text/plain" }), ORIGINS), /Content-Type/);
});

let server;
let base;
let hits = 0;
before(async () => {
  const router = createRouter([{ id: "spend", path: "/api/spend" }], { spend: () => { hits += 1; return { ok: true }; } }, { origins: ORIGINS });
  server = http.createServer((rq, rs) => router.handle(rq, rs, {}));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

function post(headers, body = "{}") {
  return new Promise((resolve, reject) => {
    const rq = http.request(`${base}/api/spend`, { method: "POST", headers }, (rs) => {
      let text = "";
      rs.on("data", (c) => { text += c; });
      rs.on("end", () => resolve({ status: rs.statusCode, headers: rs.headers, body: JSON.parse(text) }));
    });
    rq.on("error", reject);
    rq.end(body);
  });
}

test("router: allowed origin reaches the handler, foreign origin and form posts get 403 without running it", async () => {
  hits = 0;
  const ok = await post({ Origin: "http://127.0.0.1:5173", ...JSON_TYPE });
  assert.equal(ok.status, 200);
  assert.equal(hits, 1);
  assert.equal(ok.headers["access-control-allow-origin"], undefined, "no CORS grant");
  const evil = await post({ Origin: "https://evil.example", ...JSON_TYPE });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.ok, false);
  assert.match(evil.body.error, /Cross-site request refused/);
  assert.equal(evil.headers["access-control-allow-origin"], undefined);
  const form = await post({ Origin: "http://127.0.0.1:5173", "Content-Type": "application/x-www-form-urlencoded" }, "a=1");
  assert.equal(form.status, 403);
  assert.match(form.body.error, /Content-Type must be application\/json/);
  const curl = await post(JSON_TYPE);
  assert.equal(curl.status, 200, "loopback curl without Origin");
  assert.equal(hits, 2, "refused requests never ran the handler");
});
