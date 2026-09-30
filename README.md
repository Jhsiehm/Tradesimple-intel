# TradeSimple Intel

A one-screen research terminal that joins **what Congress is doing** with **what markets are doing**: roll-call votes, bills, committees, and member stock trades next to insider filings, fund holdings, lobbying, PAC money, global markets, news, X, ships, aircraft, and live satellite imagery.

It is a research tool only. It does not connect to a brokerage and never places orders.

Every panel shows where its data came from, when it was fetched, and how late that source really is. Congressional trades can be 45 days old when they're disclosed, and index quotes are 15 minutes delayed. The terminal says so rather than pretending to be real time.

---

## What you can do with it

| Section | What it shows |
| --- | --- |
| **Congress** | House and Senate roll calls on a floor-seat map or district map, bills by latest action, every member with photo, leadership role, committees, votes, disclosed trades, and PAC money, plus committees with scheduled bills and how members voted on them. |
| **Markets** | The S&P 500 board (sector heat, breadth, cap weight), **Global** indices and ETFs with an ADR-vs-home-listing premium table, FX, crypto, **Positions** (Congress, Form 4 insiders, 13F funds, FINRA short interest, and who the *last buyer* was), **Supply chain** graphs, and candlestick charts with trades, filings, earnings, and macro events marked. |
| **News** | About 45 RSS wires across every region, a Board or a Globe view with headlines pinned to places, and an X column with trending topics and posts from market-moving accounts. |
| **Districts** | Plants and headquarters for joined companies on the congressional district map. |
| **Strait** | Taiwan Strait ships (AIS) and news, plus **Air**: live civil and military aircraft for every theater, including a worldwide military view, with flight routes. |
| **Calendar** | Earnings, macro releases (CPI, FOMC, jobs), lobbying deadlines, and PAC filings. |

### Workflow features

- **Pinned panels.** Open **Panels** in the top bar to pin a Watchlist, X pulse, Last buyers, Headlines, Global markets, or a Supply chain card. Pinned cards float over every tab and are saved between sessions. The menu also suggests panels for whatever you're looking at, and has one-click workspaces (Ticker research, Congress money trail, Global macro and arbitrage).
- **Watchlist.** Star (☆) any ticker on the S&P board or a dossier, and any member on their card. The watchlist card shows quotes and each member's latest disclosed trade.
- **Resizable layout.** Drag the divider between the map and the list panel. Drag it closed, double-click it, click the ▸ tab, or press `\` to hide the list. Cards resize from any edge and collapse to their title bar with **–**.
- **Last buyer drill-down.** On Positions, the Last buyer columns name the most recent Congress and insider buyer. Click ▸ on a row to see the last six buyers, with traded date, filed date, and filing lag.
- **Supply chain.** For 38 curated large caps (semis, cloud, autos, airlines, defense, energy, pharma, logistics), you get suppliers and customers mapped to revenue lines, each company's home exchange, index, and country ETF, six-month correlation and beta, and a rebased chart of how they moved together. Every link cites the filing or announcement it comes from.
- **Live imagery.** GOES-East, GOES-West, and Himawari frames every 10 minutes, VIIRS daily passes, and a time slider to scrub and play back.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`5` | Switch sections |
| `/` | Search tickers, members, districts |
| `↑` `↓` | Move through the list |
| `\` | Hide or show the list panel |
| `Esc` | Close the dossier, calendar, or menus |

---

## Getting started

Requires **Node.js 22+**.

```bash
git clone git@github.com:Jhsiehm/Tradesimple-intel.git
cd Tradesimple-intel
npm install
cp .env.example .env.local   # add whichever keys you have
npm run dev
```

Open **http://127.0.0.1:5173**. `npm run dev` starts both the API server (port 8787) and the Vite dev server.

The first load of Positions and PAC data parses PDFs and SEC bulk files, which takes about a minute. After that, results are cached in `data/cache.sqlite`.

### API keys (all optional)

Keys live only in `.env.local`. The server reads them and they are never sent to the browser. Any panel that needs a missing key says which one.

| Key | Unlocks | Get one |
| --- | --- | --- |
| `CONGRESS_API_KEY` | Votes, bills, members, committees, calendar | [api.congress.gov](https://api.congress.gov/sign-up/) |
| `LDA_API_KEY` | Lobbying filings | [lda.senate.gov](https://lda.senate.gov/api/register/) |
| `FEC_API_KEY` | Per-ticker PAC receipts (member PAC data uses free bulk files) | [api.open.fec.gov](https://api.open.fec.gov/developers/) |
| `AISSTREAM_API_KEY` | Live ship positions | [aisstream.io](https://aisstream.io) |
| `X_BEARER_TOKEN` | Real X posts. Without it, the X column shows the same accounts' posts on Bluesky plus Truth Social. | [developer.x.com](https://developer.x.com) |

Everything else (quotes, SEC, FINRA, news, aircraft, imagery, trends) uses free public endpoints.

---

## Data sources and freshness

| Data | Source | Typical delay |
| --- | --- | --- |
| Congressional trades | House Clerk PTR PDFs, Senate eFD | Up to 45 days after the trade (legal filing window) |
| Insider trades | SEC EDGAR Form 4 | Within 2 business days |
| Fund holdings | SEC 13F | Up to 45 days after quarter end |
| Short interest | FINRA | Twice monthly |
| Lobbying, PACs | LDA.gov, FEC bulk files | Quarterly and monthly filings |
| Votes, bills, committees | Congress.gov API, unitedstates/congress-legislators | Minutes to hours |
| US equities | Nasdaq screener | About 15 min delayed |
| Global indices, ETFs, ADRs, FX, charts | Yahoo Finance chart API | 15–20 min delayed; some exchanges end of day |
| Crypto | Yahoo Finance, CoinGecko | Minutes |
| News | Publisher RSS feeds | Minutes |
| X | trends24 (hourly trending), Bluesky public API, trumpstruth.org, or X API v2 with a token | Minutes to an hour |
| Aircraft | adsb.lol (ADS-B/MLAT), adsbdb.com routes | Seconds |
| Ships | aisstream.io | Seconds |
| Satellite | NASA GIBS (GOES, Himawari, VIIRS) | About 1 hour for geostationary, daily for VIIRS |
| Supply chain links | Curated from 10-K/20-F filings and company announcements (`data/supplychain.json`) | Changes when filings change |

> **About the Global / ADR arbitrage view:** the premiums compare delayed snapshots, and most home markets are closed while the ADR trades. They show where dislocations tend to appear, not tradable opportunities. Real cross-listing arbitrage needs licensed low-latency exchange feeds. That's a possible future extension.

---

## How it's built

```
server/        Node HTTP API on :8787, no framework
  index.mjs    routes
  congress.mjs, roster.mjs        votes, bills, members, committees
  positions.mjs, corporate.mjs    PTRs, Form 4, 13F, FINRA, LDA, FEC
  chart.mjs, globals.mjs, instruments.mjs, supply.mjs, macro.mjs   market data
  news.mjs     RSS wires, geotagging, X / Bluesky / Truth Social, trends
  air.mjs, strait.mjs, earth.mjs  aircraft, ships, imagery
  db.mjs       SQLite cache (node:sqlite) and ticker join table
src/           React 19 + TypeScript + MapLibre GL (Vite)
  App.tsx      section state, action routing, and the one-screen layout
  shell/       layout pieces: useCards (floating cards), useRail (list width),
               useMapClock (imagery/news time), PanelsMenu, MapBar (toolbars),
               SearchBox, mapView, follow (dossier link actions), sections
  congress/ markets/ news/ districts/ strait/   one folder per section: data hook + boards
data/          tickers.json (join table), places, supply chain, globals, geo
scripts/       dev runner, S&P 500 rows, derived joins
```

### Ground rules the code follows

- **One screen:** top nav, center map or board, one list, one dossier. Extra views are floating cards, not extra rails.
- **No invented joins.** Tickers link to companies, lobbying clients, PACs, and districts only through `data/tickers.json`. 25 names are hand-curated and 76 more are derived by `scripts/joins.mjs` from exact matches only: SEC business address to Census 119th district, LDA client names, and FEC connected-organization PACs. Each derived row records its basis, and the dossier shows it. That makes 101 full-join names. The rest of the S&P 500 is quotes only.
- **Empty is honest.** A region or feed with no real source stays empty and says why.
- **Label everything** with its source, as-of time, and real latency.

### Scripts

```bash
npm run dev      # API and web UI
npm start        # API only
npm run build    # production build of the web UI into dist/
node scripts/sp500.mjs   # rebuild the S&P 500 rows in data/tickers.json from Wikipedia
node scripts/joins.mjs --count 76 --refresh   # derive district/LDA/PAC joins for the largest quote-only names
```

---

## Disclaimer

For research and education. Nothing here is investment advice. Public disclosures are late by design, and delayed quotes are not suitable for trading decisions. Check anything important against the primary filing, which every row links to.
