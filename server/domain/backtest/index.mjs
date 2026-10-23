import { beginResearchTrial, finishResearchTrial, researchTrialReceipt } from '../research-trials.mjs';
import { assessResearchDataValidity, dataValidityNote, DATA_VALIDITY_VERSION } from '../../../shared/researchDataValidity.mjs';
import { relationshipEligibility } from '../relationship-history.mjs';
import { auditSignals, INTEGRITY_VERSION } from '../research-integrity.mjs';
import { putRun, getRun, getDataset } from '../research-store.mjs';
import { ENGINE } from '../research-replay.mjs';
import { identities, signalEvents, datasetSource } from '../research-events.mjs';
import { runBacktest } from "../../../shared/backtest.mjs";
import { REALITY, realityCheck } from "../../../shared/backtestStats.mjs";
import { BENCHMARKS, BENCHMARK_LABEL, DEFAULT_FILTERS, DEFAULT_RULES, LIMITS, SECTOR_ETF, SOURCES, SOURCE_LABEL, cleanSpec, describeSpec, specHash } from "../../../shared/backtestSpec.mjs";
import { readCache, writeCache } from "../../lib/db.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { MINUTE } from "../../lib/time.mjs";
import { committees } from "../../roster.mjs";
import { lastBarDay, loadBars } from "./bars.mjs";
import { congressSource, contractsSource, form4Source, lobbyingSource } from "./sources.mjs";

const SOURCE_FNS = { congress: congressSource, form4: form4Source, contracts: contractsSource, lobbying: lobbyingSource };

export const RUN_BUDGET_MS = 40_000;
export const MAX_SYMBOLS = 350;
const RESULT_TTL = 30 * MINUTE;

/** What the form needs: sources, benchmarks, sectors, committees, defaults, limits. */
export async function backtestOptions(db) {
  const res = await committees(db).catch(() => ({ items: [] }));
  return {
    ok: true,
    sources: SOURCES.map((id) => ({ id, label: SOURCE_LABEL[id] })),
    benchmarks: BENCHMARKS.map((id) => ({ id, label: BENCHMARK_LABEL[id] || `${id} sector ETF` })),
    sectors: Object.keys(SECTOR_ETF),
    committees: (res.items || []).map((c) => ({ id: c.id, name: c.name, chamber: c.chamber, size: c.members.length })),
    defaults: { source: "congress", filters: DEFAULT_FILTERS, rules: DEFAULT_RULES },
    limits: LIMITS
  };
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * The run's caps: the LIMITS.signals most recently public signals on the traded side(s), then the MAX_SYMBOLS
 * tickers with the most signals. Untraded sides go first so (mostly) insider sells cannot fill a buys-only cap.
 */
export function capSignals(input, sides = "both") {
  const notes = [];
  const all = sides === "both" ? input : input.filter((s) => s.side === sides);
  let signals = [...all].sort((a, b) => String(b.signalDate).localeCompare(String(a.signalDate))).slice(0, LIMITS.signals);
  if (all.length > signals.length) notes.push({ level: "warn", id: "cap", text: `${all.length} signals matched; only the ${signals.length} most recently made public are run (cap ${LIMITS.signals}).` });
  const counts = new Map();
  for (const s of signals) counts.set(s.symbol, (counts.get(s.symbol) || 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  const symbols = ranked.slice(0, MAX_SYMBOLS);
  if (ranked.length > symbols.length) {
    const dropSet = new Set(ranked.slice(MAX_SYMBOLS));
    signals = signals.filter((s) => !dropSet.has(s.symbol));
    notes.push({ level: "warn", id: "symcap", text: `${ranked.length} distinct tickers matched; the ${MAX_SYMBOLS} with the most signals are priced (${dropSet.size} dropped).` });
  }
  return { signals, symbols, notes };
}

/**
 * Run one spec. Cached by spec hash (30 min) only when every price was in hand. Capped signals, a symbol cap,
 * and a wall-clock budget bound the run; what did not finish is counted in the caveats, never dropped silently.
 */
export async function runSpec(db, raw, { budgetMs = RUN_BUDGET_MS, loadBarsFn = loadBars, now = Date.now(), fresh = false, sourceFn = null } = {}) {
  const cleaned = cleanSpec(raw);
  if (!cleaned.ok) return { ok: false, error: cleaned.error, missing: "" };
  const spec = cleaned.spec;
  const hash = specHash(spec);
  const hit = fresh || sourceFn ? null : readCache(db, KEY.backtest(hash));
  if (hit && hit.dataValidity?.version === DATA_VALIDITY_VERSION && hit.trial?.id && hit.integrityVersion === INTEGRITY_VERSION && hit.realityVersion === REALITY.version && hit.engineId === ENGINE.id && hit.runId && getRun(db, hit.runId)) return { ...hit, cache: "hit" };
  const trial = beginResearchTrial(db, { kind: 'backtest', spec });
  let outcome;
  try {
    outcome = await executeSpec(db, spec, { budgetMs, loadBarsFn, now, sourceFn, hash, trial });
  } catch (error) {
    finishResearchTrial(db, trial, { status: 'failed', detail: error.message });
    throw error;
  }
  finishResearchTrial(db, trial, { status: !outcome.ok ? 'failed' : outcome.building ? 'partial' : 'completed', runId: outcome.runId });
  return outcome;
}

async function executeSpec(db, spec, { budgetMs, loadBarsFn, now, sourceFn, hash, trial }) {
  const receipt = researchTrialReceipt(trial);
  const t0 = Date.now();
  const deadline = t0 + budgetMs;

  // Sources that read filings one by one (Form 4) get part of the budget; prices need the rest.
  const loadSource = sourceFn || (spec.source === 'dataset' ? async () => { const d = getDataset(db, spec.datasetId); return d ? datasetSource(d) : { error: 'Dataset version not found.' }; } : SOURCE_FNS[spec.source]);
  const src = await loadSource(db, spec.filters, { deadline: t0 + Math.round(budgetMs * 0.6) });
  const identity = src.identity || identities(db);
  const provenance = { trial: receipt, source: src.dataset ? 'import' : spec.source, dataset: src.dataset || null, identity, records: src.records || [], coverage: { requested: { from: spec.filters.from || null, to: spec.filters.to || null, symbols: spec.filters.tickers || [] }, source: src.coverage || { completeness: 'unknown' }, status: 'source-loaded' }, feeds: src.feeds || [], dropped: src.dropped || {}, statistics: REALITY, runtime: process.version };
  const sourceRecords = Array.isArray(src.records) ? src.records : Object.values(src.records || {}).flat();
  const archivedRecords = sourceRecords.filter(record => record?.sourceDocument?.hash || record?.sourceDocuments?.length);
  const documentRefs = archivedRecords.flatMap(record => [...(record.sourceDocuments || []), ...(record.sourceDocument ? [record.sourceDocument] : [])]);
  provenance.coverage.originalDocuments = { records: sourceRecords.length, recordsWithDocument: archivedRecords.length, distinctDocuments: new Set(documentRefs.map(ref => ref.hash)).size, status: documentRefs.length ? 'partially-archived; see record references' : 'not-archived-by-this-path' };
  const failed = body => { body.trial = receipt; if (provenance.dataValidity) body.dataValidity = provenance.dataValidity; const runId = putRun(db, { inputs: null, result: body, provenance, engine: ENGINE }); return { ...body, runId }; };
  if (src.error) return failed({ ok: false, error: src.error, missing: src.missing || "", building: Boolean(src.building), spec, description: describeSpec(spec) });
  const tSignals = Date.now();

  const uncapped = src.signals.length;
  const audit = auditSignals(src.signals, { source: spec.source, now: iso(now) });
  provenance.integrity = audit.report;
  let eligibleSignals = audit.signals;
  if (spec.relationship) {
    try {
      const eligibility = relationshipEligibility(db, eligibleSignals, spec.relationship);
      eligibleSignals = eligibility.signals;
      provenance.relationship = eligibility.report;
    } catch (error) { return failed({ok:false,error:error.message,missing:'',spec,description:describeSpec(spec)}); }
  }
  const capped = capSignals(eligibleSignals, spec.rules.sides);
  provenance.coverage.signals = { matched: uncapped, timingEligible: audit.signals.length, timingExcluded: audit.report.excluded, ...(spec.relationship ? {relationshipEligible: eligibleSignals.length, relationshipExcluded: audit.signals.length - eligibleSignals.length} : {}), selected: capped.signals.length };
  const signals = capped.signals;
  const symbols = capped.symbols;
  const notes = [...(src.context.notes || []), ...audit.notes, ...capped.notes];
  if (provenance.relationship) notes.push({id:'relationshipEligibility',level:'warn',text:`Relationship eligibility retained ${eligibleSignals.length} of ${audit.signals.length} timing-eligible signals. Snapshot and per-signal exclusions are frozen; assertions and identity mappings are researcher supplied.`});
  const benchIds = new Set(spec.rules.benchmark === "SECTOR" ? ["SPY", ...new Set(signals.map((s) => SECTOR_ETF[s.sector]).filter(Boolean))] : [spec.rules.benchmark]);
  const need = [...new Set([...symbols, ...benchIds])];
  const priced = await loadBarsFn(db, need, { deadline });
  const tPrices = Date.now();
  provenance.coverage.prices = { requested: need, loaded: need.filter(s => priced.bars[s]?.length), pending: priced.pending, missing: priced.missing, stale: priced.stale };
  provenance.coverage.status = 'prices-loaded';
  const dataValidity = assessResearchDataValidity({ source: spec.source, filters: spec.filters, coverage: { ...src.coverage, selection: { matched: uncapped, eligible: eligibleSignals.length, selected: signals.length, capped: capped.notes.some(n => ['cap', 'symcap'].includes(n.id)) } },
    signals: eligibleSignals, prices: { ...priced, requested: need } });
  provenance.dataValidity = dataValidity;
  notes.unshift(dataValidityNote(dataValidity));
  const benchBars = Object.fromEntries([...benchIds].map((id) => [id, priced.bars[id]]).filter(([, v]) => v?.length));
  const missingBench = [...benchIds].filter((id) => !benchBars[id]);
  if (missingBench.length === benchIds.size) {
    return failed({ ok: false, error: `No benchmark prices for ${missingBench.join(", ")} yet${priced.pending.length ? ". Prices are still loading; try again shortly" : ""}.`, building: priced.pending.length > 0, spec, description: describeSpec(spec) });
  }
  const symbolBars = Object.fromEntries(symbols.map((s) => [s, priced.bars[s]]).filter(([, v]) => v?.length));
  const pendingSyms = priced.pending.filter((s) => symbols.includes(s));
  if (pendingSyms.length) notes.push({ level: "warn", id: "pending", text: `${pendingSyms.length} tickers were still loading prices when the ${Math.round(budgetMs / 1000)} s budget ended and are left out of this run (${pendingSyms.slice(0, 10).join(", ")}${pendingSyms.length > 10 ? "…" : ""}). They keep loading; run again in a minute.` });
  if (priced.stale.length) notes.push({ level: "info", id: "stale", text: `${priced.stale.length} tickers use a cached price history older than 12 h because Yahoo did not answer.` });

  const inputs = {
    signals,
    bars: symbolBars,
    benchBars,
    rules: spec.rules,
    context: { ...src.context, dataValidity, sourceFamily: spec.source, notes, unpriced: pendingSyms }
  };
  const result = runBacktest(inputs);
  const reality = result.stats ? realityCheck({ trades: result.trades, bars: symbolBars, benchBars, rules: result.rules }) : null;
  const tEngine = Date.now();
  const last = lastBarDay({ ...symbolBars, ...benchBars });
  const feeds = [
    ...src.feeds,
    {
      label: "Prices",
      source: "Yahoo Finance v8 chart, daily bars adjusted for splits and dividends",
      asOf: priced.oldestStoredAt ? iso(priced.oldestStoredAt) : iso(tPrices),
      latency: `Daily bars through ${last || "—"}; cached 12 h. ${priced.cached} symbols from cache, ${priced.fetched} fetched in ${((tPrices - tSignals) / 1000).toFixed(1)} s${priced.missing.length ? `, ${priced.missing.length} unknown to Yahoo` : ""}.`
    }
  ];
  const asOfs = feeds.map((f) => f.asOf).filter(Boolean).sort();
  const complete = !pendingSyms.length && !missingBench.length && !src.building;
  const body = {
    ...result,
    dataValidity,
    trial: receipt,
    reality,
    realityVersion: REALITY.version,
    integrityVersion: INTEGRITY_VERSION,
    spec,
    description: src.dataset ? `${src.dataset.name} v${src.dataset.version} · ${describeSpec(spec)}` : describeSpec(spec),
    source: feeds.map((f) => f.source).filter(Boolean).join(" · "),
    asOf: asOfs[0] || iso(tEngine),
    latency: `${feeds.map((f) => `${f.label}: ${f.latency}`).filter((s) => s.length > 10).join(" ")} Run took ${((tEngine - t0) / 1000).toFixed(1)} s.`,
    feeds,
    timing: { totalMs: tEngine - t0, signalsMs: tSignals - t0, pricesMs: tPrices - tSignals, engineMs: tEngine - tPrices },
    counts: { ...result.counts, matched: uncapped, tickers: symbols.length, priced: Object.keys(symbolBars).length, ...(src.context.rangeAmounts ? { unparsedPaperFilings: src.context.paperFilings || 0, unreadElectronicReports: src.context.unparsed || 0 } : {}) },
    building: !complete,
    pending: pendingSyms,
    cache: "miss",
    ranAt: iso(now)
  };
  provenance.coverage.status = complete ? 'calculation-complete' : 'calculation-partial';
  provenance.coverage.historicalCompleteness = 'not-certified';
  provenance.events = src.dataset ? src.records : signalEvents(signals, provenance.source, identity, iso(now));
  provenance.feeds = feeds;
  provenance.matchedSignals = eligibleSignals;
  const runId = putRun(db, { inputs, result: { ...body, engineResult: result }, provenance, engine: ENGINE });
  body.runId = runId;
  body.engineId = ENGINE.id;
  if (complete && !sourceFn) writeCache(db, KEY.backtest(hash), body, RESULT_TTL);
  return body;
}
