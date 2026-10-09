import { readFileSync } from "node:fs";
import { fetchJson } from "./lib/http.mjs";
import { readCache, writeCache } from "./lib/db.mjs";
import { sessionQuote } from "./chart.mjs";
import { globalInstrument } from "./globals.mjs";
import { BROWSER_UA } from "./lib/ua.mjs";
import { KEY } from "./lib/cacheKeys.mjs";

const FX = JSON.parse(readFileSync(new URL("../data/fx.json", import.meta.url), "utf8"));
const CRYPTO = JSON.parse(readFileSync(new URL("../data/crypto.json", import.meta.url), "utf8"));
const BOARD_TTL = 2 * 60 * 1000;

export function instrumentBySymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  const fx = FX.find((row) => row.symbol === s || row.code === s);
  if (fx) return { ...fx, kind: "fx" };
  const coin = CRYPTO.find((row) => row.symbol === s || row.code === s);
  if (coin) return { ...coin, kind: "crypto" };
  return globalInstrument(s);
}

export function cryptoDigits(price) {
  const p = Math.abs(Number(price) || 0);
  if (p >= 100) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  return 8;
}

export async function fxBoard(db) {
  const hit = readCache(db, KEY.fxBoard);
  if (hit) return hit;
  const items = await quoteAll(FX, (row) => row.digits);
  const usd = { USD: 1 };
  for (const row of items) {
    if (row.group !== "G10" && row.group !== "EM") continue;
    if (row.last == null) continue;
    if (row.base === "USD") usd[row.quote] = 1 / row.last;
    else if (row.quote === "USD") usd[row.base] = row.last;
  }
  const majors = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "CNY"].filter((c) => usd[c]);
  const matrix = majors.map((row) => ({
    ccy: row,
    cells: majors.map((col) => (row === col ? null : usd[row] / usd[col]))
  }));
  const payload = {
    ok: true,
    source: "Yahoo Finance chart (CCY and ICE DXY)",
    asOf: latest(items),
    latency: "Delayed indicative rates. FX trades around the clock Sunday evening to Friday evening; crosses in the matrix are derived from USD legs.",
    items,
    matrix: { ccys: majors, rows: matrix }
  };
  if (items.length) writeCache(db, KEY.fxBoard, payload, BOARD_TTL);
  return payload;
}

export async function cryptoBoard(db) {
  const hit = readCache(db, KEY.cryptoBoard);
  if (hit) return hit;
  const [items, gecko, global] = await Promise.all([
    quoteAll(CRYPTO, (_, last) => cryptoDigits(last)),
    geckoMarkets(db).catch(() => []),
    geckoGlobal(db).catch(() => null)
  ]);
  const byId = new Map(gecko.map((g) => [g.id, g]));
  for (const row of items) {
    const g = byId.get(row.gecko);
    if (!g) continue;
    Object.assign(row, {
      rank: g.market_cap_rank,
      marketCap: g.market_cap,
      volume24h: g.total_volume,
      change24h: g.price_change_percentage_24h_in_currency ?? g.price_change_percentage_24h,
      change7d: g.price_change_percentage_7d_in_currency ?? null,
      change30d: g.price_change_percentage_30d_in_currency ?? null,
      supply: g.circulating_supply,
      maxSupply: g.max_supply,
      ath: g.ath,
      athDate: g.ath_date,
      fromAth: g.ath_change_percentage
    });
  }
  items.sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const payload = {
    ok: true,
    source: "Yahoo Finance chart · CoinGecko markets",
    asOf: latest(items),
    latency: "Crypto trades 24/7. Prices are delayed session quotes; market cap, supply, and ATH from CoinGecko's free API refresh every few minutes.",
    global: global && {
      marketCap: global.total_market_cap?.usd ?? null,
      volume: global.total_volume?.usd ?? null,
      btcDominance: global.market_cap_percentage?.btc ?? null,
      ethDominance: global.market_cap_percentage?.eth ?? null,
      change24h: global.market_cap_change_percentage_24h_usd ?? null,
      coins: global.active_cryptocurrencies ?? null
    },
    items
  };
  if (items.length) writeCache(db, KEY.cryptoBoard, payload, BOARD_TTL);
  return payload;
}

async function quoteAll(rows, digitsFor) {
  const queue = [...rows];
  const items = [];
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      const quote = await sessionQuote(row, (last) => digitsFor(row, last)).catch(() => null);
      if (quote) items.push({ ...quote, code: row.code, name: row.name, group: row.group, base: row.base, quote: row.quote, gecko: row.gecko });
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  const order = new Map(rows.map((row, i) => [row.symbol, i]));
  items.sort((a, b) => order.get(a.symbol) - order.get(b.symbol));
  return items;
}

async function geckoMarkets(db) {
  const hit = readCache(db, KEY.geckoMarkets);
  if (hit) return hit;
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("ids", CRYPTO.map((row) => row.gecko).join(","));
  url.searchParams.set("price_change_percentage", "24h,7d,30d");
  const body = await fetchJson(url, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } });
  if (Array.isArray(body)) writeCache(db, KEY.geckoMarkets, body, 5 * 60 * 1000);
  return Array.isArray(body) ? body : [];
}

async function geckoGlobal(db) {
  const hit = readCache(db, KEY.geckoGlobal);
  if (hit) return hit;
  const body = await fetchJson("https://api.coingecko.com/api/v3/global", { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" } });
  const data = body?.data || null;
  if (data) writeCache(db, KEY.geckoGlobal, data, 10 * 60 * 1000);
  return data;
}

function latest(items) {
  return items.map((item) => item.asOf).filter(Boolean).sort().at(-1) || new Date().toISOString();
}
