# Chart workspace

Implemented October 20, 2026. The workspace preserves the matte green-black surfaces, cream text, bright navigation colors, and shared system typography.

## Architecture and licensing

The former custom canvas chart is replaced with Lightweight Charts 5.2.1 (Apache-2.0). Its attribution logo remains enabled and the workspace includes the TradingView copyright notice and link. Dependency license and notice ship with the package. The terminal-rs viewport, drawings, history loading, and workspace organization were inspected as design references; no Rust renderer or source code was copied.

- `ChartPanel.tsx`: financial canvas, indicators, drawings, axis controls, keyboard navigation, and view preservation.
- `chartData.ts`: window caching, in-flight deduplication, generation guards, polling, and left-edge backfill.
- `CandleChart.tsx`: layout, link groups, evidence context, persistence, and reviewed handoff.
- `server/chartWindow.mjs`: interval/window requests on the existing chart route. Legacy span requests remain supported.
- `shared/chartWorkspace.mjs`: bar validation, calendar aggregation, indicators, layout sanitization, and reviewed context validation.

## Data correctness

Prices are fetched from Yahoo Finance and explicitly labeled delayed/historical/cached. Refresh failures retain clearly stale data, and unsupported symbols show an error without simulated substitution. Demo mode is explicitly labeled simulated.

Native timestamps and precision are retained. Invalid candles are omitted; duplicates merge deterministically and holidays remain gaps. A trailing zero-volume point quote inside the current native bar updates that candle rather than inventing a new one. Weekly/monthly OHLCV is aggregated from observed daily bars using the exchange-local calendar; their axis coordinates identify period starts in UTC. Adjusted daily OHLC uses the provider adjusted-close ratio; volume stays provider-reported. The settings panel explains these choices.

Intervals and historical ranges are separate. Changing range selects a suitable interval. Unsupported combinations are disabled. Four-hour bars are unavailable because the feed lacks native session-aware 4h bars. Conservative intraday limits are 7 days for 1m, 60 days for 5–30m, and 730 days for hourly. These are provider bars, not tick or execution-grade data.

## Interaction and research

Candles/line, volume, SMA20/50, EMA20, RSI14, MACD12/26/9 and exchange-day VWAP are available. Native chart interactions handle pan, zoom and independent price scaling. Arrow keys pan, +/- zoom, Home resets, End returns to latest. Historical views retain their position on polling and prepend. Horizontal lines and trendlines persist by symbol in timestamp/price coordinates.

Layouts support single, evidence, two, and four charts. Narrow screens render one chart with scrollable evidence. Save captures arrangement, panel settings, and time-link preference; restore validates settings. Drawings and current panel settings also persist independently. Link groups synchronize symbols and optionally visible time ranges for matching intervals, while preserving separate price scales. Evidence can follow the active chart or remain pinned. News, trading activity, company details and supply exposure reuse existing application flows.

Markers cluster per bar; dense histories show colored points without overlapping text. Evidence filters and selection retain original dates, source links where available, actor and amount. Disclosure-date and transaction-date views are explicit. Filing-only dates are not represented as precise public availability timestamps. Lobbying groups link to their first source filing when available and disclose that the total may include additional filings.

The reviewed handoff carries dates, interval and up to 20 selected evidence records as validated structured context, avoiding the assistant's short question limit. It opens an unsent draft and does not run a test or replace saved conversations. Unknown publication/ingestion/version fields remain null. The review calls for a conservative next regular session assumption when only a filing date exists and excludes unknown publication dates from availability-based testing.

## Verification

- Production build and TypeScript checks pass.
- All 978 repository tests pass with `INTEL_TEST=1 node --test --test-concurrency=1 'test/*.test.mjs'`.
- Twelve focused chart tests cover intervals, invalid/missing OHLCV, adjusted prices, indicator warmup, exchange dates/DST, weekly/monthly aggregation, trailing quotes, obsolete requests, persistence, structured handoff, and a 20,000-bar dataset.
- Browser checks: live AAPL/NVDA/MSFT/LMT switching, linked and independent symbols, interval/range changes, history backfill, keyboard zoom/pan, refresh while historical, RSI/MACD rendering, saved study restoration, evidence selection, reviewed unsent assistant draft, unknown-symbol error, horizontal drawing, keyboard pane resizing, four charts at 1920×1200, and one chart at 390×844 with no document overflow.
- Screenshots: `artifacts/chart-workspace/`.
- Concurrent test runs exposed existing timing-sensitive API-startup/upstream-budget checks; sequential execution passed without relaxing timing assertions.

## Remaining limits

Legislation milestones are not supplied by the current company-event feed. Event coverage and precise availability timestamps vary by source; missing source links are not invented. Grouped lobbying/PAC markers are summaries. Crosshairs are independent; optional linking synchronizes time ranges only. Four panels require adequate screen height or vertical scrolling. Actual browser zoom and physical touch gestures were not separately exercised; narrow viewport behavior was verified. Provider outage behavior is covered by offline route tests; live browser testing exercised an unavailable symbol rather than deliberately disrupting the user's provider connection.
