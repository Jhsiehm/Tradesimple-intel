import { tickerBySymbol } from "../lib/db.mjs";
import { DAY } from "../lib/time.mjs";
import { instrumentBySymbol } from "../instruments.mjs";
import { equityEvents } from "../corporate.mjs";
import { macroMarks } from "../macro.mjs";

/** Chart marks for one symbol: corporate events for joined equities, macro releases for the relevant currencies. */
export async function marketEvents(db, rawSymbol, kinds) {
  const symbol = rawSymbol.toUpperCase();
  const from = Date.now() - 6 * 365 * DAY;
  const inst = tickerBySymbol(db, symbol) ? null : instrumentBySymbol(symbol);
  const macroCcys = inst?.kind === "fx" ? [inst.base, inst.quote].filter(Boolean) : inst?.kind === "crypto" ? ["USD"] : ["USD"];
  const [corp, macro] = await Promise.all([
    inst ? [] : equityEvents(db, symbol, kinds),
    !kinds || kinds.includes("macro") ? macroMarks(db, macroCcys, from) : []
  ]);
  return { ok: true, symbol, source: "SEC 8-K · LDA.gov · FEC · USAspending · Fed · Nasdaq economic calendar", marks: [...corp, ...macro].sort((a, b) => a.t - b.t) };
}
