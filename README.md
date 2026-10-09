# TradeSimple Intel




<img width="324" height="316" alt="image" src="https://github.com/user-attachments/assets/ef494081-e109-4578-b410-b0a5e94b6c5d" />


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

Open it with the command `BT`, **Backtest** on a member or ticker dossier, or a `#bt=…` share link (the link holds the whole spec). Pick signals (congressional trades by committee, member, party, chamber, ticker, sector, size, or nearness to a hearing; Form 4 insider buys and sells without 10b5-1 plans; contract awards by agency to joined contractors; lobbying spikes), then rules (entry, hold days, stop and take-profit, equal or range-midpoint sizing, benchmark, costs and slippage). It draws the equity curve against the benchmark held on the same days, then stats, a trade table, per-member and per-ticker breakdowns, and **Data caveats** that you should read before any number.

- **No look-ahead.** A signal is dated by when the record became public (the filing date; the amendment date for amended Senate rows; the action date plus 90 days for DoD awards, 7 days for civilian awards), never the trade date. Entry is the first trading day *after* that date, at the open or the close. Tests in `test/backtest.test.mjs` fail if a price before the entry day ever changes a result.
- **Portfolio, in calendar time.** Each trading day is the average return of the positions open that day; idle days earn zero; the benchmark holds the same positions on the same days; holidays carry the last level forward; drawdown is peak to trough on that curve. Sells are scored as shorts with no borrow cost. Congress amounts are ranges, so equal weight is the default and range midpoint (capped at $1,000,000) is an estimate.
- **What it will not tell you.** Committee seats are the current roster applied to past trades; paper filings are not parsed (counted in the caveats); symbols with no Yahoo history (delisted, renamed) are excluded and counted, which flatters results; `^GSPC` is price only while stocks are dividend-adjusted; trades overlap, so the t-statistic overstates confidence; a single prolific member can be most of a sample (the caveats name them). The Sharpe-ish figure is labeled as rough.
- **API.** `GET /api/backtest` returns the form options; `POST /api/backtest` with `{source, filters, rules}` (or `GET ?spec=<json or #bt token>`) runs one. Results carry source, as-of and latency per feed, are cached 30 minutes by spec hash, and at most two run at once (429 beyond that). A first run can take 15 to 40 seconds while prices load; the board retries while the server says it is still building.

### Ask: questions answered from the app's own data

`ASK <your question>` in the command line (`⌘K`), or type a question in the top search box and choose the **Ask** row. The answer streams into the dossier panel with a chip after each claim ([t3] style) that opens the board it came from, a collapsible **How I got this** list of every tool call with its source, as-of time, and latency, a **Data caveats** list, and buttons to open a backtest, copy a link, or share. Recent questions are kept in this browser only (last 20).

The model can only call read-only tools that wrap the app's own routes (search, member profile and trades, member timeline, ticker dossier, case file for a member, ticker or district, committees and hearings, bill and roll-call votes, contracts, lobbying, PAC receipts, positions, insiders, alerts, intel scope, `run_backtest`). It never places orders and has no network tool of its own. The server enforces: at most 8 tool calls, 6 model rounds, 90 seconds, and a 60,000-token budget per question; 12 questions per 10 minutes per client address; 3 answers in flight. Tool calls (name, arguments, timing; never keys) are logged to `/tmp/intel-ask.log`.

**Grounding.** The prompt requires answering only from tool results with a ref after each fact. The server then checks the final text: refs that match no tool result are reported, and every number in the answer that appears in no tool result is listed under the answer as *not found in any tool result*. This is a warning, not a proof: a number can match by coincidence, and a claim can be wrong without a number in it.

**Provider.** Ask is off until `.env.local` names a provider and its key (the key never reaches the browser; GET `/api/ask` reports only whether it is configured):

| `ASK_PROVIDER` | Key needed | Other settings |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `ASK_MODEL` (default `claude-sonnet-4-5`) |
| `openai` | `OPENAI_API_KEY` | `ASK_MODEL` (default `gpt-4o-mini`) |
| `compat` (OpenAI-compatible: Vercel AI Gateway, LiteLLM, vLLM, LM Studio…) | `ASK_API_KEY` | `ASK_BASE_URL` (for example `https://ai-gateway.vercel.sh/v1`) and `ASK_MODEL` (for example `anthropic/claude-sonnet-4.5`) |
| `openrouter` | `OPENROUTER_API_KEY` | `ASK_MODEL` (default `openai/gpt-4o-mini`) |

Without it the panel says *Ask is not configured — add a key to .env.local*, and the Backtest board and every other board still work. Adapters live in `server/ai/providers.mjs` and are tested with mocked fetch in `test/ask.test.mjs` (no network).

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
| `0` | Today: this week in Congress trading |
| `1`–`6` | Switch sections |
| `⌘K` / `Ctrl+K` / `:` | Command line |
| `Alt+←` | Back |
| `/` | Search tickers, members, districts (a question there offers **Ask**) |
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

Open the `https://…` address that the bootstrap printed and enter the password (and the 6-digit code if you set TOTP). To sign out, open `/logout`. To sign out every browser, run `npm run -s auth:hash` again and send only the new `INTEL_SESSION_SECRET` line through `tradesimple-env`.

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
- **OpenRouter** is the only metered cost, and an always-on server keeps scheduled tasks running. Set `ASK_MONTHLY_BUDGET_USD` in `/etc/tradesimple/env` (default 20; 0 means no cap). Answers warn from 80% of the cap. At 100%, questions fall back to `ASK_CHEAP_MODEL`, or `ASK_BUDGET_HARD_STOP=1` refuses them. Scheduled prompt tasks count toward the cap, and `TASKS_MAX_RUNS_PER_DAY` limits how many run. Web search costs about $0.01 a search. For a second stop, set a credit limit on the key itself at openrouter.ai → Keys.

### If there is no HTTPS

If Let's Encrypt cannot issue a certificate for the sslip.io name (rate limits), use a domain. As a last resort, you can serve plain HTTP: change the site address in `/etc/caddy/Caddyfile` to `http://SERVER_IP`, set `PUBLIC_ORIGIN=http://SERVER_IP`, and run `systemctl reload caddy` and `systemctl restart tradesimple`. The cookie then drops `Secure` and the server logs a warning at every start, because the password and session would cross the network unencrypted.

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
  feed.mjs                        landing feed (this week in Congress trading)
  returns.mjs                     buy returns vs SPY, member stats, leaderboards
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
npm run publish:demo   # build the static demo with member share pages and push it to gh-pages
npm run bot      # dry-run the Bluesky/X posting bot (add --post to post)
npm run demo     # zero-key demo from the snapshot; build:demo writes dist-demo/
npm test         # parser checks against real filings in test/fixtures, join rules, data integrity, API routes (no network)
node scripts/sp500.mjs   # rebuild the S&P 500 rows in data/tickers.json from Wikipedia
node scripts/joins.mjs --count 76 --refresh   # derive district/LDA/PAC joins for the largest quote-only names
node scripts/contract-parents.mjs [--only LMT,BA]   # join tickers to USAspending parent recipients (no key)
```

---

## Disclaimer

For research and education. Nothing here is investment advice. Public disclosures are late by design, and delayed quotes are not suitable for trading decisions. Check anything important against the primary filing, which every row links to.
