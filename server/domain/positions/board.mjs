import { listTickers } from "../../lib/db.mjs";
import { DAY } from "../../lib/time.mjs";
import { pacData } from "../../corporate.mjs";
import { congressTrades } from "./congress.mjs";
import { insiderTrades } from "./insiders.mjs";
import { whaleHoldings } from "./whales.mjs";
import { shortBoard } from "./shorts.mjs";

export async function positionsBoard(db) {
  const [congress, insiders, whales, shorts] = await Promise.all([
    congressTrades(db).catch((err) => ({ items: [], errors: [err.message] })),
    insiderTrades(db).catch((err) => ({ items: [], errors: [err.message] })),
    whaleHoldings(db).catch((err) => ({ items: [], errors: [err.message] })),
    shortBoard(db).catch((err) => ({ items: [], errors: [err.message] }))
  ]);
  const tickers = listTickers(db);
  const join = new Map(tickers.map((t) => [t.symbol, t]));
  const symbols = new Set([...join.keys(), ...(congress.items || []).filter((r) => r.symbol).map((r) => r.symbol)]);
  const now = Date.now();
  const age = (iso) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / DAY)) : null);
  const rows = [...symbols].map((symbol) => {
    const c = (congress.items || []).filter((r) => r.symbol === symbol);
    const buys = c.filter((r) => r.side === "buy");
    const sells = c.filter((r) => r.side === "sell");
    const ins = (insiders.items || []).filter((r) => r.symbol === symbol);
    const whAll = (whales.items || []).filter((r) => r.symbol === symbol);
    const wh = whAll.filter((r) => r.shares > 0);
    const si = (shorts.items || []).filter((r) => r.symbol === symbol);
    const lastFiled = maxOf(c.map((r) => r.filed));
    const lags = c.map((r) => r.lag).filter((v) => v != null);
    return {
      symbol,
      name: join.get(symbol)?.name || c[0]?.asset || "",
      inJoin: join.has(symbol),
      congress: {
        trades: c.length,
        buys: buys.length,
        sells: sells.length,
        buyers: new Set(buys.map((r) => r.bioguide || r.person)).size,
        sellers: new Set(sells.map((r) => r.bioguide || r.person)).size,
        members: new Set(c.map((r) => r.bioguide || r.person)).size,
        dem: new Set(c.filter((r) => r.party === "D").map((r) => r.bioguide || r.person)).size,
        rep: new Set(c.filter((r) => r.party === "R").map((r) => r.bioguide || r.person)).size,
        lastFiled,
        filedAgo: age(lastFiled),
        lastTraded: maxOf(c.map((r) => r.traded)),
        avgLag: avg(lags),
        lastBuy: maxOf(buys.map((r) => r.traded)),
        lastSell: maxOf(sells.map((r) => r.traded)),
        buyTrades: buys.length,
        sellTrades: sells.length,
        buyLow: buys.reduce((sum, r) => sum + (r.amountLow || 0), 0),
        lastBuyer: whoLast(buys),
        lastSeller: whoLast(sells),
        recentBuyers: recentOf(buys, 6)
      },
      insiders: {
        filings: new Set(ins.map((r) => r.link)).size,
        buys: ins.filter((r) => r.code === "P").length,
        sells: ins.filter((r) => r.code === "S").length,
        other: ins.filter((r) => r.code !== "P" && r.code !== "S").length,
        people: new Set(ins.map((r) => r.person)).size,
        netShares: ins.reduce((sum, r) => sum + (r.code === "P" ? r.shares : r.code === "S" ? -r.shares : 0), 0),
        lastFiled: maxOf(ins.map((r) => r.filed)),
        filedAgo: age(maxOf(ins.map((r) => r.filed))),
        lastBuy: maxOf(ins.filter((r) => r.code === "P").map((r) => r.traded)),
        lastSell: maxOf(ins.filter((r) => r.code === "S").map((r) => r.traded)),
        avgLag: avg(ins.map((r) => r.lag).filter((v) => v != null)),
        lastBuyer: whoLast(ins.filter((r) => r.code === "P")),
        lastSeller: whoLast(ins.filter((r) => r.code === "S")),
        recentBuyers: recentOf(ins.filter((r) => r.code === "P"), 6)
      },
      whales: {
        lastBuyer: whoLast(whAll.filter((r) => r.side === "buy"), "filed"),
        holders: new Set(wh.map((r) => r.person)).size,
        buyers: whAll.filter((r) => r.side === "buy").length,
        sellers: whAll.filter((r) => r.side === "sell").length,
        shares: wh.reduce((sum, r) => sum + (r.shares || 0), 0),
        value: wh.reduce((sum, r) => sum + (r.value || 0), 0),
        lastFiled: maxOf(wh.map((r) => r.filed)),
        filedAgo: age(maxOf(wh.map((r) => r.filed))),
        avgLag: avg(whAll.map((r) => r.lag).filter((v) => v != null))
      },
      short: si[0] ? { shares: si[0].shares, change: si[0].change, prior: si[0].prior, date: si[0].traded } : null
    };
  });
  rows.sort((a, b) =>
    Number(b.inJoin) - Number(a.inJoin)
    || b.congress.members - a.congress.members
    || b.congress.trades - a.congress.trades
    || a.symbol.localeCompare(b.symbol)
  );
  return {
    ok: true,
    source: "House Clerk · Senate eFD · SEC Form 4 · SEC 13F · FINRA",
    asOf: new Date().toISOString(),
    latency: "Each column keeps its own filing lag: Congress up to 45 days, Form 4 two business days, 13F up to 45 days after quarter end, short interest twice monthly.",
    feeds: {
      congress: { source: congress.source, asOf: congress.asOf, latency: congress.latency, count: (congress.items || []).length, errors: congress.errors || [] },
      insiders: { source: insiders.source, asOf: insiders.asOf, latency: insiders.latency, count: (insiders.items || []).length, errors: insiders.errors || [] },
      whales: { source: whales.source, asOf: whales.asOf, latency: whales.latency, count: (whales.items || []).length, errors: whales.errors || [] },
      shorts: { source: shorts.source, asOf: shorts.asOf, latency: shorts.latency, count: (shorts.items || []).length, errors: shorts.errors || [] }
    },
    items: rows
  };
}

export async function positionsFor(db, symbol) {
  const sym = String(symbol || "").toUpperCase();
  const [congress, insiders, whales, shorts] = await Promise.all([
    congressTrades(db).catch(() => ({ items: [] })),
    insiderTrades(db).catch(() => ({ items: [] })),
    whaleHoldings(db).catch(() => ({ items: [] })),
    shortBoard(db).catch(() => ({ items: [] }))
  ]);
  const join = listTickers(db).find((t) => t.symbol === sym);
  const trades = (congress.items || []).filter((r) => r.symbol === sym);
  const traders = new Set(trades.map((r) => r.bioguide).filter(Boolean));
  const pac = await pacData(db).catch(() => ({ rows: [] }));
  const since = new Date(Date.now() - 2 * 365 * DAY).toISOString().slice(0, 10);
  const pacs = (pac.rows || [])
    .filter((r) => r.bioguide && traders.has(r.bioguide) && r.date >= since)
    .slice(0, 200)
    .map((r) => ({ ...r, own: r.symbol === sym }));
  return {
    ok: true,
    symbol: sym,
    name: join?.name || "",
    inJoin: Boolean(join),
    asOf: new Date().toISOString(),
    congress: trades,
    pacs,
    pacNote: "Corporate PAC gifts (FEC) from the last two years to members who traded this symbol. Only PACs joined in data/tickers.json are tracked.",
    insiders: (insiders.items || []).filter((r) => r.symbol === sym),
    whales: (whales.items || []).filter((r) => r.symbol === sym),
    shorts: (shorts.items || []).filter((r) => r.symbol === sym),
    coverage: {
      insiders: coverage(insiders, sym, join, "Form 4 scan"),
      shorts: coverage(shorts, sym, join, "FINRA short-interest scan")
    }
  };
}

/** Whether an empty list means "none filed" or "never looked". Only scanned symbols can report zero. */
export function coverage(scan, sym, join, label) {
  if (!join) return { scanned: false, note: `${sym} is not in data/tickers.json, so the ${label} does not cover it.` };
  if (!join.core) return { scanned: false, note: `${sym} is quotes-only in data/tickers.json; the ${label} covers full-join names only.` };
  if (!Array.isArray(scan?.scanned)) return { scanned: false, note: `The ${label} has not finished or failed; retry shortly.` };
  if (!scan.scanned.includes(sym)) return { scanned: false, note: `The ${label} could not read ${sym} this run.` };
  return { scanned: true, note: "" };
}

function avg(values) {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function maxOf(values) {
  return values.filter(Boolean).sort().at(-1) || "";
}

function who(r) {
  return {
    person: r.person || "",
    bioguide: r.bioguide || "",
    party: r.party || "",
    role: r.title || r.role || "",
    amount: r.amount || (r.shares ? `${Math.round(r.shares).toLocaleString("en-US")} sh${r.price ? ` @ $${r.price}` : ""}` : ""),
    traded: r.traded || "",
    filed: r.filed || "",
    lag: r.lag ?? null,
    link: r.link || ""
  };
}

function byLatest(rows, key = "traded") {
  return [...rows].sort((a, b) => String(b[key] || "").localeCompare(String(a[key] || "")) || String(b.filed || "").localeCompare(String(a.filed || "")));
}

function whoLast(rows, key = "traded") {
  const r = byLatest(rows, key)[0];
  return r ? who(r) : null;
}

function recentOf(rows, n) {
  return byLatest(rows).slice(0, n).map(who);
}
