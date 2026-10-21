# terminal-rs reference audit

Audited October 21, 2026. Reference: [michaelshimeles/terminal-rs](https://github.com/michaelshimeles/terminal-rs/tree/2ae060d2d0b608aad910ed855039f6795a3322c2), pinned commit `2ae060d2d0b608aad910ed855039f6795a3322c2`. This is a static source and test inspection, with independent market-data and runtime/storage reviews. No reference build, test, ingestion, install script, brokerage action or live-provider request was executed. Findings describe this commit; proposals below are not delivered TradeSimple features.

## Decision

Use this repository as a reference for provider interfaces, background work, incremental discovery, parser fixtures and responsive chart history. It does **not** supply the missing legislative-document corpus, OCR/AI extraction, general hypothesis planner, scientific executor or reproducible study package. Its Congress module handles STOCK Act personal transaction disclosures, not legislative texts, amendments, committee reports or hearings. Adopting it wholesale would reproduce the source mismatch that TradeSimple's research routing now prevents.

Keep TradeSimple's Node/React/SQLite architecture and existing immutable research records. The reference's mutable caches and convenient market-data fallbacks need stronger provenance and failure semantics before they are suitable for research.

## What the source actually implements

| Area | Audited implementation | Meaning for TradeSimple |
| --- | --- | --- |
| House documents | Yearly disclosure ZIP/XML index, `P` filing filter, PDF URLs, text extraction and transaction-specific regular expressions. [House parser, lines 19–45, 97–167, 218–301][house] | Useful discovery/parser separation. This parser cannot interpret bill provisions or committee reports. |
| Senate documents | eFD search with a session/CSRF agreement, paginated PTR results, HTML transaction tables; paper reports are recorded without extracted trades. [Senate parser, lines 20–32, 98–146, 177–200][senate]; [refresh, lines 314–351, 415–508][refresh] | A disclosure connector, not the Senate legislative-document archive. |
| PDF/OCR/AI | `pdf-extract` yields a text string; fewer than 40 alphanumeric characters is classified as scanned. The result contains trade rows, not page/section evidence coordinates. Scans are not OCR'd. [House parser, lines 130–167, 218–301][house]; [refresh, lines 231–254][refresh] | Preserve the explicit scanned/error distinction. Add general page-aware extraction, OCR and evidence-linked semantic coding separately. |
| Market adapters | A `MarketData` interface covers history, quotes, streams and related lookups. Routing selects providers by asset class. [Interface, lines 208–255][data]; [routing, lines 47–64][markets] | Adopt the interface concept, extending every result with source, revision, timing, coverage and synthetic-data status. |
| Historical browsing | Older chart data loads asynchronously using an end timestamp; cached initial results can render before the network finishes. [Worker, lines 484–569][worker] | Useful chart behavior. It does not enumerate and archive a research population. |
| Saved data | SQLite stores normalized filings/trades and OHLCV cache rows. Layouts are also saved. [Disclosure schema, lines 12–72][db]; [cache, lines 26–49][cache]; [layouts, lines 279–286, 358–370][layouts] | Persistence exists, but a saved layout or latest-row cache is not an immutable study snapshot. |
| Execution | Background Tokio tasks handle UI requests; generation IDs reject stale chart responses. [Worker, lines 325–375, 755–812][worker] | Adapt stale-result protection and off-UI work; add durable job state, bounded concurrency and restart recovery. |
| Research methods | A politician trade-performance estimate uses transaction-date and latest prices, signed direction and disclosed amount midpoints. [Performance, lines 1–78][performance] | This is not a legislative event study, executable public-information strategy, causal estimate or general research engine. |

Workspace/module inspection and searches of application, crate and documentation sources found no general hypothesis planning, LLM research orchestration, legislative full-text acquisition, scientific notebook executor or frozen study replay. The repository's `docs/analysis` primarily documents chart-UX research. This absence finding is limited to the audited source tree. [Workspace, lines 1–17][workspace]; [worker operations, lines 29–126][worker]; [analysis directory][analysis].

## Historical depth: useful mechanics, incomplete guarantees

**Disclosure history is configured as recent incremental refresh.** The first default run selects the current and preceding House years and Senate reports since January 1 of the preceding year. Subsequent runs use a seven-day Senate overlap and usually only the current House year. Each chamber is sorted newest-first and capped at 2,000 new filings. Custom years are representable in `RefreshConfig`, but the default is not a decades-long backfill. [Refresh, lines 30–58, 207–222, 303–321][refresh].

**A refresh timestamp is not a coverage watermark.** The implementation records today's `last_refresh_date` after chamber errors have been collected. It also advances that date after a capped run. Combined with the narrowed next-run discovery window, this can leave older unprocessed filings outside subsequent default discovery. This is an inference from control flow, not a reproduced live-provider incident. TradeSimple needs independent, persistent partition cursors and terminal states for complete, partial, capped, failed and cancelled work. [Refresh, lines 124–137, 213–215, 310–311][refresh].

**Retry behavior is worth preserving accurately.** Fetch failures are not stored as completed filings; `known_filing_ids` excludes parser-error records, allowing retries while those records remain discoverable. Scanned and successfully parsed filings are considered known. A future parser/OCR upgrade therefore needs an explicit reprocessing job over preserved originals, not just another refresh. [Refresh, lines 224–255, 323–351][refresh]; [known IDs, lines 284–287][db].

**Market history limits are provider- and implementation-specific.** The Yahoo adapter clamps the earliest requested timestamp to seven days before the current time for one-minute bars, 59 days for 5–30-minute bars and 729 days for hourly bars. Alpaca queries starting in 2000 do not prove data exists from 2000. Treasury retrieval bounds each history request to 1–12 years. These are code behaviors, not independently verified provider entitlements or coverage dates. [Yahoo, lines 64–76, 156–178][yahoo]; [Alpaca, lines 75–116][alpaca]; [Treasury, lines 164–188][treasury].

**Chart exhaustion is a heuristic.** Initial history marks exhaustion when fewer than half the requested bars arrive; later paging marks it when no bars are prepended. The `MoreHistory` path updates the in-memory series but does not write older bars to the disk cache. Neither a fully scrollable chart nor an exhausted marker proves a complete saved dataset. [Worker, lines 506–569][worker].

For TradeSimple, historical depth must be reported per source, document type, chamber, period and granularity. Fetching the earliest available record does not certify continuous coverage. Backfill should discover explicit partitions, preserve every page receipt, reconcile unique document/version counts, retain omissions and expose stop reasons. A failed page must remain retryable after newer pages arrive.

## Behaviors that must not enter a research result unchanged

1. **Synthetic fallback can appear under the primary provider name.** `Fallback` keeps the primary name and returns generated initial history or quotes after certain failures. Older-history paging does surface failures instead of generating more bars. The bar/quote types do not carry a synthetic/source tag, and successful initial history is written to the normal cache. This is suitable only for an explicitly isolated demonstration path. Research jobs must fail with a data gap; they must never silently substitute generated observations. [Fallback, lines 294–332][fallback]; [bar type, lines 5–14][bar]; [quote type, lines 34–44][data]; [worker, lines 506–512][worker].

2. **The market cache overwrites earlier observations and has no provider key.** Its key is `(symbol, timeframe, timestamp)` and conflicting OHLCV values replace earlier values. It does not retain provider/feed, raw response, retrieval revision, adjustment convention or source hashes. TradeSimple should keep fast chart caches separate from immutable research series. [Cache, lines 26–49][cache].

3. **Real-provider fallback also needs lineage.** Equity history can fall from Alpaca to Yahoo, and crypto history can fall from Binance to Coinbase. Alpaca requests split-adjusted prices; raw OHLCV alone cannot establish compatible conventions across providers. Record the actual provider for each response, and validate venue, calendar, adjustment and resampling policy before joining pages. [Routing, lines 47–64][markets]; [Alpaca, lines 75–116][alpaca]; [crypto, lines 304–318][crypto].

4. **Source documents and extraction versions are not archived.** The filing schema stores URL, date, status and fetch time, but not original PDF/HTML bytes, content hash, parser version or page evidence. Re-inserting a filing updates status/date/fetch time and deletes/replaces trades transactionally. A Senate amendment flag is not a complete original-to-amended-version lineage. TradeSimple's append-only document and dataset stores already provide a stronger foundation. [Schema, lines 23–52; replacement, lines 290–338][db].

5. **Some operational failures degrade into partial or volatile data.** A persistent disclosure DB open failure falls back to memory, and Treasury can suppress a final-year fetch error when earlier years yielded rows. An archival study must report failed persistence or an incomplete partition instead of claiming it is saved or complete. [Worker, lines 328–333][worker]; [Treasury, lines 150–161][treasury].

6. **Estimated politician performance is not a reproducible trading strategy.** Entry is scored from transaction date, which can precede disclosure; the calculation uses latest prices and amount-band midpoints. It does not model public availability, benchmark-relative performance, costs, portfolio capital constraints, out-of-sample validation or causal identification. Do not reuse that estimate to answer whether legislation-based trading outperforms. [Performance, lines 1–78][performance].

These are adaptation constraints based on source inspection. They are not claims about a live user's dataset or a security review of the entire reference application.

## Concrete adaptations in the existing TradeSimple architecture

| Work item | Existing foundation | Proposed change and acceptance condition |
| --- | --- | --- |
| Provider contracts | `server/domain/policy/evidenceHttp.mjs`, `server/domain/research-connectors.mjs` | Return data with exact provider/endpoint, request scope, response hash, acquisition time, version and coverage state. Test provider failure without synthetic substitution and preserve real-provider substitution explicitly. |
| Historical acquisition | `server/domain/connector-retrievals.mjs`, `server/domain/evidence/contracts.mjs` | Reuse persisted receipt/checkpoint patterns for Congress.gov/GovInfo collection partitions. Separate historical backfill cursors from incremental updates. Kill/restart and capped-page fixtures must resume without skipping or duplicating source versions. |
| Legislative corpus | `server/domain/policy/legislation.mjs`, `server/domain/source-documents.mjs` | Extend beyond bill actions to document/version discovery and original XML/HTML/PDF acquisition. Include bill text, amendments, reports and meeting/hearing attachments with explicit source-specific availability. A manually reconciled bounded corpus must account for every discovered document and failed download. |
| Text extraction | `server/parsers/ptr.mjs` and source-document hashes | Add document-type-specific pure parsers, page/section coordinates, parser versions and OCR status. Preserve original bytes before normalization. Validate against a reviewed set spanning multi-page text, tables, scans, amendments and malformed documents; do not treat low text count alone as comprehensive scan detection. |
| AI annotation | Existing AI tool boundary and research journal | Add schema-validated annotations linked to exact source passages, with model/prompt/schema versions, uncertainty and review status. Freeze outputs and blind annotation to outcome prices where possible. Model reruns need not reproduce identical annotations; frozen-output replay must. |
| Data durability | `server/domain/research-store.mjs`, `server/domain/source-documents.mjs`, backup/export services | Retain append-only study inputs. Add price/provider vintages and extraction revisions rather than overwrite-on-conflict research rows. Verify backup, restore and offline replay against originals. Large corpus storage needs explicit size/retention budgeting; the existing 10 MiB document limit is not an unlimited archive. |
| Research execution | `server/domain/policy/worker.mjs`, `server/domain/policy/replay.mjs`, protocol/intent contracts | Adopt request-generation protection for revised/cancelled plans. Add durable bounded jobs where needed. A child process or Node worker thread alone is not a security boundary. An eventual custom scientific runner requires OS-enforced isolation with documented and tested filesystem, network, credential and resource restrictions, a pinned runtime and declared input/output artifacts. |
| Open-ended study design | `shared/researchIntent.mjs`, `shared/researchCompatibility.mjs`, capability assessment | Compose evidence discovery, transformations and validated methods around the question. Treat the policy pilot as one adapter. No source keyword should choose a predetermined answer or strategy. A custom method remains exploratory until validated; citations and model confidence cannot certify it. |

Proposed source, parser, storage, orchestration and UI responsibilities should remain in separate readable modules. Follow the existing 100–250-line target and 300-line soft ceiling; do not transplant the reference's large worker or database files. No Rust migration is needed to adopt these patterns.

The reference does not resolve the key pre-news timing problem: transaction/action dates, filing dates, collector observation and original public availability are different fields. Historical documents obtained today may support a retrospective document study while remaining ineligible for a claim that a signal was tradable at a particular past instant.

## Tests to learn from, and tests still needed

The disclosure suite uses real captured documents and an injected `Source` interface. It checks multi-page rows, partial sales, wrapped amounts, non-ticker assets, scanned filings, both chambers, roster joins, fetch errors, repeated refreshes and alerts. These are useful parser and adapter acceptance patterns. [Parser tests, lines 24–168][parser-tests]; [refresh test, lines 19–92][refresh-tests].

Market tests check ordering, basic paging, cache replacement and fallback behavior. Some live tests are ignored by default, and one cross-asset test permits an older-history request to fail. A synthetic fallback test intentionally asserts generated results retain the primary provider name. These tests validate chart/adapter behavior, not historical completeness or scientific validity. [Live tests, lines 6–57][live-tests]; [fallback test, lines 465–474][data]; [cache test, lines 72–82][cache].

TradeSimple's adaptation gates should additionally cover: original bytes and parser-version replay; document/version coverage denominators; failed/capped backfill recovery; amendments and same-URL revisions; publication-time uncertainty; historical identity/exposure mappings; mixed-provider/adjustment rejection; no synthetic data in real studies; persistence failure; frozen method/runtime artifacts; and independent numerical validation of each enabled estimator. Test success and corpus completeness must be reported separately.

## Reuse and handoff

No tracked project `LICENSE`, `COPYING` or `NOTICE` file, or license declaration in the inspected Cargo manifests and site package manifest, was found at the pinned commit. Record this as **reuse license not established**, not a definitive legal conclusion. Architectural concepts can guide independent implementation; do not vendor source or fixtures until reuse permission is established.

Recommended order: first build durable historical document discovery and originals, then page-aware extraction and audited annotations, then bind frozen datasets to the general investigation protocol. Expand methods through separately validated adapters and an isolated scientific runtime when needed. Retain TradeSimple's current calculation replay and provenance mechanisms throughout. The reference supplies engineering examples for this sequence, not evidence that the completed research platform already exists.

[house]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/src/house.rs#L19-L301
[senate]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/src/senate.rs#L20-L200
[refresh]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/src/refresh.rs#L30-L508
[db]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/src/db.rs#L12-L338
[data]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/lib.rs
[fallback]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/lib.rs#L294-L332
[markets]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/markets.rs#L47-L64
[worker]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/app/src/worker.rs
[cache]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/cache.rs#L26-L82
[layouts]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/app/src/layouts.rs
[performance]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/src/performance.rs#L1-L78
[workspace]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/Cargo.toml#L1-L17
[analysis]: https://github.com/michaelshimeles/terminal-rs/tree/2ae060d2d0b608aad910ed855039f6795a3322c2/docs/analysis
[yahoo]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/yahoo.rs#L64-L178
[alpaca]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/alpaca.rs#L75-L116
[treasury]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/treasury.rs#L122-L188
[crypto]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/src/crypto.rs#L304-L318
[bar]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/core/src/bar.rs#L5-L14
[parser-tests]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/tests/parsers.rs#L24-L168
[refresh-tests]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/congress/tests/refresh.rs#L19-L92
[live-tests]: https://github.com/michaelshimeles/terminal-rs/blob/2ae060d2d0b608aad910ed855039f6795a3322c2/crates/data/tests/live.rs#L6-L57
