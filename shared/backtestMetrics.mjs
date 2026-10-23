/** Pure numeric summaries for the signal-return engine. Preserve operation and output-key order for frozen replay. */
export const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10_000) / 10_000);
export const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const pctile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stdev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** Peak-to-trough drop of an index curve (starting value included). Dates are optional parallel labels. */
export function maxDrawdown(values, labels = []) {
  let peak = values[0];
  let peakAt = 0;
  let worst = 0;
  let from = 0;
  let to = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > peak) {
      peak = values[i];
      peakAt = i;
    }
    const dd = values[i] / peak - 1;
    if (dd < worst) {
      worst = dd;
      from = peakAt;
      to = i;
    }
  }
  return { depth: worst, from: labels[from] ?? from, to: labels[to] ?? to, peak: values[from], trough: values[to] };
}

export function breakdown(trades, keyOf, labelOf, limit = 30) {
  const by = new Map();
  for (const t of trades) {
    const k = keyOf(t);
    if (!k) continue;
    const row = by.get(k) || { key: k, label: labelOf(t), rets: [], ex: [] };
    row.rets.push(t.ret);
    row.ex.push(t.excess);
    by.set(k, row);
  }
  const rows = [...by.values()]
    .map((r) => ({
      key: r.key,
      label: r.label,
      n: r.rets.length,
      avg: r4(mean(r.rets)),
      median: r4(median(r.rets)),
      hitRate: r4(r.rets.filter((v) => v > 0).length / r.rets.length),
      avgExcess: r4(mean(r.ex)),
      beatRate: r4(r.ex.filter((v) => v > 0).length / r.ex.length),
    }))
    .sort((a, b) => b.n - a.n || (b.avgExcess ?? 0) - (a.avgExcess ?? 0));
  return { total: rows.length, rows: rows.slice(0, limit) };
}

/** Construct the recorded curve and summary statistics from unrounded trade paths. */
export function backtestMetrics(trades, curve, rules, sizeCap) {
  const result = {};
  const rets = trades.map((t) => t.ret);
  const ex = trades.map((t) => t.excess);
  const days = curve.days;
  const spanDays = days.length ? days.at(-1) - days[0] + 1 : 0;
  const total = curve.s.at(-1) - 1;
  const btotal = curve.b.at(-1) - 1;
  const annual = (v) => (spanDays >= 90 && v > -1 ? (1 + v) ** (365 / spanDays) - 1 : null);
  const dd = maxDrawdown(curve.s, curve.labels);
  const bdd = maxDrawdown(curve.b, curve.labels);
  const sd = stdev(curve.R);
  const sdx = stdev(curve.R.map((v, i) => v - curve.B[i]));
  const exBeat = ex.filter((v) => v > 0).length;
  const sdEx = stdev(ex);
  result.curve = curve.labels.map((d, i) => ({ d, s: r4(curve.s[i]), b: r4(curve.b[i]) }));
  result.stats = {
    trades: trades.length,
    total: r4(total),
    annualized: r4(annual(total)),
    benchmarkTotal: r4(btotal),
    benchmarkAnnualized: r4(annual(btotal)),
    excessTotal: r4(total - btotal),
    excessAnnualized: annual(total) != null && annual(btotal) != null ? r4(annual(total) - annual(btotal)) : null,
    hitRate: r4(rets.filter((v) => v > 0).length / rets.length),
    beatRate: r4(exBeat / ex.length),
    avgTrade: r4(mean(rets)),
    medianTrade: r4(median(rets)),
    avgExcess: r4(mean(ex)),
    medianExcess: r4(median(ex)),
    excessT: sdEx ? r2(mean(ex) / (sdEx / Math.sqrt(ex.length))) : null,
    best: r4(Math.max(...rets)),
    worst: r4(Math.min(...rets)),
    avgHoldDays: r2(mean(trades.map((t) => t.days))),
    maxDrawdown: r4(dd.depth),
    drawdownFrom: dd.from,
    drawdownTo: dd.to,
    benchmarkMaxDrawdown: r4(bdd.depth),
    wins: rets.filter((v) => v > 0).length,
    sessions: curve.R.length,
    dailyMean: curve.R.length ? Math.round(mean(curve.R) * 1e8) / 1e8 : null,
    dailySd: sd ? Math.round(sd * 1e8) / 1e8 : null,
    drawdownPeak: r4(dd.peak),
    drawdownTrough: r4(dd.trough),
    volatility: sd ? r4(sd * Math.sqrt(252)) : null,
    sharpeish: sd ? r2((mean(curve.R) / sd) * Math.sqrt(252)) : null,
    infoRatioish: sdx ? r2((mean(curve.R.map((v, i) => v - curve.B[i])) / sdx) * Math.sqrt(252)) : null,
    maxConcurrent: curve.maxOpen,
    avgConcurrent: r2(curve.avgOpen),
    activeShare: r4(curve.activeDays / Math.max(1, curve.R.length)),
    from: curve.labels[0],
    to: curve.labels.at(-1),
    spanDays,
    sharpeNote:
      "Sharpe-ish: mean daily return ÷ daily standard deviation × √252, risk-free rate taken as 0, calendar-time portfolio. A rough score on a short, overlapping sample, not a risk-adjusted performance claim.",
    weighting:
      rules.sizing === "amountMid"
        ? `Weighted by disclosed range midpoint (capped at $${sizeCap.toLocaleString("en-US")}).`
        : "Equal weight across open positions.",
  };
  return result;
}
