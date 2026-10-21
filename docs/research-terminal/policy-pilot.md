# Legislative actions before news: delivered pilot

The Policy research workspace at `#research/policy` implements a saved investigation from protocol to source collection, evidence checks, conditional calculation, frozen report, export and offline replay. It does not establish that a legislative strategy earns excess returns. Broad lobbying, regulation and combined-signal research remains outside this pilot.

## What can run

1. Save a question, named bills, action types, company universe, date window, processing delay, holding minutes, round-trip costs, SPY and optional sector benchmark.
2. Collect bounded Congress.gov action pages and GDELT article candidates. Preserve raw sanitized responses, query/offset receipts, source hashes, first observations, missing fields and coverage gaps.
3. Append dated exposure assertions, reviewed news/event associations, explicit scoped news coverage and continuous one-minute asset/benchmark prices.
4. Evaluate the frozen inputs. Eligible observations produce matched policy-entry and news-entry return comparisons. Ineligible observations remain in an exclusion ledger. Missing evidence produces an inspectable insufficient-evidence report.
5. Export evidence JSON or a ZIP containing the exact protocol, inputs, source receipts, result, original engine files, checksums and `replay.mjs`. Extract the ZIP and run `node replay.mjs` without network or packages.

Create a separate protocol for each requested evaluation window. Protocols are locked; editing the question or scientific rules creates another investigation. Evidence additions and evaluations append immutable revisions in the existing durable research SQLite database. Earlier evidence and reports remain retrievable internally.

## Scientific boundaries

- Source action dates define legislative event scope. Availability and chronological split dates use UTC, explicitly displayed in the workspace. Action dates and public-release times remain distinct.
- Congress action time, recorded-vote time, update time and HTTP modification time do not establish first public release. Today's first collector observation cannot be backdated into a historical study. Prospective observations must follow protocol registration.
- A publication-time study requires exact cited publication timestamps. An archive-first-observation study must be selected explicitly and answers a narrower question. A publisher timestamp later than observation of the same article is contradictory and excluded.
- Collected article candidates are unreviewed query matches. Calculation requires an exact event association and researcher review. Bill-number matches alone do not prove article identity across Congresses.
- A complete coverage assertion must match the event, bill, or explicitly named global archive scope. It must cover the action through the selected article, including any period before a late collector observation. Successful search and missing articles never certify completeness.
- Original/corrected action payloads retain distinct version hashes. Ambiguous source anchors are excluded rather than counted twice.
- Exposure assertions require a cited directional rationale, review, prior knowledge time, and a valid historical interval. These remain assertions; the terminal does not certify that a researcher actually recorded them before observing outcomes.
- Imported records are labeled researcher-asserted. A client cannot promote imported availability to independent provider verification merely by supplying `verified-publication`.
- Exact one-minute windows are required. No daily-bar, missing-minute, later-session or interpolated substitution is made. Weekdays/regular New York session hours are checked; supplied bars still require exchange-calendar, early-close, corporate-action and price-quality audits.
- Execution starts at the first complete minute strictly after public availability plus processing delay, and before the selected covered-news timestamp. The comparison starts strictly after that news timestamp plus delay. Both use the same eligible event/security cohort and holding minutes.
- `costBps` is a round-trip deduction once per completed asset strategy and long benchmark. Short borrow, executable quotes, liquidity and market impact require additional evidence.
- Output is a paired event-return comparison, not a capital-constrained portfolio backtest. Mean returns, benchmark excess and policy-minus-news differences are descriptive. Portfolio drawdown, Sharpe, confidence intervals, significance and an investable or causal edge are not claimed.
- The registered chronological split is preserved. A protocol created after the historical test period is explicitly exploratory, not a prospectively untouched holdout.
- Every evaluation freezes `asOf`. Future availability, observations, news and incomplete outcomes cannot enter it. Explicit reevaluation creates another frozen report; replay uses the original time.

## Module boundaries

| Area | Modules |
| --- | --- |
| Protocol and pure methods | `shared/policyProtocol.mjs`, `policyEvidence.mjs`, `policyStudy.mjs`, matching declarations |
| Official acquisition | `server/domain/policy/acquisition.mjs`, `evidenceHttp.mjs`, `legislation.mjs`, `legislationActions.mjs`, `news.mjs` |
| Research lifecycle | `server/domain/policy/store.mjs`, `imports.mjs`, `investigations.mjs` |
| Bounded computation | `server/domain/policy/worker.mjs`, `analysisWorker.mjs` |
| Reproduction | `server/domain/policy/replay.mjs` |
| Thin HTTP adapter | `server/routes/policy.mjs` and route manifest |
| Workspace | `src/research/policy/` |

No new dependency, scientific runtime or separate research database was introduced. Heavy eligibility/calculation work runs in at most two resource-limited workers with a 15-second budget, so it cannot occupy the API event loop. Worker result messages are tagged; Node's development-watch dependency messages cannot masquerade as results.

Imports are bounded to 6 MiB and 20,000 rows per evidence type, with a 16 MiB aggregate evidence budget and a 36 MiB frozen revision budget. Exact duplicates are idempotent; conflicting IDs/prices require another investigation. Expected revisions prevent concurrent mutation from overwriting evidence. List views use checksummed summaries instead of loading every full study. Collection supports cancellation, partial receipts and interrupted-run recovery.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/api/research/policy` | List capabilities/studies or create `{protocol}` |
| GET | `/api/research/policy/:id` | Current report and source metadata |
| POST | `/:id/collect` | Bounded real-source collection |
| POST | `/:id/cancel` | Stop active collection while preserving completed receipts |
| POST | `/:id/import` | Append `{kind, records, revision}` |
| POST | `/:id/evaluate` | Freeze checks/calculation at server evaluation time |
| POST | `/:id/replay` | Compare frozen calculation against current identical engine |
| GET | `/:id/export` | Full JSON evidence/report snapshot |
| GET | `/:id/archive` | Original executable engine and frozen study ZIP |

The abbreviated `/:id` routes share the `/api/research/policy` prefix. Writes use the existing origin guard. Acquisition uses fixed provider hosts and server-side configuration; imported URLs are citations, not requests to fetch arbitrary destinations. Source credentials and arbitrary `Retry-After` text are not persisted.

## Real-source acceptance evidence

The live defense example selected `hr-119-1968` and five named defense securities before examining any returns. Congress.gov returned 36 actions in one page; 15 requested action types were preserved, and 21 other action types were excluded. The source contains ambiguous untimed action anchors, which remain visible and ineligible without adjudication. Historical public-release timestamps were not certified.

GDELT retrieval failed in the live run. The saved manifest reports partial collection, clipped search history and unknown news completeness, rather than claiming no news existed. No prices or exposure assertions were fabricated and no historical strategy return was produced from this corpus.

Synthetic hand-calculated fixtures separately validate the complete calculation, HTTP lifecycle, append-only revisions, input assertions, optimistic concurrency, cancellation, watch-mode worker messages and offline executable archive. Synthetic arithmetic does not establish real-provider coverage or investment performance.

Verification: all 1,074 repository tests passed with `INTEL_TEST=1 node --test --test-concurrency=1 'test/*.test.mjs'`; TypeScript and the production build passed. Desktop and 390-pixel mobile layouts were inspected. Browser save, collection, evaluation and offline replay were exercised on the live server. A second, separately registered one-month version retained zero in-period actions for the specified bill and recorded the failed news lookup; it also produced an insufficient-evidence report and a matching replay. This is not a conclusion about other bills or the strategy's returns. The original broad question and the exact pre-news prompt retained their domains, both periods and SPY, returned no unrelated portfolios, and linked to the new workspace. Automatic source refreshes remained on.

## Remaining work

The historical pre-news question still requires a defensible archive with suitable coverage and original timestamps, reviewed bill/event/company mappings, minute prices for the eligible periods, and independently audited timing/identity evidence. One-minute opens/closes are not executable quotes. Additional statistical inference and portfolio allocation require separately validated methods. Provider failure and missing historical publication evidence cannot be repaired by a more persuasive model answer.

Primary source specifications: [Congress.gov bill endpoint](https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/BillEndpoint.md), [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/), and [GDELT historical-search limitations](https://blog.gdeltproject.org/doc-2-0-updates-1-5-year-searching-and-updated-mobile-interface/). The broader methodology and delivery gates remain in [methodology.md](methodology.md) and [plan.md](plan.md).
