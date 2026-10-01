import { test } from "node:test";
import assert from "node:assert/strict";
import { boardOrder, boardRow, composeBoard, keyed } from "../server/contracts.mjs";
import { makeGate, retryable, retryDelay } from "../server/http.mjs";

const t = (symbol, sector = "Industrials") => ({ symbol, name: `${symbol} Inc`, sector, industry: "", contractParents: [{ name: symbol, uei: `UEI${symbol}` }] });

test("board fetch order puts last build's largest contractors first, unknown names last", () => {
  const prior = { items: [{ symbol: "BA", obligations: 20e9 }, { symbol: "LMT", obligations: 48e9 }, { symbol: "AAPL", obligations: 0 }] };
  assert.deepEqual(boardOrder([t("ZTS"), t("AAPL"), t("BA"), t("ABT"), t("LMT")], prior).map((x) => x.symbol), ["LMT", "BA", "AAPL", "ABT", "ZTS"]);
  assert.deepEqual(boardOrder([t("B"), t("A")], null).map((x) => x.symbol), ["A", "B"]);
});

test("board row uses the dependence year when revenue exists, else the last complete fiscal year", () => {
  const byYear = [{ fy: 2025, amount: 5e9 }, { fy: 2026, amount: 6e9 }, { fy: 2027, amount: 1e8 }];
  const withRev = boardRow(t("LMT"), { byYear, dependence: { fy: 2026, obligations: 6e9, revenue: 60e9, revenueFy: 2025, share: 0.1 } }, 2027);
  assert.equal(withRev.obligations, 6e9);
  assert.equal(withRev.share, 0.1);
  const noRev = boardRow(t("GD"), { byYear, dependence: null }, 2027);
  assert.equal(noRev.fy, 2026);
  assert.equal(noRev.share, null);
  assert.equal(boardRow(t("X"), null), null);
});

test("partial board reports progress, ranks by obligations, and names failures", () => {
  const rows = [
    { symbol: "BA", sector: "Industrials", obligations: 2e9, fy: 2026 },
    { symbol: "UNH", sector: "Health Care", obligations: 3e9, fy: 2026 },
    { symbol: "XOM", sector: "Energy", obligations: -1e6, fy: 2026 }
  ];
  const b = composeBoard({ rows, building: true, done: 40, total: 200, failed: ["GD"], constituents: 503 });
  assert.equal(b.building, true);
  assert.deepEqual(b.progress, { done: 40, total: 200, failed: 1 });
  assert.deepEqual(b.items.map((r) => r.symbol), ["UNH", "BA", "XOM"]);
  assert.equal(b.index.obligations, 5e9);
  assert.equal(b.sectors[0].sector, "Health Care");
  assert.match(b.note, /1 contractor failed .*GD/);
  assert.match(b.latency, /90 days/);
  assert.ok(b.source && b.asOf);
});

test("feed rows get unique keys when one award has several modifications in the window", () => {
  const link = "https://www.usaspending.gov/award/CONT_AWD_693KA825C00011_6920_-NONE-_-NONE-";
  const ids = keyed([
    { award: "693KA825C00011", link, mod: "P00009", date: "2026-09-22" },
    { award: "693KA825C00011", link, mod: "P00008", date: "2026-09-01" },
    { award: "693KA825C00011", link, mod: "P00008", date: "2026-09-01" }
  ]).map((r) => r.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(ids[0], "award:CONT_AWD_693KA825C00011_6920_-NONE-_-NONE-:P00009:2026-09-22");
});

test("gate caps concurrency, spaces starts, and lets priority jobs jump the queue", async () => {
  const gate = makeGate(2, 20);
  let active = 0;
  let peak = 0;
  const order = [];
  const starts = [];
  const job = (name) => () => {
    order.push(name);
    starts.push(Date.now());
    active += 1;
    peak = Math.max(peak, active);
    return new Promise((r) => setTimeout(() => { active -= 1; r(name); }, 30));
  };
  const jobs = ["a", "b", "c", "d"].map((n) => gate(job(n)));
  jobs.push(gate(job("urgent"), { priority: true }));
  assert.deepEqual(await Promise.all(jobs), ["a", "b", "c", "d", "urgent"]);
  assert.equal(peak, 2);
  assert.equal(order[0], "a");
  assert.ok(order.indexOf("urgent") < order.indexOf("c"));
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 15);
});

test("retry policy: timeouts, network errors, 429 and 5xx retry; other 4xx do not", () => {
  assert.equal(retryable(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(retryable(new Error("fetch failed")), true);
  assert.equal(retryable(Object.assign(new Error("HTTP 429"), { status: 429 })), true);
  assert.equal(retryable(Object.assign(new Error("HTTP 503"), { status: 503 })), true);
  assert.equal(retryable(Object.assign(new Error("HTTP 400"), { status: 400 })), false);
  assert.equal(retryDelay(1, 500, () => 0.5), 1500);
  assert.equal(retryDelay(2, 500, () => 0.5), 3000);
  assert.equal(retryDelay(1, 429, () => 0.5), 5000);
});
