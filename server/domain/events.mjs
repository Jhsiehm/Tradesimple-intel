import { tickerBySymbol } from "../lib/db.mjs";
import { DAY } from "../lib/time.mjs";
import { instrumentBySymbol } from "../instruments.mjs";
import { equityEvents } from "../corporate.mjs";
import { macroMarks } from "../macro.mjs";

const MACRO = { id: "macro", source: "Federal Reserve FOMC · Nasdaq economic calendar", latency: "FOMC decisions on the meeting day; releases once the actual prints (cached calendar days only)." };

/**
 * Chart marks for one symbol: corporate events for joined equities, macro releases for the relevant currencies.
 * `feeds` labels each kind; `asOf` is the oldest feed as-of; `pending` kinds were still loading at the time budget.
 */
export async function marketEvents(db, rawSymbol, kinds) {
  const symbol = rawSymbol.toUpperCase();
  const from = Date.now() - 6 * 365 * DAY;
  const inst = tickerBySymbol(db, symbol) ? null : instrumentBySymbol(symbol);
  const macroCcys = inst?.kind === "fx" ? [inst.base, inst.quote].filter(Boolean) : inst?.kind === "crypto" ? ["USD"] : ["USD"];
  const wantMacro = !kinds || kinds.includes("macro");
  const [corp, macro] = await Promise.all([
    inst ? { marks: [], feeds: [], pending: [], failed: [] } : equityEvents(db, symbol, kinds),
    wantMacro ? macroMarks(db, macroCcys, from) : []
  ]);
  const feeds = [...corp.feeds, ...(wantMacro ? [{ ...MACRO, asOf: new Date().toISOString() }] : [])];
  const dated = feeds.map((f) => f.asOf).filter(Boolean).sort();
  return {
    ok: true,
    symbol,
    source: [...new Set(feeds.map((f) => f.source))].join(" · ") || "SEC 8-K · LDA.gov · FEC · USAspending · Fed · Nasdaq economic calendar",
    asOf: dated[0] || new Date().toISOString(),
    latency: corp.pending.length
      ? `${corp.pending.join(", ")} still loading; the rest as of each feed. ${feeds.map((f) => `${f.id}: ${f.latency}`).join(" ")}`
      : feeds.map((f) => `${f.id}: ${f.latency}`).join(" "),
    feeds,
    ...(corp.pending.length ? { pending: corp.pending } : {}),
    marks: [...corp.marks, ...macro].sort((a, b) => a.t - b.t)
  };
}
