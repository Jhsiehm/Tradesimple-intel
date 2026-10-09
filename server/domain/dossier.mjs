import { tickerBySymbol } from "../lib/db.mjs";
import { sessionQuote } from "../feeds/yahoo.mjs";
import { fecForCommittees, lobbyingForClient } from "../lobby.mjs";
import { contractFeed } from "../contracts.mjs";
import { positionsFor } from "../positions.mjs";
import { seatsForCodes } from "../congress.mjs";
import { hqFor } from "../hq.mjs";

/** `withLobby = false` skips LDA.gov (10–30 s per client query); the client fetches /api/lobby?client= on its own. */
export async function tickerDossier(db, symbol, withLobby = true) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return { ok: false, error: "Ticker is not in the join table" };
  const client = ticker.ldaClients[0] || ticker.name;
  const [lobby, fec, contracts, quote, positions, seats, hq] = await Promise.all([
    withLobby
      ? lobbyingForClient(db, client).catch((err) => ({ ok: false, error: err.message, filings: [] }))
      : { ok: true, deferred: true, client, filings: [] },
    fecForCommittees(db, ticker.pacs || []).catch((err) => ({ ok: false, error: err.message, committees: [] })),
    contractFeed(db, { symbol: ticker.symbol, days: 180 }).then((r) => ({ ...r, awards: r.items || [] })).catch((err) => ({ ok: false, error: err.message, awards: [] })),
    sessionQuote(ticker).catch(() => null),
    positionsFor(db, ticker.symbol).catch(() => null),
    seatsForCodes(db, ticker.districts || []).catch(() => []),
    hqFor(db, ticker.symbol).then((r) => r.item || null).catch(() => null)
  ]);
  return { ok: true, ticker, lobby, fec, contracts, quote, positions, seats, hq };
}
