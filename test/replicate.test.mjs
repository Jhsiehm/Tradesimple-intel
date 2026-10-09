import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runBacktest, dayOf } from "../shared/backtest.mjs";
import { cleanRules } from "../shared/backtestSpec.mjs";
import { replicateFiles, zipFiles, crc32, expectedOf } from "../shared/replicate.mjs";
import { backtestFormulas, leadersFormulas } from "../shared/formulas.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const START = dayOf("2025-01-02");

/** Deterministic random walk with weekends removed and a few missing opens. */
function series(seed, base, days = 320) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  let p = base;
  for (let d = START; d < START + days; d += 1) {
    if (d % 7 === 2 || d % 7 === 3) continue;
    const open = p * (1 + (rnd() - 0.5) * 0.01);
    p = p * (1 + (rnd() - 0.48) * 0.04);
    out.push([d, rnd() < 0.03 ? null : Math.round(open * 100) / 100, Math.round(p * 100) / 100]);
  }
  return out;
}

function fixture(ruleOverrides) {
  const symbols = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const bars = Object.fromEntries(symbols.map((s, i) => [s, series(17 + i * 31, 40 + i * 25)]));
  const SPY = series(999, 500);
  const XLK = series(4242, 200);
  const signals = [];
  for (let i = 0; i < 36; i += 1) {
    const sym = symbols[i % symbols.length];
    signals.push({
      id: `s${i}`, symbol: sym, side: i % 4 === 3 ? "sell" : "buy", signalDate: new Date((START + 5 + i * 7) * 86_400_000).toISOString().slice(0, 10),
      sizeHint: [8_000, 32_500.5, 75_000, 2_000_000][i % 4], sizeIsRange: true, actor: `M${i % 3}`, actorLabel: `Member ${i % 3}`, sector: i % 2 ? "Information Technology" : "Energy"
    });
  }
  const rules = cleanRules(ruleOverrides);
  const benchBars = { SPY, XLK };
  const out = runBacktest({ signals, bars, benchBars, rules, calendar: SPY });
  const first = Math.min(...out.trades.map((t) => dayOf(t.signal))) - 10;
  const last = Math.max(...out.trades.map((t) => dayOf(t.exit)));
  const cut = (b) => b.filter((x) => x[0] >= first && x[0] <= last);
  const used = [...new Set(out.trades.map((t) => t.symbol))];
  const benches = [...new Set([...out.trades.map((t) => t.benchmark), "SPY"])];
  return {
    out,
    rep: {
      ok: true, spec: { source: "congress", filters: {}, rules }, description: "fixture", stats: out.stats, counts: out.counts, trades: out.trades,
      prices: used.map((symbol) => ({ symbol, bars: cut(bars[symbol]) })),
      benchmarks: benches.map((symbol) => ({ symbol, bars: cut(benchBars[symbol] || SPY) })),
      feeds: [{ label: "Prices", source: "fixture", asOf: "2026-10-09", latency: "none" }], priceSource: "fixture", priceAsOf: "2026-10-09", ranAt: "2026-10-09T00:00:00Z"
    }
  };
}

function writeFolder(rep) {
  const dir = mkdtempSync(join(tmpdir(), "intel-rep-"));
  for (const f of replicateFiles(rep)) writeFileSync(join(dir, f.name), f.text);
  writeFileSync(join(dir, "replicate.mjs"), readFileSync(join(ROOT, "shared/replicate/replicate.mjs.txt"), "utf8"));
  writeFileSync(join(dir, "replicate.py"), readFileSync(join(ROOT, "shared/replicate/replicate.py.txt"), "utf8"));
  return dir;
}

const lastJson = (stdout) => JSON.parse(String(stdout).trim().split("\n").at(-1));

const CASES = [
  ["size-weighted, both sides, stop/take, marked open trades", { entry: "nextOpen", holdDays: 20, sides: "both", sizing: "amountMid", stopLossPct: 8, takeProfitPct: 15, costBps: 3, slippageBps: 5, openTrades: "mark" }],
  ["equal weight, buys, close entry, sector benchmark, open trades excluded", { entry: "nextClose", holdDays: 90, sides: "buy", sizing: "equal", benchmark: "SECTOR", costBps: 0, slippageBps: 5 }]
];

for (const [name, rules] of CASES) {
  test(`the generated Node script reproduces shared/backtest.mjs: ${name}`, () => {
    const { out, rep } = fixture(rules);
    assert.ok(out.stats.trades >= 10, "fixture has trades");
    const dir = writeFolder(rep);
    try {
      const res = lastJson(execFileSync(process.execPath, [join(dir, "replicate.mjs"), dir], { encoding: "utf8" }));
      assert.equal(res.match, true, JSON.stringify(res));
      for (const k of ["trades", "total", "benchmarkTotal", "excessTotal", "hitRate", "avgTrade", "medianTrade", "maxDrawdown", "spanDays"]) {
        assert.ok(Math.abs(res.replicated[k] - out.stats[k]) <= 1e-4, `${k}: ${res.replicated[k]} vs ${out.stats[k]}`);
      }
      assert.deepEqual(res.app, expectedOf(out.stats));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("the generated Python script reproduces the same numbers (skipped without python3)", (t) => {
  const has = spawnSync("python3", ["--version"]);
  if (has.status !== 0) return t.skip("no python3");
  const { out, rep } = fixture(CASES[0][1]);
  const dir = writeFolder(rep);
  try {
    const res = spawnSync("python3", [join(dir, "replicate.py"), dir], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const j = lastJson(res.stdout);
    assert.equal(j.match, true);
    assert.equal(j.replicated.total, out.stats.total);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export files carry source and as-of on every price row, and spec.json holds the headline numbers", () => {
  const { rep, out } = fixture(CASES[0][1]);
  const files = Object.fromEntries(replicateFiles(rep).map((f) => [f.name, f.text]));
  assert.deepEqual(Object.keys(files), ["spec.json", "trades.csv", "prices.csv", "benchmark.csv", "METHODS.md"]);
  assert.match(files["prices.csv"].split("\n")[0], /^symbol,date,open_adj,close_adj,source,as_of$/);
  assert.ok(files["prices.csv"].split("\n").slice(1).filter(Boolean).every((l) => l.endsWith(",fixture,2026-10-09")));
  assert.equal(files["trades.csv"].trim().split("\n").length, out.trades.length + 1);
  assert.equal(JSON.parse(files["spec.json"]).expected.total, out.stats.total);
  assert.match(files["METHODS.md"], /Max drawdown/);
});

test("the zip is a valid stored archive (unzip -t when available)", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const bytes = zipFiles([{ name: "a.txt", text: "hello" }, { name: "b/c.csv", text: "x,y\n1,2\n" }]);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const dir = mkdtempSync(join(tmpdir(), "intel-zip-"));
  try {
    writeFileSync(join(dir, "t.zip"), bytes);
    const res = spawnSync("unzip", ["-t", join(dir, "t.zip")], { encoding: "utf8" });
    if (res.status !== null && !res.error) assert.match(res.stdout, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formulas substitute this run's own numbers", () => {
  const { out } = fixture(CASES[0][1]);
  const f = Object.fromEntries(backtestFormulas(out).map((x) => [x.id, x]));
  for (const id of ["entry", "exit", "costs", "trade", "sizing", "daily", "total", "annualized", "excess", "hit", "avg", "drawdown", "sharpe"]) assert.ok(f[id], id);
  assert.match(f.total.worked, new RegExp(`${(out.stats.total * 100).toFixed(2)}\\\\%`));
  assert.match(f.hit.worked, new RegExp(`\\\\frac\\{${out.stats.wins}\\}\\{${out.stats.trades}\\}`));
  assert.match(f.costs.worked, /\\frac\{3 \+ 5\}\{10\^4\} = 0\.0008/);
  assert.match(f.sizing.tex, /L_i \+ U_i/);
  assert.match(f.sharpe.worked, new RegExp(String(out.stats.sharpeish)));
  assert.match(leadersFormulas({ name: "Jane Doe", priced: 12, excessSince: 0.0421 })[1].worked, /n = 12.*4\.21\\%/);
});
