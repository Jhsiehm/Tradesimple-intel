import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";
import { listTickers, openDb, tickerBySymbol } from "./db.mjs";
import { billDetail, calendar, listBills, listVotes, searchMembers, voteDetail } from "./congress.mjs";
import { fecForName, lobbyingForClient } from "./lobby.mjs";
import { awardsForRecipient } from "./contracts.mjs";
import { insiderFilings, politicianTrades, shortInterest, whaleFilings } from "./markets.mjs";
import { THEATERS, aisSnapshot, satelliteStill, straitNews } from "./strait.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const db = openDb(root);
const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/geo/")) {
      return sendGeo(res, url.pathname);
    }
    if (url.pathname === "/api/health") {
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/tickers") {
      return send(res, 200, { ok: true, items: listTickers(db) });
    }
    if (url.pathname === "/api/sites") {
      const sites = JSON.parse(fs.readFileSync(path.join(root, "data", "sites.json"), "utf8"));
      return send(res, 200, { ok: true, source: "Curated district registry", asOf: null, items: sites });
    }
    if (url.pathname === "/api/congress/bills") {
      return send(res, 200, await listBills(db));
    }
    if (url.pathname.startsWith("/api/congress/bills/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop());
      return send(res, 200, await billDetail(db, id));
    }
    if (url.pathname === "/api/congress/calendar") {
      return send(res, 200, await calendar(db));
    }
    if (url.pathname === "/api/congress/votes") {
      const chamber = url.searchParams.get("chamber") === "senate" ? "senate" : "house";
      return send(res, 200, await listVotes(db, chamber));
    }
    const voteMatch = url.pathname.match(/^\/api\/congress\/votes\/(house|senate)\/(\d+)\/(\d+)\/(\d+)$/);
    if (voteMatch) {
      return send(res, 200, await voteDetail(db, voteMatch[1], voteMatch[2], voteMatch[3], voteMatch[4]));
    }
    if (url.pathname === "/api/congress/members") {
      return send(res, 200, await searchMembers(db, url.searchParams.get("q") || ""));
    }
    if (url.pathname === "/api/lobby") {
      return send(res, 200, await lobbyingForClient(db, url.searchParams.get("client") || ""));
    }
    if (url.pathname === "/api/fec") {
      return send(res, 200, await fecForName(db, url.searchParams.get("name") || ""));
    }
    if (url.pathname === "/api/contracts") {
      return send(res, 200, await awardsForRecipient(db, url.searchParams.get("recipient") || ""));
    }
    const tickerMatch = url.pathname.match(/^\/api\/tickers\/([A-Za-z.]+)$/);
    if (tickerMatch) {
      return send(res, 200, await tickerDossier(tickerMatch[1].toUpperCase()));
    }
    if (url.pathname === "/api/markets/politicians") {
      return send(res, 200, await politicianTrades(db));
    }
    if (url.pathname === "/api/markets/insiders") {
      return send(res, 200, await insiderFilings(db));
    }
    if (url.pathname === "/api/markets/whales") {
      return send(res, 200, await whaleFilings(db));
    }
    if (url.pathname === "/api/markets/shorts") {
      return send(res, 200, await shortInterest(db, url.searchParams.get("symbol") || ""));
    }
    if (url.pathname === "/api/strait/news") {
      return send(res, 200, await straitNews(db));
    }
    if (url.pathname === "/api/strait/ais") {
      return send(res, 200, aisSnapshot());
    }
    if (url.pathname === "/api/strait/satellite") {
      return send(res, 200, satelliteStill());
    }
    if (url.pathname === "/api/strait/theaters") {
      return send(res, 200, { ok: true, items: THEATERS });
    }
    if (url.pathname === "/api/search") {
      return send(res, 200, await search(url.searchParams.get("q") || ""));
    }
    send(res, 404, { ok: false, error: "Not found" });
  } catch (err) {
    send(res, 500, { ok: false, error: err.message || "Request failed" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`intel api http://127.0.0.1:${port}`);
});

async function tickerDossier(symbol) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return { ok: false, error: "Ticker is not in the join table" };
  const client = ticker.ldaClients[0] || ticker.name;
  const recipient = ticker.recipients[0] || ticker.name;
  const [lobby, fec, contracts] = await Promise.all([
    lobbyingForClient(db, client).catch((err) => ({ ok: false, error: err.message, filings: [] })),
    fecForName(db, ticker.name).catch((err) => ({ ok: false, error: err.message, committees: [] })),
    awardsForRecipient(db, recipient).catch((err) => ({ ok: false, error: err.message, awards: [] }))
  ]);
  return { ok: true, ticker, lobby, fec, contracts };
}

async function search(q) {
  const query = q.trim();
  const upper = query.toUpperCase();
  const tickers = listTickers(db).filter((t) =>
    t.symbol.includes(upper) || t.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6);
  const sites = JSON.parse(fs.readFileSync(path.join(root, "data", "sites.json"), "utf8")).filter((s) => {
    const blob = `${s.name} ${s.symbol} ${s.district} ${s.state}`.toLowerCase();
    return blob.includes(query.toLowerCase());
  }).slice(0, 6);
  let members = [];
  if (query.length >= 3) {
    try {
      const found = await searchMembers(db, query);
      members = found.items || [];
    } catch {
      members = [];
    }
  }
  return { ok: true, tickers, sites, members };
}

function sendGeo(res, pathname) {
  const name = pathname === "/geo/states.geojson" ? "states.geojson" : pathname === "/geo/cd119.geojson" ? "cd119.geojson" : null;
  if (!name) return send(res, 404, { ok: false, error: "Unknown geometry" });
  const file = path.join(root, "data", "geo", name);
  res.writeHead(200, { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=86400" });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}
