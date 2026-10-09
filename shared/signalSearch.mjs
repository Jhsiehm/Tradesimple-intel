/**
 * Signal search, pure: many backtest variants in, a ranked list with multiple-testing correction out.
 *
 * Each variant runs through the same engine as a single backtest. Variants with fewer than `minTrades` priced trades
 * are not tested (and do not count toward m). The tested ones get a one-sided p-value for "mean excess per trade > 0"
 * from a t-test clustered by member (by entry week when a variant has fewer than 5 members; SE never below the iid
 * one), then Benjamini–Hochberg
 * q-values across all m tested. The top findings also get the random-entry placebo.
 */
import { dayOf, runBacktest } from "./backtest.mjs";
import { clusteredT, conservativeT, realityCheck, weekOf, REALITY } from "./backtestStats.mjs";

export const SEARCH = { minTrades: 30, fdr: 0.1, top: 12, minMembersForMemberCluster: 5 };

/** Benjamini–Hochberg q-values, in the input order. q_(i) = min over j ≥ i of m·p_(j)/j, capped at 1. */
export function bhQValues(ps) {
  const m = ps.length;
  const order = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const q = new Array(m);
  let run = 1;
  for (let k = m - 1; k >= 0; k -= 1) {
    const [p, i] = order[k];
    run = Math.min(run, (p * m) / (k + 1));
    q[i] = Math.min(1, run);
  }
  return q;
}

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);

/** One variant through the engine and the cheap checks (no placebo). `null` stats when it has no trades. */
export function evaluateVariant({ variant, bars, benchBars, seed = REALITY.seed }) {
  const run = runBacktest({ signals: variant.signals, bars, benchBars, rules: variant.spec.rules });
  const s = run.stats;
  const base = { id: variant.id, dim: variant.dim, label: variant.label, spec: variant.spec, signals: variant.signals.length, n: s?.trades || 0 };
  if (!s) return { ...base, stats: null };
  const reality = realityCheck({ trades: run.trades, bars, benchBars, rules: run.rules, seed, placebo: false });
  const ex = run.trades.map((t) => t.excess);
  const byWeek = conservativeT(clusteredT(ex, run.trades.map((t) => weekOf(dayOf(t.entry)))));
  const members = reality.cluster?.members || 0;
  const useMember = members >= SEARCH.minMembersForMemberCluster && reality.cluster?.pOne != null;
  return {
    ...base,
    stats: {
      avgExcess: s.avgExcess, avgTrade: s.avgTrade, excessTotal: s.excessTotal, total: s.total, benchmarkTotal: s.benchmarkTotal,
      hitRate: s.hitRate, beatRate: s.beatRate, from: s.from, to: s.to
    },
    ci: reality.bootstrap?.meanExcess || null,
    members,
    nEff: reality.cluster?.nEff ?? null,
    t: useMember ? reality.cluster.t : r4(byWeek?.t),
    p: useMember ? reality.cluster.pOne : r4(byWeek?.pOne),
    pBasis: useMember ? "member" : "week"
  };
}

/**
 * Rank evaluated rows: tested = at least `minTrades` trades and a p-value. Sorted by mean excess per trade; q-values
 * over the tested set; `passes` when q ≤ fdr and the mean excess is positive.
 */
export function rankFindings(rows, { minTrades = SEARCH.minTrades, fdr = SEARCH.fdr } = {}) {
  const tested = rows.filter((r) => r.stats && r.n >= minTrades && r.p != null);
  const q = bhQValues(tested.map((r) => r.p));
  const ranked = tested.map((r, i) => ({ ...r, q: r4(q[i]), passes: q[i] <= fdr && (r.stats.avgExcess ?? 0) > 0 }))
    .sort((a, b) => (b.stats.avgExcess ?? -Infinity) - (a.stats.avgExcess ?? -Infinity) || String(a.id).localeCompare(String(b.id)));
  const untested = rows.filter((r) => !tested.includes(r)).map((r) => ({ id: r.id, dim: r.dim, label: r.label, n: r.n, signals: r.signals }));
  return { built: rows.length, tested: tested.length, passing: ranked.filter((r) => r.passes).length, findings: ranked, untested };
}

/** The warning shown with every search, with the counts filled in. */
export function searchWarning({ built, tested, passing }, { minTrades = SEARCH.minTrades, fdr = SEARCH.fdr } = {}) {
  const expectedFalse = passing ? Math.max(0, Math.round(passing * fdr * 10) / 10) : 0;
  return [
    `${tested} variants were tested (${built} built; ${built - tested} had fewer than ${minTrades} priced trades and were not tested).`,
    `With that many tries, some will look good by chance: at 5% significance about ${Math.round(tested * 0.05)} would pass with no real effect at all.`,
    passing
      ? `${passing} pass a false discovery rate of ${fdr * 100}% (Benjamini–Hochberg q ≤ ${fdr}); expect about ${expectedFalse} of those to be false anyway.`
      : `None pass a false discovery rate of ${fdr * 100}% (Benjamini–Hochberg q ≤ ${fdr}).`,
    "Variants overlap (the same trades sit in many), all are in-sample on one period, and a pass is a lead to check out of sample, not an edge."
  ].join(" ");
}

/**
 * Evaluate every variant, rank, then run the full check (with placebo) on the top `top` rows. `onProgress(done, total)`
 * is called after each variant. Deterministic for a given seed.
 */
export function evaluateVariants({ variants, bars, benchBars, minTrades = SEARCH.minTrades, fdr = SEARCH.fdr, top = SEARCH.top, seed = REALITY.seed, onProgress = () => {} }) {
  const rows = [];
  const total = variants.length + top;
  variants.forEach((variant, i) => {
    rows.push(evaluateVariant({ variant, bars, benchBars, seed }));
    onProgress(i + 1, total);
  });
  const ranked = rankFindings(rows, { minTrades, fdr });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const head = ranked.findings.slice(0, top);
  const finalTotal = variants.length + head.length;
  head.forEach((row, i) => {
    const v = byId.get(row.id);
    const run = runBacktest({ signals: v.signals, bars, benchBars, rules: v.spec.rules });
    const full = realityCheck({ trades: run.trades, bars, benchBars, rules: run.rules, seed });
    row.placebo = full.placebo ? { pct: full.placebo.pct, p: full.placebo.p, iters: full.placebo.iters } : null;
    row.verdict = full.verdict;
    onProgress(variants.length + i + 1, finalTotal);
  });
  return { ...ranked, minTrades, fdr, seed, warning: searchWarning(ranked, { minTrades, fdr }) };
}
