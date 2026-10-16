/** Conservative assessment of a frozen run, never a claim of complete source history. */
export function researchReadiness(run, universe = []) {
  const counts = run?.counts || {};
  const exclusions = run?.caveats?.exclusions || {};
  const priceReasons = [
    "noPrice",
    "notPriced",
    "noBenchmark",
    "beforePriceHistory",
    "noBarAfterSignal",
    "entryGap",
    "badPrice",
  ];
  const priceGaps = priceReasons.reduce((n, key) => n + (exclusions[key] || 0), 0);
  const sourceWarnings = (run?.caveats?.items || [])
    .filter((c) =>
      [
        "f4pending",
        "f4failed",
        "f4issuers",
        "f4capped",
        "f4short",
        "f4rows",
        "contractCover",
        "contractFail",
        "evidenceCoverage",
        "ldaGap",
        "cap",
        "symcap",
      ].includes(c.id),
    )
    .map((c) => c.text);
  const status = !run
    ? "unchecked"
    : run.building
      ? "building"
      : !run.ok
        ? "failed"
        : sourceWarnings.length
          ? "source-gaps"
          : !counts.signals
            ? "no-signals"
            : priceGaps || (counts.priced != null && counts.tickers > counts.priced)
              ? "price-gaps"
              : !counts.used
                ? "no-trades"
                : "review";
  const labels = {
    "source-gaps": "Source history needs review",
    unchecked: "Not checked",
    building: "Inputs still building",
    failed: "Run failed",
    "no-signals": "No matching signals returned",
    "price-gaps": "Price coverage needs review",
    "no-trades": "No executable trades",
    review: "Ready for evidence review",
  };
  const next = {
    "source-gaps":
      "The source reports incomplete or sampled records. Audit or backfill these gaps before interpreting the test; zero returned signals does not establish no events.",
    unchecked: "Define the question and run a source check.",
    building:
      "Wait for source or price loading to finish, then check again. Zero signals during loading is not a finding.",
    failed: "Resolve the recorded error and check again.",
    "no-signals": "Review dates, filters and source history. This does not prove no events occurred.",
    "price-gaps": "Inspect missing price history and excluded symbols before interpreting returns.",
    "no-trades": "Inspect exclusions and the holding period. Signals are not the same as completed trades.",
    review:
      "Review source timing, sample size and exclusions before using this experiment in a comparison. Completed loading does not certify historical completeness.",
  };
  return {
    status,
    label: labels[status],
    next: next[status],
    priceGaps,
    sourceWarnings,
    tickers: [...new Set(universe)].map((symbol) => {
      const trades = (run?.trades || []).filter((t) => t.symbol === symbol);
      const reasons = Object.entries(run?.caveats?.excludedSymbols || {})
        .filter(([, symbols]) => symbols.includes(symbol))
        .map(([reason]) => reason);
      return {
        symbol,
        trades: trades.length,
        first: trades.map((t) => t.signal).sort()[0] || null,
        last:
          trades
            .map((t) => t.signal)
            .sort()
            .at(-1) || null,
        status: !run
          ? "Not checked"
          : run.pending?.includes(symbol)
            ? "Prices loading"
            : reasons.length
              ? `Excluded: ${reasons.join(", ")}`
              : trades.length
                ? "Executed trades available"
                : "No executed trades; coverage unverified",
      };
    }),
  };
}
