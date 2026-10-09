import { tickerDossier, watchSummary } from "../domain/watchlist/index.mjs";
import { reply } from "../router.mjs";

export const handlers = {
  "watchlist.activity": ({ db, query }) => watchSummary(db, query.str("tickers").split(","), { days: query.str("days") }),
  "watchlist.ticker": async ({ db, params, query }) => {
    const out = await tickerDossier(db, decodeURIComponent(params.symbol), { days: query.str("days") });
    return out || reply(404, { ok: false, error: "Ticker is not in data/tickers.json", missing: "" });
  }
};
