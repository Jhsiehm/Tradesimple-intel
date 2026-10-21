import { cleanSpec, SOURCE_LABEL } from "./backtestSpec.mjs";
const BENCH_WORD = { SPY: "S&P 500 (SPY)", "^GSPC": "S&P 500 price index", SECTOR: "sector ETF" };
const SIDE_WORD = { buy: "buys only", sell: "sells only (shorted)", both: "buys and sells" };

const FIELD_WORD = {
  "rules.holdDays": (v) => `hold ${v} d`,
  "rules.benchmark": (v) => `vs ${BENCH_WORD[v] || v}`,
  "rules.sides": (v) => SIDE_WORD[v] || v,
  "rules.sizing": (v) => (v === "amountMid" ? "range-midpoint weights" : "equal weight"),
  "rules.entry": (v) => (v === "nextClose" ? "next close" : "next open"),
  "rules.costBps": (v) => `${v} bps commission`,
  "rules.slippageBps": (v) => `${v} bps slippage`,
  "rules.stopLossPct": (v) => (v ? `stop −${v}%` : "no stop"),
  "rules.takeProfitPct": (v) => (v ? `take +${v}%` : "no take-profit"),
  "rules.openTrades": (v) => (v === "mark" ? "open trades marked" : "open trades left out"),
  "filters.excludeMembers": (v) => (v?.length ? `excluding ${v.join(", ")}` : "nobody excluded"),
  "filters.include10b51": (v) => (v ? "10b5-1 included" : "10b5-1 excluded"),
  "filters.nearHearingDays": (v) => (v ? `within ${v} d of a hearing` : "any time"),
  "filters.contractLagDays": (v) => (v ? `${v} d award lag` : "default award lag"),
};

/** "hold 90 d → hold 30 d" lines between two specs. */
export function specDiff(rawPrev, rawNext) {
  const prev = rawPrev && cleanSpec(rawPrev).spec;
  const next = rawNext && cleanSpec(rawNext).spec;
  if (!prev || !next) return [];
  const out = [];
  if (prev.source !== next.source) out.push(`${SOURCE_LABEL[prev.source]} → ${SOURCE_LABEL[next.source]}`);
  for (const group of ["filters", "rules"]) {
    const keys = new Set([...Object.keys(prev[group] || {}), ...Object.keys(next[group] || {})]);
    for (const k of keys) {
      const a = prev[group]?.[k];
      const b = next[group]?.[k];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const word =
        FIELD_WORD[`${group}.${k}`] ||
        ((v) => `${k} ${Array.isArray(v) ? v.join(", ") || "none" : v === "" || v == null ? "none" : v}`);
      out.push(`${word(a)} → ${word(b)}`);
    }
  }
  return out;
}
