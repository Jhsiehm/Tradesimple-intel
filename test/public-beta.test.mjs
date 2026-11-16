import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_BETA_ASK_TOOLS, publicBetaPermission, publicBetaRouteId } from "../server/lib/publicBeta.mjs";

const req = (url, method = "GET") => ({ url, method, headers: {}, socket: { remoteAddress: "127.0.0.1" } });
const allowed = (url, method = "GET") => publicBetaPermission(req(url, method)).ok;
test("public beta explicitly exposes only public feeds and bounded compute", () => {
  assert.equal(publicBetaRouteId("/api/congress/feed"), "congress.feed");
  assert.ok(allowed("/api/congress/feed"));
  assert.ok(allowed("/api/tickers/NVDA"));
  assert.ok(allowed("/api/ask", "POST"));
  assert.ok(allowed("/api/backtest", "POST"));
  assert.ok(allowed("/api/backtest"));
  assert.ok(!allowed("/api/backtest?spec=%7B%7D"), "GET compute bypass rejected");
  assert.ok(!allowed("/api/backtest/search", "POST"));
  assert.ok(!allowed("/api/research/experiments"));
  assert.ok(!allowed("/api/research/experiments", "POST"));
  assert.ok(!allowed("/api/research/notebooks"));
  assert.ok(!allowed("/api/tasks"));
  assert.ok(!allowed("/api/live/stream"));
  assert.ok(!allowed("/api/notify"));
  assert.ok(!allowed("/api/watchlist/activity"));
  assert.ok(!allowed("/api/search", "POST"));
  assert.ok(!allowed("/api/unknown"));
  assert.ok(!allowed("/api/ask", "DELETE"));
});

test("anonymous model capabilities exclude local data and web tools", () => {
  for (const name of [
    "research_memory", "web_search", "web_fetch",
    "research_audit_saved_studies", "propose_theory",
  ]) assert.ok(!PUBLIC_BETA_ASK_TOOLS.has(name), name);
  for (const name of ["search", "run_backtest", "ticker_dossier"])
    assert.ok(PUBLIC_BETA_ASK_TOOLS.has(name), name);
});
