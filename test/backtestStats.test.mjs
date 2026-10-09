import { test } from "node:test";
import assert from "node:assert/strict";
import { dayOf, isoOf, runBacktest } from "../shared/backtest.mjs";
import { cleanRules } from "../shared/backtestSpec.mjs";
import { blockBootstrap, clusteredT, conservativeT, mulberry32, placeboTest, realityCheck, realityVerdict, tCdf, weekOf } from "../shared/backtestStats.mjs";
import { backtestFormulas } from "../shared/formulas.mjs";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

test("mulberry32 is deterministic per seed, in [0, 1), and roughly uniform", () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const xs = Array.from({ length: 5000 }, () => a());
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  near(xs.reduce((s, x) => s + x, 0) / xs.length, 0.5, 0.02, "mean");
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  assert.equal(mulberry32(0)(), 0.26642920868471265);
});

test("Student t CDF matches table values", () => {
  near(tCdf(2.228, 10), 0.975, 1e-4, "t(10) 97.5%");
  near(tCdf(12.706, 1), 0.975, 1e-4, "t(1) 97.5%");
  near(tCdf(1.96, 1e6), 0.975, 1e-4, "normal limit");
  near(tCdf(0, 7), 0.5, 1e-12);
  near(tCdf(-2.228, 10), 0.025, 1e-4);
});

test("clustered t: known answer on two clusters", () => {
  const c = clusteredT([1, 2, 3, 4], ["a", "a", "b", "b"]);
  assert.equal(c.mean, 2.5);
  near(c.se, 1, 1e-12, "se = sqrt(2/1 · ((-2)² + 2²)) / 4");
  near(c.t, 2.5, 1e-12);
  assert.equal(c.df, 1);
  near(c.pOne, 0.5 - Math.atan(2.5) / Math.PI, 1e-9, "t(1) is Cauchy");
  assert.equal(clusteredT([1, 2, 3], ["a", "a", "a"]).t, null, "one cluster has no clustered SE");
  const lopsided = clusteredT([0.1, -0.1, 0.2, -0.2, 0.05, 0.02], ["a", "a", "a", "a", "a", "b"]);
  const cons = conservativeT(lopsided);
  assert.ok(lopsided.se < lopsided.seIid, "one dominant cluster: CR1 comes out below iid");
  assert.equal(cons.se, lopsided.seIid);
  assert.equal(cons.seCluster, lopsided.se);
  assert.ok(Math.abs(cons.t) < Math.abs(lopsided.t));
  assert.equal(conservativeT(c).t, c.t, "unchanged when the clustered SE is the larger");
});

test("block bootstrap: constants give a zero-width interval, one block gives the mean, same seed same answer", () => {
  const [c] = blockBootstrap([[0.02, 0.02, 0.02, 0.02]], [1, 2, 3, 4], { iters: 500, seed: 7 });
  near(c.lo, 0.02, 1e-15);
  near(c.hi, 0.02, 1e-15);
  const [one] = blockBootstrap([[0.1, -0.3, 0.5]], [9, 9, 9], { iters: 200, seed: 7 });
  near(one.lo, 0.1, 1e-12);
  near(one.hi, 0.1, 1e-12);
  const rnd = mulberry32(99);
  const xs = Array.from({ length: 400 }, () => (rnd() - 0.5) * 0.2);
  const keys = xs.map((_, i) => i);
  const a = blockBootstrap([xs], keys, { seed: 3 });
  assert.deepEqual(a, blockBootstrap([xs], keys, { seed: 3 }));
  assert.notDeepEqual(a, blockBootstrap([xs], keys, { seed: 4 }));
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - a[0].mean) ** 2, 0) / (xs.length - 1));
  near(a[0].hi - a[0].lo, 2 * 1.96 * (sd / Math.sqrt(xs.length)), 0.15 * 2 * 1.96 * (sd / Math.sqrt(xs.length)), "width ≈ normal theory");
});

test("weeks are Monday-based", () => {
  assert.equal(weekOf(dayOf("2026-10-05")), weekOf(dayOf("2026-10-11")), "Mon..Sun same week");
  assert.notEqual(weekOf(dayOf("2026-10-11")), weekOf(dayOf("2026-10-12")));
});

/* A market where the stock jumps 10% the first trading day after each planted public date, flat otherwise. */
const START = dayOf("2025-01-01");
function plantedMarket(planted, days = 400) {
  const jumps = new Set(planted);
  const stock = [];
  const spy = [];
  let p = 100;
  for (let d = START; d < START + days; d += 1) {
    if (d % 7 === 2 || d % 7 === 3) continue;
    if (jumps.has(d - 1)) p *= 1.1;
    stock.push([d, p, p]);
    spy.push([d, 400, 400]);
  }
  return { stock, spy };
}

test("placebo: planted timing beats random entries; same seed, same result", () => {
  const publicDays = Array.from({ length: 10 }, (_, i) => START + 20 + i * 30).map((d) => (d % 7 === 2 || d % 7 === 3 ? d - 2 : d));
  const { stock, spy } = plantedMarket(publicDays.map((d) => d));
  const rules = cleanRules({ entry: "nextClose", holdDays: 3, slippageBps: 0 });
  const signals = publicDays.map((d, i) => ({ id: `s${i}`, symbol: "AAA", side: "buy", signalDate: isoOf(d - 1), actor: `M${i % 4}` }));
  const run = runBacktest({ signals, bars: { AAA: stock }, benchBars: { SPY: spy }, rules });
  assert.ok(run.trades.length >= 8);
  const input = { trades: run.trades, bars: { AAA: stock }, benchBars: { SPY: spy }, rules: run.rules, calendar: spy, iters: 300 };
  const a = placeboTest(input);
  assert.deepEqual(a, placeboTest(input));
  assert.ok(a.actual > 0.05, `actual ${a.actual}`);
  assert.ok(a.pct > 0.99, `pct ${a.pct}`);
  near(a.p, 1 / 301, 1e-12, "p floor is 1/(K+1)");
});

function nullRun(seed) {
  const rnd = mulberry32(seed);
  const walk = (base) => {
    const out = [];
    let p = base;
    for (let d = START; d < START + 420; d += 1) {
      if (d % 7 === 2 || d % 7 === 3) continue;
      p *= 1 + (rnd() - 0.5) * 0.04;
      out.push([d, p, p]);
    }
    return out;
  };
  const bars = { AAA: walk(50), BBB: walk(80), CCC: walk(20) };
  const SPY = walk(400);
  const signals = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, symbol: ["AAA", "BBB", "CCC"][i % 3], side: "buy", signalDate: isoOf(START + 10 + Math.floor(rnd() * 300)), actor: `M${i % 6}`, actorLabel: `Member ${i % 6}` }));
  const run = runBacktest({ signals, bars, benchBars: { SPY }, rules: cleanRules({ holdDays: 30 }) });
  return { run, bars, SPY };
}

test("on random walks with random signals the placebo rarely fires, and the run is deterministic", () => {
  const ps = [];
  for (let seed = 1; seed <= 20; seed += 1) {
    const { run, bars, SPY } = nullRun(seed);
    const r = realityCheck({ trades: run.trades, bars, benchBars: { SPY }, rules: run.rules, placeboIters: 300 });
    ps.push(r.placebo.p);
    assert.ok(r.cluster.nEff <= r.n);
  }
  assert.ok(ps.filter((p) => p <= 0.05).length <= 4, `false positives: ${ps.join(", ")}`);
  const { run, bars, SPY } = nullRun(5);
  const r = realityCheck({ trades: run.trades, bars, benchBars: { SPY }, rules: run.rules });
  assert.deepEqual(r, realityCheck({ trades: run.trades, bars, benchBars: { SPY }, rules: run.rules }), "deterministic");
  const f = Object.fromEntries(backtestFormulas({ ...run, reality: r }).map((x) => [x.id, x]));
  for (const id of ["bootstrap", "placebo", "cluster", "neff"]) assert.ok(f[id], id);
  assert.match(f.placebo.worked, new RegExp(String(r.placebo.p)));
});

test("verdict wording never overclaims", () => {
  const base = { n: 60, bootstrap: { iters: 2000, blocks: 40, meanTrade: { mean: 0.01, lo: -0.01, hi: 0.03 }, meanExcess: { mean: 0.006, lo: -0.021, hi: 0.034 } }, cluster: { nEff: 55 } };
  const luck = realityVerdict({ ...base, placebo: { pct: 0.59, p: 0.41, iters: 1000 } });
  assert.equal(luck.level, "luck");
  assert.match(luck.text, /^Not distinguishable from luck \(p=0\.41; excess per trade −2\.1% to \+3\.4%, 95% CI\)\.$/);
  const beat = realityVerdict({ ...base, bootstrap: { ...base.bootstrap, meanExcess: { mean: 0.02, lo: 0.004, hi: 0.03 } }, placebo: { pct: 0.975, p: 0.025, iters: 1000 } });
  assert.equal(beat.level, "beat");
  assert.match(beat.text, /^Beat random entries in 97% of 1000 trials \(p=0\.03?.*not proof/);
  const tickers = realityVerdict({ ...base, bootstrap: { ...base.bootstrap, meanExcess: { mean: 0.02, lo: 0.004, hi: 0.03 } }, placebo: { pct: 0.7, p: 0.3, iters: 1000 } });
  assert.equal(tickers.level, "tickers");
  const untested = realityVerdict({ ...base, bootstrap: { ...base.bootstrap, meanExcess: { mean: 0.02, lo: 0.004, hi: 0.03 } }, placebo: null });
  assert.equal(untested.level, "bench");
  assert.match(untested.text, /timing is untested/);
  assert.equal(realityVerdict({ n: 4 }).level, "few");
  const clustered = realityVerdict({ ...base, cluster: { nEff: 12 }, placebo: { pct: 0.5, p: 0.5, iters: 1000 } });
  assert.match(clustered.text, /effective sample about 12 of 60/);
  for (const v of [luck, beat, tickers, untested, clustered]) assert.doesNotMatch(v.text, /prove[sn]?\b(?! of)|guarantee|significant edge|will /i);
});
