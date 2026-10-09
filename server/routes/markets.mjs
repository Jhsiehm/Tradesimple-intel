import { shortInterest } from "../markets.mjs";
import { congressTrades, insiderTrades, positionsBoard, positionsFor, shortBoard, whaleHoldings } from "../positions.mjs";
import { globalBoard } from "../globals.mjs";
import { chainSymbols, supplyChain } from "../supply.mjs";
import { priceChart, quoteBoard } from "../chart.mjs";
import { cryptoBoard, fxBoard } from "../instruments.mjs";
import { marketEvents } from "../domain/events.mjs";

export const handlers = {
  "markets.politicians": ({ db }) => congressTrades(db),
  "markets.insiders": ({ db }) => insiderTrades(db),
  "markets.whales": ({ db }) => whaleHoldings(db),
  "markets.shorts": ({ db, query }) => {
    const symbol = query.str("symbol");
    return symbol ? shortInterest(db, symbol) : shortBoard(db);
  },
  "markets.positions": ({ db }) => positionsBoard(db),
  "markets.position": ({ db, params }) => positionsFor(db, params.symbol),
  "markets.globals": ({ db }) => globalBoard(db),
  "markets.supply": () => ({ ok: true, items: chainSymbols() }),
  "markets.supplyChain": ({ db, params }) => supplyChain(db, params.symbol),
  "markets.board": ({ db }) => quoteBoard(db),
  "markets.chart": ({ db, query }) => priceChart(db, query.str("symbol"), query.str("span") || query.str("range", "6mo")),
  "markets.events": ({ db, query }) => marketEvents(db, query.str("symbol"), query.params.get("kinds")?.split(",").filter(Boolean)),
  "fx.board": ({ db }) => fxBoard(db),
  "crypto.board": ({ db }) => cryptoBoard(db)
};
