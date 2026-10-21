/**
 * A backtest's counts under names that say what each one counts, so "117" cannot be read as tickers when it is
 * paper filings. Absent counts are left out rather than shown as 0.
 */
export function countsForModel(c = {}) {
  const out = {
    matchedSignals: c.matched ?? c.offeredSignals,
    signalsOnChosenSides: c.signals,
    tradesPriced: c.used,
    signalsNotPriced: c.skipped,
    distinctTickersMatched: c.tickers,
    tickersWithPriceHistory: c.priced,
    unparsedPaperFilings: c.unparsedPaperFilings,
    unreadElectronicReports: c.unreadElectronicReports,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => typeof v === "number"));
}

/** The compact answer a backtest gives a model: stats, the biggest names, every warning, each feed's label. */
export function summarizeBacktest(out) {
  if (!out || out.ok === false) return out;
  const warn = (out.caveats?.items || []).filter((c) => c.level === "warn").map((c) => c.text);
  const info = (out.caveats?.items || []).filter((c) => c.level !== "warn").map((c) => c.text);
  const s = out.stats || {};
  const c = out.counts || {};
  return {
    ok: true,
    description: out.description,
    spec: out.spec,
    counts: countsForModel(c),
    stats: {
      trades: s.trades,
      totalReturn: s.total,
      annualized: s.annualized,
      benchmarkReturn: s.benchmarkTotal,
      benchmarkAnnualized: s.benchmarkAnnualized,
      excessReturn: s.excessTotal,
      hitRate: s.hitRate,
      beatBenchmarkRate: s.beatRate,
      avgTrade: s.avgTrade,
      medianTrade: s.medianTrade,
      avgExcessPerTrade: s.avgExcess,
      excessTStat: s.excessT,
      maxDrawdown: s.maxDrawdown,
      benchmarkMaxDrawdown: s.benchmarkMaxDrawdown,
      sharpeish: s.sharpeish,
      from: s.from,
      to: s.to,
      avgHoldDays: s.avgHoldDays,
    },
    topMembers: (out.byMember?.rows || []).slice(0, 5),
    topTickers: (out.byTicker?.rows || []).slice(0, 5),
    caveatTexts: [...warn, ...info.slice(0, 3)].slice(0, 6),
    feeds: (out.feeds || []).map((f) => ({ label: f.label, source: f.source, asOf: f.asOf })),
    source:
      (out.feeds || [])
        .map((f) => f.source)
        .filter(Boolean)
        .join(" · ") || out.source,
    asOf: out.asOf,
    latency: out.latency,
    cache: out.cache,
    isItReal: out.reality
      ? {
          verdict: out.reality.verdict?.text,
          excessCI95Lo: out.reality.bootstrap?.meanExcess.lo ?? null,
          excessCI95Hi: out.reality.bootstrap?.meanExcess.hi ?? null,
          placeboBeatShare: out.reality.placebo?.pct ?? null,
          placeboP: out.reality.placebo?.p ?? null,
          clusteredT: out.reality.cluster?.t ?? null,
          effectiveTrades: out.reality.cluster?.nEff ?? null,
        }
      : null,
  };
}
