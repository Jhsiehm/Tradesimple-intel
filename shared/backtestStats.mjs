/**
 * "Is it real?" statistics for a backtest. Pure and deterministic: the same trades, bars, rules and seed always give
 * the same numbers, here and in the Replicate scripts (shared/replicate/*.txt port this file line for line).
 *
 * - Block bootstrap: resample whole entry weeks (Monday-based) with replacement, so trades that cluster in a week
 *   move together; 95% percentile intervals for the mean trade return and the mean excess per trade.
 * - Random-entry placebo: each trade keeps its ticker, side, benchmark and rules but gets a random public date drawn
 *   from the trading days of the run's own window; the actual mean excess is ranked against the placebo means.
 * - Clustered t: mean excess over a standard error clustered by member (CR1), with G − 1 degrees of freedom, and an
 *   effective sample size from the design effect of member and week clustering.
 */
import { dayOf, lastOnOrBefore, simulateTrade } from "./backtest.mjs";

export const REALITY = { version: 3, seed: 12345, bootIters: 2000, placeboIters: 1000, alpha: 0.05, draws: 10, minTrades: 10 };

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** mulberry32: a small seeded PRNG in [0, 1). Ported bit for bit to the Python script. */
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monday-based week number of a day count (1970-01-01 was a Thursday). */
export const weekOf = (day) => Math.floor((day + 3) / 7);

/** Groups in first-seen order: `{ key, idx[] }[]`. */
function groupsOf(keys) {
  const by = new Map();
  keys.forEach((k, i) => { if (!by.has(k)) by.set(k, []); by.get(k).push(i); });
  return [...by.entries()].map(([key, idx]) => ({ key, idx }));
}

/**
 * Block bootstrap of the mean of each series in `series` (parallel arrays), resampling the groups in `keys`.
 * Every iteration draws G groups with replacement and takes the pooled mean of their members.
 */
export function blockBootstrap(series, keys, { iters = REALITY.bootIters, seed = REALITY.seed, alpha = REALITY.alpha } = {}) {
  const groups = groupsOf(keys);
  const G = groups.length;
  if (!G || !series.length || !series[0].length) return null;
  const sums = groups.map((g) => series.map((xs) => sum(g.idx.map((i) => xs[i]))));
  const sizes = groups.map((g) => g.idx.length);
  const rnd = mulberry32(seed);
  const draws = series.map(() => []);
  for (let b = 0; b < iters; b += 1) {
    const acc = series.map(() => 0);
    let n = 0;
    for (let j = 0; j < G; j += 1) {
      const k = Math.floor(rnd() * G);
      for (let s = 0; s < series.length; s += 1) acc[s] += sums[k][s];
      n += sizes[k];
    }
    for (let s = 0; s < series.length; s += 1) draws[s].push(acc[s] / n);
  }
  return draws.map((d, s) => {
    const sorted = [...d].sort((x, y) => x - y);
    return { mean: sum(series[s]) / series[s].length, lo: sorted[Math.floor((alpha / 2) * iters)], hi: sorted[Math.ceil((1 - alpha / 2) * iters) - 1] };
  });
}

/* ---------- Student t ---------- */

const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lnGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const x0 = z - 1;
  let x = LANCZOS[0];
  for (let i = 1; i < 9; i += 1) x += LANCZOS[i] / (x0 + i);
  const t = x0 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x0 + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaCf(a, b, x) {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `df` degrees of freedom. */
export function tCdf(t, df) {
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Mean of `xs` over a standard error clustered by `keys` (CR1: G/(G−1) small-sample factor), df = G − 1. */
export function clusteredT(xs, keys) {
  const n = xs.length;
  const groups = groupsOf(keys);
  const G = groups.length;
  if (n < 2) return null;
  const m = sum(xs) / n;
  const sd = Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (n - 1));
  const seIid = sd / Math.sqrt(n);
  if (G < 2) return { mean: m, se: null, seIid, t: null, df: 0, clusters: G, pOne: null, pTwo: null };
  const S = sum(groups.map((g) => sum(g.idx.map((i) => xs[i] - m)) ** 2));
  const se = Math.sqrt((G / (G - 1)) * S) / n;
  if (!(se > 0)) return { mean: m, se, seIid, t: null, df: G - 1, clusters: G, pOne: null, pTwo: null };
  const t = m / se;
  const df = G - 1;
  return { mean: m, se, seIid, t, df, clusters: G, pOne: 1 - tCdf(t, df), pTwo: 2 * (1 - tCdf(Math.abs(t), df)) };
}

/**
 * The clustered t made conservative: SE = max(clustered, iid). With few or very unequal clusters (one member with most
 * of the trades) the CR1 estimate can come out far below the iid one and overstate t.
 */
export function conservativeT(c) {
  if (!c || c.se == null || !(c.df > 0)) return c;
  const se = Math.max(c.se, c.seIid);
  if (!(se > 0)) return { ...c, seCluster: c.se, t: null, pOne: null, pTwo: null };
  const t = c.mean / se;
  return { ...c, seCluster: c.se, se, t, pOne: 1 - tCdf(t, c.df), pTwo: 2 * (1 - tCdf(Math.abs(t), c.df)) };
}

/** n × (iid SE / clustered SE)², the trade count an independent sample with the same precision would need. */
const effective = (n, c) => (c?.se > 0 && c.seIid > 0 ? Math.min(n, n * (c.seIid / c.se) ** 2) : null);

/* ---------- placebo ---------- */

const cutAt = (bars, last) => (bars?.length && bars.at(-1)[0] > last ? bars.slice(0, lastOnOrBefore(bars, last) + 1) : bars || []);

/**
 * Random-entry placebo. Bars are cut at the last actual exit, so a placebo trade can only use prices the real run
 * also had. Each trade draws up to `draws` trading days until one gives a completed trade; one that never does is
 * left out of that iteration's mean.
 */
export function placeboTest({ trades, bars, benchBars, rules, calendar, iters = REALITY.placeboIters, seed = REALITY.seed + 1, draws = REALITY.draws }) {
  if (!trades?.length || !calendar?.length) return null;
  const signalDays = trades.map((t) => dayOf(t.signal));
  const lo = Math.min(...signalDays);
  const hi = Math.max(...signalDays);
  const lastExit = Math.max(...trades.map((t) => dayOf(t.exit)));
  const days = calendar.filter((b) => b[0] >= lo && b[0] <= hi).map((b) => b[0]);
  if (days.length < 2) return null;
  const cutBars = new Map();
  const cut = (id, src) => { if (!cutBars.has(id)) cutBars.set(id, cutAt(src, lastExit)); return cutBars.get(id); };
  const keyOf = (t) => `${t.symbol}|${t.side}|${t.benchmark}`;
  const memo = new Map();
  const legs = trades.map((t) => {
    const k = keyOf(t);
    if (!memo.has(k)) memo.set(k, new Map());
    const bench = benchBars[t.benchmark] || (rules.benchmark === "SECTOR" ? benchBars.SPY : null);
    return { cache: memo.get(k), series: cut(`s:${t.symbol}`, bars[t.symbol]), bench: cut(`b:${t.benchmark}`, bench), sign: t.side === "sell" ? -1 : 1 };
  });
  const outcome = (leg, d) => {
    if (leg.cache.has(d)) return leg.cache.get(d);
    const out = leg.series.length && leg.bench.length ? simulateTrade(null, leg.series, leg.bench, rules, d, leg.sign) : { skip: "noPrice" };
    const v = out.trade ? out.trade.ret - out.trade.bench : null;
    leg.cache.set(d, v);
    return v;
  };
  const rnd = mulberry32(seed);
  const means = [];
  let missed = 0;
  for (let it = 0; it < iters; it += 1) {
    let s = 0;
    let n = 0;
    for (const leg of legs) {
      let got = null;
      for (let k = 0; k < draws && got == null; k += 1) got = outcome(leg, days[Math.floor(rnd() * days.length)]);
      if (got == null) { missed += 1; continue; }
      s += got;
      n += 1;
    }
    if (n) means.push(s / n);
  }
  if (!means.length) return null;
  const actual = sum(trades.map((t) => t.excess)) / trades.length;
  const below = means.filter((m) => m < actual).length;
  const atOrAbove = means.length - below;
  const sorted = [...means].sort((a, b) => a - b);
  return {
    iters: means.length,
    seed,
    actual,
    placeboMean: sum(means) / means.length,
    placeboLo: sorted[Math.floor(0.025 * means.length)],
    placeboHi: sorted[Math.ceil(0.975 * means.length) - 1],
    pct: below / means.length,
    p: (1 + atOrAbove) / (means.length + 1),
    window: { from: days[0], to: days.at(-1), tradingDays: days.length },
    missedDraws: missed
  };
}

/* ---------- the whole check ---------- */

/**
 * Everything the "Is it real?" panel shows, from the run's public trade rows (rounded as served) plus the bars the
 * engine read. `placebo: false` skips the placebo (the signal search ranks first and runs it on the top findings).
 */
export function realityCheck({ trades = [], bars = {}, benchBars = {}, rules, calendar = null, seed = REALITY.seed, bootIters = REALITY.bootIters, placeboIters = REALITY.placeboIters, placebo = true }) {
  const rows = trades.filter((t) => Number.isFinite(t.ret) && Number.isFinite(t.excess) && dayOf(t.entry) != null);
  const n = rows.length;
  if (n < 2) return { n, seed, bootstrap: null, placebo: null, cluster: null, verdict: realityVerdict({ n }, rules?.benchmark) };
  const rets = rows.map((t) => t.ret);
  const ex = rows.map((t) => t.excess);
  const weeks = rows.map((t) => weekOf(dayOf(t.entry)));
  const members = rows.map((t) => t.actorLabel || t.actor || "");
  const boot = blockBootstrap([rets, ex], weeks, { iters: bootIters, seed });
  const rawMember = clusteredT(ex, members);
  const byWeek = clusteredT(ex, weeks);
  const effs = [effective(n, rawMember), effective(n, byWeek)].filter((v) => v != null);
  const byMember = conservativeT(rawMember);
  const cal = calendar || benchBars[rules?.benchmark === "SECTOR" ? "SPY" : rules?.benchmark] || null;
  const pl = placebo ? placeboTest({ trades: rows, bars, benchBars, rules, calendar: cal, iters: placeboIters, seed: seed + 1 }) : null;
  const out = {
    n,
    seed,
    bootstrap: boot && {
      iters: bootIters,
      blocks: new Set(weeks).size,
      meanTrade: { mean: r4(boot[0].mean), lo: r4(boot[0].lo), hi: r4(boot[0].hi) },
      meanExcess: { mean: r4(boot[1].mean), lo: r4(boot[1].lo), hi: r4(boot[1].hi) }
    },
    placebo: pl && { ...pl, actual: r4(pl.actual), placeboMean: r4(pl.placeboMean), placeboLo: r4(pl.placeboLo), placeboHi: r4(pl.placeboHi), pct: r4(pl.pct), p: r4(pl.p) },
    cluster: {
      members: byMember?.clusters ?? 0,
      weeks: byWeek?.clusters ?? 0,
      t: r4(byMember?.t),
      df: byMember?.df ?? 0,
      se: r4(byMember?.se),
      seCluster: r4(byMember?.seCluster ?? byMember?.se),
      seIid: r4(byMember?.seIid),
      pOne: r4(byMember?.pOne),
      pTwo: r4(byMember?.pTwo),
      nEff: effs.length ? Math.max(1, Math.round(Math.min(...effs))) : null,
      topShare: r4(Math.max(...groupsOf(members).map((g) => g.idx.length)) / n)
    }
  };
  out.verdict = realityVerdict(out, rules?.benchmark);
  return out;
}

const pctTxt = (v) => (v == null ? "n/a" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);
export const pTxt = (p) => (p == null ? "n/a" : p < 0.001 ? "p<0.001" : `p=${p < 0.01 ? p.toFixed(3) : p.toFixed(2)}`);

/**
 * One plain sentence that never claims more than the numbers allow. `level`: few | luck | mixed | tickers | bench |
 * worse | beat. "beat" needs both a bootstrap interval above zero and a placebo p ≤ 0.05, and still says it is one test.
 */
export function realityVerdict(r, benchmark = "SPY") {
  const bench = !benchmark || benchmark === "SECTOR" ? "the benchmark" : benchmark;
  if (!r || r.n < REALITY.minTrades || !r.bootstrap) return { level: "few", text: `Too few trades to tell (${r?.n ?? 0}; at least ${REALITY.minTrades} needed for these checks).` };
  const { lo, hi } = r.bootstrap.meanExcess;
  const ci = `excess per trade ${pctTxt(lo)} to ${pctTxt(hi)}, 95% CI`;
  const pl = r.placebo;
  const beatPct = pl ? Math.floor(pl.pct * 100) : null;
  const plOk = pl ? pl.p <= 0.05 : false;
  const nEff = r.cluster?.nEff;
  const tail = nEff != null && nEff < r.n * 0.6 ? ` Trades cluster: effective sample about ${nEff} of ${r.n}.` : "";
  let level;
  let text;
  if (lo > 0 && plOk) {
    level = "beat";
    text = `Beat random entries in ${beatPct}% of ${pl.iters} trials (${pTxt(pl.p)}; ${ci}). One in-sample test, not proof of an edge.`;
  } else if (lo > 0 && pl) {
    level = "tickers";
    text = `Beat ${bench} per trade (${ci}), but random entry dates in the same tickers did about as well (${pTxt(pl.p)}): the edge is in which tickers, not when.`;
  } else if (lo > 0) {
    level = "bench";
    text = `Beat ${bench} per trade (${ci}); the random-entry placebo was not run, so timing is untested.`;
  } else if (hi < 0) {
    level = "worse";
    text = `Lagged ${bench} per trade (${ci})${pl ? `; random entries did better in ${Math.floor((1 - pl.pct) * 100)}% of trials` : ""}.`;
  } else if (plOk) {
    level = "mixed";
    text = `Beat random entries in ${beatPct}% of trials (${pTxt(pl.p)}), but the ${ci} includes zero. Suggestive, not established.`;
  } else {
    level = "luck";
    text = `Not distinguishable from luck (${pTxt(pl ? pl.p : r.cluster?.pTwo)}; ${ci}).`;
  }
  return { level, text: text + tail };
}
