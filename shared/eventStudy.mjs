/** Descriptive market-adjusted event windows over immutable daily close snapshots. */
import { dayOf, isoOf } from "./backtest.mjs";
export const EVENT_STUDY_VERSION = 3;
const date = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayOf(s) !== null && isoOf(dayOf(s)) === s;
export function cleanEventStudy(raw) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some(
      (k) => !["from", "to", "before", "after", "sides", "model", "estimationSessions", "estimationGap"].includes(k),
    )
  )
    throw Error("Provide only event dates, before/after sessions, sides and expected-return model settings.");
  if (!date(raw.from) || !date(raw.to) || raw.from > raw.to)
    throw Error("Use valid publication dates with start on or before end.");
  const before = raw.before ?? 5,
    after = raw.after ?? 10,
    sides = raw.sides ?? "both";
  if (!Number.isInteger(before) || before < 0 || before > 20 || !Number.isInteger(after) || after < 0 || after > 60)
    throw Error("Use 0–20 sessions before and 0–60 sessions after the anchor.");
  if (!["buy", "sell", "both"].includes(sides)) throw Error("Select buy, sell or both publication sides.");
  const model = raw.model ?? "market-adjusted";
  if (!["market-adjusted", "market-model"].includes(model))
    throw Error("Choose market-adjusted or market-model expected returns.");
  if (model === "market-adjusted") {
    if (raw.estimationSessions !== undefined || raw.estimationGap !== undefined)
      throw Error("Estimation settings apply only to the market model.");
    return { from: raw.from, to: raw.to, before, after, sides, model };
  }
  const estimationSessions = raw.estimationSessions ?? 120,
    estimationGap = raw.estimationGap ?? 5;
  if (
    !Number.isInteger(estimationSessions) ||
    estimationSessions < 20 ||
    estimationSessions > 252 ||
    !Number.isInteger(estimationGap) ||
    estimationGap < 0 ||
    estimationGap > 60
  )
    throw Error("Use 20–252 estimation sessions and a gap of 0–60 sessions before event measurement.");
  return { from: raw.from, to: raw.to, before, after, sides, model, estimationSessions, estimationGap };
}
const validClose = (row) =>
  Array.isArray(row) && Number.isInteger(row[0]) && typeof row[2] === "number" && Number.isFinite(row[2]) && row[2] > 0;
function indexBars(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!Array.isArray(row) || !Number.isInteger(row[0]))
      throw Error("Price snapshots contain an invalid session date.");
    if (map.has(row[0])) throw Error("Price snapshots contain duplicate sessions.");
    map.set(row[0], row);
  }
  return map;
}
// Centered OLS with an intercept; estimation uses only complete pre-window returns.
function fitMarket(samples) {
  const n = samples.length,
    meanX = samples.reduce((sum, p) => sum + p.benchmarkReturn, 0) / n,
    meanY = samples.reduce((sum, p) => sum + p.securityReturn, 0) / n;
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const p of samples) {
    const x = p.benchmarkReturn - meanX,
      y = p.securityReturn - meanY;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  if (!Number.isFinite(xx) || !Number.isFinite(xy) || !Number.isFinite(yy) || xx / n <= 1e-14) return null;
  const beta = xy / xx,
    alpha = meanY - beta * meanX;
  const sse = samples.reduce((sum, p) => sum + (p.securityReturn - alpha - beta * p.benchmarkReturn) ** 2, 0);
  if (![alpha, beta, sse].every(Number.isFinite)) return null;
  return {
    alpha,
    beta,
    rSquared: yy > 1e-14 ? Math.max(0, Math.min(1, 1 - sse / yy)) : null,
    residualStdDev: Math.sqrt(sse / (n - 2)),
    n,
  };
}
/** Intercept-only CR1 variance, with connected ticker/calendar-window clusters.
 * Same-ticker dependence and overlapping windows across tickers are retained together.
 * Separate components are assumed independent; no p-value or confidence claim is made.
 */
export function eventStudyUncertainty(events) {
  const ordered = [...events].sort((a, b) => a.id.localeCompare(b.id));
  const parent = ordered.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i],
        b = ordered[j];
      if (a.symbol === b.symbol || (a.from <= b.to && b.from <= a.to)) parent[root(j)] = root(i);
    }
  const components = new Map();
  ordered.forEach((e, i) => {
    const key = root(i);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(e);
  });
  const blocks = [...components.values()].map((rows) => ({
    id: rows[0].id,
    eventIds: rows.map((e) => e.id),
    symbols: [...new Set(rows.map((e) => e.symbol))].sort(),
    from: rows.reduce((v, e) => (e.from < v ? e.from : v), rows[0].from),
    to: rows.reduce((v, e) => (e.to > v ? e.to : v), rows[0].to),
  }));
  const n = ordered.length,
    groups = blocks.length,
    meanCar = n ? ordered.reduce((sum, e) => sum + e.car, 0) / n : null;
  let standardError = null,
    status = "insufficient-groups";
  if (groups >= 2) {
    const scoreSquares = [...components.values()].reduce(
      (sum, rows) => sum + rows.reduce((score, e) => score + e.car - meanCar, 0) ** 2,
      0,
    );
    const variance = ((groups / (groups - 1)) * scoreSquares) / (n * n);
    if (!Number.isFinite(variance)) {
      status = "nonfinite-variance";
    } else {
      standardError = Math.sqrt(variance);
      status = standardError > 0 ? "estimated" : "zero-variance";
    }
  }
  return {
    method: "connected-ticker-window-cr1",
    n,
    groups,
    largestGroup: Math.max(0, ...blocks.map((b) => b.eventIds.length)),
    meanCar,
    standardError,
    status,
    blocks,
  };
}
export function runEventStudy({ base, spec: raw }) {
  const spec = cleanEventStudy(raw);
  if (
    !base ||
    base.kind ||
    !Array.isArray(base.signals) ||
    base.signals.length > 1500 ||
    new Set(base.signals.map((s) => s.id)).size !== base.signals.length
  )
    throw Error("Event studies require a single-source snapshot with at most 1,500 unique signals.");
  const benchmark = indexBars(base.benchBars?.SPY),
    sessions = [...benchmark.keys()].sort((a, b) => a - b);
  if (sessions.length < 2)
    throw Error("The frozen source must contain SPY prices. Run the source experiment with SPY first.");
  const stocks = new Map(),
    groups = new Map(),
    decisions = [];
  for (const signal of [...base.signals].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!date(signal.signalDate) || !["buy", "sell"].includes(signal.side) || typeof signal.symbol !== "string")
      throw Error("Invalid frozen source signal.");
    const decision = {
      signalId: signal.id,
      symbol: signal.symbol,
      publicDate: signal.signalDate,
      side: signal.side,
      anchorDate: null,
      eventId: null,
      reason: "included",
    };
    decisions.push(decision);
    if (signal.signalDate < spec.from || signal.signalDate > spec.to) {
      decision.reason = "outside-publication-window";
      continue;
    }
    if (spec.sides !== "both" && signal.side !== spec.sides) {
      decision.reason = "side-filter";
      continue;
    }
    const anchor = sessions.findIndex((d) => d > dayOf(signal.signalDate));
    if (anchor < 0) {
      decision.reason = "no-anchor-session";
      continue;
    }
    decision.anchorDate = isoOf(sessions[anchor]);
    decision.eventId = `${signal.symbol}:${decision.anchorDate}`;
    if (!groups.has(decision.eventId))
      groups.set(decision.eventId, {
        id: decision.eventId,
        symbol: signal.symbol,
        anchor,
        anchorDate: decision.anchorDate,
        records: [],
      });
    groups.get(decision.eventId).records.push(decision);
  }
  const events = [];
  for (const group of [...groups.values()].sort((a, b) => a.anchor - b.anchor || a.symbol.localeCompare(b.symbol))) {
    const start = group.anchor - spec.before,
      end = group.anchor + spec.after;
    let reason = start < 1 || end >= sessions.length ? "incomplete-calendar-window" : null;
    if (!stocks.has(group.symbol)) stocks.set(group.symbol, indexBars(base.bars[group.symbol]));
    const prices = stocks.get(group.symbol);
    if (!reason)
      for (let i = start - 1; i <= end; i++) {
        if (!validClose(benchmark.get(sessions[i]))) {
          reason = "missing-benchmark-close";
          break;
        }
        if (!validClose(prices.get(sessions[i]))) {
          reason = "missing-security-close";
          break;
        }
      }
    if (reason) {
      for (const record of group.records) record.reason = reason;
      continue;
    }
    let estimation = null;
    if (spec.model === "market-model") {
      const last = start - spec.estimationGap - 1,
        first = last - spec.estimationSessions + 1,
        samples = [];
      if (first < 1) reason = "incomplete-estimation-calendar";
      else
        for (let i = first; i <= last; i++) {
          const prior = sessions[i - 1],
            day = sessions[i];
          if (!validClose(benchmark.get(prior)) || !validClose(benchmark.get(day))) {
            reason = "missing-estimation-benchmark-close";
            break;
          }
          if (!validClose(prices.get(prior)) || !validClose(prices.get(day))) {
            reason = "missing-estimation-security-close";
            break;
          }
          const securityReturn = prices.get(day)[2] / prices.get(prior)[2] - 1,
            benchmarkReturn = benchmark.get(day)[2] / benchmark.get(prior)[2] - 1;
          if (!Number.isFinite(securityReturn) || !Number.isFinite(benchmarkReturn)) {
            reason = "nonfinite-estimation-return";
            break;
          }
          samples.push({ date: isoOf(day), securityReturn, benchmarkReturn });
        }
      if (!reason) {
        const fit = fitMarket(samples);
        if (!fit) reason = "unstable-estimation-fit";
        else
          estimation = {
            ...fit,
            from: isoOf(sessions[first]),
            to: isoOf(sessions[last]),
            precedingClose: isoOf(sessions[first - 1]),
            gap: spec.estimationGap,
            samples,
          };
      }
      if (reason) {
        for (const record of group.records) record.reason = reason;
        continue;
      }
    }
    let car = 0,
      marketAdjustedCar = 0,
      stockGrowth = 1,
      marketGrowth = 1;
    const path = [];
    for (let i = start; i <= end; i++) {
      const securityReturn = prices.get(sessions[i])[2] / prices.get(sessions[i - 1])[2] - 1;
      const benchmarkReturn = benchmark.get(sessions[i])[2] / benchmark.get(sessions[i - 1])[2] - 1;
      const expectedReturn = estimation ? estimation.alpha + estimation.beta * benchmarkReturn : benchmarkReturn;
      const marketAdjustedReturn = securityReturn - benchmarkReturn,
        abnormalReturn = securityReturn - expectedReturn;
      car += abnormalReturn;
      marketAdjustedCar += marketAdjustedReturn;
      stockGrowth *= 1 + securityReturn;
      marketGrowth *= 1 + benchmarkReturn;
      if (
        ![securityReturn, benchmarkReturn, expectedReturn, car, marketAdjustedCar, stockGrowth, marketGrowth].every(
          Number.isFinite,
        )
      ) {
        reason = "nonfinite-event-return";
        break;
      }
      path.push({
        offset: i - group.anchor,
        date: isoOf(sessions[i]),
        securityReturn,
        benchmarkReturn,
        expectedReturn,
        marketAdjustedReturn,
        abnormalReturn,
        cumulativeAbnormalReturn: car,
        marketAdjustedCar,
      });
    }
    if (reason) {
      for (const record of group.records) record.reason = reason;
      continue;
    }
    events.push({
      estimation,
      marketAdjustedCar,
      id: group.id,
      symbol: group.symbol,
      anchorDate: group.anchorDate,
      from: isoOf(sessions[start]),
      to: isoOf(sessions[end]),
      signalIds: group.records.map((r) => r.signalId),
      sides: [...new Set(group.records.map((r) => r.side))].sort(),
      path,
      car,
      buyHoldAbnormalReturn: stockGrowth - marketGrowth,
      overlappingEventIds: [],
    });
  }
  // Retain dependent windows and expose them; no independence-based significance claims.
  for (let i = 0; i < events.length; i++)
    for (let j = i + 1; j < events.length; j++)
      if (events[i].symbol === events[j].symbol && events[i].from <= events[j].to && events[j].from <= events[i].to) {
        events[i].overlappingEventIds.push(events[j].id);
        events[j].overlappingEventIds.push(events[i].id);
      }
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const curve = events.length
    ? events[0].path.map((p, i) => ({
        offset: p.offset,
        n: events.length,
        meanSecurityReturn: mean(events.map((e) => e.path[i].securityReturn)),
        meanBenchmarkReturn: mean(events.map((e) => e.path[i].benchmarkReturn)),
        meanExpectedReturn: mean(events.map((e) => e.path[i].expectedReturn)),
        marketAdjustedAar: mean(events.map((e) => e.path[i].marketAdjustedReturn)),
        marketAdjustedCaar: mean(events.map((e) => e.path[i].marketAdjustedCar)),
        aar: mean(events.map((e) => e.path[i].abnormalReturn)),
        caar: mean(events.map((e) => e.path[i].cumulativeAbnormalReturn)),
      }))
    : [];
  const exclusions = {};
  for (const d of decisions) if (d.reason !== "included") exclusions[d.reason] = (exclusions[d.reason] || 0) + 1;
  return {
    version: EVENT_STUDY_VERSION,
    uncertainty: eventStudyUncertainty(events),
    spec,
    benchmark: "SPY",
    counts: {
      publications: base.signals.length,
      eligiblePublications: [...groups.values()].reduce((n, g) => n + g.records.length, 0),
      candidateEvents: groups.size,
      completeEvents: events.length,
      excludedEvents: groups.size - events.length,
      includedPublications: events.reduce((n, e) => n + e.signalIds.length, 0),
      overlappingEvents: events.filter((e) => e.overlappingEventIds.length).length,
    },
    exclusions,
    decisions,
    events,
    curve,
    summary: events.length
      ? {
          marketAdjustedMeanCar: mean(events.map((e) => e.marketAdjustedCar)),
          meanCar: mean(events.map((e) => e.car)),
          meanBuyHoldAbnormalReturn: mean(events.map((e) => e.buyHoldAbnormalReturn)),
        }
      : null,
    caveats: [
      "Descriptive association around public disclosure, not a causal estimate, trading strategy, multi-factor model or new out-of-sample evaluation.",
      "Session zero is the first saved SPY session strictly after the publication date. Intraday release times are unavailable; same-day reactions can precede session zero.",
      "Windows use saved SPY session dates and close-to-close returns. A complete window requires each security and benchmark close plus the preceding close; missing windows are excluded as a whole without imputation. Calendar completeness is not independently certified.",
      "One equal-weight event per ticker and anchor session; all contributing publication IDs and sides remain visible. Sell disclosures are not sign-inverted. Both sides may share an event.",
      spec.model === "market-model"
        ? "Expected return is alpha + beta × SPY return, fitted separately for each event by OLS with an intercept using the registered pre-window sessions. No event-window or gap returns enter estimation. This is a single-market-factor model using raw returns, not risk-free-adjusted CAPM."
        : "Expected return equals SPY return (fixed alpha zero, beta one); no coefficients are estimated.",
      "Daily abnormal return is security return minus the selected expected return. CAR adds daily abnormal returns. The SPY buy-and-hold difference always compares compounded security and SPY returns, even when a market model is selected.",
      "Market-adjusted comparison returns use the same complete-event cohort as the selected model. Estimation exclusions can change the cohort relative to a separately registered market-adjusted study.",
      "Market-model estimation requires every registered close and refuses fits with benchmark daily-return variance at or below 1e-14 or nonfinite coefficients. Coefficients, residual dispersion and R-squared describe the estimation sample, not significance or predictive validity.",
      "Every relative-session mean uses the same complete-event cohort. Excluded coverage can bias that cohort. No transaction costs, portfolio capital allocation or investability claims apply.",
      "Uncertainty uses the intercept-only CR1 standard error of mean CAR. Events connected by a common ticker or overlapping calendar windows form one cluster, including transitive links. The correction is G/(G-1); at least two clusters are required. Cluster membership is preserved.",
      "Separate dependence clusters are assumed independent. Distant market shocks, few or unbalanced clusters, estimated-model uncertainty and selected coverage can undermine this estimate. Zero estimated variance does not establish certainty. No p-values, confidence intervals, multiple-testing adjustment or significance verdict are reported.",
      "The original source selection, caps, public-date assertions, current security identities and saved price-adjustment limitations remain. Pre-event observations are descriptive and must not enter historical decision rules.",
    ],
  };
}
