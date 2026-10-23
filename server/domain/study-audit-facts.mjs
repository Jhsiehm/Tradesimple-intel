const count = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const scalar = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v, n = 240) => (typeof v === "string" ? v.slice(0, n) : null);
const object = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const numericFields = (value, fields) => Object.fromEntries(fields.map((key) => [key, scalar(value?.[key])]));
const boolean = (value) => (typeof value === "boolean" ? value : null);
const list = (value) => (Array.isArray(value) ? value : []);
const texts = (value) =>
  list(value)
    .slice(0, 8)
    .map((item) => text(item));
const omitted = (value) => Math.max(0, list(value).length - 8);
const recorded = (value) => value && typeof value === "object" && !Array.isArray(value);

/** Bounded recorded receipts only. Missing legacy reports remain unknown; no assessment is rerun. */
function researchMetadata(run) {
  const result = object(run.result),
    provenance = object(run.provenance);
  const inference = result.reality?.inference;
  const validity = result.dataValidity ?? provenance.dataValidity;
  const execution = result.executionAssessment;
  const trial = result.trial ?? provenance.trial;
  const strict = object(validity?.strictHistoricalTradability),
    prices = validity?.priceCoverage;
  return {
    inference: recorded(inference)
      ? {
          origin: `run:${run.id}#/result/reality/inference`,
          status: text(inference.status) || "unknown",
          basis: text(inference.basis),
          blocks: count(inference.blocks),
          reasons: texts(inference.reasons),
          omittedReasons: omitted(inference.reasons),
        }
      : null,
    dataValidity: recorded(validity)
      ? {
          origin: `run:${run.id}#/${result.dataValidity != null ? "result" : "provenance"}/dataValidity`,
          version: count(validity.version),
          claimScope: text(validity.claimScope) || "unknown",
          strictHistoricalTradability: {
            eligible: boolean(strict.eligible),
            status: text(strict.status) || "unknown",
            blockers: texts(strict.blockers),
            omittedBlockers: omitted(strict.blockers),
          },
          timing: {
            verification: text(validity.timing?.verification) || "unknown",
            precision: text(validity.timing?.precision),
            ...numericFields(validity.timing, [
              "sourceDate",
              "assumedLag",
              "assertedOrUnknown",
              "independentlyVerified",
            ]),
          },
          identity: {
            universe: text(validity.identity?.universe) || "unknown",
            historicalValidity: text(validity.identity?.historicalValidity) || "unknown",
          },
          sourceCoverage: {
            declared: text(validity.sourceCoverage?.declared) || "unknown",
            certification: text(validity.sourceCoverage?.certification) || "unknown",
            gaps: list(validity.sourceCoverage?.gaps)
              .slice(0, 8)
              .map((gap) => ({ code: text(gap?.code), count: count(gap?.count) })),
            omittedGaps: omitted(validity.sourceCoverage?.gaps),
          },
          priceCoverage: recorded(prices)
            ? {
                ...Object.fromEntries(
                  ["requested", "loaded", "absent", "pending", "missing", "stale"].map((key) => [
                    key,
                    Array.isArray(prices[key]) ? prices[key].length : null,
                  ]),
                ),
                sessionCompleteness: text(prices.sessionCompleteness) || "unknown",
                adjustmentValidation: text(prices.adjustmentValidation) || "unknown",
                delistedCoverage: text(prices.delistedCoverage) || "unknown",
              }
            : null,
        }
      : null,
    executionAssessment: recorded(execution)
      ? {
          origin: `run:${run.id}#/result/executionAssessment`,
          version: count(execution.version),
          classification: text(execution.classification) || "unknown",
          executablePortfolio: boolean(execution.executablePortfolio),
          liveTradingValidated: boolean(execution.liveTradingValidated),
          curveBasis: text(execution.curveBasis),
          tradeBasis: text(execution.tradeBasis),
          shortTrades: count(execution.shortTrades),
          markedOpenTrades: count(execution.markedOpenTrades),
          gates: list(execution.gates)
            .slice(0, 8)
            .map((gate) => ({ id: text(gate?.id), status: text(gate?.status) })),
          omittedGates: omitted(execution.gates),
        }
      : null,
    trial: recorded(trial)
      ? {
          origin: `run:${run.id}#/${result.trial != null ? "result" : "provenance"}/trial`,
          id: text(trial.id),
          kind: text(trial.kind),
          registeredAt: text(trial.registeredAt),
          priorOverlappingAttempts: count(trial.priorOverlappingAttempts),
          priorOverlappingVariants: count(trial.priorOverlappingVariants),
          interpretation: text(trial.interpretation, 500),
        }
      : null,
  };
}
const statFields = [
  "trades",
  "total",
  "benchmarkTotal",
  "excessTotal",
  "hitRate",
  "beatRate",
  "avgTrade",
  "avgExcess",
  "excessT",
  "maxDrawdown",
  "spanDays",
  "avgHoldDays",
];
const ruleFields = [
  "entry",
  "holdDays",
  "stopLossPct",
  "takeProfitPct",
  "sides",
  "sizing",
  "benchmark",
  "costBps",
  "slippageBps",
  "openTrades",
];

function counters(value) {
  const entries = Object.entries(object(value)).sort(([a], [b]) => a.localeCompare(b));
  const selected = entries
    .filter(([key]) => key.length <= 80 && !["origin", "recorded", "omittedFields"].includes(key))
    .slice(0, 20);
  return {
    ...Object.fromEntries(selected.map(([key, n]) => [key, count(n)])),
    omittedFields: entries.length - selected.length,
  };
}
function coverage(dataset, run) {
  const manifest = object(dataset?.manifest?.coverage),
    normalized = object(dataset?.coverage);
  const partitions = count(manifest.partitions),
    completed = count(manifest.completed);
  const partitionStatus =
    partitions !== null && partitions > 0 && completed !== null && completed <= partitions
      ? completed === partitions
        ? "count-reconciled-within-declared-scope"
        : "partial"
      : "unknown";
  return {
    origin: dataset ? `dataset:${dataset.id}#/manifest/coverage; /coverage` : `run:${run.id}#/provenance/coverage`,
    partitionStatus,
    partitions,
    completed,
    providerReceived: count(manifest.received),
    normalizedReceived: count(normalized.received),
    normalizedValid: count(normalized.valid),
    normalizedRejected: count(normalized.rejected),
    versions: count(manifest.versions),
    ambiguousVersions: count(manifest.ambiguousVersions),
    unmapped: count(manifest.unmapped),
    missingAmounts: count(manifest.missingAmounts),
    missingDates: count(manifest.missingDates),
    historicalOwnership: text(manifest.historicalOwnership) || "unknown",
    historicalCompleteness: "not-certified",
  };
}
function timing(dataset, run) {
  const policy = object(dataset?.manifest?.policy);
  const mode = text(policy.mode) || "unknown";
  return {
    origin: dataset ? `dataset:${dataset.id}#/manifest/policy` : `run:${run.id}#/provenance`,
    mode,
    defenseDays: count(policy.defenseDays),
    civilianDays: count(policy.civilianDays),
    evidence:
      mode === "assumed"
        ? "Assumed delays do not establish historical publication or tradability."
        : mode === "observed"
          ? "Collector observation does not establish original publication."
          : "Source assertions were not independently validated by this audit.",
    lookAheadAbsence: "not-established",
    beforeNews: "not-established",
  };
}
function archivedCaveats(dataset, run) {
  const procurement = /contract|procurement/i.test(`${dataset?.sourceFamily || ""} ${dataset?.source || ""}`);
  const saved = run.result?.caveats;
  const caveats = (Array.isArray(saved) ? saved : Array.isArray(saved?.items) ? saved.items : []).map(
    (c) => text(typeof c === "string" ? c : c?.text, 500) || "",
  );
  const mismatches = procurement ? caveats.filter((c) => /stock act|45.day|fil(?:ed|ing).{0,35}deadline/i.test(c)) : [];
  return {
    origin: `run:${run.id}#/result/caveats`,
    sourceSemanticMismatch: mismatches.length > 0,
    mismatchedCount: mismatches.length,
    example: mismatches[0] || null,
    treatment: mismatches.length
      ? "Archived original retained; stock-filing deadline claims are inapplicable to procurement and must not be reused."
      : "Original caveats remain archived; this audit does not certify their claims.",
  };
}
export function studyFacts({ experiment, run, dataset }) {
  const result = object(run.result),
    stats = object(result.stats),
    spec = object(result.spec);
  const manifest = object(dataset?.manifest),
    rules = object(run.inputs?.rules);
  const datasetExclusions = counters(manifest.dropped),
    runExclusions = counters(run.provenance?.dropped);
  return {
    id: experiment.id,
    title: text(experiment.title, 120),
    createdAt: experiment.createdAt,
    runId: run.id,
    inputHash: run.inputHash,
    engineId: run.engineId,
    datasetId: dataset?.id || null,
    datasetVersion: dataset?.version || null,
    datasetHash: dataset?.contentHash || null,
    source: text(dataset?.sourceFamily || dataset?.source || spec.source) || "unknown",
    symbols: (Array.isArray(manifest.scope?.symbols) ? manifest.scope.symbols : [])
      .filter((s) => typeof s === "string")
      .slice(0, 8),
    calculation: {
      origin: `run:${run.id}#/result`,
      status: result.ok === true ? (result.building ? "partial" : "completed-as-recorded") : "failed-or-unknown",
      replayPerformed: false,
      arithmeticVerified: false,
    },
    ...researchMetadata(run),
    coverage: coverage(dataset, run),
    exclusions: {
      origin: dataset ? `dataset:${dataset.id}#/manifest/dropped` : null,
      recorded: Object.keys(object(manifest.dropped)).length > 0,
      ...datasetExclusions,
    },
    runExclusions: {
      origin: `run:${run.id}#/provenance/dropped`,
      recorded: Object.keys(object(run.provenance?.dropped)).length > 0,
      ...runExclusions,
    },
    timing: timing(dataset, run),
    stats: {
      origin: `run:${run.id}#/result/stats`,
      units: "Return/rate fields are fractions; excessTotal is a difference of return fractions.",
      ...numericFields(stats, statFields),
    },
    window: {
      origin: `run:${run.id}#/result/stats; dataset:${dataset?.id || "unknown"}#/manifest/scope`,
      resultFrom: text(stats.from),
      resultTo: text(stats.to),
      sourceActionFrom: text(manifest.scope?.actionFrom),
      sourceActionTo: text(manifest.scope?.actionTo),
      publicFrom: text(manifest.scope?.publicFrom),
      publicTo: text(manifest.scope?.publicTo),
    },
    parameters: {
      origin: `run:${run.id}#/inputs/rules; dataset:${dataset?.id || "unknown"}#/manifest/cooldownDays`,
      ...Object.fromEntries(
        ruleFields.map((key) => [
          key,
          ["stopLossPct", "takeProfitPct"].includes(key) && Object.hasOwn(rules, key) && rules[key] === null
            ? "disabled"
            : ["string", "number", "boolean"].includes(typeof rules[key])
              ? rules[key]
              : null,
        ]),
      ),
      cooldownDays: count(manifest.cooldownDays),
    },
    counts: {
      origin: `run:${run.id}#/result/counts`,
      ...numericFields(result.counts, ["signals", "used", "skipped", "tickers", "priced"]),
    },
    archivedCaveats: archivedCaveats(dataset, run),
  };
}
