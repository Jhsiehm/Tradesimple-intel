import { cleanPolicyProtocol, policyInstant, policyDate } from "./policyProtocol.mjs";
import {
  MINUTE,
  policyDay,
  policyAvailability,
  earliestPolicyNews,
  policyNewsCoverage,
  policyExposure,
  policyBarIndex,
  policyPriceWindow,
} from "./policyEvidence.mjs";

const CLAIM_CEILING =
  "Conditional descriptive comparison on supplied evidence; no verified historical, causal, or investable edge.";
const LIMITATIONS = [
  "Archive coverage must span the action instant, or start of its source action date when timing is day-only, through selected news. Completeness and imported timestamps/mappings are researcher assertions, not independent certification. No claim covers news outside the named archive.",
  "Each row is a matched event/security return comparison, not a capital-constrained portfolio. Means do not represent executable portfolio returns; drawdown, Sharpe, and significance are not calculated.",
  "Events and securities can overlap and share policy shocks. Uncertainty is unavailable without a defensible dependence-aware sampling and identification design.",
  "A historically dated exposure assertion does not prove it was recorded prospectively. Revisions, missing events, security survival, and selection can bias this conditional cohort.",
  "One-minute opens/closes approximate fills, not executable quotes. Round-trip costBps is deducted once per completed strategy and long benchmark; short borrow, liquidity, market impact, dividends, and corporate actions require separate audit.",
  "Legislative scope uses sourceEventDate when supplied, otherwise the UTC action date. Availability-period checks and holdout assignment use UTC availability dates; both action scope and availability must fall within the protocol dates.",
  "Cash-session weekdays are checked in America/New_York; the supplied price history must itself respect exchange holidays and early closes. Missing minutes are excluded rather than filled.",
];
const iso = (at) => new Date(at).toISOString();
// A strict later bar avoids executing at the same instant as the information/latency boundary.
const nextMinute = (at) => (Math.floor(at / MINUTE) + 1) * MINUTE;
const average = (values) => (values.length ? values.reduce((a, b) => a + b / values.length, 0) : null);
function voteInstantKey(event) {
  const types = Array.isArray(event.eventTypes) ? event.eventTypes : [event.type],
    at = policyInstant(event.eventAt);
  return event.eventPrecision === "instant" && types.includes("vote") && at !== null ? `${event.billId}:${at}` : null;
}
function groupSummary(rows) {
  return {
    pairs: rows.length,
    events: new Set(rows.map((r) => r.eventId)).size,
    meanPolicyNet: average(rows.map((r) => r.returns.policyNet)),
    meanNewsNet: average(rows.map((r) => r.returns.newsNet)),
    meanPairedDifference: average(rows.map((r) => r.returns.pairedDifference)),
    meanPolicyExcess: average(rows.map((r) => r.returns.policyExcess)),
    meanNewsExcess: average(rows.map((r) => r.returns.newsExcess)),
  };
}
function evidenceError(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return "An evidence object is required.";
  for (const [key, max] of [
    ["events", 10000],
    ["news", 50000],
    ["exposures", 50000],
    ["bars", 1000000],
  ]) {
    if (
      !Array.isArray(evidence[key]) ||
      evidence[key].length > max ||
      evidence[key].some((v) => !v || typeof v !== "object" || Array.isArray(v))
    )
      return `${key} must be an array of records (maximum ${max}).`;
  }
  if (
    evidence.newsCoverage !== undefined &&
    (!Array.isArray(evidence.newsCoverage) ||
      evidence.newsCoverage.length > 10000 ||
      evidence.newsCoverage.some((v) => !v || typeof v !== "object" || Array.isArray(v)))
  )
    return "newsCoverage must be an array of coverage assertions.";
  return null;
}
function prepare(protocol, evidence, { asOf = new Date().toISOString() } = {}) {
  const asOfMs = policyInstant(asOf);
  if (asOfMs === null)
    return {
      error: "asOf must be a valid frozen evaluation instant.",
      protocol: null,
      rows: [],
      exclusions: [],
      counts: { inputEvents: 0, uniqueEvents: 0, candidatePairs: 0, completedPairs: 0 },
    };
  asOf = iso(asOfMs);
  const clean = cleanPolicyProtocol(protocol, { now: asOf, registeredAt: protocol?.registeredAt });
  if (!clean.ok)
    return {
      error: clean.error,
      protocol: null,
      rows: [],
      exclusions: [],
      counts: { inputEvents: 0, uniqueEvents: 0, candidatePairs: 0, completedPairs: 0 },
    };
  const p = clean.protocol,
    shapeError = evidenceError(evidence);
  if (shapeError)
    return {
      error: shapeError,
      protocol: p,
      rows: [],
      exclusions: [],
      counts: { inputEvents: evidence?.events?.length || 0, uniqueEvents: 0, candidatePairs: 0, completedPairs: 0 },
    };
  if (
    evidence.events.length * p.universe.length > 25000 ||
    evidence.events.length * p.universe.length * p.holdingMinutes > 8000000
  )
    return {
      error:
        "Study workload exceeds the pilot limit (25,000 event/security pairs or 8 million holding-minute pairs); reduce scope.",
      protocol: p,
      rows: [],
      exclusions: [],
      counts: { inputEvents: evidence.events.length, uniqueEvents: 0, candidatePairs: 0, completedPairs: 0 },
    };
  const rows = [],
    exclusions = [],
    seen = new Set(),
    sourceVersions = new Map(),
    sourceIds = new Map(),
    eventIds = new Map(),
    voteAnchors = new Map(),
    ambiguousVoteGroups = new Set();
  const notes = [];
  for (const [key, label] of [
    ["events", "Legislative events"],
    ["news", "Reviewed timestamped event/news associations"],
    ["exposures", "Predefined reviewed directional company exposures"],
    ["bars", "Continuous one-minute asset and benchmark prices"],
  ])
    if (!evidence[key].length) notes.push(`${label} are missing.`);
  if (
    !evidence.newsCoverage?.some((c) => c.complete === true) &&
    !evidence.news.some((n) => n.coverageComplete === true)
  )
    notes.push("An explicit complete, scoped news-archive coverage assertion is missing.");
  const counts = {
    inputEvents: evidence.events.length,
    uniqueEvents: 0,
    scopedEvents: 0,
    candidatePairs: 0,
    completedPairs: 0,
    duplicateEvents: 0,
    ambiguousRevisions: 0,
    ambiguousVoteEvents: 0,
    ambiguousVoteGroups: 0,
  };
  const exclude = (event, code, reason, symbol = null) =>
    exclusions.push({ eventId: String(event.id || ""), billId: event.billId || null, symbol, code, reason });
  for (const event of evidence.events) {
    if (!event.sourceRecordId) continue;
    const voteKey = voteInstantKey(event),
      voteRecords = voteAnchors.get(voteKey) || new Set();
    if (voteKey) {
      voteRecords.add(event.sourceRecordId);
      voteAnchors.set(voteKey, voteRecords);
    }
    const hashes = sourceVersions.get(event.sourceRecordId) || new Set();
    hashes.add(event.sourceHash);
    sourceVersions.set(event.sourceRecordId, hashes);
    const identity = `${event.sourceRecordId}:${event.sourceHash || ""}`,
      ids = sourceIds.get(identity) || new Set();
    ids.add(event.id);
    sourceIds.set(identity, ids);
    const anchors = eventIds.get(event.id) || new Set();
    anchors.add(identity);
    eventIds.set(event.id, anchors);
  }
  const prices = policyBarIndex(evidence.bars);
  const ordered = [...evidence.events].sort(
    (a, b) => String(a.eventAt).localeCompare(String(b.eventAt)) || String(a.id).localeCompare(String(b.id)),
  );
  for (const event of ordered) {
    const identity = `${event.sourceRecordId || event.id}:${event.sourceHash || ""}`;
    if (typeof event.id !== "string" || !event.id || seen.has(identity)) {
      counts.duplicateEvents++;
      exclude(event, "duplicate-event", "Missing event ID or duplicate source record/version.");
      continue;
    }
    seen.add(identity);
    counts.uniqueEvents++;
    if ((sourceIds.get(identity)?.size || 0) > 1 || (eventIds.get(event.id)?.size || 0) > 1) {
      exclude(
        event,
        "ambiguous-identity",
        "Conflicting event IDs or source anchors require explicit adjudication before analysis.",
      );
      continue;
    }
    if ((sourceVersions.get(event.sourceRecordId)?.size || 0) > 1) {
      counts.ambiguousRevisions++;
      exclude(
        event,
        "ambiguous-revision",
        "Multiple versions share the same source record; freeze an adjudicated version before analysis.",
      );
      continue;
    }
    const day =
        event.sourceEventDate === undefined
          ? policyDay(event.eventAt)
          : policyDate(event.sourceEventDate)
            ? event.sourceEventDate
            : null,
      types = Array.isArray(event.eventTypes) ? event.eventTypes : [event.type];
    if (
      !types.length ||
      types.some((t) => !["vote", "markup", "introduced", "passed", "enacted"].includes(t)) ||
      !day ||
      !p.billIds.includes(event.billId) ||
      !p.eventTypes.some((t) => types.includes(t)) ||
      day < p.from ||
      day > p.to
    ) {
      exclude(
        event,
        "out-of-scope",
        "Event is outside the registered bill, type, or date scope, or its action date is invalid.",
      );
      continue;
    }
    counts.scopedEvents++;
    counts.candidatePairs += p.universe.length;
    const voteKey = voteInstantKey(event);
    if (voteKey && voteAnchors.get(voteKey)?.size > 1) {
      counts.ambiguousVoteEvents++;
      ambiguousVoteGroups.add(voteKey);
      exclude(
        event,
        "ambiguous-vote-alias",
        "Distinct source records share a bill and exact vote instant; canonical vote identity and adjudication are required before counting them.",
      );
      continue;
    }
    const availability = policyAvailability(event, p);
    if (availability.error) {
      exclude(event, "unknown-availability", availability.error);
      continue;
    }
    if (
      availability.at > asOfMs ||
      (policyInstant(event.firstSeenAt) !== null && policyInstant(event.firstSeenAt) > asOfMs)
    ) {
      exclude(
        event,
        "future-availability",
        "Availability or source observation occurs after the frozen evaluation time.",
      );
      continue;
    }
    const availableDay = iso(availability.at).slice(0, 10);
    if (availableDay < p.from || availableDay > p.to) {
      exclude(event, "availability-outside-period", "The usable availability bound is outside the study dates.");
      continue;
    }
    const news = earliestPolicyNews(event, p, evidence);
    if (news.error) {
      exclude(event, "unknown-news", news.error);
      continue;
    }
    if (
      news.at > asOfMs ||
      (policyInstant(news.news.firstSeenAt) !== null && policyInstant(news.news.firstSeenAt) > asOfMs)
    ) {
      exclude(event, "future-news", "News timing or archive observation occurs after the frozen evaluation time.");
      continue;
    }
    const actionBound =
      event.eventPrecision === "instant" ? policyInstant(event.eventAt) : Date.parse(`${day}T00:00:00.000Z`);
    const newsCoverageFrom = Math.min(actionBound, availability.at);
    if (!policyNewsCoverage(p, evidence, newsCoverageFrom, news.at, event)) {
      exclude(
        event,
        "incomplete-news-coverage",
        "No explicit complete archive-coverage assertion spans the legislative action bound through selected news; later collector observation cannot hide earlier coverage.",
      );
      continue;
    }
    const policyEntry = nextMinute(availability.at + p.latencySeconds * 1000),
      newsEntry = nextMinute(news.at + p.latencySeconds * 1000);
    if (policyEntry >= news.at) {
      exclude(event, "not-before-news", "The first eligible policy execution minute does not precede matching news.");
      continue;
    }
    const newsExit = newsEntry + p.holdingMinutes * MINUTE;
    if (newsExit > asOfMs) {
      exclude(
        event,
        "future-outcome",
        "The complete news-comparison holding period has not ended by the frozen evaluation time.",
      );
      continue;
    }
    if (iso(newsExit - 1).slice(0, 10) > p.to) {
      exclude(event, "censored-outcome", "News strategy holding period ends after the requested study end.");
      continue;
    }
    const partition = availableDay < p.holdoutFrom ? "train" : "holdout";
    if (partition === "train" && iso(newsExit - 1).slice(0, 10) >= p.holdoutFrom) {
      exclude(event, "partition-boundary", "A training outcome crosses the frozen holdout boundary.");
      continue;
    }
    for (const symbol of p.universe) {
      const mapping = policyExposure(event, symbol, availability.at, evidence);
      if (mapping.error) {
        exclude(event, "invalid-exposure", mapping.error, symbol);
        continue;
      }
      const symbols = [...new Set([symbol, p.benchmark, ...(p.sectorBenchmark ? [p.sectorBenchmark] : [])])];
      const windows = new Map(
        symbols.map((s) => [
          s,
          {
            policy: policyPriceWindow(prices.index, s, policyEntry, p.holdingMinutes),
            news: policyPriceWindow(prices.index, s, newsEntry, p.holdingMinutes),
          },
        ]),
      );
      if ([...windows.values()].some((w) => !w.policy || !w.news)) {
        exclude(
          event,
          "missing-intraday-window",
          "Exact continuous one-minute asset and benchmark windows are missing, duplicated, invalid, or outside regular sessions; no daily or later-session substitution.",
          symbol,
        );
        continue;
      }
      const cost = p.costBps / 10000,
        side = mapping.exposure.side === "long" ? 1 : -1;
      const returnsFor = (s) => ({
        policy: windows.get(s).policy.exit / windows.get(s).policy.entry - 1,
        news: windows.get(s).news.exit / windows.get(s).news.entry - 1,
      });
      const asset = returnsFor(symbol),
        benchmark = returnsFor(p.benchmark);
      const policyNet = side * asset.policy - cost,
        newsNet = side * asset.news - cost;
      const returns = {
        policyGross: side * asset.policy,
        newsGross: side * asset.news,
        policyNet,
        newsNet,
        policyBenchmarkNet: benchmark.policy - cost,
        newsBenchmarkNet: benchmark.news - cost,
        policyExcess: policyNet - (benchmark.policy - cost),
        newsExcess: newsNet - (benchmark.news - cost),
        pairedDifference: policyNet - newsNet,
      };
      if (p.sectorBenchmark) {
        const sector = returnsFor(p.sectorBenchmark);
        returns.policySectorExcess = policyNet - (sector.policy - cost);
        returns.newsSectorExcess = newsNet - (sector.news - cost);
      }
      if (Object.values(returns).some((value) => !Number.isFinite(value))) {
        exclude(
          event,
          "nonfinite-return",
          "Supplied prices produce a nonfinite return; numeric comparison is invalid.",
          symbol,
        );
        continue;
      }
      rows.push({
        eventId: event.id,
        billId: event.billId,
        actionDate: day,
        availabilityDateUTC: availableDay,
        symbol,
        side: mapping.exposure.side,
        partition,
        availabilityAt: iso(availability.at),
        availabilityBasis: availability.basis,
        exposureId: mapping.exposure.id,
        newsCoverageFromAt: iso(newsCoverageFrom),
        newsId: news.news.id,
        newsAt: iso(news.at),
        newsArchive: p.newsArchive,
        newsTimeBasis: p.newsTimeBasis,
        policyEntryAt: iso(policyEntry),
        policyExitAt: iso(policyEntry + p.holdingMinutes * MINUTE),
        newsEntryAt: iso(newsEntry),
        newsExitAt: iso(newsExit),
        returns,
        evidenceStatus: "conditional-on-supplied-evidence",
        citations: [event.sourceUrl, mapping.exposure.sourceUrl, news.news.sourceUrl],
      });
    }
  }
  counts.ambiguousVoteGroups = ambiguousVoteGroups.size;
  counts.completedPairs = rows.length;
  counts.excludedPairs = counts.candidatePairs - rows.length;
  return { protocol: p, asOf, rows, exclusions, counts, notes, duplicatePriceMinutes: prices.conflicts.size };
}
export function assessPolicyReadiness(protocol, evidence, options) {
  const result = prepare(protocol, evidence, options);
  return {
    ready: !result.error && result.rows.length > 0,
    gaps: [
      ...new Set(result.error ? [result.error] : [...(result.notes || []), ...result.exclusions.map((e) => e.reason)]),
    ],
    asOf: result.asOf || options?.asOf || null,
    counts: result.counts,
    claimCeiling: CLAIM_CEILING,
  };
}
export function evaluatePolicyStudy(protocol, evidence, options) {
  const result = prepare(protocol, evidence, options);
  const { rows, exclusions, counts } = result;
  const p = result.protocol;
  const prospectiveHoldout = !!p && Date.parse(p.registeredAt) <= Date.parse(`${p.holdoutFrom}T00:00:00.000Z`);
  const gaps = [
    ...new Set(result.error ? [result.error] : [...(result.notes || []), ...exclusions.map((e) => e.reason)]),
  ];
  return {
    schemaVersion: 1,
    asOf: result.asOf || options?.asOf || null,
    status: result.error ? "invalid-input" : rows.length ? "conditional-analysis" : "insufficient-evidence",
    executed: rows.length > 0,
    protocol: p,
    claimCeiling: CLAIM_CEILING,
    counts,
    gaps,
    exclusions,
    rows,
    summary: {
      kind: "paired-event-return-comparison",
      units: "decimal-return",
      ...groupSummary(rows),
      train: groupSummary(rows.filter((r) => r.partition === "train")),
      holdout: groupSummary(rows.filter((r) => r.partition === "holdout")),
      holdoutStatus: prospectiveHoldout
        ? "registered-before-holdout-start; prior outcome access and registration integrity still require audit"
        : "retrospective exploratory chronological split; not a prospective untouched holdout",
      uncertainty: {
        available: false,
        reason: "No dependence-aware sampling/identification design; event/security observations are not independent.",
      },
      portfolioMetrics: null,
    },
    limitations: [
      ...LIMITATIONS,
      ...(p?.newsTimeBasis === "archive-first-seen"
        ? ["This compares archive discovery timestamps, not original news publication or all public news."]
        : []),
      ...(result.duplicatePriceMinutes
        ? [`${result.duplicatePriceMinutes} duplicate price minutes were rejected, including identical duplicates.`]
        : []),
    ],
  };
}
