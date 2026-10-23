/** Evidence classification, not a certification API. Provider/import assertions cannot unlock strict claims. */
export const DATA_VALIDITY_VERSION = 1;
const builtIn = new Set(["congress", "form4", "contracts", "lobbying"]);
const list = (value) => (Array.isArray(value) ? value : []);

/** Describe exactly what price loading observed; series presence does not prove session completeness. */
export function assessPriceCoverage({ requested = [], bars = {}, pending = [], missing = [], stale = [] } = {}) {
  const symbols = [...new Set(requested)].sort();
  const series = symbols.map((symbol) => {
    const rows = list(bars[symbol]);
    let previous = -Infinity,
      invalidRows = 0;
    for (const row of rows) {
      if (
        !Array.isArray(row) ||
        !Number.isInteger(row[0]) ||
        row[0] <= previous ||
        !Number.isFinite(row[1]) ||
        row[1] <= 0 ||
        !Number.isFinite(row[2]) ||
        row[2] <= 0
      )
        invalidRows++;
      if (Array.isArray(row) && Number.isFinite(row[0])) previous = row[0];
    }
    return {
      symbol,
      rows: rows.length,
      firstDay: rows[0]?.[0] ?? null,
      lastDay: rows.at(-1)?.[0] ?? null,
      invalidRows,
    };
  });
  return {
    requested: symbols,
    loaded: series.filter((s) => s.rows > 0).map((s) => s.symbol),
    absent: series.filter((s) => !s.rows).map((s) => s.symbol),
    pending: [...pending],
    missing: [...missing],
    stale: [...stale],
    series,
    sessionCompleteness: "not-verified",
    adjustmentValidation: "not-independently-verified",
    delistedCoverage: "not-certified",
  };
}

export function assessResearchDataValidity({ source, filters = {}, coverage = {}, signals = [], prices = null } = {}) {
  const limitations = [];
  const add = (code, text) => limitations.push({ code, text });
  const timing = { sourceDate: 0, assumedLag: 0, assertedOrUnknown: 0, independentlyVerified: 0 };
  for (const signal of signals) {
    const basis =
      signal.availabilityBasis ||
      (source === "contracts"
        ? "assumed-publication-lag"
        : builtIn.has(source)
          ? "source-derived-public-date"
          : "unknown");
    if (basis === "assumed-publication-lag") timing.assumedLag++;
    else if (basis === "source-derived-public-date" && builtIn.has(source)) timing.sourceDate++;
    else timing.assertedOrUnknown++;
  }
  if (timing.assumedLag || source === "contracts" || filters.awardWithinDays)
    add(
      "assumed-publication",
      "Contract availability uses an assumed action-to-publication delay; an observed original publication history is required.",
    );
  add(
    "publication-unverified",
    "Filing/posting dates are source-derived or importer-asserted. Original publication timestamps, revisions and availability at the decision time are not independently verified.",
  );
  add(
    "historical-universe",
    "Historical universe membership, delisted/acquired securities, and effective-dated security and issuer mappings are not certified.",
  );
  if (filters.sector)
    add("current-sector", "Sector filtering uses current classifications applied to historical records.");
  if (filters.committee || filters.nearHearingDays)
    add(
      "current-committee",
      "Committee filters use current assignments; historical membership and hearing announcement availability are not established.",
    );
  if (filters.nearHearingDays && !filters.hearingKnown)
    add("future-hearing", "The hearing filter may select on events after the disclosure date.");
  if (coverage.selection?.capped)
    add(
      "run-selection-cap",
      "The run caps signals or symbols; results describe a selected subset of eligible signals.",
    );
  if (coverage.auxiliary?.contracts?.completeness === "sample")
    add(
      "contract-filter-sample",
      "The contract filter selects using the largest 100 actions in a trailing-year sample, not all historical contracts.",
    );
  if (coverage.store?.coveredFrom && coverage.from && coverage.from < coverage.store.coveredFrom)
    add(
      "store-start-gap",
      `Requested history starts ${coverage.from}, before the Form 4 store starts ${coverage.store.coveredFrom}.`,
    );
  const sourceGaps = [];
  const gap = (code, count) => {
    if (count > 0) sourceGaps.push({ code, count });
  };
  gap("amendment-lines-excluded", coverage.store?.amended);
  gap("filings-failed", coverage.filings?.failed);
  gap("filings-pending", coverage.filings?.pending);
  gap("issuers-capped", list(coverage.providerCoverage?.capped).length);
  gap("issuer-history-short", list(coverage.providerCoverage?.shortList).length);
  gap("feed-failures", list(coverage.failures).length);
  gap("feed-gaps", list(coverage.gaps).length);
  for (const chamber of ["house", "senate"]) {
    gap(`${chamber}-index-failures`, list(coverage.progress?.[chamber]?.indexFailures).length);
    gap(`${chamber}-unparsed`, coverage.progress?.[chamber]?.failed);
    gap(`${chamber}-paper`, coverage.progress?.[chamber]?.paper);
  }
  if (coverage.building || coverage.filings?.listingIncomplete)
    add("collection-incomplete", "Collection is still building or filing lists are incomplete.");
  add(
    "source-coverage",
    coverage.completeness === "sample"
      ? "The source is a capped sample; absence of a returned event is not evidence that no event occurred."
      : "Historical source completeness and amendment coverage are not certified, even when all requested records loaded.",
  );
  if (sourceGaps.length)
    add(
      "known-source-gaps",
      "Known missing, failed, capped or unparsed source records are listed in sourceCoverage.gaps.",
    );
  const priceCoverage = prices ? assessPriceCoverage(prices) : null;
  if (!priceCoverage) add("prices-unassessed", "Price evidence has not been assessed at this stage.");
  else {
    if (
      priceCoverage.absent.length ||
      priceCoverage.pending.length ||
      priceCoverage.missing.length ||
      priceCoverage.stale.length ||
      priceCoverage.series.some((s) => s.invalidRows)
    )
      add(
        "price-gaps",
        "Price histories are absent, pending, missing, stale or malformed; inspect priceCoverage before interpreting exclusions.",
      );
    add(
      "price-history-unverified",
      "Loaded daily bars do not certify complete trading sessions, independent corporate-action adjustments or delisted-security returns.",
    );
  }
  return {
    version: DATA_VALIDITY_VERSION,
    claimScope: "exploratory-only",
    strictHistoricalTradability: {
      eligible: false,
      status: "not-established",
      blockers: limitations.map((l) => l.code),
    },
    timing: { ...timing, precision: "day", verification: "not-certified" },
    identity: {
      universe: builtIn.has(source) ? "current-registry" : "importer-asserted-or-unknown",
      historicalValidity: "not-certified",
    },
    sourceCoverage: {
      declared: coverage.completeness || "unknown",
      certification: "not-certified",
      gaps: sourceGaps,
      selection: coverage.selection || null,
      store: coverage.store || null,
      auxiliary: coverage.auxiliary || null,
    },
    priceCoverage,
    limitations,
  };
}

export function dataValidityNote(report) {
  return {
    id: "researchDataValidity",
    level: "warn",
    text: `This run supports exploratory analysis. Historical trading eligibility is not established: publication timing, historical security identities, source completeness and price coverage still need independent validation.${report.timing.assumedLag ? " Contract publication dates use assumed delays." : ""} Inspect the data-validity report for specific gaps and evidence requirements.`,
  };
}

/** Gate for consumers that require a historical-tradability claim; ordinary exploration remains available. */
export function requireStrictHistoricalTradability(report) {
  // No current path independently validates the required evidence; a caller-supplied eligible flag is insufficient.
  throw new Error(
    `Strict historical tradability is not established (${report?.strictHistoricalTradability?.blockers?.join(", ") || "missing verified evidence"}).`,
  );
}
