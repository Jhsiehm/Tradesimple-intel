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
| **Contracts** | Federal contract actions from USAspending, scoped to all agencies, a ticker (through its USAspending parent records), a congressional district (place of performance), or a member (their House district or Senate state), sorted by most recent or largest. The center board ranks S&P 500 contractors by fiscal-year obligations and by share of revenue, with sector filters and a five-year trend. Beside it is the War.gov daily index of DoD awards of $7.5M or more. |
| **News** | About 45 RSS wires across every region, a Board or a Globe view with headlines pinned to places, and an X column with trending topics and posts from market-moving accounts. |
| **Districts** | Plants and headquarters for joined companies on the congressional district map. |
| **Strait** | Taiwan Strait ships (AIS) and news, plus **Air**: live civil and military aircraft for every theater, including a worldwide military view, with flight routes. |
| **Calendar** | Earnings, macro releases (CPI, FOMC, jobs), lobbying deadlines, and PAC filings. |

### Workflow features

- **Command line.** Press `⌘K`, `Ctrl+K`, or `:`, or click **GO**. Type a section code (`CONG`, `VOTE`, `MKTS`, `WEI`, `POSN`, `PTRS`, `CTR`, `CAL`, `ALRT`, …), a ticker and a function (`LMT CTR`, `NVDA GP`, `BA SPLC`), a district (`TX-12`), or a member name followed by `TL` (timeline), `CTR` (district contracts), or `DES` (card). With nothing typed, it lists where you've been. `Alt+←` goes back.
- **Member timeline.** Click **Timeline ▸** on any member card, or open `#timeline/<bioguide>` (for example `#timeline/T000278`). It plots the member's disclosed trades against hearings on their committees and the roll calls they cast or missed. Trades within 14 days of a committee hearing are linked to it. The stats line compares that share with a baseline: the share of all days since Jan 3, 2025 that fall within 14 days of a hearing. A member whose committees meet most weeks will show a high count by chance. **Copy link** shares the view. This shows calendar proximity only, not what a hearing covered. Hearings and votes are indexed from the start of the 119th Congress (Jan 3, 2025). Earlier dates are shaded.
- **Alerts.** The **Alerts** button in the top bar lists new disclosed trades by watched members, Congress trades and Form 4 filings in watched tickers, and lobbying filings for joined watched tickers. Optionally it also lists every trade filed more than 45 days late. Unread alerts are counted. Browser notifications are opt-in. Alerts are checked every 5 minutes while the tab is open.
- **Phone view.** Below 720 px wide, the terminal is a read-only list and dossier with no map, for people arriving from a shared link. Member timelines still open from `#timeline/…` links.
- **Pinned panels.** Open **Panels** in the top bar to pin a Watchlist, X pulse, Last buyers, Headlines, Global markets, or a Supply chain card. Pinned cards float over every tab and are saved between sessions. The menu also suggests panels for whatever you're looking at, and has one-click workspaces (Ticker research, Congress money trail, Global macro and arbitrage).
- **Watchlist.** Star (☆) any ticker on the S&P board or a dossier, and any member on their card. The watchlist card shows quotes and each member's latest disclosed trade.
- **Resizable layout.** Drag the divider between the map and the list panel. Drag it closed, double-click it, click the ▸ tab, or press `\` to hide the list. Cards resize from any edge and collapse to their title bar with **–**.
- **Last buyer drill-down.** On Positions, the Last buyer columns name the most recent Congress and insider buyer. Click ▸ on a row to see the last six buyers, with traded date, filed date, and filing lag.
- **Supply chain.** For 38 curated large caps (semis, cloud, autos, airlines, defense, energy, pharma, logistics), you get suppliers and customers mapped to revenue lines, each company's home exchange, index, and country ETF, six-month correlation and beta, and a rebased chart of how they moved together. Every link cites the filing or announcement it comes from.
- **Live imagery.** GOES-East, GOES-West, and Himawari frames every 10 minutes, VIIRS daily passes, and a time slider to scrub and play back.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`6` | Switch sections |
| `⌘K` / `Ctrl+K` / `:` | Command line |
| `Alt+←` | Back |
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

### Demo mode (no keys)

`npm run demo` serves the UI from a frozen snapshot of the API, with no server and no keys. A **DEMO** chip with the snapshot date stays in the top bar, and every feed keeps the as-of time from when the snapshot was taken.

```bash
npm run dev                  # in one terminal, with your keys, and let the indexes warm up
npm run snapshot             # writes demo/snapshot/ (about 30 MB, gitignored)
npm run demo                 # or: npm run build:demo  → static site in dist-demo/
VITE_BASE=/Tradesimple-intel/ npm run build:demo   # for GitHub Pages under a repo path
```

The snapshot covers the top 40 traders (cards, trades, timelines), up to 60 joined tickers (positions, charts, events, supply chains), and the main boards. Anything outside it says it isn't in the snapshot. The script aborts if any value from `.env.local` appears in a response.

### Public demo on GitHub Pages

Live copy: **https://jhsiehm.github.io/Tradesimple-intel/** (static, no keys, no server).

```bash
npm start                                  # API with your keys; let trades, timeline, and returns warm up
npm run publish:demo -- --snapshot         # snapshot → build → trim → member pages → push gh-pages
npm run publish:demo                       # rebuild from the existing demo/snapshot and push
npm run publish:demo -- --no-push          # build dist-demo/ only
VITE_DEMO=1 npx vite preview --base /Tradesimple-intel/ --port 4180   # check it locally
```

The keys never leave your machine. CI can't run the live API, so the snapshot is taken locally and only the built site goes to the `gh-pages` branch, as a normal commit (never forced). `main` holds no snapshot data; `demo/snapshot/` and `dist-demo/` stay gitignored.

The published copy is trimmed by `scripts/trim.mjs`: the board-level lists keep their newest rows (3,000 of ~11,000 Congress trades on the Markets layer, 500 positions rows, 300 PAC calendar rows), display-only nested lists are shortened, and long strings are cut. Lists that feed a count or dollar total (timeline trades, ticker PAC and Congress rows) are kept whole. Every trimmed route says so in its latency label. The site is about 40 MB uncompressed; Pages serves it gzipped and each file loads only when opened.

**Share pages with link previews.** `scripts/member-pages.mjs` (run by `publish:demo`) writes `m/<slug>/index.html` (for example `m/cory-a-booker/`) and `m/<BIOGUIDE>/index.html` for every member timeline in the snapshot. Each page carries Open Graph and Twitter `summary_large_image` meta, with a factual description (trades, share of trade days near a hearing against the baseline, median filing lag, late filings, and buys against the S&P 500) and an absolute `og:image` pointing to a 1200×630 `card.png`. Visitors are sent straight to `#timeline/<BIOGUIDE>`. The PNGs are rendered at build time by `@resvg/resvg-js` from the SVG built in `shared/card.mjs`, with no browser. On the timeline, **Share image** downloads the same card drawn client-side, and **Copy link** copies the `/m/<slug>/` page when the build has a public URL (`VITE_PUBLIC_URL`, set by `publish:demo`), or the `#timeline/` link otherwise.

**Enable Pages once:** repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `gh-pages` / `(root)`**. Pages on a private repository needs a paid GitHub plan; on a free plan, make the repository public or publish `dist-demo/` from a separate public repo. `--base` and `--url` change the path and the absolute URL used in share links and preview images.

### API keys (all optional)

Keys live only in `.env.local`. The server reads them and they are never sent to the browser. Any panel that needs a missing key says which one.

| Key | Unlocks | Get one |
| --- | --- | --- |
| `CONGRESS_API_KEY` | Votes, bills, members, committees, calendar | [api.congress.gov](https://api.congress.gov/sign-up/) |
| `LDA_API_KEY` | Lobbying filings | [lda.senate.gov](https://lda.senate.gov/api/register/) |
| `FEC_API_KEY` | Per-ticker corporate PAC receipts and spending for the current cycle, for PACs joined in `data/tickers.json` (member PAC data uses free bulk files) | [api.open.fec.gov](https://api.open.fec.gov/developers/) |
| `AISSTREAM_API_KEY` | Live ship positions | [aisstream.io](https://aisstream.io) |
| `X_BEARER_TOKEN` | Real X posts. Without it, the X column shows the same accounts' posts on Bluesky plus Truth Social. | [developer.x.com](https://developer.x.com) |

Everything else (quotes, SEC, FINRA, news, aircraft, imagery, trends) uses free public endpoints.

---

## Data sources and freshness

| Data | Source | Typical delay |
| --- | --- | --- |
| Congressional trades | House Clerk PTR PDFs, Senate eFD. Every electronic report filed since Jan 3, 2025; scanned paper filings are counted but not parsed. The first full backfill takes a few minutes, and the newest reports appear first. | Up to 45 days after the trade (legal filing window) |
| Federal contract actions | USAspending.gov transactions API, joined through USAspending parent recipient UEIs in `data/tickers.json` | Civilian agencies within days. DoD actions publish about 90 days after award. |
| DoD daily awards | War.gov contract announcements RSS (list of days; article text is not machine-readable here) | Same business day, about 5 p.m. ET |
| Insider trades | SEC EDGAR Form 4 | Within 2 business days |
| Fund holdings | SEC 13F | Up to 45 days after quarter end |
| Short interest | FINRA | Twice monthly |
| Lobbying, PACs | LDA.gov, FEC bulk files | Quarterly and monthly filings |
| Votes, bills, committees | Congress.gov API, unitedstates/congress-legislators | Minutes to hours |
| Timeline index (hearings, per-member roll calls) | Congress.gov committee meetings, House Clerk EVS XML, Senate LIS XML | Rebuilt every 6 hours |
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
  timeline.mjs, alerts.mjs        member timeline index, alerts
  positions.mjs, corporate.mjs    PTRs, Form 4, 13F, FINRA, LDA, FEC
  contracts.mjs                   USAspending contract feed, contractor board, DoD daily index
  chart.mjs, globals.mjs, instruments.mjs, supply.mjs, macro.mjs   market data
  news.mjs     RSS wires, geotagging, X / Bluesky / Truth Social, trends
  air.mjs, strait.mjs, earth.mjs  aircraft, ships, imagery
  db.mjs       SQLite cache (node:sqlite) and ticker join table
src/           React 19 + TypeScript + MapLibre GL (Vite)
  App.tsx      section state, action routing, and the one-screen layout
  shell/       layout pieces: useCards (floating cards), useRail (list width),
               useMapClock (imagery/news time), PanelsMenu, MapBar (toolbars),
               SearchBox, mapView, follow (dossier link actions), sections
  congress/ markets/ contracts/ news/ districts/ strait/   one folder per section: data hook + boards
data/          tickers.json (join table), places, supply chain, globals, geo
scripts/       dev runner, S&P 500 rows, derived joins
```

### Ground rules the code follows

- **One screen:** top nav, center map or board, one list, one dossier. Extra views are floating cards, not extra rails.
- **No invented joins.** Tickers link to companies, lobbying clients, PACs, and districts only through `data/tickers.json`. 25 names are hand-curated and 76 more are derived by `scripts/joins.mjs` from exact matches only: SEC business address to Census 119th district, LDA client names, and FEC connected-organization PACs. Each derived row records its basis, and the dossier shows it. That makes 101 full-join names. The rest of the S&P 500 is quotes only. Separately, `scripts/contract-parents.mjs` joins 200 S&P 500 names to USAspending parent recipient records (`contractParents`), accepting only exact parent-name matches or a multi-word name plus a division word like SYSTEMS or SPACE. A name with no parent record, such as Apple, gets none rather than a fuzzy hit like Appleton Marine.
- **Empty is honest.** A region or feed with no real source stays empty and says why.
- **Label everything** with its source, as-of time, and real latency.

### Scripts

```bash
npm run dev      # API and web UI
npm start        # API only
npm run build    # production build of the web UI into dist/ (map and boards load on demand)
npm run snapshot # capture the running API into demo/snapshot/ for demo mode
npm run demo     # zero-key demo from the snapshot; build:demo writes dist-demo/
npm test         # parser checks against real filings in test/fixtures, join rules, data integrity, API routes (no network)
node scripts/sp500.mjs   # rebuild the S&P 500 rows in data/tickers.json from Wikipedia
node scripts/joins.mjs --count 76 --refresh   # derive district/LDA/PAC joins for the largest quote-only names
node scripts/contract-parents.mjs [--only LMT,BA]   # join tickers to USAspending parent recipients (no key)
```

---

## Disclaimer

For research and education. Nothing here is investment advice. Public disclosures are late by design, and delayed quotes are not suitable for trading decisions. Check anything important against the primary filing, which every row links to.
