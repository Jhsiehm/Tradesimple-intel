# Historical evidence corpus and coverage specification

Status: design and repository audit, 2026-10-21. This document specifies proposed work; it does not certify a collected corpus.
Companions: [methodology](methodology.md), [architecture](architecture.md), and [delivered policy pilot](policy-pilot.md).
The target is reusable evidence infrastructure for financial investigations, with legislative history as the first adapter.
Historical depth, document completeness, extraction accuracy, and historical tradability are separate properties.

## Delivered foundations and their actual bounds

| Reuse path | Implemented behavior | Boundary relevant to this work |
| --- | --- | --- |
| `server/domain/source-documents.mjs` | Immutable text/byte preservation, SHA-256, retrieval observation | 10 MiB per source; binary is base64 in SQLite; no document/version inventory |
| `server/domain/policy/legislation.mjs` | Enumerates actions for named bills with pagination receipts and gaps | Bounded pages/bills; no full-text, amendment, report, or hearing collection |
| `server/domain/policy/evidenceHttp.mjs` | Bounded JSON retrieval, credential removal, timeouts, response hashes | Sanitized canonical JSON hash; not preservation of exact response bytes |
| `server/domain/evidence/contracts.mjs` | Resumable ticker/month procurement partitions, counts, raw pages, freeze/export | USAspending-specific; current entity mappings; not a generic document job |
| `server/domain/evidence/store.mjs` | Immutable blobs, observations, record versions and mapping evidence | Useful persistence pattern; job cursor state is mutable and needs a separate audit journal |
| `server/domain/research-connectors.mjs` | Configured HTTP/SQLite sources with bounded read-only acquisition | HTTP cursor import: 2 MiB, 5,000 rows, at most 20 pages; not a corpus crawler |
| `server/domain/connector-retrievals.mjs` | Durable page checkpoints and configuration-pinned resume | Source-specific cursor and completion semantics still need adapters |
| `server/parsers/ptr.mjs` | `unpdf` extraction and deterministic House transaction-report parsing | Merged text; no legislative page mapping, OCR, or semantic coding |
| `server/domain/research-archive.mjs` | Transitive run/dataset/source evidence export with checks | Originals are not universally archived; new corpus references need explicit traversal |
| `server/domain/research-backup.mjs` | Consistent SQLite snapshot, checksums, restore to a new path | An external object store would need additional verified backup closure |

Do not enlarge synchronous Ask requests or silently remove their limits to backfill decades of documents.
Do not interpret a successful connector import, source hash, or replay as proof of source completeness.

## Official historical coverage: discovery targets, not local holdings

These are provider-advertised collection boundaries checked on the audit date; record the source documentation snapshot in each acquisition design.

| Collection | Historical opportunity and limitation | Primary source |
| --- | --- | --- |
| GovInfo published bill versions | All published versions from the 103rd Congress, 1993–94; preserve each version, not only enacted text | [BILLS help](https://www.govinfo.gov/help/bills) |
| GovInfo bulk bill XML | 113th Congress, 2013–14, onward; earlier published bill files require other available formats | [GPO bulk-data documentation](https://github.com/usgpo/bulk-data/blob/main/README.md) |
| GovInfo bulk bill-status XML | 108th Congress, 2003–04, onward; metadata/status is distinct from full document text | [GPO bill-status repository](https://github.com/usgpo/bill-status) |
| Congress.gov older bill records | Some 1799–1873 records have sparse metadata; 1951–72 introduced dates remain incomplete in places | [Bill endpoint caveats](https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/BillEndpoint.md) |
| Amendment text | Senate submitted full text from 117th Congress; older Senate and House text may require Congressional Record links; newer House text granules are also incomplete | [Amendment endpoint](https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/AmendmentEndpoint.md) |
| GovInfo committee reports | Select reports from 104th Congress, 1995–96, plus earlier additions; include parts, volumes, and errata | [CRPT help](https://www.govinfo.gov/help/crpt) |
| GovInfo hearings | Select hearings from 104th Congress plus older additions; not all hearings are deposited; publication may lag the hearing by months or years | [CHRG help](https://www.govinfo.gov/help/chrg) |
| GovInfo committee prints | Select prints from 104th Congress plus older additions; inconsistent numbering/publication history | [CPRT help](https://www.govinfo.gov/help/cprt) |

An early surviving document does not establish continuous coverage from its year onward.
The depth target is every discoverable eligible version within a declared scope, with gaps retained, rather than one universal start date.
Committee meeting attachments, witness statements, markup amendments, transcripts, and later published hearings are different artifacts.
Use Congress.gov meeting metadata and chamber/committee sites to discover gaps; label each additional site's own coverage and collection rule.
Keep legislative documents and House/Senate personal financial disclosures in separate source families.

## Collection contract and scalable backward acquisition

1. Freeze a collection specification: adapter/version, source, chambers, Congresses, document families, inclusion rules, formats, budget, and time semantics.
2. Enumerate the universe before relevance ranking; keyword hits alone cannot define a census or a negative-control population.
3. Partition by collection/Congress/type and, where supported, issued-date intervals; use small independently resumable partitions.
4. Use bulk directory listings for supported XML families, official package inventories for other formats, then document relations for attachments and versions.
5. Store inventory responses and pagination/count evidence; record exact scope, filters, sort, cursor, observation time, and completion reason.
6. Commit page receipt, discovered IDs, and next checkpoint atomically; restart after process loss without skipping an uncommitted page.
7. Separate discovered-document, downloaded-rendition, extraction, OCR, semantic-coding, and review jobs; each has its own terminal status.
8. Apply provider-aware concurrency, request budgets, backoff, `Retry-After`, cancellation, and explicit oversized/unsupported states.
9. Reconcile unique IDs and advertised counts where available; preserve count changes and partition mismatches as review states.
10. Refresh with overlapping update-watermark windows and periodic inventory reconciliation; older Congresses can receive later digitizations or corrections.

Congress.gov currently documents 250 results per page and 5,000 requests/hour; configure lower operating budgets and retain rate-limit failures. [Congress API documentation](https://github.com/LibraryOfCongress/api.congress.gov)
GovInfo offers cursor-based discovery, issued-date discovery, package metadata/download links, and update feeds. Its `lastModified` is a repository addition/update time, not original publication. [GovInfo API documentation](https://github.com/usgpo/api)
Persist both issued-date and update-watermark searches; filtering repository updates to the historical study years would miss recently digitized old documents.
Provider inventories can change during pagination. Freeze observed results and reconcile drift; never declare a historical census from stable counts alone.
For internet discovery, preserve search queries, result lists, visited URLs, retrieval times, and inclusion/exclusion reasons; search ranking is not exhaustive coverage.

## Storage, lineage, retention, and retrieval

Use an additive corpus schema with SQLite metadata and a content-addressed object store for large immutable originals.
Store exact bytes under a cryptographic digest, stream downloads to a temporary file, validate size/type/hash, and publish objects atomically.
Keep credentials out of persisted URLs and request receipts; store a sanitized request identity separately from raw document bytes.
Documents are untrusted input: use vetted source adapters, redirect/network controls, and resource-limited parser/OCR workers; never execute embedded content.
Preserve source identity, package/granule IDs, Congress/chamber/type/number, version code, part/volume/erratum, URL, media type, and content digest.
Model document identity, source version, rendition, retrieval observation, extraction, annotation, and study membership as separate immutable records.
Deduplicate identical bytes globally while preserving every source URL and retrieval observation that supplied them.
Represent revised bytes at the same URL as a new version; do not replace the prior object or inherit its first-observed timestamp.
Link XML, HTML, text, and PDF as renditions only when identity evidence supports that relation; do not merge merely similar texts.
Retain both deterministic text diffs and uncertain semantic relationships; final law language must never overwrite an earlier bill version.
Pin each study to a corpus snapshot manifest and source/extraction/annotation hashes; refreshes create new snapshots.
Keep originals, receipts, annotations, and referenced snapshots independent of provider cache eviction; indexes and embeddings are rebuildable derivatives.
Retain all evidence referenced by a frozen study until an explicit retention action; show quotas, byte counts, and storage destinations before bulk runs.
Back up database plus referenced objects, verify hashes/reference closure, and restore into a fresh destination without the network.
Retain redistribution/access restrictions per source; reproducible calculations may be shareable when original licensed data is not.
A missing original or unresolved reference invalidates a complete export; include an explicit restricted-data manifest when redistribution is prohibited.

## Extraction and AI coding requirements

Prefer official structured XML/HTML with section identifiers; retain the schema and parser version alongside extracted structure.
PDF extraction must preserve physical page index, printed page label when present, text offsets, and source-object hash.
Keep tables, footnotes, exhibits, reading-order warnings, and image-only pages visible; empty extraction is a failure or OCR requirement, not an empty document.
OCR produces a new derivative with engine/language/version/settings and page-level quality diagnostics; never replace original bytes.
Cross-check structured and PDF renditions where available, with specific checks for amounts, units, dates, negation, provisos, and table alignment.
AI coding is optional interpretation above preserved extraction: use schema-validated outputs, exact supporting spans, and explicit unknown/ambiguous states.
Record codebook, model/provider/version when available, prompt, input chunks, parameters, response, reviewer decisions, and annotation lineage.
Do not promote model confidence to measured accuracy or force an exposure/ticker onto every document.
Validate coding against a held-out human-reviewed sample stratified by chamber, decade, document family, format, scan quality, and positive/negative cases.
Measure errors and disagreements per field/class, including false negatives from missing sections and OCR; predeclare quality gates appropriate to the study.
Blind semantic coding to downstream awards/returns where feasible; modern model knowledge can introduce retrospective leakage even with frozen documents.
Frozen annotations support deterministic study replay; regenerating hosted-model annotations is a separate replication attempt and may differ.
Semantic search retrieves candidates; citations must resolve to immutable source spans and extraction versions, not an embedding result alone.

## Coverage and point-in-time eligibility

Report a vector for every source/chamber/Congress/family partition; never display a single percentage labeled “research coverage.”

| Measure | Required denominator and meaning |
| --- | --- |
| Source-advertised | Provider's stated scope, exclusions, documentation date; unknown population denominator stays unknown |
| Enumerated | Unique discovered documents/versions against available inventory counts; expose unsearched and capped partitions |
| Fetched | Verified downloaded originals against enumerated eligible renditions; separate inaccessible, absent, failed, and oversized |
| Parsed | Documents/pages with usable extraction against fetched documents/pages; separate OCR pending and partial extraction |
| Validated | Reviewed samples and measured field-level performance; unsampled strata remain unvalidated |
| Study eligible | Inclusions against scoped candidate records, with every exclusion and unresolved identity/version |
| Point-in-time eligible | Records with adequate historical availability, version, and exposure evidence under the declared timing policy |

Keep event date, document date, source publication evidence, effective date, provider update, first observation, and ingest time distinct.
A hearing date cannot backdate a transcript published later; a PDF's creation metadata or present-day retrieval cannot establish historical public availability.
Report earliest/latest observed event dates and independently earliest/latest verified availability dates, with precision and missingness.
Retrospective descriptive analysis may use historically unavailable documents if labeled; a strict tradable strategy may not.
Use sensitivity intervals or explicit assumptions for uncertain timing, with results separate from historically verified claims.
Corpus depth does not cure missing point-in-time market prices, historical security identities, company exposure, or news archive coverage.

## Delivery priorities and acceptance gates

P0: add source adapter contracts, inventory/checkpoint journal, immutable object references, coverage views, and verified backup/export closure.
P1: prove one historical Congress end to end for both chambers: bills/status, every discoverable bill version, failures, exact originals, and structured extraction.
P2: extend backward over the advertised BILLS range, add reports/hearings/prints and amendment/Record relations, then audit older sparse collections.
P3: add bounded OCR and reviewed semantic coding, publication-evidence enrichment, historical exposure links, and validated study-ready datasets.
Apply the same adapter/manifest/version contract to regulatory, filings, procurement, macroeconomic, market, and internet evidence without pretending their scopes match.

- Crash/resume tests prove no lost committed pages; duplicate pages, cursor loops, upstream revisions, rate limits, and partial scopes remain explicit.
- A stratified real-document fixture set covers both chambers, older/newer versions, XML/HTML/PDF, scans, tables, parts, and errata without fabricated content.
- Coverage counts reconcile across inventory, objects, extraction, exclusions, and frozen study manifests; unavailable denominators remain unknown.
- Every reported quotation/amount resolves to its original object and page/section; rejected or ambiguous extraction cannot silently become a signal.
- Offline restore and study export reproduce pinned deterministic outputs; deleting a referenced object is detected before export/replay succeeds.
- A historical pre-news test rejects a current download as evidence of old public availability, and rejects later text versions at an earlier decision time.
- Release evidence distinguishes fixture verification, measured extraction quality, actually collected scope, and unresolved scientific/data limitations.

Passing these gates establishes a usable corpus layer for supported investigations. It does not establish that every financial hypothesis is identifiable or answerable.
