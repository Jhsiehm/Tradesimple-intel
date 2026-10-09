/** Ask tool `search_signals`: starts (or reuses) a signal search and returns its ranked findings with q-values. */
import { searchView, startSearch, waitForSearch } from "../domain/backtest/search.mjs";

const WAIT_MS = 45_000;
const TOP = 10;

/** What the model sees: counts and the warning first, then each finding with its q-value and a link to the full run. */
export function searchForModel(out) {
  if (!out || out.ok === false) return out;
  if (out.state !== "done") {
    return {
      ok: true,
      state: out.state,
      progress: out.progress,
      note: "The signal search is still running in the background (one worker thread). It appears under Backtest › Search when done; ask again in a minute. Do not report findings yet.",
      source: "TradeSimple signal search (in process)",
      asOf: out.startedAt || new Date().toISOString(),
      latency: `Phase ${out.phase || "?"}: ${out.progress?.done ?? 0} of ${out.progress?.total ?? "?"} steps.`
    };
  }
  return {
    ok: true,
    state: "done",
    variantsTested: out.tested,
    variantsBuilt: out.built,
    passingFdr: out.passing,
    fdr: out.fdr,
    minTrades: out.minTrades,
    multipleTestingWarning: out.warning,
    options: out.opts,
    findings: (out.findings || []).slice(0, TOP).map((f) => ({
      label: f.label,
      dimension: f.dim,
      trades: f.n,
      avgExcessPerTrade: f.stats?.avgExcess,
      excessCI95Lo: f.ci?.lo ?? null,
      excessCI95Hi: f.ci?.hi ?? null,
      excessTotal: f.stats?.excessTotal,
      hitRate: f.stats?.hitRate,
      pOneSided: f.p,
      pBasis: `t-test clustered by ${f.pBasis}`,
      qValue: f.q,
      passesFdr: f.passes,
      placeboBeatShare: f.placebo?.pct ?? null,
      placeboP: f.placebo?.p ?? null,
      verdict: f.verdict?.text || "",
      description: f.description,
      open: f.open
    })),
    notes: out.notes,
    feeds: (out.feeds || []).map((f) => ({ label: f.label, source: f.source, asOf: f.asOf })),
    source: out.source,
    asOf: out.asOf,
    latency: out.latency,
    cache: out.cache
  };
}

export const searchSignalsTool = {
  name: "search_signals",
  description: "Search many backtest variants at once for signals that beat a benchmark: congressional buys by committee, chamber, party, member (min trades), trade size, sector, filing speed, buys followed by contract awards; Form 4 buys by 10b5-1 vs discretionary, CEO/CFO/director, cluster buys. Ranks by mean excess per trade with Benjamini–Hochberg q-values and reports how many variants were tested. Use for 'find signals that beat SPY', 'what works', 'which committee's trades beat the market'. Always state variantsTested and the multiple-testing warning, and give q-values, never p-values alone. Runs in the background (up to a minute or two the first time).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      holdDays: { type: "number", description: "Hold for every variant, default 90" },
      benchmark: { type: "string", description: "SPY (default), ^GSPC, SECTOR, or a sector ETF" },
      minTrades: { type: "number", description: "Minimum priced trades for a variant to be tested, default 30" },
      sources: { type: "array", items: { type: "string", enum: ["congress", "form4"] }, description: "Default both" },
      from: { type: "string", description: "First public date, YYYY-MM-DD" },
      to: { type: "string", description: "Last public date, YYYY-MM-DD" }
    },
    required: []
  },
  run: async (db, a) => {
    const started = startSearch(db, a || {});
    if (started.ok === false || started.state === "done") return searchForModel(started);
    await waitForSearch(started.id, WAIT_MS);
    return searchForModel(searchView(db, started.id));
  },
  label: "Signal search"
};
