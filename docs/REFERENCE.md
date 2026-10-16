# TradeSimple Intel reference

Detailed feature, methodology, setup, and maintenance documentation. For an introduction, see the [README](../README.md).

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

The first visit (and every visit to the public demo) opens **Today** in the center stage: the newest disclosed trades in plain sentences, such as *Sen. X sold $50k–$100k NVDA · traded Sep 3, filed Sep 25 (22d)*, each with a **filing ↗** link to the source document. A disclosure overview leads into four evidence views: latest filings (one row per report, with a count of the other trades in it), filings made more than 45 days after trading (all loaded history), the biggest trades by the low end of the disclosed range, and the most-traded tickers by number of members. Overview links open the corresponding evidence view; the watchlist follows the evidence. The window is by filed date: 7 days, widened to 14 or 30 when fewer than five members filed, and the header says which. Names open the member timeline, tickers open the chart. Open it with **Today** in the nav, key `0`, `#week`, or the command codes `WEEK` and `LEAD` (leaderboards). API: `/api/congress/feed` (pure `buildFeed` in `server/feed.mjs`; sentences in `shared/sentences.mjs`).

### Find: destinations and research

Open **Find** or press **⌘K / Ctrl+K** to search companies, members, districts, app destinations, recent visits, and saved Ask chats. Recent and saved research appear first when the query is empty; saved chats stay in this browser. Results show their type and a short explanation, with existing codes such as `LMT CTR`, `Pelosi TL`, and `ASK …` retained. Use arrow keys and Enter to open a result, Escape to dismiss; focus stays inside the dialog and returns to its opener. Find is also available in the phone navigation. Company-search loading or failure is shown independently of local results.

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

### Ask: questions answered from the app's own data (and optionally the web)

`ASK <your question>` in the command line (`⌘K`), type a question in the top search box and choose the **Ask** row, or press **Ask** when something is on screen. Answers stream in a floating **Ask sheet** (resizable, peek / half / full): live tool steps, citation chips after each claim (`[t3]` style) that open the board they came from, a collapsible **How I got this** list with source / as-of / latency per tool call, **Data caveats**, clarifying chips when a backtest or sourcing choice is needed, inline backtest cards, and buttons to Keep the chat, copy a link, or share. History stays in this browser only.

**Sourcing modes** (default: in-app feeds — isolates the research bot from the open web):

| Mode | What Ask may call |
| --- | --- |
| **In-app feeds** (`platform`) | Congress, markets, contracts, **news RSS**, **X pulse/posts**, world calendar, **satellite status**, Strait AIS/news, air, backtests, theories. World/news answers must cross-check ≥2 signal feeds and keep Records vs Signals distinct. |
| **In-app + web** (`both`) | Everything above, plus `web_search` and `web_fetch` |
| **Web only** (`web`) | Open web only (`web_search` / `web_fetch`); no in-app filing tools |

Toggle in the Ask sheet, say it in chat (“in-app only”, “use in-app and the web”, “web only”), or answer the follow-up chip when a question clearly wants the open web. Modes persist in this browser (`intel:ask:session:v1`) until cleared. `web_fetch` refuses private/link-local hosts, pins validated DNS addresses to each connection, and revalidates up to three redirects. Downloads stop at 2 MB of decoded content or a 12-second deadline covering DNS, redirects, and the body.

**Writing styles** (specialized instruction packs per data layer are injected automatically):

| Style | Behavior |
| --- | --- |
| **Terminal** (default) | Dense, figures-first tables |
| **Professional** | Executive brief: finding → evidence → one caveat |
| **Simplified** | Plain language for a smart non-expert; jargon defined once |

Say “professional”, “simplified”, or “terminal style” in the question or as a follow-up. Layer packs (`shared/askModes.mjs`) add standing rules for Congress, markets, money, news/X, world/geo, and web whenever those tools are enabled.

Screen context (the selected member or ticker, or a theory) is attached only when something is selected; you can detach it. Accepting a **propose_theory** result writes one cleaned theory into your map document (`saveTheory`); dismiss writes nothing. Theories are labeled *not from a data source* and are never mixed into counts or case files.

**Platform tools** (TradeSimple feeds): `search`, `member_profile`, `member_trades`, `member_timeline`, `ticker_dossier`, `case_file`, `committee`, `hearings`, `bill`, `bill_votes`, `votes`, `contracts`, `corporate`, `lobbying_client`, `pac_committee`, `positions`, `insiders`, `congress_feed`, `congress_leaders`, `alerts`, `intel_scope`, `run_backtest`, `propose_theory`, `news`, `news_desk`, `x_pulse`, `x_posts`, `world_calendar`, `macro_strip`, `satellite`, `shipping`, `strait_news`, `strait_ships`, `air_theater`.

**Web tools** (only in `both` / `web`): `web_search` (Brave when `BRAVE_SEARCH_API_KEY` is set, else DuckDuckGo HTML), `web_fetch` (one public http(s) URL; localhost blocked). Web results are labeled as outside TradeSimple and must be cited by URL.

It never places orders. The server enforces (see `ASK_LIMITS` in `shared/ask.mjs`): at most 8 tool calls, 6 model rounds, 150 seconds wall clock, and an 80,000-token budget per question; 12 questions per 10 minutes per client address; 3 answers in flight. Replies that skip the model (greetings, preference/mode saves, clarify-only turns) do not consume the rate limit. Tool calls (name, arguments, timing; never keys) are logged to `/tmp/intel-ask.log`.

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
- **Trade age on every alert.** Alert rows, live toasts and the watchlist feed show when the record was filed ("filed 2h ago"), when the trade happened ("traded 38d ago"), and the filing lag between them, with a freshness tag on the trade date: FRESH ≤3 days, RECENT ≤14, STALE ≤45, OLD beyond. A Congress trade or Form 4 that is STALE drops one severity level and one that is OLD drops two, so a trade disclosed today but made 38 days ago ranks below an insider buy from yesterday. Late-filing rows keep their level (the lateness is the point). Hover the age for the rule and the level before ageing.
- **Fast SEC alerts.** For watched tickers, the live poller reads EDGAR's latest-filings Atom feeds (Form 4, 8-K, Schedule 13D, 13G) every 30 seconds through the shared 8 req/s SEC gate, matches issuers by CIK from `data/tickers.json`, and fetches only the matching filings (Form 4s go through the same parser as the Positions board). A per-issuer submissions sweep still runs every 30 minutes and after a restart, so nothing is missed while the server was down. Detection latency (EDGAR acceptance → detected) is measured on every new filing in those feeds and shown in the live status strip; each pushed alert carries its own. Measured on 9 Oct 2026 (30-second polling, 35 new filings over 11.5 minutes): a median of 43 s after acceptance, p90 54 s, worst 63 s, best 25 s. About 25 s of that is EDGAR listing the filing in the feed; the rest is waiting for the next poll. The old per-issuer polling ran every 90 s and could only see a filing once it appeared in that company's submissions file. A 403 or 429 from SEC pauses SEC polling for 10 minutes.

### Phone alerts (ntfy)

Live alerts can also go to your phone through [ntfy](https://ntfy.sh), a free push service with no account needed. The server sends them; the topic never reaches the browser (the Alerts menu shows it masked).

1. Install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347), [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy), or the web app at ntfy.sh).
2. Pick a long random topic. Anyone who knows a topic on ntfy.sh can read it, so treat it like a password. **Alerts → Phone (ntfy) → Suggest a topic** generates one, or run `node -e "console.log('tsi-'+require('crypto').randomBytes(18).toString('base64url').toLowerCase())"`.
3. Add it to `.env.local` as `NTFY_TOPIC=…` and restart the API (`npm run dev`).
4. In the app, tap **+**, subscribe to the same topic (server `ntfy.sh` unless you set `NTFY_SERVER`).
5. Open **Alerts → Phone (ntfy)** and press **Send test notification**.

Each message has the ticker, who and what, traded and filed ages, filing lag, detection latency and the source, with priority from severity (HIGH 4, ELEVATED 3, ROUTINE 2; never 5, which overrides Do Not Disturb) and an **Open filing** button. Tapping opens the hosted terminal when `PUBLIC_ORIGIN` (or `NTFY_CLICK_URL`) is set. By default ELEVATED and HIGH alerts are sent, every kind except news and the all-members late-filing list; change this in the panel or with `NTFY_MIN_SEVERITY` / `NTFY_KINDS`. Quiet hours (`NTFY_QUIET=22:00-07:00`, New York time) hold everything except HIGH. No alert is ever sent twice (sent ids are kept in `data/cache.sqlite`), and at most `NTFY_MAX_PER_HOUR` (default 20) go out per hour; the next message after a held stretch says how many were held. Backfill (filings already on record when a ticker is added) is never sent. For a private server or a reserved topic, set `NTFY_SERVER` and `NTFY_TOKEN`.

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

Requires **Node.js 22.13+**.

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
| `LDA_API_KEY` | Lobbying filings | [lda.gov](https://lda.gov/api/register/) |
| `FEC_API_KEY` | Per-ticker corporate PAC receipts and spending for the current cycle, for PACs joined in `data/tickers.json` (member PAC data uses free bulk files) | [api.open.fec.gov](https://api.open.fec.gov/developers/) |
| `AISSTREAM_API_KEY` | Live ship positions | [aisstream.io](https://aisstream.io) |
| `X_BEARER_TOKEN` | Real X posts. Without it, the X column shows the same accounts' posts on Bluesky plus Truth Social. | [developer.x.com](https://developer.x.com) |
| `NTFY_TOPIC` | Phone alerts through ntfy (see [Phone alerts](#phone-alerts-ntfy)) | Any long random string; no sign-up |
| `SEC_CONTACT` | Your email in the SEC User-Agent. www.sec.gov refuses agents without a contact; a generic default is used when empty. | — |
| `ASK_PROVIDER` + provider key | Ask sheet (see table above). `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ASK_API_KEY`+`ASK_BASE_URL`, or `OPENROUTER_API_KEY` | Provider dashboards |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` | Ask `web_search` when sourcing is "In-app + web" or "Web only" and no `OPENROUTER_API_KEY` is set (OpenRouter's web plugin is used first) | [Tavily](https://tavily.com), [Brave Search API](https://brave.com/search/api/) |
| `INTEL_ALLOWED_ORIGINS` | Extra origins allowed to POST/PUT/PATCH/DELETE to the local API (comma-separated). Loopback Vite and Origin-less curl/scripts are already allowed. | — |

Everything else (quotes, SEC, FINRA, news, aircraft, imagery, trends, backtest prices) uses free public endpoints.

**Cross-site guard.** POST / PUT / PATCH / DELETE to the API must come from an allowed origin (the Vite app, `INTEL_ALLOWED_ORIGINS`) or, with no Origin/Referer, from a loopback non-browser client. That stops another tab from running backtests or spending Ask credits against your local server. `PUBLIC_URL` is not an allowed write origin.

---

## Hosting on a VPS

An always-on private copy behind a password, on one small Ubuntu server for about $5–7 a month. The public GitHub Pages demo is separate and stays as it is.

```
browser ──https──▶ Caddy :443  (Let's Encrypt certificate, HSTS, gzip/zstd, event streams flushed unbuffered)
                     └─▶ node server/index.mjs on 127.0.0.1:8787  (NODE_ENV=production, systemd, Restart=always)
                           /healthz · /login · /logout → sign-in gate → dist/ (built app) | /api, /geo (API)
                           sqlite cache /var/lib/tradesimple/cache.sqlite → daily backup, newest 7 kept
```

In production the Node server serves the built app and the API on one port, and every page and `/api` call needs a signed session cookie (HttpOnly, Secure, SameSite=Lax, 30 days, renewed while you use it). The password is stored only as a scrypt hash. Five wrong tries from one address lock that address out for 15 minutes, 30 in total lock sign-in for everyone, and fail2ban bans repeat offenders at the firewall. An authenticator code (TOTP) is optional. `npm run dev` on your own machine never asks for a password.

### 1. Create the server (only you can do this)

You need an SSH key. If `ls ~/.ssh/id_ed25519.pub` finds nothing, run `ssh-keygen -t ed25519` first. Then copy it with `pbcopy < ~/.ssh/id_ed25519.pub`.

**Hetzner CX22** (2 vCPU, 4 GB RAM, 40 GB disk, about €4–5 a month including the IPv4 address):

1. Sign up at [console.hetzner.cloud](https://console.hetzner.cloud), open the default project and click **Add Server**.
2. **Location**: Falkenstein, Nuremberg or Helsinki (the CX line runs in the EU; distance does not matter for polled feeds).
3. **Image**: Ubuntu 24.04. **Type**: Shared vCPU, x86, **CX22**.
4. **Networking**: keep **Public IPv4** and IPv6 on.
5. **SSH keys**: **Add SSH key**, paste the key, save.
6. Leave volumes, firewalls and cloud-config empty. Hetzner's own Backups (+20%) are optional. Name it `intel` and click **Create & Buy now**. Copy the IPv4 address.

**DigitalOcean $6 droplet** (1 vCPU, 1 GB RAM, 25 GB disk; the bootstrap adds 2 GB of swap so builds fit):

1. Sign up at [cloud.digitalocean.com](https://cloud.digitalocean.com), click **Create → Droplets**.
2. **Region**: New York or the closest to you. **Image**: Ubuntu 24.04 (LTS) x64.
3. **Size**: Basic, Regular SSD, **$6/mo** (1 GB / 1 CPU).
4. **Authentication**: SSH Key → **New SSH Key**, paste the key.
5. Free **Monitoring** is worth ticking. Click **Create Droplet** and copy the IPv4 address.

### 2. Optional: a domain

Without a domain, the bootstrap serves the app at `https://<ip-with-dashes>.sslip.io` (for example `https://203-0-113-5.sslip.io`), which resolves to your server and gets a real certificate. With a domain, add an **A record** for, say, `intel.example.com` pointing at the IPv4 address (and an AAAA record for IPv6 if you like), wait until `dig +short intel.example.com` shows the address, and pass `DOMAIN=intel.example.com` below. Ports 80 and 443 must reach the server so Let's Encrypt can verify it.

### 3. Bootstrap the server (from your laptop, in this repo)

```bash
scp -r deploy root@SERVER_IP:/root/
ssh root@SERVER_IP 'bash /root/deploy/bootstrap.sh'
# with a domain:
ssh root@SERVER_IP 'DOMAIN=intel.example.com bash /root/deploy/bootstrap.sh'
```

`deploy/bootstrap.sh` does the following, and is safe to run again:

- Upgrades packages and adds 2 GB of swap on boxes with less than 3 GB of RAM.
- Creates the `deploy` user (your SSH key, sudo only for the deploy helpers) and the `tradesimple` user (runs the app, no login), and turns off SSH password login.
- Sets up the firewall (only 22, 80 and 443 open), fail2ban (SSH and app sign-in), and unattended security upgrades (rebooting at 04:30 UTC when needed). Logs go to journald, capped at 300 MB.
- Installs Node 22 LTS and Caddy.
- Clones this repo into `/srv/tradesimple/app`, runs `npm ci`, and builds.
- Installs the systemd unit and the Caddy site.
- Creates `/etc/tradesimple/env` (root, mode 600) with `PUBLIC_ORIGIN` filled in.
- Adds a daily database backup.

The app stays stopped until sign-in is set.

### 4. Set the password and copy your keys (never through git)

```bash
npm run -s auth:hash > /tmp/intel-auth.env        # asks for the password twice; add  -- --totp  for authenticator codes
scp /tmp/intel-auth.env deploy@SERVER_IP:/tmp/intel-auth.env && rm /tmp/intel-auth.env
ssh deploy@SERVER_IP sudo tradesimple-env /tmp/intel-auth.env

scp .env.local deploy@SERVER_IP:/tmp/intel.env
ssh deploy@SERVER_IP sudo tradesimple-env /tmp/intel.env
```

`tradesimple-env` merges the uploaded `KEY=value` lines into `/etc/tradesimple/env`, prints only the key names, deletes the upload, and starts or restarts the app. Empty values never blank a key already set. Local-only settings (`PORT`, `VITE_*`, `INTEL_ALLOWED_ORIGINS`) are skipped. With `--totp`, `auth:hash` also prints an `otpauth://` link; add it to your authenticator app (or type in the secret) before you sign in. To change one value later, put just that line in a file and send it the same way.

Set **`ASK_MONTHLY_BUDGET_USD`** on the server (see costs below). `PUBLIC_ORIGIN` is the address you open the app at. Phone alerts (ntfy) use it for their tap-through link, and the API accepts writes only from it. `PUBLIC_URL` stays the GitHub Pages demo and is never trusted for writes.

### 5. First sign-in

Open the `https://…` address that the bootstrap printed and enter the password (and the 6-digit code if you set TOTP). To sign out, use **Sign out** at the right of the top bar (shown only when sign-in is on) or open `/logout`. To sign out every browser, run `npm run -s auth:hash` again and send only the new `INTEL_SESSION_SECRET` line through `tradesimple-env`.

### Updating

```bash
git push                                   # the server pulls from GitHub, never from your working tree
deploy/deploy.sh deploy@SERVER_IP          # or: INTEL_SSH=deploy@SERVER_IP deploy/deploy.sh
```

The update runs on the server as `/usr/local/sbin/tradesimple-update`:

1. Fetches and runs `npm ci` only when the lockfile changed.
2. Builds into `dist.next` while the old build keeps serving, and keeps the last build's hashed files so open tabs can still load lazy chunks.
3. Swaps the builds and restarts the app (open pages wait out the second or two and retry on their own).
4. Checks `/healthz`. If the check fails, it rolls back to the previous commit and build.

If an update changed `deploy/` itself (unit, Caddyfile, helpers), copy the folder again and re-run the bootstrap.

### Running it

| Task | Command |
| --- | --- |
| Live logs | `ssh deploy@SERVER_IP sudo journalctl -u tradesimple -f` |
| Restart | `ssh deploy@SERVER_IP sudo systemctl restart tradesimple` |
| Sign-in failures and bans | `ssh root@SERVER_IP 'journalctl -u tradesimple -g "intel auth" -n 50; fail2ban-client status tradesimple-login'` |
| Backup now | `ssh deploy@SERVER_IP sudo tradesimple-backup` |
| Copy backups to your laptop | `scp 'root@SERVER_IP:/var/backups/tradesimple/*.gz' ./backups/` |

**Backups.** Every day at 03:30 UTC, `deploy/backup.sh` takes an online sqlite `.backup` of `/var/lib/tradesimple/cache.sqlite`, checks it, gzips it and keeps the newest 7 in `/var/backups/tradesimple`. Most of the database is feed cache that rebuilds itself. The parts worth keeping are scheduled tasks, the watchlist and alert state, the Ask spend ledger, and the insider history. To restore, run `systemctl stop tradesimple`, then `gunzip -c cache-….sqlite.gz > /var/lib/tradesimple/cache.sqlite`, remove any `cache.sqlite-wal` and `cache.sqlite-shm` files, run `chown tradesimple: /var/lib/tradesimple/cache.sqlite`, and start the app again.

**Insider history backfill.** The full SEC Form 4 history (`npm run insiders:backfill`) goes into the same database and runs for a long time, so start it as a background job that survives logging out. It reads the same environment as the app:

```bash
ssh root@SERVER_IP
systemd-run --unit=insiders-backfill --uid=tradesimple --gid=tradesimple -p WorkingDirectory=/srv/tradesimple/app \
  -p EnvironmentFile=/etc/tradesimple/env -E HOME=/srv/tradesimple -E INTEL_CACHE=/var/lib/tradesimple/cache.sqlite -E NODE_ENV=production \
  /usr/bin/npm run insiders:backfill
journalctl -u insiders-backfill -f          # it resumes where it stopped if interrupted
```

On a 1 GB droplet, run it once at a quiet hour and watch `df -h /` afterwards, because the history adds a large table and the backups grow with it.

### Costs

- **Server**: about €4–5 a month for a Hetzner CX22, or $6 for a DigitalOcean droplet. Provider backups are optional (+20%). Bandwidth is included (20 TB at Hetzner, 1 TB at DigitalOcean), far more than one user needs.
- **Domain**: optional, about $10–15 a year. Caddy, Let's Encrypt and sslip.io are free.
- **OpenRouter** is the only metered cost, and an always-on server keeps scheduled tasks running. Set `ASK_MONTHLY_BUDGET_USD` in `/etc/tradesimple/env` (default 20; 0 means no cap). Answers warn from 80% of the cap. At 100%, questions fall back to `ASK_CHEAP_MODEL`, or `ASK_BUDGET_HARD_STOP=1` refuses them. Scheduled prompt tasks count toward the cap, and `TASKS_MAX_RUNS_PER_DAY` limits how many run. Web search costs about $0.01–0.02 a search and counts toward the cap too (OpenRouter's reported cost per search). For a second stop, set a credit limit on the key itself at openrouter.ai → Keys.

### If there is no HTTPS

If Let's Encrypt cannot issue a certificate for the sslip.io name (rate limits), use a domain. As a last resort, you can serve plain HTTP: change the site address in `/etc/caddy/Caddyfile` to `http://SERVER_IP`, set `PUBLIC_ORIGIN=http://SERVER_IP`, and run `systemctl reload caddy` and `systemctl restart tradesimple`. The cookie then drops `Secure` and the server logs a warning at every start, because the password and session would cross the network unencrypted.

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
npm run typecheck # TypeScript check without emitting files
npm run build    # typecheck, then production build into dist/ (Ask, maps and boards load on demand)
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

GitHub Actions runs tests, typechecking, production and demo builds, and a high-severity dependency audit on Node 22 and 24. Tests do not load `.env.local`; API smoke tests use explicit dummy keys and an isolated temporary cache, with outbound requests disabled. FEC routes report an error when their bulk downloads are unavailable instead of relying on previously downloaded files.

---

## Disclaimer

For research and education. Nothing here is investment advice. Public disclosures are late by design, and delayed quotes are not suitable for trading decisions. Backtests replay past public records with the caveats on the board — they are not proof of an edge. Ask answers are grounded against tool results with a warning check, not a guarantee. Check anything important against the primary filing, which every row links to.

### Nav weather and hazards

Choose **Nav → Weather** for worldwide point forecasts and regional hazard reports. Use **Point forecast** to pick a map point, enter coordinates, or choose a supply location. The dossier shows temperature, sustained wind, precipitation, a 24-hour temperature change, and a seven-day UTC outlook. **Hazard layers** toggles earthquakes, cyclones, floods, droughts, wildfires, and volcanoes; the continent/region selector filters event centers. On phones, **Reports / Map** explicitly switches between the list and interactive map. Cloud imagery reuses the existing GOES/Himawari layer.

No new API keys are required:

- [MET Norway Locationforecast](https://api.met.no/doc/locationforecast/HowTO): worldwide model forecasts. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); TradeSimple summarizes model samples and non-overlapping precipitation intervals. Missing rain remains unknown, and partial UTC days are marked. Requests identify this repository, are rounded to two decimal places, cached for at least an hour or until upstream `Expires`, and conditionally revalidated with `If-Modified-Since`. No device geolocation is collected.
- [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): M2.5+ earthquakes over the past week, refreshed every five minutes. PAGER impact colors appear only when supplied; absent ratings remain **unrated**.
- [Global Disaster Awareness and Coordination System, GDACS](https://www.gdacs.org/Documents/2025/GDACS_API_quickstart_v2.pdf): latest 100 reports, plus a separate two-year drought/volcano search (up to 100 reports, cached hourly) so slower events are not crowded out by wildfire updates. Only reports marked current by GDACS are shown; overlapping results are deduplicated. Event centers are not affected-area polygons or a complete inventory of local warnings. GDACS and USGS levels are distinct provider assessments, not a comparable risk score.

API: `/api/weather/hazards` returns independent feed states, source coverage and timestamps; `/api/weather/forecast?lat=29.76&lon=-95.37` returns the point forecast. Concurrent identical fetches are coalesced. Upstream failures retain cached data explicitly labeled **stale**, or show unavailable without manufacturing an all-clear. These feeds have no delivery SLA. The static demo does not contain weather snapshots and shows an unavailable state.

Commodity notes describe conditional exposure channels and locations to investigate. They do not match events to facilities, estimate lost production, forecast prices, or provide push/emergency notifications. This release does not include global radar, marine-wave forecasts, every national warning system, or gridded drought/soil-moisture products.

## Phase 1: experiments and Data Hub

Open **Research** in the navigation or enter `RESEARCH` in Find. The research workspace uses the existing center stage.

### Save, inspect, replay, export

Run a backtest, then choose **Save experiment** and record a title and hypothesis. The calculation already has a frozen run ID: saving does not fetch or recalculate it. Research → Experiments shows saved runs, including partial runs and failed attempts created through the Research runner. **Verify offline replay** reruns the deterministic engine and statistical checks against the exact saved inputs without any network access. **Rerun as new experiment** reads the current built-in feeds (or the selected immutable imported dataset version), loads prices through the existing cache, and creates a new run linked to its parent. It does not force a vendor refresh or overwrite the original.

**Export frozen run** downloads a ZIP containing `run.json`, the original calculation modules, an offline `replay.mjs`, and SHA-256 checksums. Extract it and run `node replay.mjs` (Node 22.13+, no packages or network). The script checks archive contents and compares all engine results and statistical checks exactly. The recorded engine is used even after the app is upgraded. In-app replay refuses a different engine hash and directs you to the export. A match verifies reproducibility, not predictive validity.

Runs retain normalized engine signals, all matched signals before caps, adjusted prices and benchmark bars, rules, context/caveats, statistical seed/settings, outputs, original parsed records supplied by the source adapter, source labels and as-of metadata, and a snapshot/hash of the current ticker identity registry. They do not universally archive original PDFs or provider responses, nor replay upstream parsers or historical entity resolution. Existing CSV replication downloads now use frozen price inputs when a run ID is available.

### Import transaction signals

Data Hub accepts UTF-8 CSV (including quoted fields/newlines) or JSON as an array of objects or `{ "items": [...] }`. Limits: **2 MiB and 5,000 records per import**. Provide a dataset name and source label. Use **Map source columns** when your field names differ, then **Preview and validate** before importing. Imports with any invalid row are rejected atomically. The preview displays up to 100 validation errors and ten normalized rows.

Required fields:

- `id`: unique source record ID within the dataset (up to 200 characters).
- `symbol`: exact ticker-registry match, case-insensitive. No fuzzy entity joins.
- `eventAt`: transaction date, `YYYY-MM-DD` or a UTC ISO timestamp ending in `Z`.
- `availableAt`: public-availability date/time in the same format, on or after the event. It is never inferred from transaction or ingestion time.
- `side`: `buy` or `sell`.

Optional fields: `sourceUrl` (HTTP/S reference without embedded credentials), `value` (positive transaction amount). Missing source URLs are counted and shown. Availability is explicitly labeled **importer-asserted, not independently verified**. Ingestion time, timestamp precision, source record ID, original row, stable `ticker:SYMBOL` / `cik:ID` identifiers, and identity snapshot version are preserved. Mapping history is not a historical security master: current mapping validity is stated explicitly.

A changed import under the same name creates a new immutable version; identical content, mapping, source, and identity snapshot reuse the existing version. **Create experiment from this version** evaluates those transaction signals with the existing engine, a SPY benchmark, equal weighting, configurable hold/cost/slippage/side rules, and next-trading-day entry. The existing 1,500-signal and 350-symbol run caps still apply and appear in caveats. This is a basic transaction-signal importer, not arbitrary factor or multi-source strategy ingestion.

### API connectors

Configure `RESEARCH_API_CONNECTORS` in `.env.local` as shown in `.env.example`, then restart the API. Each named connector defines a fixed HTTPS GET endpoint and an optional `tokenEnv` naming a server-side Bearer credential. The browser receives connector names only. Both transaction signals and numeric observations offer configured connectors. Importing saves the exact validated preview without fetching a second version. Numeric observations additionally require ownership and usage labels; these do not certify rights or implement team permissions.

Without pagination, a connector accepts a JSON array or `{items: [...]}`. Optional `pagination: {cursorParam, itemsField, nextCursorField, maxPages}` supports top-level cursor pagination with 1–20 pages. Every page must supply its row array and cursor field; null or an empty cursor explicitly completes retrieval. Cursors are encoded only as query values on the configured endpoint. Missing/repeated cursors, malformed pages, redirects or page-limit exhaustion fail rather than importing partial results. Exact response pages, timestamps and checksums are retained with the combined records. Import validation checks that the pages, cursor chain and combined records agree.

Requests pin vetted public DNS addresses for all pages, use HTTPS port 443 and a 15-second total deadline, and reject private addresses and credential echoes. The complete evidence package is limited to 2 MiB and 5,000 rows. Completed pagination does not establish historical completeness or verify publication dates. Arbitrary query parameters, headers or next-page URLs, OAuth flows and scheduled imports remain unsupported. Cursor-paginated connectors support explicit durable retrieval and resume through the Data Hub; see the implementation ledger. Keep access tokens in `.env.local`; never put them in source rows or URLs.

### Read-only SQLite connectors

Configure `RESEARCH_SQLITE_CONNECTORS` in `.env.local` with unique named entries containing `file` (an absolute path on the API server) and `query` (a fixed SELECT or WITH query, up to 16,000 characters). Restart the API after configuration changes. The browser chooses only the connector ID; it cannot supply a file path or SQL. IDs must not overlap HTTP connector IDs. A trailing semicolon is accepted; internal semicolons are refused, including inside string literals. Alias columns to the normal transaction or observation schema, or use Data Hub's column mapping.

The query runs on a read-only connection inside a single read transaction in a separate process. Extension loading is disabled, trusted schema is disabled, and query-only mode is enabled. The process is killed after 15 seconds; SQLite heap is capped at 64 MiB, with a 64 MiB V8 heap limit. These are separate limits, not a combined process-memory cap. Results above 5,000 rows or 2 MiB are rejected rather than truncated. Binary columns must be cast or omitted. Integers outside JavaScript's safe integer range become exact decimal strings; numeric observation validation still applies.

The returned JSON includes rows plus database evidence: connector name, normalized query checksum, retrieval start/end, row count/checksum and single-read-transaction consistency. It omits SQL text and the database file path. The raw JSON and its evidence survive normal immutable imports and exports. Source timestamps and ownership labels are supplied by the query/researcher; reading an old database does not prove its rows were publicly available historically. Checksums establish consistency, not provider authenticity. Other database engines, remote database authentication and project/team access isolation remain open.

### Durability, ownership and backups

Research is stored in **`data/research.sqlite`**, independently of `data/cache.sqlite`. When `INTEL_CACHE` points elsewhere, research defaults to `research.sqlite` in that directory; `INTEL_RESEARCH` overrides it. Both files and their WAL sidecars are gitignored. Immutable SQL tables hold runs, engines, datasets, and saved experiments. The API exposes no overwrite/delete operation; there is no automatic research retention cleanup. Monitor disk usage: every newly calculated backtest is frozen, even before it is explicitly saved as an experiment.

For a consistent backup, stop the API and copy `research.sqlite` and any `research.sqlite-wal` / `research.sqlite-shm` files together, or use SQLite’s online backup mechanism. Restore to the configured research location before restarting. Do not treat this file as a disposable cache. A cache reset cannot delete saved experiments. Checksums detect corruption but are not a signature against a malicious database administrator.

This phase inherits the app’s single-owner authentication and same-origin write protections. Imported private data and saved experiments are visible to that server’s owner; organizational RBAC and isolated project tenants are later work. Isolated/context-aware/paired AI memory, historical relationship validity, held-out validation, and multi-source signal composition are not added by Phase 1.

API endpoints:

- `GET/POST /api/research/experiments`: list or save an existing `runId` with `title`, `hypothesis`, and optional `parentId`.
- `GET /api/research/experiments/:id`: inspect metadata, results, and a bounded lineage preview.
- `POST /api/research/run`: run and save a built-in `spec`, or an imported `datasetId` with `rules`; requires a title.
- `POST /api/research/runs/:id/replay`: recompute with frozen inputs using the matching engine.
- `GET /api/research/runs/:id/export`: download the frozen archive and original engine.
- `GET/POST /api/research/datasets`: list or atomically import a version.
- `GET /api/research/datasets/:id`: inspect coverage, caveats, and first ten events.
- `POST /api/research/preview`: validate `name`, `source`, `format`, `content`, and optional `mapping`; or preview a configured `connector`.

Research tests exercise CSV/JSON validation, temporal and entity constraints, immutable versions, cache deletion/restart durability, exact replay, portable export/checksum failures, credential handling and public-address connector restrictions, and API write guards.

### Phase 2 — Convergence Lab

Open **Research → Convergence** after saving two or three completed source experiments. Declare the ticker universe, development/holdout dates, embargo, trailing confirmation window, holding period, and costs. The first selected experiment supplies the common frozen adjusted-price snapshot; it must cover every declared ticker and SPY. Distinct source families (or distinct imported dataset names) are required. Current committee/hearing membership cohorts are refused.

Locking creates an immutable plan and development run. The separate holdout action evaluates the locked rules once; repeat requests return the same recorded run. Overlapping prior holdout evaluations are counted. Choose `confirmation: all` (default), `any`, or `at-least` with integer `minSources: 2` or `3`. The fixed count cannot exceed the selected source count. Agreement matches the same ticker and side within the trailing interval and retains every eligible witness. Each source-alone baseline requires one source. Leave-one-out comparisons retain the declared rule: all remaining sources, any remaining source, or the unchanged fixed threshold. If too few sources remain for a fixed threshold, the ablation has no decisions; two-source fixed-threshold plans therefore show separate removal variants rather than reusing the single baselines. Matching resets at the split; prices stop at each period boundary and incomplete positions are excluded. Signals enter after the final required public date. Each source contributes at most one vote per ticker/side/day. The rule is frozen with the inputs and carried into stress tests. Pre-upgrade plans remain readable/exportable, but an unopened holdout locked with an earlier engine requires a new plan; original archives include their original engines.

Total excess uses a common full-window SPY return with zero return on idle strategy capital. Mean trade excess, excluded trades, confirmation lineage, and seeded entry-week bootstrap intervals are available. Ablations are descriptive, not causal or multiple-testing-adjusted. Historical source coverage, current-universe survivorship, imported availability assertions, and any prior inspection remain limitations. Preserve the source experiments alongside exports; comparison archives contain the exact selected signals, common prices, source run IDs/checksums and caveats, and original calculation engine for offline replay.

### Phase 3 — Research notebooks

**Research → Notebooks** records hypotheses, conclusions, decision rationale, ticker/topic tags, and follow-ups. Findings can be draft, promising, inconclusive, rejected, or needs-data; classification requires both a conclusion and rationale. Search includes titles, hypotheses, conclusions, decisions, tags, source/evidence titles, and follow-up text.

Every save appends a checksummed, immutable revision to the research database. Concurrent stale revisions are refused instead of overwriting newer work. Evidence attachments resolve server-side to an existing experiment or Convergence plan and pin its exact run/checksum and evaluation phase. Subsequent holdout evaluation does not alter an existing notebook citation. Remove/save/reattach to cite a newer run. Decision history retains earlier attachments and follow-up states. Each evidence link exports its frozen run, including source lineage.

Unsaved edits are retained in browser session storage across Research-tab navigation; saved records survive feed-cache deletion and server restarts. Follow-up dates track work but do not schedule notifications. This remains a single-owner local registry, without team permissions or author attribution.

### Research home and portable conversation

The local terminal opens Research on a bare URL; explicit deep links retain their destination and static demo startup remains Today. Research and the portable Research chat share the same `useAsk` conversation, draft, sourcing, attachments and execution state. Home suggestions are labeled deterministic prompts based on browser-saved chat titles and recent registry records; they are not model-generated findings, do not fetch every feed, and never automatically execute. Selected saved chats are explicitly attached before transmission.

The data-layer catalog comes from registered server tools and lists accepted inputs. Coverage is verified only when a tool retrieves data; registration does not imply a working key, current data, or complete history. The read-only `research_memory` tool retrieves saved experiments, datasets, notebook revisions and Convergence summaries, retaining frozen run IDs and separating commentary from evidence. It is unavailable in web-only mode. Weather hazards are also exposed through the existing feed handler.

The home uses the same `tradesimple-mark.svg` as the terminal brand. Hover feedback and execution orbit animation respect reduced motion; execution status comes from actual streamed phase/tool events. No artificial percentage progress is shown. The Methods section links Lewis et al. (2020), Yao et al. (ICLR 2023), and Bailey & López de Prado (2014), distinguishing design references and descriptive formulas from implemented statistics. DSR is not implemented or claimed. The decorative background grid has been removed globally; analytical axes remain.

### Guided source experiments

Research → Guided experiment provides a browser-local draft for the hypothesis, declared tickers, public-date window and cost settings. Checking inputs calls the existing research run endpoint and preserves an immutable diagnostic experiment, including partial or failed results. It does not require an AI provider. Editing settings invalidates the displayed check without deleting saved experiments.

Readiness distinguishes unfinished loading, failed retrieval, zero returned signals, price gaps, zero executable trades and results available for review. Per-ticker rows describe executed trades and exclusions, not certified full historical coverage; source timestamps and timing assumptions remain visible. A zero-signal result is not evidence that no real events occurred. Open the saved experiment for replay/export, Data Hub for audited imports, Convergence for source comparisons, or Notebooks to record a decision. Feed-level progress percentages and full-history completeness are not inferred when the provider does not supply them.

### Historical USAspending evidence

Research → Contract evidence creates bounded, resumable retrieval jobs for USAspending prime contract transactions. Jobs partition the requested action-date range by month and registered ticker, discover current child-recipient candidates, fetch transaction pages through the shared USAspending rate gate, persist raw page checksums and normalized transaction versions, and compare source counts before and after paging. Jobs stop after 600 ticker-months or 100,000 source records; a page budget pauses work so a researcher can resume from the stored page checkpoint. Partial evidence requires explicit acknowledgement before freezing.

The frozen dataset retains its job scope, page and version hashes, recipient-map snapshot, signed obligation checks, exclusions, timing policy and caveats. Action date is not a verified publication timestamp. Researchers can choose first observed by this collector or an assumed agency delay; verified publication is unavailable until an independent publication-date source is wired. A backfill's first-observed timestamp does not establish historical public availability. Current parent/child recipient relationships do not establish historical ownership. Unmapped and ambiguous recipient identifiers remain outside ticker-level research. Search count reconciliation detects many retrieval failures, while same-count upstream revisions can remain undetected. A frozen evidence dataset can contain zero signals and still be saved for diagnosis.

Transaction search covers action dates from 2007-10-01. Larger-scale bulk downloads are not yet wired; they remain a future scale path after the bounded search adapter is reconciled against production responses. USAspending transaction-search documentation: https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_transaction.md .

### Dated price shocks in registered stress plans

Stress scenarios accept optional `priceShock: { date: "YYYY-MM-DD", changePct: -20, symbols: ["AAPL", "SPY"] }`, alongside delay, missingness and cost assumptions. A shock alone is sufficient to register a scenario. Choose 1–40 distinct exact symbols present in the frozen asset/benchmark series, a nonzero change from -95% through +500%, and a date with saved bars both before and on/after it. Invalid dates, unknown symbols, duplicate targets and out-of-coverage dates are refused.

For each selected symbol, multiply saved open and close prices on and after the date by `1 + changePct / 100`; retain missing opens as missing. A weekend/holiday starts with the next available saved bar. Earlier prices and later percentage returns are unchanged. The same symbol changes consistently in asset and benchmark maps; untargeted series stay unchanged. Source-ID selection applies only to publication delay/missingness, not prices or costs. A trade entirely after the change can have unchanged return; a position spanning it can change. This is a hypothetical persistent level shift, not a validated market regime or regulatory model, and it infers no cross-asset spillover.

The registered assumptions and original price inputs stay immutable. Scenario output includes `priceChanges` with symbol, asset/benchmark role, multiplier, affected-bar count and first affected date. The UI exposes these through each price-shock audit disclosure. Exports bundle original inputs and the exact transformation engine for offline replay. Pre-upgrade evaluated reports remain readable/exportable; unevaluated stress plans pinned to an earlier engine require a new registration.

### Manual paper accounts

**Research → Paper trading** links a manual simulated account to a completed, timing-audited single-source experiment. This is owner-local paper bookkeeping, with no broker, automatic strategy execution, quote retrieval or independently verified fill. Entered tickers/prices are operator assertions; no instrument eligibility, corporate actions, market hours, liquidity, dividends, interest or mark-to-market valuation are inferred. Cash is not total portfolio equity.

- `GET/POST /api/research/paper` lists the latest 100 account headers or creates one. Creation requires `title`, `experimentId`, integer `initialCashCents` (1–100,000,000,000), `maxOrderCents` (1 through starting cash), and `maxPositionShares` (1–1,000,000). Limits and the exact source run/hash are immutable.
- `GET /api/research/paper/:id` verifies the append-only hash-linked ledger and recomputes cash, share holdings, cumulative fees, fill count, halted state, sequence and head checksum. No cached balance is treated as authoritative.
- `POST /api/research/paper/:id/actions` requires a unique `requestId`, the reviewed `expectedSequence`, and `kind`. A `fill` needs `symbol`, `side` (`buy`/`sell`), integer `quantity`, integer `priceCents`, integer `feeCents`, `priceBasis`, and `approvalReason`. The operator explicitly approves the assumed fill; it is recorded immediately. Whole shares only; negative cash, short sales, oversized positions and orders exceeding the fixed limit including fees are refused without a ledger change. A stale sequence requires refreshing and reviewing balances. Retry the same request ID and action after an uncertain response to avoid double fills; changing instructions under that ID is refused.
- `halt` and `resume` actions need a nonempty `reason`. Halt blocks every subsequent fill, including sells, until explicitly resumed. It does not liquidate holdings or control other accounts. Each account is limited to 10,000 recorded events.
- `GET /api/research/paper/:id/export` downloads the complete account, events and recomputed state as JSON. Source experiment export is linked separately. The JSON is an inspectable ledger, not a standalone execution-engine bundle or cryptographic proof of an actor's identity.

Paper tables and their source references participate in research backup verification and restore. Reconciliation means internal integer-cent/share arithmetic and hash-chain verification; it does not reconcile broker or exchange records. Rejected attempts are returned as errors without ledger events. Team approvals, aggregate risk, automated paper strategies, market-backed simulated execution and broker reconciliation remain separate work.
