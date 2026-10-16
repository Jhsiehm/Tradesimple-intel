/** Deterministic, chronological multi-source confirmation and evaluation. No clock or I/O. */
import { cleanRules } from './backtestSpec.mjs';
import { runBacktest, dayOf, isoOf } from './backtest.mjs';
import { blockBootstrap, weekOf } from './backtestStats.mjs';
export const CONVERGENCE_VERSION = 2;
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dayOf(s) !== null && isoOf(dayOf(s)) === s;
function agreementPolicy(raw) {
  const confirmation = raw.confirmation ?? 'all';
  if (!['all', 'any', 'at-least'].includes(confirmation)) throw new Error('Choose all, any, or at-least source agreement.');
  if (confirmation === 'at-least') {
    if (!Number.isInteger(raw.minSources) || raw.minSources < 2 || raw.minSources > 3) throw new Error('Minimum agreement must be 2 or 3 sources.');
    return { confirmation, minSources: raw.minSources };
  }
  if (raw.minSources !== undefined) throw new Error('Minimum sources applies only to at-least agreement.');
  return { confirmation };
}
export function cleanConvergence(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('A convergence specification is required.');
  const { from, split, to } = raw;
  if (![from, split, to].every(validDate) || !(from < split && split < to)) throw new Error('Use valid dates with development start < holdout start < evaluation end.');
  const universe = [...new Set(String(raw.universe || '').split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase()))].sort();
  if (!universe.length || universe.length > 40 || universe.some(s => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(s))) throw new Error('Declare 1–40 ticker symbols before locking the plan.');
  const windowDays = Number(raw.windowDays ?? 14), embargoDays = Number(raw.embargoDays ?? 7);
  if (!Number.isInteger(windowDays) || windowDays < 0 || windowDays > 90 || !Number.isInteger(embargoDays) || embargoDays < 1 || embargoDays > 90) throw new Error('Confirmation window: 0–90 days. Embargo: 1–90 days.');
  const rules = cleanRules(raw.rules);
  if (rules.holdDays > 180) throw new Error('Convergence holding periods are limited to 180 days.');
  if (raw.rules?.benchmark && raw.rules.benchmark !== 'SPY') throw new Error('Convergence uses SPY as the common benchmark.');
  if (rules.sizing !== 'equal' || rules.openTrades !== 'exclude') throw new Error('Convergence requires equal weighting and excludes unfinished trades.');
  rules.benchmark = 'SPY'; rules.sizing = 'equal'; rules.openTrades = 'exclude';
  const developmentEnd = isoOf(dayOf(split) - embargoDays - 1);
  if (dayOf(developmentEnd) - dayOf(from) < rules.holdDays + 7 || dayOf(to) - dayOf(split) < rules.holdDays + 7) throw new Error('Both periods must exceed the holding period by at least 7 days, after the embargo.');
  return { version: CONVERGENCE_VERSION, ...agreementPolicy(raw), from, split, to, developmentEnd, universe, windowDays, embargoDays, rules };
}
/** Deduplicate daily source votes, then confirm using only observations public by the decision day. */
export function combineSignals(sources, indices, options) {
  const { windowDays, from, to, universe, sides = 'buy' } = options;
  const policy = agreementPolicy(options);
  const required = policy.confirmation === 'all' ? indices.length : policy.confirmation === 'any' ? 1 : policy.minSources;
  const allowed = new Set(universe), events = [], seen = new Set();
  const counts = { offered: 0, outsideWindowOrUniverse: 0, wrongSide: 0, duplicateDailyVotes: 0 };
  for (const index of indices) {
    for (const signal of [...sources[index].signals].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
      counts.offered++;
      if (!validDate(signal.signalDate)) throw new Error('Every source signal must have a valid public date.');
      if (!['buy', 'sell'].includes(signal.side)) throw new Error('Every source signal must have a buy/sell side.');
      if (!allowed.has(signal.symbol) || signal.signalDate < from || signal.signalDate > to) { counts.outsideWindowOrUniverse++; continue; }
      if (sides !== 'both' && signal.side !== sides) { counts.wrongSide++; continue; }
      const key = `${index}|${signal.symbol}|${signal.side}|${signal.signalDate}`;
      if (seen.has(key)) { counts.duplicateDailyVotes++; continue; }
      seen.add(key); events.push({ index, signal });
    }
  }
  events.sort((a, b) => a.signal.signalDate.localeCompare(b.signal.signalDate) || a.signal.symbol.localeCompare(b.signal.symbol) || a.signal.side.localeCompare(b.signal.side) || a.index - b.index);
  const latest = new Map(), signals = [];
  for (let i = 0; i < events.length;) {
    const first = events[i].signal, key = `${first.symbol}|${first.side}`, group = [];
    while (i < events.length && events[i].signal.signalDate === first.signalDate && `${events[i].signal.symbol}|${events[i].signal.side}` === key) group.push(events[i++]);
    const state = latest.get(key) || new Map(); latest.set(key, state);
    for (const e of group) state.set(e.index, e.signal);
    const evidence = indices.map(index => ({ source: sources[index].id, signal: state.get(index) })).filter(e => e.signal && dayOf(first.signalDate) - dayOf(e.signal.signalDate) <= windowDays);
    if (evidence.length < required) continue;
    signals.push({ id: `${indices.join('+')}:${key}:${first.signalDate}`, symbol: first.symbol, side: first.side, signalDate: first.signalDate, tradeDate: first.signalDate, actor: first.symbol, actorLabel: first.symbol, sector: first.sector || '', sizeHint: 1, evidence: evidence.map(e => ({ source: e.source, recordId: e.signal.id, publicDate: e.signal.signalDate })) });
  }
  if (signals.length > 1500) throw new Error('A comparison exceeds 1,500 decisions. Narrow the declared window or universe; no outcome-dependent truncation is performed.');
  return { signals, counts };
}
function subsets(n, policy) {
  const all = Array.from({ length: n }, (_, i) => i), variants = all.map(i => ({ id: `single:${i}`, label: `Source ${i + 1} alone`, indices: [i] }));
  variants.push({ id: 'combined', label: policy.confirmation === 'any' ? 'Any source confirmed' : policy.confirmation === 'at-least' ? `At least ${policy.minSources} sources confirmed` : 'All sources confirmed', indices: all });
  // Two-source all/any ablations equal the single baselines. Fixed quorums need separate variants.
  if (n === 3 || policy.confirmation === 'at-least') all.forEach(i => variants.push({ id: `without:${i}`, label: `Without source ${i + 1}`, indices: all.filter(j => j !== i) }));
  return variants;
}
function periodReport(input, from, to) {
  const { sources, spec } = input;
  const cut = rows => rows.filter(b => b[0] >= dayOf(from) && b[0] <= dayOf(to));
  const bars = Object.fromEntries(spec.universe.map(s => [s, cut(input.bars[s] || [])]));
  const benchBars = { SPY: cut(input.benchBars.SPY || []) };
  if (benchBars.SPY.length < 2) throw new Error(`No benchmark coverage for ${from} to ${to}.`);
  const variants = subsets(sources.length, agreementPolicy(spec)).map(v => {
    const periodSources = sources.map(s => ({ ...s, signals: s.signals.filter(event => event.signalDate >= from && event.signalDate <= to) }));
    const combined = combineSignals(periodSources, v.indices, { ...spec, ...(v.id.startsWith('single:') ? { confirmation: 'any', minSources: undefined } : {}), from, to, sides: spec.rules.sides });
    const result = runBacktest({ signals: combined.signals, bars, benchBars, rules: spec.rules });
    const benchmarkReturn = benchBars.SPY.at(-1)[2] / benchBars.SPY[0][2] - 1;
    const strategyReturn = result.stats?.total ?? 0;
    const windowStats = { strategyReturn, benchmarkReturn, excess: strategyReturn - benchmarkReturn };
    const weeks = result.trades.map(t => weekOf(dayOf(t.entry)));
    const xs = result.trades.map(t => t.excess);
    const bootstrap = xs.length >= 10 && new Set(weeks).size >= 2 ? blockBootstrap([xs], weeks, { iters: 2000, seed: 12345, alpha: 0.05 })[0] : null;
    return { ...v, windowStats, counts: { ...combined.counts, decisions: combined.signals.length, executed: result.trades.length, excluded: result.counts.skipped }, evidence: combined.signals.map(s => ({ id: s.id, symbol: s.symbol, publicDate: s.signalDate, records: s.evidence })), result, bootstrap: bootstrap ? { low: bootstrap.lo, high: bootstrap.hi, mean: bootstrap.mean, unit: 'fraction', blocks: new Set(weeks).size } : null };
  });
  const combined = variants.find(v => v.id === 'combined');
  const ablations = sources.map((source, i) => {
    const other = variants.find(v => v.id === (sources.length === 2 && spec.confirmation !== 'at-least' ? `single:${1 - i}` : `without:${i}`));
    const fullStats = combined.result.stats, otherStats = other.result.stats;
    return { source: source.label, withoutVariant: other.id, deltaExcess: Number((combined.windowStats.excess - other.windowStats.excess).toFixed(8)), deltaMeanTradeExcess: fullStats && otherStats ? Number((fullStats.avgExcess - otherStats.avgExcess).toFixed(8)) : null, fullTrades: combined.result.trades.length, withoutTrades: other.result.trades.length };
  });
  return { from, to, benchmarkDays: benchBars.SPY.length, variants, ablations };
}
export function runConvergence(input) {
  if (!['development', 'evaluation'].includes(input.phase)) throw new Error('Unknown convergence phase.');
  if (input.sources.length < 2 || input.sources.length > 3) throw new Error('Choose two or three source snapshots.');
  const policy = agreementPolicy(input.spec);
  if (policy.minSources > input.sources.length) throw new Error('Minimum agreement exceeds the selected source count.');
  const periods = { development: periodReport(input, input.spec.from, input.spec.developmentEnd) };
  if (input.phase === 'evaluation') periods.holdout = periodReport(input, input.spec.split, input.spec.to);
  return { version: CONVERGENCE_VERSION, phase: input.phase, periods, caveats: [
    'All comparisons use the declared universe, common frozen price snapshot, costs, sizing, and date windows. Signal-driven cohorts and exposure still differ.',
    `Confirmation requires ${policy.confirmation === 'all' ? 'every selected source' : policy.confirmation === 'any' ? 'at least one selected source' : `at least ${policy.minSources} selected sources`} to publish the same ticker and side within the trailing interval. Decisions use only then-public records; one decision per ticker/side/day, with all eligible witnesses retained.`,
    'Single-source baselines require one source. Leave-one-out comparisons keep the declared agreement rule: all means all remaining sources, any means one, and at-least keeps its fixed count even when too few sources remain (no decisions).',
    'Matching state resets at the holdout boundary. Development prices stop before the embargo, and unfinished positions are excluded; no trade crosses the split.',
    'Ablation differences describe changes in strategy performance and sample selection, not causal attribution or additive contributions.',
    'Intervals are 95% entry-week block-bootstrap intervals for average trade excess (2,000 seeded draws), only with at least 10 trades and 2 entry weeks. They are not multiple-testing-adjusted significance claims.',
    'This is a chronological holdout over historical data. Locking a plan cannot establish that a researcher has never seen the period or eliminate survivorship and source coverage bias.',
    'The first source supplies the common price snapshot. Public dates retain source-specific assumptions and imported assertions; original source caveats remain applicable.'
  ] };
}
