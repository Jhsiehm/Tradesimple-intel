import { congressTrades } from "./positions.mjs";
import { LATE_DAYS } from "./alerts.mjs";
import { tradeSentence } from "../shared/sentences.mjs";
import { DAY } from "./lib/time.mjs";

const back = (today, days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);

function row(t, refYear) {
  return {
    id: t.id, bioguide: t.bioguide, person: t.person, chamber: t.chamber, party: t.party, state: t.state, district: t.district,
    symbol: t.symbol, asset: t.asset, side: t.side, type: t.type, amount: t.amount, amountLow: t.amountLow || 0,
    traded: t.traded, filed: t.filed, lag: t.lag ?? null, link: t.link, inJoin: Boolean(t.inJoin),
    text: tradeSentence(t, { refYear })
  };
}

/**
 * Pure. "This week in Congress trading" from the disclosure rows. The window is by filed date (when the public
 * could first see the trade): 7 days, widened to 14 and then 30 when fewer than `minMembers` members filed, so
 * one large report doesn't fill the page. `window.days` says which window was used. The latest list shows one
 * row per filing (report link) with a count of the other trades in it.
 */
export function buildFeed(trades, { today, days = 7, minMembers = 5, limit = 30 } = {}) {
  const refYear = Number(String(today).slice(0, 4));
  const byFiled = [...trades].filter((t) => t.filed && t.filed <= today).sort((a, b) => String(b.filed).localeCompare(String(a.filed)) || String(b.traded).localeCompare(String(a.traded)) || String(a.id).localeCompare(String(b.id)));
  let span = days;
  let base = [];
  for (const d of [days, 14, 30]) {
    span = Math.max(days, d);
    base = byFiled.filter((t) => t.filed >= back(today, span));
    if (new Set(base.map((t) => t.bioguide || t.person)).size >= minMembers) break;
  }
  const fallback = span !== days;
  const from = back(today, span);
  if (!base.length) base = byFiled.slice(0, 200);
  const filings = new Map();
  for (const t of base) {
    const key = t.link || t.id;
    const hit = filings.get(key);
    if (hit) hit.more += 1;
    else filings.set(key, { t, more: 0 });
  }
  const latest = [...filings.values()].slice(0, limit).map(({ t, more }) => ({ ...row(t, refYear), more }));
  const late = byFiled.filter((t) => t.lag != null && t.lag > LATE_DAYS).slice(0, limit);
  const biggest = [...base].sort((a, b) => (b.amountLow || 0) - (a.amountLow || 0) || String(b.filed).localeCompare(String(a.filed))).slice(0, limit);
  const bySymbol = new Map();
  for (const t of base) {
    if (!t.symbol) continue;
    const s = bySymbol.get(t.symbol) || { symbol: t.symbol, asset: t.asset, inJoin: Boolean(t.inJoin), trades: 0, buys: 0, sells: 0, members: new Set(), low: 0, last: "" };
    s.trades += 1;
    if (t.side === "buy") s.buys += 1;
    if (t.side === "sell") s.sells += 1;
    if (t.bioguide || t.person) s.members.add(t.bioguide || t.person);
    s.low += t.amountLow || 0;
    if (String(t.filed) > s.last) s.last = t.filed;
    bySymbol.set(t.symbol, s);
  }
  const tickers = [...bySymbol.values()]
    .map((s) => ({ ...s, members: s.members.size }))
    .sort((a, b) => b.members - a.members || b.trades - a.trades || b.low - a.low || a.symbol.localeCompare(b.symbol))
    .slice(0, 20);
  return {
    window: { from, to: today, days: span, fallback, basis: "disclosure date (filed)", late: "the late list covers every filing the app holds, not this window" },
    counts: {
      trades: base.length,
      reports: filings.size,
      members: new Set(base.map((t) => t.bioguide || t.person)).size,
      lateThisWindow: base.filter((t) => t.lag != null && t.lag > LATE_DAYS).length
    },
    latest,
    late: late.map((t) => row(t, refYear)),
    biggest: biggest.map((t) => row(t, refYear)),
    tickers
  };
}

/** `days` (optional) starts the window there instead of 7; it still widens when too few members filed. */
export async function congressFeed(db, { days = 0 } = {}) {
  const board = await congressTrades(db).catch(() => ({ items: [] }));
  const today = new Date().toISOString().slice(0, 10);
  return {
    ok: (board.items || []).length > 0,
    source: board.source || "House Clerk PTR PDFs · Senate eFD PTRs",
    asOf: board.asOf || new Date().toISOString(),
    latency: `Grouped by filed date, the day the public could first see the trade. Trades are filed up to ${LATE_DAYS} days after the trade date by law; "late" means more than ${LATE_DAYS} days. ${board.building ? "Backfill still running; older reports are still arriving." : ""}`.trim(),
    building: Boolean(board.building),
    ...buildFeed(board.items || [], { today, ...(days > 0 ? { days } : {}) })
  };
}
