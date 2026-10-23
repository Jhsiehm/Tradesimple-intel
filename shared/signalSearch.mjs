/**
 * Signal search, pure: many backtest variants in, a ranked list with multiple-testing correction out.
 *
 * Each variant runs through the same engine as a single backtest. Variants with fewer than `minTrades` priced trades
 * are not tested (and do not count toward m). The tested ones get a one-sided p-value for "mean excess per trade > 0"
 * from a t-test clustered by member (by entry week when a variant has fewer than 10 members; SE never below the iid
 * one), then Benjamini–Hochberg
 * q-values across all m tested. The top findings also get the random-entry placebo.
 */
import { dayOf, runBacktest } from "./backtest.mjs";
import { clusteredT, conservativeT, realityCheck, weekOf, REALITY } from "./backtestStats.mjs";

export const SEARCH = { minTrades: 30, fdr: 0.1, top: 12, minMembersForMemberCluster: 10 };

/** Benjamini–Hochberg q-values, in the input order. q_(i) = min over j ≥ i of m·p_(j)/j, capped at 1. */
export function bhQValues(ps) {
  if (ps.some(p => !Number.isFinite(p) || p < 0 || p > 1)) throw new RangeError("BH requires finite p-values in [0, 1].");
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
  const byMember = conservativeT(clusteredT(ex, run.trades.map(t => t.actorLabel || t.actor || "")));
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
    inference: reality.inference,
    t: useMember ? byMember?.t : byWeek?.t,
    // Preserve full precision through multiple-testing decisions.
    p: reality.inference?.status === "withheld" ? null : (useMember ? byMember?.pOne : byWeek?.pOne),
    pBasis: useMember ? "member" : "week"
  };
}

/**
 * Rank evaluated rows: tested = at least `minTrades` trades and a p-value. Sorted by mean excess per trade; q-values
 * over the tested set; `passes` when q ≤ fdr and the mean excess is positive.
 */
export function rankFindings(rows, { minTrades = SEARCH.minTrades, fdr = SEARCH.fdr } = {}) {
  const tested = rows.filter((r) => r.stats && r.n >= minTrades && Number.isFinite(r.p) && r.p >= 0 && r.p <= 1);
  const q = bhQValues(tested.map((r) => r.p));
  const ranked = tested.map((r, i) => ({ ...r, q: q[i], passes: q[i] <= fdr && (r.stats.avgExcess ?? 0) > 0 }))
    .sort((a, b) => (b.stats.avgExcess ?? -Infinity) - (a.stats.avgExcess ?? -Infinity) || String(a.id).localeCompare(String(b.id)));
  const untested = rows.filter((r) => !tested.includes(r)).map((r) => ({ id: r.id, dim: r.dim, label: r.label, n: r.n, signals: r.signals, reasons: r.inference?.reasons || [] }));
  return { built: rows.length, tested: tested.length, passing: ranked.filter((r) => r.passes).length, findings: ranked, untested };
}

/** The warning shown with every search, with the counts filled in. */
export function searchWarning({ built, tested, passing }, { minTrades = SEARCH.minTrades, fdr = SEARCH.fdr } = {}) {
  return [
    `${tested} variants were tested (${built} built; ${built - tested} were not tested: fewer than ${minTrades} priced trades, unavailable p-values, or failed inference safeguards).`,
    `With that many tries, some will look good by chance: at 5% significance about ${Math.round(tested * 0.05)} would pass with no real effect at all.`,
    passing
      ? `${passing} meet the nominal Benjamini–Hochberg threshold (q ≤ ${fdr}).`
      : `None meet the nominal Benjamini–Hochberg threshold (q ≤ ${fdr}).`,
    `The ${fdr * 100}% FDR target concerns the expected false-discovery proportion over repeated experiments under valid p-values and appropriate dependence assumptions; it does not estimate the number of false findings in this run.`,
    "Overlapping variants may violate those assumptions. This correction covers only this search, not repeated searches or prior experimentation. All findings are exploratory and require an untouched prospective evaluation."
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
