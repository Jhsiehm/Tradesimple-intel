import { tickerBySymbol } from "../lib/db.mjs";
import { contractFeed, contractorBoard, dodAnnouncements } from "../contracts.mjs";
import { EARNINGS_LATENCY, EARNINGS_SOURCE, contractsFor, earningsCalendar, earningsFiled, lobbyingBoard, lobbyingFor, pacFor } from "../corporate.mjs";
import { econCalendar, fomcMeetings, macroStrip } from "../macro.mjs";
import { pacCalendar } from "../domain/calendar.mjs";
import { reply } from "../router.mjs";

const contractsFeed = ({ db, query }) => contractFeed(db, {
  symbol: query.str("symbol"),
  place: query.str("place"),
  member: query.str("member"),
  sort: query.str("sort"),
  days: query.str("days")
});

const CORPORATE = {
  lobbying: (db, ticker) => lobbyingFor(db, ticker, 5),
  pac: (db, ticker) => pacFor(db, ticker.symbol),
  contracts: (db, ticker) => contractsFor(db, ticker),
  earnings: async (db, ticker) => {
    const { items, asOf, note } = await earningsFiled(db, ticker);
    return { ok: true, source: EARNINGS_SOURCE, asOf, latency: EARNINGS_LATENCY, ...(note ? { note } : {}), items };
  }
};

export const handlers = {
  contracts: contractsFeed,
  "contracts.feed": contractsFeed,
  "contracts.board": ({ db }) => contractorBoard(db),
  "contracts.dod": ({ db }) => dodAnnouncements(db),
  corporate: ({ db, params }) => {
    const ticker = tickerBySymbol(db, params.symbol);
    if (!ticker) return reply(404, { ok: false, error: "Ticker is not in the join table" });
    return CORPORATE[params.kind](db, ticker);
  },
  "calendar.earnings": ({ db }) => earningsCalendar(db),
  "calendar.lobbying": ({ db }) => lobbyingBoard(db),
  "calendar.pacs": ({ db }) => pacCalendar(db),
  "calendar.macro": ({ db, query }) => econCalendar(db, Math.min(30, Number(query.str("back") || 3)), Math.min(45, Number(query.str("ahead") || 21))),
  "macro.strip": ({ db }) => macroStrip(db),
  "macro.fomc": ({ db }) => fomcMeetings(db)
};
