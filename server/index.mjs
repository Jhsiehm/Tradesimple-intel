import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { listTickers, openDb, tickerBySymbol } from "./lib/db.mjs";
import { billsWithVotes, billRolls } from "./votemap.mjs";
import { hqAll, hqFor } from "./hq.mjs";
import { billDetail, billVote, calendar, committeeDetail, committeeList, compareMembers, listVotes, memberProfile, memberRoster, searchMembers, seatsForCodes, voteDetail } from "./congress.mjs";
import { fecForCommittees, fecForName, lobbyingForClient } from "./lobby.mjs";
import { memberTimeline, warmTimeline } from "./timeline.mjs";
import { alertsFor } from "./alerts.mjs";
import { caseFile, intelScope } from "./intel.mjs";
import { congressFeed } from "./feed.mjs";
import { leaders, warmReturns } from "./returns.mjs";
import { roster } from "./roster.mjs";
import { contractFeed, contractorBoard, dodAnnouncements, warmContracts } from "./contracts.mjs";
import { shortInterest } from "./markets.mjs";
import { congressTrades, insiderTrades, memberTrades, positionsBoard, positionsFor, shortBoard, warmPositions, whaleHoldings } from "./positions.mjs";
import { newsWire, xPulse, xWire } from "./news.mjs";
import { globalBoard } from "./globals.mjs";
import { supplyChain, chainSymbols } from "./supply.mjs";
import { airspace, flightRoute } from "./air.mjs";
import { priceChart, quoteBoard } from "./chart.mjs";
import { sessionQuote } from "./feeds/yahoo.mjs";
import { THEATERS, aisSnapshot, straitNews } from "./strait.mjs";
import { imagery, liveImagery, shippingLanes } from "./earth.mjs";
import { cryptoBoard, fxBoard, instrumentBySymbol } from "./instruments.mjs";
import { econCalendar, fomcMeetings, macroMarks, macroStrip, warmMacro } from "./macro.mjs";
import { contractsFor, earningsCalendar, earningsHistory, equityEvents, lobbyingBoard, lobbyingFor, pacData, pacFor, warmCorporate } from "./corporate.mjs";

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
    if (url.pathname === "/api/hq") {
      return send(res, 200, hqAll(db));
    }
    const hqMatch = url.pathname.match(/^\/api\/hq\/([A-Za-z.\-]+)$/);
    if (hqMatch) {
      return send(res, 200, await hqFor(db, hqMatch[1].toUpperCase()));
    }
    if (url.pathname === "/api/sites") {
      const sites = JSON.parse(fs.readFileSync(path.join(root, "data", "sites.json"), "utf8"));
      return send(res, 200, { ok: true, source: "Curated district registry", asOf: null, items: sites });
    }
    if (url.pathname === "/api/congress/bills") {
      return send(res, 200, await billsWithVotes(db));
    }
    const billRollsMatch = url.pathname.match(/^\/api\/congress\/bills\/([^/]+)\/votes$/);
    if (billRollsMatch) {
      return send(res, 200, await billRolls(db, decodeURIComponent(billRollsMatch[1])));
    }
    const billVoteMatch = url.pathname.match(/^\/api\/congress\/bills\/([^/]+)\/vote$/);
    if (billVoteMatch) {
      const chamber = url.searchParams.get("chamber") === "senate" ? "senate" : "house";
      return send(res, 200, await billVote(db, decodeURIComponent(billVoteMatch[1]), chamber));
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
    if (url.pathname === "/api/congress/compare") {
      const chamber = url.searchParams.get("chamber") === "senate" ? "senate" : "house";
      return send(res, 200, await compareMembers(db, url.searchParams.get("a") || "", url.searchParams.get("b") || "", chamber));
    }
    if (url.pathname === "/api/congress/roster") {
      return send(res, 200, await memberRoster(db));
    }
    if (url.pathname === "/api/congress/committees") {
      return send(res, 200, await committeeList(db));
    }
    const committeeMatch = url.pathname.match(/^\/api\/congress\/committees\/([A-Za-z0-9]+)$/);
    if (committeeMatch) {
      return send(res, 200, await committeeDetail(db, committeeMatch[1]));
    }
    const tradesMatch = url.pathname.match(/^\/api\/congress\/member\/([A-Za-z]\d{6})\/trades$/);
    if (tradesMatch) {
      return send(res, 200, { ok: true, items: await memberTrades(db, tradesMatch[1].toUpperCase()) });
    }
    const timelineMatch = url.pathname.match(/^\/api\/congress\/member\/([A-Za-z]\d{6})\/timeline$/);
    if (timelineMatch) {
      return send(res, 200, await memberTimeline(db, timelineMatch[1]));
    }
    const memberMatch = url.pathname.match(/^\/api\/congress\/member\/([A-Za-z]\d{6})$/);
    if (memberMatch) {
      const chamber = url.searchParams.get("chamber") === "senate" ? "senate" : "house";
      return send(res, 200, await memberProfile(db, memberMatch[1], chamber));
    }
    if (url.pathname === "/api/lobby") {
      return send(res, 200, await lobbyingForClient(db, url.searchParams.get("client") || ""));
    }
    if (url.pathname === "/api/fec") {
      return send(res, 200, await fecForName(db, url.searchParams.get("name") || ""));
    }
    if (url.pathname === "/api/contracts" || url.pathname === "/api/contracts/feed") {
      const q = url.searchParams;
      return send(res, 200, await contractFeed(db, { symbol: q.get("symbol") || "", place: q.get("place") || "", member: q.get("member") || "", sort: q.get("sort") || "", days: q.get("days") || "" }));
    }
    if (url.pathname === "/api/contracts/board") {
      return send(res, 200, await contractorBoard(db));
    }
    if (url.pathname === "/api/contracts/dod") {
      return send(res, 200, await dodAnnouncements(db));
    }
    const tickerMatch = url.pathname.match(/^\/api\/tickers\/([A-Za-z.\-]+)$/);
    if (tickerMatch) {
      return send(res, 200, await tickerDossier(tickerMatch[1].toUpperCase()));
    }
    if (url.pathname === "/api/congress/leaders") {
      const people = await roster(db).catch(() => ({ items: [] }));
      return send(res, 200, await leaders(db, new Map((people.items || []).map((p) => [p.bioguide, p]))));
    }
    if (url.pathname === "/api/congress/feed") {
      return send(res, 200, await congressFeed(db));
    }
    if (url.pathname === "/api/markets/politicians") {
      return send(res, 200, await congressTrades(db));
    }
    if (url.pathname === "/api/markets/insiders") {
      return send(res, 200, await insiderTrades(db));
    }
    if (url.pathname === "/api/markets/whales") {
      return send(res, 200, await whaleHoldings(db));
    }
    if (url.pathname === "/api/markets/shorts") {
      const symbol = url.searchParams.get("symbol") || "";
      return send(res, 200, symbol ? await shortInterest(db, symbol) : await shortBoard(db));
    }
    if (url.pathname === "/api/markets/positions") {
      return send(res, 200, await positionsBoard(db));
    }
    const positionMatch = url.pathname.match(/^\/api\/markets\/positions\/([A-Za-z.\-]+)$/);
    if (positionMatch) {
      return send(res, 200, await positionsFor(db, positionMatch[1]));
    }
    if (url.pathname === "/api/news") {
      return send(res, 200, await newsWire(db));
    }
    if (url.pathname === "/api/news/xpulse") {
      return send(res, 200, await xPulse(db));
    }
    if (url.pathname === "/api/markets/globals") {
      return send(res, 200, await globalBoard(db));
    }
    if (url.pathname === "/api/markets/supply") {
      return send(res, 200, { ok: true, items: chainSymbols() });
    }
    const supplyMatch = url.pathname.match(/^\/api\/markets\/supply\/([A-Za-z.\-]+)$/);
    if (supplyMatch) {
      return send(res, 200, await supplyChain(db, supplyMatch[1]));
    }
    if (url.pathname === "/api/air") {
      const theater = THEATERS.find((t) => t.id === url.searchParams.get("theater")) || THEATERS[0];
      return send(res, 200, await airspace(db, theater));
    }
    const routeMatch = url.pathname.match(/^\/api\/air\/route\/([A-Za-z0-9]+)$/);
    if (routeMatch) {
      return send(res, 200, await flightRoute(db, routeMatch[1]));
    }
    if (url.pathname === "/api/news/x") {
      return send(res, 200, await xWire(db));
    }
    if (url.pathname === "/api/markets/board") {
      return send(res, 200, await quoteBoard(db));
    }
    if (url.pathname === "/api/markets/chart") {
      const span = url.searchParams.get("span") || url.searchParams.get("range") || "6mo";
      return send(res, 200, await priceChart(db, url.searchParams.get("symbol") || "", span));
    }
    if (url.pathname === "/api/fx/board") {
      return send(res, 200, await fxBoard(db));
    }
    if (url.pathname === "/api/crypto/board") {
      return send(res, 200, await cryptoBoard(db));
    }
    if (url.pathname === "/api/macro/strip") {
      return send(res, 200, await macroStrip(db));
    }
    if (url.pathname === "/api/macro/fomc") {
      return send(res, 200, await fomcMeetings(db));
    }
    if (url.pathname === "/api/calendar/macro") {
      const back = Math.min(30, Number(url.searchParams.get("back") || 3));
      const ahead = Math.min(45, Number(url.searchParams.get("ahead") || 21));
      return send(res, 200, await econCalendar(db, back, ahead));
    }
    if (url.pathname === "/api/calendar/earnings") {
      return send(res, 200, await earningsCalendar(db));
    }
    if (url.pathname === "/api/alerts") {
      return send(res, 200, await alertsFor(db, url.searchParams));
    }
    if (url.pathname === "/api/intel/scope") {
      return send(res, 200, await intelScope(db, url.searchParams));
    }
    const caseMatch = url.pathname.match(/^\/api\/intel\/case\/(member|ticker|district)\/([A-Za-z0-9.\-]+)$/);
    if (caseMatch) {
      return send(res, 200, await caseFile(db, caseMatch[1], decodeURIComponent(caseMatch[2])));
    }
    if (url.pathname === "/api/calendar/lobbying") {
      return send(res, 200, await lobbyingBoard(db));
    }
    if (url.pathname === "/api/calendar/pacs") {
      const data = await pacData(db);
      const since = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      return send(res, 200, { ...data, rows: data.rows.filter((r) => r.date >= since).slice(0, 500) });
    }
    if (url.pathname === "/api/markets/events") {
      const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
      const kinds = url.searchParams.get("kinds")?.split(",").filter(Boolean);
      const from = Date.now() - 6 * 365 * 86400000;
      const inst = tickerBySymbol(db, symbol) ? null : instrumentBySymbol(symbol);
      const macroCcys = inst?.kind === "fx" ? [inst.base, inst.quote].filter(Boolean) : inst?.kind === "crypto" ? ["USD"] : ["USD"];
      const [corp, macro] = await Promise.all([
        inst ? [] : equityEvents(db, symbol, kinds),
        !kinds || kinds.includes("macro") ? macroMarks(db, macroCcys, from) : []
      ]);
      return send(res, 200, { ok: true, symbol, source: "SEC 8-K · LDA.gov · FEC · USAspending · Fed · Nasdaq economic calendar", marks: [...corp, ...macro].sort((a, b) => a.t - b.t) });
    }
    const corpMatch = url.pathname.match(/^\/api\/corporate\/(lobbying|pac|contracts|earnings)\/([A-Za-z.\-]+)$/);
    if (corpMatch) {
      const ticker = tickerBySymbol(db, corpMatch[2]);
      if (!ticker) return send(res, 404, { ok: false, error: "Ticker is not in the join table" });
      if (corpMatch[1] === "lobbying") return send(res, 200, await lobbyingFor(db, ticker, 5));
      if (corpMatch[1] === "pac") return send(res, 200, await pacFor(db, ticker.symbol));
      if (corpMatch[1] === "contracts") return send(res, 200, await contractsFor(db, ticker));
      return send(res, 200, { ok: true, source: "SEC EDGAR 8-K item 2.02", items: await earningsHistory(db, ticker) });
    }
    if (url.pathname === "/api/strait/news") {
      return send(res, 200, await straitNews(db));
    }
    if (url.pathname === "/api/strait/ais") {
      return send(res, 200, aisSnapshot());
    }
    if (url.pathname === "/api/earth/imagery") {
      return send(res, 200, await imagery(db));
    }
    if (url.pathname === "/api/earth/live") {
      return send(res, 200, await liveImagery(db));
    }
    if (url.pathname === "/api/earth/lanes") {
      return send(res, 200, await shippingLanes(db));
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

process.on("unhandledRejection", (err) => console.error("unhandled", err instanceof Error ? err.message : err));

server.listen(port, "127.0.0.1", () => {
  console.log(`intel api http://127.0.0.1:${port}`);
  if (process.env.INTEL_NO_WARM) return;
  warmPositions(db);
  warmTimeline(db);
  warmReturns(db);
  setTimeout(() => warmContracts(db), 3000);
  setInterval(() => warmContracts(db), 60 * 60 * 1000).unref();
  setTimeout(() => {
    warmCorporate(db).then(() => warmMacro(db)).then((n) => console.log(`macro warm: ${n} days fetched`)).catch((err) => console.error("warm", err.message));
  }, 5000);
});

async function tickerDossier(symbol) {
  const ticker = tickerBySymbol(db, symbol);
  if (!ticker) return { ok: false, error: "Ticker is not in the join table" };
  const client = ticker.ldaClients[0] || ticker.name;
  const [lobby, fec, contracts, quote, positions, seats, hq] = await Promise.all([
    lobbyingForClient(db, client).catch((err) => ({ ok: false, error: err.message, filings: [] })),
    fecForCommittees(db, ticker.pacs || []).catch((err) => ({ ok: false, error: err.message, committees: [] })),
    contractFeed(db, { symbol: ticker.symbol, days: 180 }).then((r) => ({ ...r, awards: r.items || [] })).catch((err) => ({ ok: false, error: err.message, awards: [] })),
    sessionQuote(ticker).catch(() => null),
    positionsFor(db, ticker.symbol).catch(() => null),
    seatsForCodes(db, ticker.districts || []).catch(() => []),
    hqFor(db, ticker.symbol).then((r) => r.item || null).catch(() => null)
  ]);
  return { ok: true, ticker, lobby, fec, contracts, quote, positions, seats, hq };
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
  if (query.length >= 2) {
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
