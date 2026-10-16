/** Deterministic sensitivity calculations over a frozen, single-source experiment. */
import { runConvergence } from "./convergence.mjs";
import { runBacktest, dayOf, isoOf } from "./backtest.mjs";
export const STRESS_VERSION = 3;
const number = (value, name, max, integer = false) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw Error(`${name} must be ${integer ? "an integer" : "a number"} from 0 to ${max}.`);
  return value;
};
export function cleanStressScenarios(input, rules, { sourceIds = [], priceSeries = {} } = {}) {
  if (!Array.isArray(input) || !input.length || input.length > 12) throw Error("Register 1–12 stress scenarios.");
  const ids = new Set();
  return input.map((s) => {
    if (
      !s ||
      typeof s !== "object" ||
      typeof s.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,59}$/.test(s.id) ||
      ids.has(s.id)
    )
      throw Error("Each scenario needs a distinct lowercase ID.");
    ids.add(s.id);
    if (typeof s.label !== "string" || !s.label.trim() || s.label.length > 200)
      throw Error("Each scenario needs a label up to 200 characters.");
    const allowed = new Set([
      "id",
      "label",
      "delayDays",
      "missingPct",
      "seed",
      "extraCostBps",
      "extraSlippageBps",
      "sourceIds",
      "priceShock",
    ]);
    if (Object.keys(s).some((k) => !allowed.has(k))) throw Error("Unsupported stress assumption.");
    const delayDays = number(s.delayDays ?? 0, "Reporting delay", 90, true),
      missingPct = number(s.missingPct ?? 0, "Missing signal percentage", 100),
      seed = number(s.seed ?? 0, "Missing signal seed", 4294967295, true),
      extraCostBps = number(s.extraCostBps ?? 0, "Additional cost", 300),
      extraSlippageBps = number(s.extraSlippageBps ?? 0, "Additional slippage", 300);
    if (rules.costBps + extraCostBps > 300 || rules.slippageBps + extraSlippageBps > 300)
      throw Error("Total cost and slippage must each stay within the engine limit of 300 bps per side.");
    const priceShock = s.priceShock === undefined ? undefined : cleanPriceShock(s.priceShock, priceSeries);
    if (!delayDays && !missingPct && !extraCostBps && !extraSlippageBps && !priceShock)
      throw Error("Each scenario must change at least one assumption; the baseline is included automatically.");
    if (
      s.sourceIds !== undefined &&
      (!Array.isArray(s.sourceIds) ||
        !s.sourceIds.length ||
        new Set(s.sourceIds).size !== s.sourceIds.length ||
        s.sourceIds.some((id) => !sourceIds.includes(id)))
    )
      throw Error("Select distinct source IDs from the frozen Convergence plan.");
    return {
      ...(priceShock ? { priceShock } : {}),
      ...(s.sourceIds ? { sourceIds: [...s.sourceIds].sort() } : {}),
      id: s.id,
      label: s.label.trim(),
      delayDays,
      missingPct,
      seed,
      extraCostBps,
      extraSlippageBps,
    };
  });
}
function cleanPriceShock(raw, priceSeries) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((k) => !["date", "changePct", "symbols"].includes(k))
  )
    throw Error("Price shock requires date, changePct and symbols.");
  const day = dayOf(raw.date);
  if (typeof raw.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || day === null || isoOf(day) !== raw.date)
    throw Error("Price shock requires a valid YYYY-MM-DD date.");
  if (
    typeof raw.changePct !== "number" ||
    !Number.isFinite(raw.changePct) ||
    raw.changePct === 0 ||
    raw.changePct < -95 ||
    raw.changePct > 500
  )
    throw Error("Price shock must be a nonzero percentage from -95 to 500.");
  if (
    !Array.isArray(raw.symbols) ||
    !raw.symbols.length ||
    raw.symbols.length > 40 ||
    new Set(raw.symbols).size !== raw.symbols.length ||
    raw.symbols.some((s) => typeof s !== "string" || !Object.hasOwn(priceSeries, s))
  )
    throw Error("Choose 1–40 distinct symbols from the frozen price series.");
  for (const symbol of raw.symbols) {
    const rows = priceSeries[symbol];
    if (!Array.isArray(rows) || !rows.some((b) => b[0] < day) || !rows.some((b) => b[0] >= day))
      throw Error(`Price shock for ${symbol} needs saved bars both before and on/after its date.`);
  }
  return { date: raw.date, changePct: raw.changePct, symbols: [...raw.symbols].sort() };
}
export function stressPriceSeries(base) {
  const result = Object.create(null);
  for (const series of [base.bars || {}, base.benchBars || {}])
    for (const [symbol, rows] of Object.entries(series)) result[symbol] = [...(result[symbol] || []), ...rows];
  return result;
}
/** One persistent level change; subsequent saved returns are retained, not resampled. */
export function shockPrices(base, shock) {
  if (!shock) return { inputs: base, priceChanges: [] };
  const policy = cleanPriceShock(shock, stressPriceSeries(base)),
    day = dayOf(policy.date),
    factor = 1 + policy.changePct / 100,
    selected = new Set(policy.symbols),
    priceChanges = [];
  const transform = (series, kind) =>
    Object.fromEntries(
      Object.entries(series || {}).map(([symbol, rows]) => {
        if (!selected.has(symbol)) return [symbol, rows];
        let affectedBars = 0,
          firstAffectedDate = null;
        const changed = rows.map((row) => {
          if (row[0] < day) return row;
          if (!Number.isFinite(row[2]) || row[2] <= 0 || (row[1] !== null && (!Number.isFinite(row[1]) || row[1] <= 0)))
            throw Error("Price shock requires valid positive frozen open/close prices.");
          const open = row[1] === null ? null : row[1] * factor,
            close = row[2] * factor;
          if (!Number.isFinite(close) || close <= 0 || (open !== null && (!Number.isFinite(open) || open <= 0)))
            throw Error("Price shock exceeds finite price limits.");
          affectedBars++;
          firstAffectedDate ??= isoOf(row[0]);
          return [row[0], open, close];
        });
        priceChanges.push({ symbol, series: kind, factor, affectedBars, firstAffectedDate });
        return [symbol, changed];
      }),
    );
  const bars = transform(base.bars, "asset"),
    benchBars = transform(base.benchBars, "benchmark");
  return { inputs: { ...base, bars, benchBars }, priceChanges };
}
// Fixed FNV-1a ranking: reproducible across runtimes and independent of source row order.
function rank(id, seed) {
  let h = 2166136261;
  for (const c of `${seed}:${id}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function stressInputs(base, scenario, maxSignals = 1500) {
  if (
    !Array.isArray(base.signals) ||
    base.signals.length > maxSignals ||
    new Set(base.signals.map((s) => s.id)).size !== base.signals.length
  )
    throw Error(`Stress inputs require up to ${maxSignals} uniquely identified frozen signals.`);
  const dropped = new Set(
    [...base.signals]
      .sort((a, b) => rank(a.id, scenario.seed) - rank(b.id, scenario.seed) || String(a.id).localeCompare(String(b.id)))
      .slice(0, Math.floor((base.signals.length * scenario.missingPct) / 100))
      .map((s) => s.id),
  );
  const decisions = [],
    signals = [];
  for (const original of base.signals) {
    const day = dayOf(original.signalDate);
    if (day === null) throw Error("Stress source contains an invalid public date.");
    const publicDate = new Date((day + scenario.delayDays) * 86400000).toISOString().slice(0, 10);
    const excluded = dropped.has(original.id);
    decisions.push({
      signalId: original.id,
      symbol: original.symbol,
      originalPublicDate: original.signalDate,
      scenarioPublicDate: publicDate,
      reason: excluded ? "missing-signal" : "retained",
    });
    if (!excluded) signals.push({ ...original, signalDate: publicDate });
  }
  return {
    inputs: {
      ...base,
      signals,
      rules: {
        ...base.rules,
        costBps: base.rules.costBps + scenario.extraCostBps,
        slippageBps: base.rules.slippageBps + scenario.extraSlippageBps,
      },
    },
    decisions,
    removed: dropped.size,
  };
}
export function runStress({ base, scenarios }) {
  if (base.kind === "convergence") return runConvergenceStress(base, scenarios);
  const spec = cleanStressScenarios(scenarios, base.rules, { priceSeries: stressPriceSeries(base) }),
    baseline = runBacktest(base);
  const results = spec.map((scenario) => {
    const transformed = stressInputs(base, scenario),
      shocked = shockPrices(transformed.inputs, scenario.priceShock),
      result = runBacktest(shocked.inputs);
    const delta =
      baseline.stats && result.stats
        ? Object.fromEntries(
            ["total", "benchmarkTotal", "excessTotal", "maxDrawdown"].map((k) => [
              k,
              Math.round((result.stats[k] - baseline.stats[k]) * 1e8) / 1e8,
            ]),
          )
        : null;
    return {
      scenario,
      priceChanges: shocked.priceChanges,
      removed: transformed.removed,
      retained: transformed.inputs.signals.length,
      decisions: transformed.decisions,
      result,
      delta,
    };
  });
  return {
    version: STRESS_VERSION,
    kind: "single-source-stress",
    baseline,
    scenarios: results,
    caveats: [
      "Sensitivity analysis of a previously observed experiment, not a new out-of-sample test or evidence of causality.",
      "Only frozen source signals and price histories are used. Delays may push trades beyond saved price coverage; exclusions remain visible and missing results are not zero returns.",
      "Missing signals are a deterministic, seeded sample by publication ID. This models a chosen missingness assumption, not observed provider outages.",
      "Each arm uses the existing engine’s portfolio and matched-exposure benchmark. Changed exposure windows are reported; annualized comparisons are not a common-horizon performance test.",
      "Source caps, historical identity limits, publication assertions and original coverage limitations still apply.",
      "A dated price shock multiplies selected asset and benchmark opens/closes on and after its date by 1 + changePct/100. Earlier prices and subsequent percentage returns are preserved. A position held entirely after the shock may have unchanged return.",
      "Price shocks are chosen hypothetical level changes, not forecasts or validated price-regime, regulatory-reversal, liquidity or live-execution models. Untargeted series stay unchanged; no cross-asset spillovers are inferred.",
    ],
  };
}

/** Rebuild confirmations and ablations after changing selected source publications. */
function runConvergenceStress(base, scenarios) {
  if (base.phase !== "evaluation") throw Error("Convergence stress requires an already evaluated holdout.");
  if (scenarios.length > 6) throw Error("Convergence stress is limited to six scenarios.");
  if (base.sources.some((s) => s.signals.length > 5000))
    throw Error(
      "Convergence stress supports at most 5,000 frozen signals per source. Narrow the original plan; no signals are silently truncated.",
    );
  const spec = cleanStressScenarios(scenarios, base.spec.rules, {
      sourceIds: base.sources.map((s) => s.id),
      priceSeries: stressPriceSeries(base),
    }),
    baseline = runConvergence(base);
  const period = (date) =>
    date >= base.spec.from && date <= base.spec.developmentEnd
      ? "development"
      : date >= base.spec.split && date <= base.spec.to
        ? "holdout"
        : null;
  const results = spec.map((scenario) => {
    const decisions = [];
    let removed = 0;
    const sources = base.sources.map((source) => {
      const targeted = !scenario.sourceIds || scenario.sourceIds.includes(source.id);
      const transformed = stressInputs(
        { signals: source.signals, rules: base.spec.rules },
        { ...scenario, delayDays: targeted ? scenario.delayDays : 0, missingPct: targeted ? scenario.missingPct : 0 },
        5000,
      );
      const audit = new Map(transformed.decisions.map((d) => [d.signalId, d]));
      const kept = transformed.inputs.signals.filter((signal) => {
        const d = audit.get(signal.id),
          originalPeriod = period(d.originalPublicDate),
          changedPeriod = period(d.scenarioPublicDate);
        if (originalPeriod !== changedPeriod) {
          d.reason = "delay-crosses-period";
          return false;
        }
        return true;
      });
      for (const d of transformed.decisions)
        decisions.push({
          ...d,
          sourceId: source.id,
          sourceLabel: source.label,
          targeted,
          originalPeriod: period(d.originalPublicDate),
        });
      removed += source.signals.length - kept.length;
      return { ...source, signals: kept };
    });
    const inputs = {
      ...base,
      sources,
      spec: {
        ...base.spec,
        rules: {
          ...base.spec.rules,
          costBps: base.spec.rules.costBps + scenario.extraCostBps,
          slippageBps: base.spec.rules.slippageBps + scenario.extraSlippageBps,
        },
      },
    };
    const shocked = shockPrices(inputs, scenario.priceShock),
      result = runConvergence(shocked.inputs);
    return {
      scenario,
      priceChanges: shocked.priceChanges,
      removed,
      retained: sources.reduce((n, s) => n + s.signals.length, 0),
      decisions,
      result,
    };
  });
  return {
    version: STRESS_VERSION,
    kind: "convergence-stress",
    baseline,
    scenarios: results,
    caveats: [
      "Sensitivity analysis of an already evaluated Convergence plan. The holdout has already been observed; this is not a fresh out-of-sample evaluation.",
      "Selected source publications are delayed or removed before rebuilding every individual-source, combined and ablation strategy. Additional costs apply to every strategy.",
      "Original development/holdout membership is frozen. A delay crossing a period boundary removes that publication instead of transferring it into another period; the embargo and confirmation reset remain unchanged.",
      "The original frozen universe, windows, benchmark choices and source limitations apply. No data is fetched and no source signals are silently truncated.",
      "Dated price shocks multiply every selected asset/benchmark series on and after the declared date by 1 + changePct/100. Earlier prices and later percentage returns stay intact. These are hypothetical level shifts, not validated regime or regulatory models; no spillovers are inferred. Price changes apply to every strategy, independently of source-publication targeting.",
      "Convergence uses full-window benchmark comparisons and cash when no positions execute; inspect executed trades and exclusions before interpreting a zero strategy return.",
      "Missingness is a seeded deterministic publication sample, not a validated outage model. Scenario comparisons and ablations are descriptive, not causal or adjusted for repeated testing.",
    ],
  };
}
