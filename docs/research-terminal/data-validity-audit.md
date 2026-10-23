# Data validity audit and evidence requirements

Implemented October 22, 2026. This is an assessment of evidence available in the existing build, not a certification of datasets or tradable edge. No provider was purchased, no credentials added, and no historical backfill was performed.

## Implemented controls

`shared/researchDataValidity.mjs` distinguishes source-derived dates, assumed contract-publication delays, and importer assertions/unknown timing. A source date is observed in a normalized record; it is not an independently verified first-publication timestamp. No caller-supplied assertion can promote it to verified evidence.

All four built-in backtest source adapters attach a source assessment to their context. Signal builders carry explicit availability bases. The price loader reports requested and absent symbols, stale/missing/pending history, observed series bounds, and invalid row counts. Bounds and loaded series do not establish complete trading-session coverage.

The run orchestration integration assesses the combined source and price evidence and exposes it as `dataValidity` on the result and provenance, freezes it in input context, and adds a caveat. Consumers can inspect stable blocker codes rather than infer readiness from successful calculation or absence of errors. Historical trading eligibility remains `not-established`, with `eligible: false`; ordinary exploratory calculation remains available. The strict eligibility helper deliberately rejects all current reports because there is no independently validated evidence path yet. Changing a report's `eligible` flag is insufficient.

Original source notes, amendment timing, excluded records, source caps, and calculation results remain intact. The assessment does not filter surviving samples into apparently unbiased samples. In particular, the count of loaded records is not a coverage percentage without a defensible population denominator.

## Source-specific findings and required evidence

| Source | Present evidence and limits | Required before a strict historical claim |
| --- | --- | --- |
| Form 4 | Filing dates, parsed transactions, listing/read counts; current issuer universe; bulk-store start limits and excluded amendment lines, or newest-per-issuer caps and short recent-filing lists on the submissions fallback | Historical issuer/security master, full filing accession inventory over the selected universe/window, archived originals and amendments, accepted/publication timestamp reconciliation, delisted returns |
| Congressional trades | Filing/public dates and amendment handling; unparsed and paper reports remain visible; current ticker joins | Complete chamber/report inventory with parse outcomes, scanned-report recovery, original/amended version lineage, publication availability checks, historical securities and membership mappings |
| Contracts | Largest 100 actions per request in the trailing year; positive obligations; seven/90-day or configured assumed delay | Paginated historical transaction inventory, original release/revision history, stable recipient identifiers and effective-dated corporate-parent mapping; distinguish obligations from new awards |
| Lobbying | Original LD-2 quarter aggregates and posting dates in fetched records; current client joins and retrieval gaps | Complete original/amended filing history, version/availability reconciliation, effective-dated client relationships, quarter-completeness audit |
| Market prices | Yahoo daily adjusted bars, cache timestamps, and load failures | Independent adjustment checks, exchange-session completeness, symbol-change/corporate-action history, delisted/acquired security coverage and terminal returns |
| Committee/hearing filters | Current committee membership; optional future-event selection | Membership valid at event time and known at decision time, hearing announcement publication history; exclusion of future-dependent selection |
| Imported datasets | Frozen researcher-provided rows, identity and availability assertions | Independent source reconciliation and signed-off coverage/identity/timestamp audit; importing alone cannot supply verification |

## Methodical next validation sequence

1. Specify one bounded study population and historical date range before collection. Include an independently enumerated denominator, exclusion policy, and proposed decision timestamp.
2. Reconcile a complete source inventory against parsed records. Classify every missing, unparsed, amended, duplicated, and excluded record; examine whether missingness varies by issuer, size, time or chamber.
3. Preserve original document/version evidence, source accessions, retrieval timestamps and first-publication evidence. A retrieval date proves collection at that time, not earlier market availability.
4. Reconcile permanent security identifiers, historical listings, ticker changes, corporate parents and delistings. Test mappings both as effective then and knowable then. Current registry joins cannot substitute for this.
5. Reconcile bars against exchange sessions and a second reference; audit adjustments and terminal security returns. Check actual entry/exit coverage and exclusions separately from source coverage.
6. Independently reproduce the study and lock a prospective evaluation. Execution, multiple-testing and experiment-registry controls are separate requirements; this data assessment cannot establish those by itself.

## Reproducibility boundary

Previously frozen runs and engine bundles are not rewritten. The new report is saved metadata and caveat input for new runs; offline replay still uses the original bundled calculation engine. Successful replay validates reproducibility of the saved inputs, not the truth or completeness of historical source evidence. Future verification support needs an explicit, tested evidence-validation mechanism and version change; accepting arbitrary `verified: true` fields would defeat the control.

## Targeted validation

`INTEL_TEST=1 node --test test/researchDataValidity.test.mjs test/backtestServer.test.mjs test/researchIntegrity.test.mjs` passes the source, integrity and new validity tests. New cases cover importer/forged assertions, assumed contract timing, known missing reports, future hearings, malformed/absent price series, and integration into a built-in Form 4 source while preserving existing warnings. Existing source, caching and timing checks remain passing. Additional regression cases cover run selection caps, auxiliary contract sampling, excluded bulk-store amendments, store start gaps and failed/empty annual House index retrieval. Annual index failures are now retained in progress and source errors instead of silently becoming empty filing years. Full run-level integration is validated by the orchestration test suite.
