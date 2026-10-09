import { test } from "node:test";
import assert from "node:assert/strict";
import { isRestart, mayResend, retryDelays } from "../src/lib/retry.ts";

test("backoff doubles from 1 s, caps each wait, and fits the 30 s budget", () => {
  const d = retryDelays();
  assert.deepEqual(d.slice(0, 4), [1000, 2000, 4000, 8000]);
  assert.ok(d.every((ms) => ms <= 8000));
  assert.equal(d.reduce((a, b) => a + b, 0), 30_000);
  assert.deepEqual(retryDelays(7000), [1000, 2000, 4000]);
  assert.deepEqual(retryDelays(500), []);
});

test("connection failures and proxy 502s while the API restarts count as a restart", () => {
  assert.ok(isRestart({ error: new TypeError("Failed to fetch") }));
  assert.ok(isRestart({ error: new TypeError("fetch failed") }));
  assert.ok(isRestart({ error: new TypeError("Load failed") }));
  assert.ok(isRestart({ status: 502, body: JSON.stringify({ ok: false, error: "The API server refused the connection (is it restarting?), so Ask could not run." }) }));
  assert.ok(isRestart({ status: 502, body: JSON.stringify({ ok: false, error: "The API connection dropped while Ask was still calling the model or a tool." }) }));
  assert.ok(isRestart({ status: 502, body: "" }));
  assert.ok(isRestart({ status: 500, body: "" }), "Vite's generic proxy answers an empty 500");
  assert.ok(isRestart({ status: 503, body: "" }));
});

test("real errors from the API, timeouts and aborts are not retried", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isRestart({ error: abort }), false);
  assert.equal(isRestart({ error: new SyntaxError("Unexpected token <") }), false);
  assert.equal(isRestart({ status: 502, body: JSON.stringify({ ok: false, error: "The API proxy timed out before the model and its tools finished." }) }), false);
  assert.equal(isRestart({ status: 500, body: JSON.stringify({ ok: false, error: "boom" }) }), false);
  assert.equal(isRestart({ status: 429, body: "" }), false);
  assert.equal(isRestart({ status: 403, body: "" }), false);
  assert.equal(isRestart({ status: 504, body: "Gateway timed out" }), false);
  assert.equal(isRestart({}), false);
});

test("Ask resends once, and only before any answer text arrived", () => {
  assert.equal(mayResend({ tokens: 0, done: false, resent: false }), true);
  assert.equal(mayResend({ tokens: 3, done: false, resent: false }), false);
  assert.equal(mayResend({ tokens: 0, done: true, resent: false }), false);
  assert.equal(mayResend({ tokens: 0, done: false, resent: true }), false);
});
