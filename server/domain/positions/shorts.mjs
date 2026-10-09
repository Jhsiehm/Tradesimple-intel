import { coreKey, listCore, readCache, writeCache } from "../../lib/db.mjs";
import { once } from "../../lib/once.mjs";
import { pool } from "../../lib/pool.mjs";
import { HOUR } from "../../lib/time.mjs";
import { KEY } from "../../lib/cacheKeys.mjs";
import { shortInterest } from "../../markets.mjs";

export function shortBoard(db) {
  return once("short-board", async () => {
    const key = KEY.posShorts(coreKey(db));
    const hit = readCache(db, key);
    if (hit) return hit;
    const tickers = listCore(db);
    const rows = [];
    const scanned = [];
    await pool(tickers, 3, async (ticker) => {
      const res = await shortInterest(db, ticker.symbol).catch(() => null);
      if (res) scanned.push(ticker.symbol);
      const items = res?.items || [];
      items.forEach((row, i) => {
        const prev = items[i + 1];
        rows.push({
          id: `si-${ticker.symbol}-${row.date}`,
          symbol: ticker.symbol,
          person: "FINRA consolidated",
          shares: row.shares,
          change: row.change,
          prior: prev?.shares ?? null,
          traded: row.date,
          filed: row.date,
          lag: null,
          latest: i === 0,
          link: "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/data"
        });
      });
    });
    rows.sort((a, b) => String(b.traded).localeCompare(String(a.traded)) || a.symbol.localeCompare(b.symbol));
    const result = {
      ok: rows.length > 0,
      source: "FINRA consolidated short interest",
      asOf: new Date().toISOString(),
      latency: "Settlement-date snapshots published twice a month, about a week after settlement.",
      scanned: scanned.sort(),
      items: rows
    };
    if (rows.length) writeCache(db, key, result, 6 * HOUR);
    return result;
  });
}
