# TradeSimple Intel




<img width="324" height="316" alt="image" src="https://github.com/user-attachments/assets/ef494081-e109-4578-b410-b0a5e94b6c5d" />


A one-screen research terminal that joins **what Congress is doing** with **what markets are doing**: roll-call votes, bills, committees, and member stock trades next to insider filings, fund holdings, lobbying, PAC money, federal contracts, global markets, news, X, ships, aircraft, and live satellite imagery.

**Ask** answers questions from the app's own feeds (with citation chips and a grounding check). **Backtest** replays public records against a benchmark with no look-ahead. The **Map** section is a relationship graph you can expand by category, with theories you draw yourself.

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
| **Map** | Relationship graph for a member or ticker: expand neighbors by category (trades, committees, hearings, roll calls, contracts, lobbying, PAC money, supply chain, HQ/district, Form 4). Opening a member or ticker draws the latest disclosed trade (filing lag on the line) and a hearing or same-ticker contract only when it falls within 14 days. **Theory mode** lets you draw dashed links of your own; they are never mixed into data counts or case files. |
| **Calendar** | Earnings, macro releases (CPI, FOMC, jobs), lobbying deadlines, and PAC filings. |

### Today: this week in Congress trading

The first visit (and every visit to the public demo) opens **Today** in the center stage: the newest disclosed trades in plain sentences, such as *Sen. X sold $50k–$100k NVDA · traded Sep 3, filed Sep 25 (22d)*, each with a **filing ↗** link to the source document. Four cards: latest filings (one row per report, with a count of the other trades in it), filings more than 45 days late, the biggest trades by the low end of the disclosed range, and the most-traded tickers by number of members. The window is by filed date: 7 days, widened to 14 or 30 when fewer than five members filed, and the header says which. Names open the member timeline, tickers open the chart. Open it with **Today** in the nav, key `0`, `#week`, or the command codes `WEEK` and `LEAD` (leaderboards). API: `/api/congress/feed` (pure `buildFeed` in `server/feed.mjs`; sentences in `shared/sentences.mjs`).

### Leaderboards and returns against the S&P 500

**Today → Leaderboards** (`#leaders`, command `LEAD`) ranks members four ways: disclosed buys against the S&P 500 (highest and lowest, minimum 10 priced buys), most active traders, late filers (reports with a trade filed more than 45 days after it, plus the longest lag with a link to that filing), and most-traded tickers since Jan 3, 2025.

How returns are computed, and what they are not:

- **Buys only.** Each disclosed buy of a joined ticker (`data/tickers.json`) is priced from the Yahoo Finance daily **adjusted** close on the trade date (or the next trading day, within 5 days) to the latest close. SPY over the same days is the S&P 500. Excess = stock return − SPY return, in percentage points. 30-day and 90-day figures use only buys at least that old. Sells are not scored.
- **Equal-weighted, not a portfolio.** Disclosures give ranges, not amounts or exit dates, so the headline averages every buy equally. A second figure weights each buy by its **range midpoint**. Neither is the member's actual return: we don't know position sizes, when they sold, or what they hold outside these reports. The UI and share card say *Disclosed buys, equal-weighted, not their actual portfolio*.
- **Coverage.** Up to the 300 most-bought joined tickers plus SPY. Unjoined symbols, options, bonds, and funds outside the join table are not priced; the board shows priced/total buys per member.
- **Fetching.** `server/returns.mjs` warms in the background 20 s after boot and every 12 h, one Yahoo request at a time about 450 ms apart, with daily closes cached in SQLite for 20 h (stale copies are kept if Yahoo fails). Results appear progressively while pricing runs. Pure functions (`tradeReturn`, `buyReturns`, `memberStats`, `buildLeaders`) are tested in `test/returns.test.mjs`.

The member timeline shows the same figure in its stats line and each trade's return against SPY in its tooltip; the share card adds a *Buys vs S&P 500* stat. API: `/api/congress/leaders`, and `returns` on `/api/congress/member/:id/timeline`.

### Backtest: replay public records against a benchmark

Open it with the command `BT`, **Backtest** on a member or ticker dossier, a `#bt=…` share link (the link holds the whole spec), or **Ask the chat to backtest…** on the board. Plain-words planning lives in Ask (clarifying chips and preferences); the board is the expanded view of a run. The hand-edit form folds under **Edit the spec by hand**.

Pick signals (congressional trades by committee, member, party, chamber, ticker, sector, size, or nearness to a hearing; Form 4 insider buys and sells without 10b5-1 plans; contract awards by agency to joined contractors; lobbying spikes), then rules (entry, hold days, stop and take-profit, equal or range-midpoint sizing, benchmark, costs and slippage). It draws the equity curve against the benchmark held on the same days, then stats, a trade table, per-member and per-ticker breakdowns, **Formulas** (KaTeX with worked numbers from this run), a **Replicate** download (spec, CSVs, METHODS.md, and scripts), and **Data caveats** that you should read before any number.

- **No look-ahead.** A signal is dated by when the record became public (the filing date; the amendment date for amended Senate rows; the action date plus 90 days for DoD awards, 7 days for civilian awards), never the trade date. Entry is the first trading day *after* that date, at the open or the close. Tests in `test/backtest.test.mjs` fail if a price before the entry day ever changes a result.
- **Disclosure dedupe.** A trade listed in both a Senate original and its amendment (or two House PTRs) counts once (`shared/disclosures.mjs`). Filing lag is original report date minus trade date; amendment delay is reported on its own. The public date for backtests is the earliest date any of those reports was public.
- **Portfolio, in calendar time.** Each trading day is the average return of the positions open that day; idle days earn zero; the benchmark holds the same positions on the same days; holidays carry the last level forward; drawdown is peak to trough on that curve. Sells are scored as shorts with no borrow cost. Congress amounts are ranges, so equal weight is the default and range midpoint (capped at $1,000,000) is an estimate. Only the selected side counts as signals; price history covers about three years.
- **What it will not tell you.** Committee seats are the current roster applied to past trades; paper filings are not parsed (counted in the caveats); symbols with no Yahoo history (delisted, renamed) are excluded and counted, which flatters results; `^GSPC` is price only while stocks are dividend-adjusted; trades overlap, so the t-statistic overstates confidence; a single prolific member can be most of a sample (the caveats name them). The Sharpe-ish figure is labeled as rough.
- **API.** `GET /api/backtest` returns the form options; `POST /api/backtest` with `{source, filters, rules}` (or `GET ?spec=<json or #bt token>`) runs one. `GET /api/backtest/replicate` builds the export pack. Results carry source, as-of and latency per feed, are cached 30 minutes by spec hash, and at most two run at once (429 beyond that). A first run can take 15 to 40 seconds while prices load; the board retries while the server says it is still building. Pure engine: `shared/backtest.mjs`; formulas: `shared/formulas.mjs`; export: `shared/replicate.mjs`.

### Ask: questions answered from the app's own data

`ASK <your question>` in the command line (`⌘K`), type a question in the top search box and choose the **Ask** row, or press **Ask** when something is on screen. Answers stream in a floating **Ask sheet** (resizable, peek / half / full): live tool steps, citation chips after each claim (`[t3]` style) that open the board they came from, a collapsible **How I got this** list with source / as-of / latency per tool call, **Data caveats**, clarifying chips when a backtest needs a choice, inline backtest cards, and buttons to Keep the chat, copy a link, or share. History stays in this browser only.

Screen context (the selected member or ticker, or a theory) is attached only when something is selected; you can detach it. Accepting a **propose_theory** result writes one cleaned theory into your map document (`saveTheory`); dismiss writes nothing. Theories are labeled *not from a data source* and are never mixed into counts or case files.

The model can only call read-only tools that wrap the app's own routes:

`search`, `member_profile`, `member_trades`, `member_timeline`, `ticker_dossier`, `case_file`, `committee`, `bill`, `bill_votes`, `votes`, `contracts`, `corporate`, `lobbying_client`, `pac_committee`, `positions`, `alerts`, `intel_scope`, `congress_leaders`, `run_backtest`, `propose_theory`.

It never places orders and has no network tool of its own. The server enforces (see `ASK_LIMITS` in `shared/ask.mjs`): at most 8 tool calls, 6 model rounds, 150 seconds wall clock, and an 80,000-token budget per question; 12 questions per 10 minutes per client address; 3 answers in flight. Replies that skip the model (greetings, preference saves, clarify-only turns) do not consume the rate limit. Tool calls (name, arguments, timing; never keys) are logged to `/tmp/intel-ask.log`.

**Grounding.** The prompt requires answering only from tool results with a ref after each fact. The server then checks the final text: refs that match no tool result are reported, and every number in the answer that appears in no tool result is listed under the answer as *not found in any tool result*. This is a warning, not a proof: a number can match by coincidence, and a claim can be wrong without a number in it. If a data tool returned rows but the answer has no figures, Ask retries once; if it still has none, the tool's own table is shown.

**Backtest planning.** Questions that want a backtest are planned first (`shared/backtestAsk.mjs`): preferences, the previous run, and chip answers. Ambiguous result-changing fields end the turn with clarify chips (no model call). Preferences can be set or cleared in plain words and apply to new backtests until changed.

**Provider.** Ask is off until `.env.local` names a provider and its key (the key never reaches the browser; `GET /api/ask` reports only whether it is configured):

| `ASK_PROVIDER` | Key needed | Default `ASK_MODEL` (when empty) |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4.1` |
| `compat` (OpenAI-compatible: Vercel AI Gateway, LiteLLM, vLLM, LM Studio…) | `ASK_API_KEY` + `ASK_BASE_URL` | set `ASK_MODEL` (for example `anthropic/claude-sonnet-4.5`) |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-4.6` (menu also offers GPT, Gemini, Haiku, mini) |

With `ASK_PROVIDER` empty and only `OPENROUTER_API_KEY` set, the provider is inferred as `openrouter`. `AGENT_MODEL` is read as an alias of `ASK_MODEL`. Small models (mini, nano, haiku, flash) work but show a warning badge. Without a key the sheet says *Ask is not configured — add a key to .env.local*, and Backtest and every other board still work. Adapters live in `server/ai/providers.mjs` and are tested with mocked fetch in `test/ask.test.mjs` (no network).

### Map: relationship graph and theories

Open with **Map** in the nav, command `MAP`, or from a member/ticker follow action. The center stage is a canvas graph (pan / zoom / pinch, drag to pin, hover neighborhood, keyboard). Expand a node by category; each edge carries source, as-of, and latency. Filter chips, legend, search-to-add, and undo/redo are in the chrome.

**Theory mode** draws dashed magenta links stored in this browser only (versioned documents, export / import / share link). Ask can propose a theory; Accept stores one cleaned theory and the open map picks it up. User-added nodes (person, event, company, other) are marked as yours.

Data maps elsewhere (votes, filings, districts, HQ) run flat and dark by default; imagery and intel arcs are opt-in. On Congress and Districts maps, the time scrubber can draw trade / contract / PAC arcs for a member or ticker scope (`/api/intel/scope`), with case-file signals in the dossier.

### Case files and alerts

Opening a member, ticker, or district assembles a **case file**: headline, signal chip (hearing-proximity severity for members, 30-day activity spike for tickers), stats, and provenance. As-of is the stalest contributing feed, not request time. Signal rules are shown in the UI and defined in `shared/intel.mjs`.

**Alerts** in the top bar list new disclosed trades by watched members, Congress trades and Form 4 filings in watched tickers, and lobbying filings for joined watched tickers. Optionally every trade filed more than 45 days late. Form 4 rows are one per filing (accession) with summed value; 10b5-1 planned sales only are ROUTINE. Triage levels: HIGH / ELEVATED / ROUTINE. Unread alerts are counted; browser notifications are opt-in; checked every 5 minutes while the tab is open.

### Posting bot (Bluesky and X), dry run by default

`npm run bot` finds trade lines **filed since the last run** and picks the notable ones: filed more than 45 days late, $250,001 or more, or traded within 14 days of a hearing on one of the member's committees. It keeps one post per report (noting how many other trades it holds), strongest first, at most 5 per run (`--max`). Each post is factual and links the filing, for example:

```
Filed 466 days late: Rep. John W. Rose (R-TN-6) sold $250k–$500k GOOGL · traded Jun 3, 2025, filed Sep 12 (466d).
Traded 1 day before a House Agriculture hearing; calendar proximity only, not evidence of wrongdoing.
Filing: disclosures-clerk.house.gov/…/20035444.pdf
```

Posts are shortened step by step to fit Bluesky (300 graphemes, link shown short with a full-URL facet) and X (280, URLs count 23). The member's share card is attached as the image.

```bash
npm start                                   # the bot reads the running API
npm run bot                                 # DRY RUN: prints posts, writes card PNGs to /tmp/intel-bot, changes nothing
npm run bot -- --since-days 7 --max 3       # first-run window (default 3 days) and cap
npm run bot -- --mark                       # record the shown filings as handled without posting
npm run bot -- --post [--only bluesky|x]    # actually post; requires keys
```

Nothing is posted without `--post` **and** keys in `.env.local` (names in `.env.example`): `BSKY_HANDLE` + `BSKY_APP_PASSWORD` (an app password, not your login) for Bluesky via atproto, and/or `X_API_KEY` + `X_API_SECRET` + `X_ACCESS_TOKEN` + `X_ACCESS_SECRET` for X (API v2 tweet with a v1.1 media upload, OAuth 1.0a user context; the X app needs write access). Posted ids and the last filed date live in `data/bot-state.json` (gitignored), so reruns don't duplicate. To run it on a schedule, use cron or launchd, e.g. `*/30 * * * * cd ~/tradesimple-intel && npm run bot -- --post >> /tmp/intel-bot.log 2>&1`. Pure helpers are in `scripts/botlib.mjs` and tested in `test/bot.test.mjs` (including the documented OAuth signature example).

### Workflow features

- **Command line.** Press `⌘K`, `Ctrl+K`, or `:`, or click **GO**. Type a section code (`CONG`, `VOTE`, `MKTS`, `WEI`, `POSN`, `PTRS`, `CTR`, `CAL`, `MAP`, `ALRT`, `ASK`, `BT`, …), a ticker and a function (`LMT CTR`, `NVDA GP`, `BA SPLC`, `NVDA BT`), a district (`TX-12`), or a member name followed by `TL` (timeline), `CTR` (district contracts), `DES` (card), or `BT` (backtest). With nothing typed, it lists where you've been. `Alt+←` goes back.
- **Member timeline.** Click **Timeline ▸** on any member card, or open `#timeline/<bioguide>` (for example `#timeline/T000278`). It plots the member's disclosed trades against hearings on their committees and the roll calls they cast or missed. Trades within 14 days of a committee hearing are linked to it. The stats line compares that share with a baseline: the share of all days since Jan 3, 2025 that fall within 14 days of a hearing. A member whose committees meet most weeks will show a high count by chance. **Copy link** shares the view. This shows calendar proximity only, not what a hearing covered. Hearings and votes are indexed from the start of the 119th Congress (Jan 3, 2025). Earlier dates are shaded.
- **Phone view.** Below 720 px wide, the terminal is a read-only list and dossier with no map, for people arriving from a shared link. Member timelines still open from `#timeline/…` links; the Map canvas sits above the list when that section is open.
- **Pinned panels.** Open **Panels** in the top bar to pin a Watchlist, X pulse, Last buyers, Headlines, Global markets, or a Supply chain card. Pinned cards float over every tab and are saved between sessions. The menu also suggests panels for whatever you're looking at, and has one-click workspaces (Ticker research, Congress money trail, Global macro and arbitrage).
- **Watchlist.** Star (☆) any ticker on the S&P board or a dossier, and any member on their card. The watchlist card shows quotes and each member's latest disclosed trade.
- **Resizable layout.** Drag the divider between the map and the list panel. Drag it closed, double-click it, click the ▸ tab, or press `\` to hide the list. Cards resize from any edge and collapse to their title bar with **–**. The Ask sheet is independently resizable and snaps peek / half / full.
- **Last buyer drill-down.** On Positions, the Last buyer columns name the most recent Congress and insider buyer. Click ▸ on a row to see the last six buyers, with traded date, filed date, and filing lag.
- **Supply chain.** For 38 curated large caps (semis, cloud, autos, airlines, defense, energy, pharma, logistics), you get suppliers and customers mapped to revenue lines, each company's home exchange, index, and country ETF, six-month correlation and beta, and a rebased chart of how they moved together. Every link cites the filing or announcement it comes from.
- **Live imagery.** GOES-East, GOES-West, and Himawari frames every 10 minutes, VIIRS daily passes, and a time slider to scrub and play back. On Strait, Dark / Live picture switch; imagery on data maps is opt-in.

### Keyboard

| Key | Action |
| --- | --- |
| `0` | Today: this week in Congress trading |
| `1`–`7` | Switch sections (Congress … Map) |
| `⌘K` / `Ctrl+K` / `:` | Command line |
| `Alt+←` | Back |
| `/` | Search tickers, members, districts (a question there offers **Ask**) |
| `↑` `↓` | Move through the list |
| `\` | Hide or show the list panel |
| `Esc` | Close the dossier, Ask sheet, calendar, backtest, or menus |

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

To point a second Vite UI at another API (experiments, a fake model), set `INTEL_API` (API origin) and `VITE_PORT` (UI port). Vite proxies `/api/ask` with a long timeout so streamed answers and backtests can finish.

### Demo mode (no keys)

`npm run demo` serves the UI from a frozen snapshot of the API, with no server and no keys. A **DEMO** chip with the snapshot date stays in the top bar, and every feed keeps the as-of time from when the snapshot was taken. Ask stays unavailable in demo (no provider, no live tools).

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
| `ASK_PROVIDER` + provider key | Ask sheet (see table above). `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ASK_API_KEY`+`ASK_BASE_URL`, or `OPENROUTER_API_KEY` | Provider dashboards |
| `INTEL_ALLOWED_ORIGINS` | Extra origins allowed to POST/PUT/PATCH/DELETE to the local API (comma-separated). Loopback Vite and Origin-less curl/scripts are already allowed. | — |

Everything else (quotes, SEC, FINRA, news, aircraft, imagery, trends, backtest prices) uses free public endpoints.

**Cross-site guard.** POST / PUT / PATCH / DELETE to the API must come from an allowed origin (the Vite app, `INTEL_ALLOWED_ORIGINS`) or, with no Origin/Referer, from a loopback non-browser client. That stops another tab from running backtests or spending Ask credits against your local server. `PUBLIC_URL` is not an allowed write origin.

---

## Data sources and freshness

| Data | Source | Typical delay |
| --- | --- | --- |
| Congressional trades | House Clerk PTR PDFs, Senate eFD. Every electronic report filed since Jan 3, 2025; scanned paper filings are counted but not parsed. Duplicate lines across an original and its amendment (or two House PTRs) are folded to one transaction. The first full backfill takes a few minutes, and the newest reports appear first. | Up to 45 days after the trade (legal filing window) |
| Federal contract actions | USAspending.gov transactions API, joined through USAspending parent recipient UEIs in `data/tickers.json` | Civilian agencies within days. DoD actions publish about 90 days after award. |
| DoD daily awards | War.gov contract announcements RSS (list of days; article text is not machine-readable here) | Same business day, about 5 p.m. ET |
| Insider trades | SEC EDGAR Form 4 | Within 2 business days |
| Fund holdings | SEC 13F | Up to 45 days after quarter end |
| Short interest | FINRA | Twice monthly |
| Lobbying, PACs | LDA.gov, FEC bulk files | Quarterly and monthly filings |
| Votes, bills, committees | Congress.gov API, unitedstates/congress-legislators | Minutes to hours |
| Timeline index (hearings, per-member roll calls) | Congress.gov committee meetings, House Clerk EVS XML, Senate LIS XML | Rebuilt every 6 hours |
| US equities | Nasdaq screener | About 15 min delayed |
| Global indices, ETFs, ADRs, FX, charts, backtest bars | Yahoo Finance chart API | 15–20 min delayed; some exchanges end of day; backtest OHLC cached ~12 h |
| Crypto | Yahoo Finance, CoinGecko | Minutes |
| News | Publisher RSS feeds | Minutes |
| X | trends24 (hourly trending), Bluesky public API, trumpstruth.org, or X API v2 with a token | Minutes to an hour |
| Aircraft | adsb.lol (ADS-B/MLAT), adsbdb.com routes | Seconds |
| Ships | aisstream.io | Seconds |
| Satellite | NASA GIBS (GOES, Himawari, VIIRS) | About 1 hour for geostationary, daily for VIIRS |
| Supply chain links | Curated from 10-K/20-F filings and company announcements (`data/supplychain.json`) | Changes when filings change |
| Ask answers | Model provider + in-process tools over the routes above | Live; limited by tool and model latency |

> **About the Global / ADR arbitrage view:** the premiums compare delayed snapshots, and most home markets are closed while the ADR trades. They show where dislocations tend to appear, not tradable opportunities. Real cross-listing arbitrage needs licensed low-latency exchange feeds. That's a possible future extension.

---

## How it's built

```
server/        Node HTTP API on :8787, no framework
  index.mjs, router.mjs, lib/guard.mjs   routes + cross-site write guard
  ai/          Ask: providers, tools, run loop, SSE, config, log
  routes/      ask, backtest, congress, markets, relations, …
  domain/      backtest (signals, bars, sources, replicate), congress, corporate, …
  congress.mjs, roster.mjs        votes, bills, members, committees
  timeline.mjs, alerts.mjs        member timeline index, alerts
  feed.mjs                        landing feed (this week in Congress trading)
  returns.mjs                     buy returns vs SPY, member stats, leaderboards
  positions.mjs, corporate.mjs    PTRs, Form 4, 13F, FINRA, LDA, FEC
  contracts.mjs                   USAspending contract feed, contractor board, DoD daily index
  intel.mjs                       case files, arc links, scope scrubber
  chart.mjs, globals.mjs, instruments.mjs, supply.mjs, macro.mjs   market data
  news.mjs     RSS wires, geotagging, X / Bluesky / Truth Social, trends
  air.mjs, strait.mjs, earth.mjs  aircraft, ships, imagery
  db.mjs       SQLite cache (node:sqlite) and ticker join table
src/           React 19 + TypeScript + MapLibre GL (Vite)
  App.tsx      section state, action routing, and the one-screen layout
  agent/       Ask sheet (chat UI, context, size snaps)
  ask/         stream client, answer/steps/clarify/backtest cards
  backtest/    board, form, equity chart, formulas (KaTeX), replicate panel
  relations/   relationship canvas, theory editor, palette, store
  intel/       case header, scrubber, arcs
  shell/       layout pieces: useCards, useRail, useMapClock, PanelsMenu,
               MapBar, SearchBox, CommandBar, mapView, follow, sections
  congress/ markets/ contracts/ news/ districts/ strait/ city/   section boards
shared/        ask, agent, backtest, backtestAsk, backtestSpec, disclosures,
               formulas, replicate, intel, relations, theories, sentences, …
data/          tickers.json (join table), places, supply chain, globals, geo
scripts/       dev runner, S&P 500 rows, derived joins, snapshot, bot, publish
test/          parsers, joins, ask, backtest, replicate, routes, intel, …
```

### Ground rules the code follows

- **One screen:** top nav, center map or board, one list, one dossier. Extra views are floating cards or the Ask sheet, not extra rails.
- **No invented joins.** Tickers link to companies, lobbying clients, PACs, and districts only through `data/tickers.json`. 25 names are hand-curated and 76 more are derived by `scripts/joins.mjs` from exact matches only: SEC business address to Census 119th district, LDA client names, and FEC connected-organization PACs. Each derived row records its basis, and the dossier shows it. That makes 101 full-join names. The rest of the S&P 500 is quotes only. Separately, `scripts/contract-parents.mjs` joins 200 S&P 500 names to USAspending parent recipient records (`contractParents`), accepting only exact parent-name matches or a multi-word name plus a division word like SYSTEMS or SPACE. A name with no parent record, such as Apple, gets none rather than a fuzzy hit like Appleton Marine. Ask must not invent a join the ticker tool did not return.
- **Empty is honest.** A region or feed with no real source stays empty and says why. China, Europe, the Middle East, Eastern Europe, South Asia, and Southeast Asia stay empty until a feed is real.
- **Label everything** with its source, as-of time, and real latency.
- **Theories are yours.** Dashed theory edges and Ask proposals never feed counts, case files, or backtests until you accept them into the local theory document — and even then they stay marked as not from a data source.
- **Research only.** No brokerage connection, no order placement. Ask must not recommend buys or sells or predict prices.
- **Keys stay on the server.** Never commit `.env.local` or send keys to the browser.

### Scripts

```bash
npm run dev      # API and web UI
npm start        # API only
npm run build    # production build of the web UI into dist/ (map and boards load on demand)
npm run snapshot # capture the running API into demo/snapshot/ for demo mode
npm run publish:demo   # build the static demo with member share pages and push it to gh-pages
npm run bot      # dry-run the Bluesky/X posting bot (add --post to post)
npm run demo     # zero-key demo from the snapshot; build:demo writes dist-demo/
npm test         # parsers, joins, ask, backtest, replicate, data integrity, API routes (no network)
node scripts/sp500.mjs   # rebuild the S&P 500 rows in data/tickers.json from Wikipedia
node scripts/joins.mjs --count 76 --refresh   # derive district/LDA/PAC joins for the largest quote-only names
node scripts/contract-parents.mjs [--only LMT,BA]   # join tickers to USAspending parent recipients (no key)
INTEL_API=http://127.0.0.1:8788 VITE_PORT=5174 npm run dev   # second UI against another API
```

---

## Disclaimer

For research and education. Nothing here is investment advice. Public disclosures are late by design, and delayed quotes are not suitable for trading decisions. Backtests replay past public records with the caveats on the board — they are not proof of an edge. Ask answers are grounded against tool results with a warning check, not a guarantee. Check anything important against the primary filing, which every row links to.
