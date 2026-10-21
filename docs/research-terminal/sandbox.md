# An open financial research sandbox

Status: design and source-code audit, October 21, 2026. This is the expanded product requirement, not a delivered execution engine. It complements [methodology](methodology.md), [architecture](architecture.md), and [historical collection](historical-corpus.md). The legislative pilot is one acceptance case, not the scope of the product.

## Product objective

Accept a financial question in ordinary language, construct a defensible operational design, discover platform and internet evidence, build and save the actual dataset, execute an appropriate analysis, and deliver inspectable findings plus a reproducibility package. A new question must not require another hard-coded question-to-workflow route.

Any financial hypothesis may be investigated. Whether it can be answered depends on evidence, identification, measurement and available methods. The system may deliver a useful chronology, feasibility finding or partial analysis without a numeric investment result. More records or a successful replay do not establish validity.

The assistant must distinguish exploratory iteration, a protocol locked before analysis, and later confirmation on genuinely untouched data. User corrections create linked revisions rather than erase the earlier choices or trials.

## Audited current position

| Layer | Implemented foundation | Remaining capability |
| --- | --- | --- |
| Intent and tool choice | `shared/researchIntent.mjs`, compatibility checks, `server/ai/researchRouting.mjs` | General semantic interpretation and task-specific plans; current broad-hypothesis assessment returns before the model/tool loop, preventing an automatic investigation |
| Platform access | Typed lookups in `server/ai/tools.mjs`; dataset, observation, relationship and analysis routes | A coherent assistant toolchain to discover schemas, acquire, transform, join, freeze and analyze those resources |
| Internet evidence | Search and page fetch when enabled; `shared/webAsk.mjs` limits each question to three searches, three pages and 6,000 characters per page | Durable bounded research jobs, document capture and search/exclusion manifests; snippets are discovery evidence, not full-document coverage |
| Historical collection | Source-specific feeds, bounded policy collector, resumable contract/connector retrieval patterns | Broad versioned document acquisition and an audited history inventory across providers |
| Persistent data | Immutable datasets, observations, relationships, source documents and engines in `research.sqlite` | Reusable document/table corpus and derivation lineage shared across investigations without mutating old versions |
| Execution | Specialized backtests, event studies, comparisons and policy calculations | Composable execution and an isolated scientific runtime; current event studies depend on buy/sell replay inputs and a daily publication-date anchor |
| Trace and recovery | Controlled analysis journal, memory snapshots, backup and portable archives | Uniform plan-to-evidence-to-code-to-result lineage and restart/resume across general studies |

These are implementation observations, not proof that any configured provider has complete history. See [portable evidence limits](../research-evidence-exports.md) and [recovery](../research-recovery.md).

## Workflow construction rather than question templates

The planner discovers capabilities and schemas and proposes a versioned dependency graph. Each node names its operation, input artifact hashes, typed parameters, output schema, budget and validation. Example operations are discover, retrieve, parse, code, filter, transform, temporally join, freeze, estimate, diagnose and report.

Templates may suggest starting designs. They must not determine the question's source or outcome. A legislation query can require procurement outcomes; a document comparison may need no price series; a macro study can require revised-data vintages. None should inherit a stock-disclosure portfolio by default.

1. Preserve the original hypothesis and alternatives. Operationalize population, unit, exposure, outcome, comparison, period, target quantity and claim type. Resolve material ambiguities; record ordinary defaults.
2. Inventory available platform datasets, source schemas, methods, configured connectors and historical evidence. Search primary sources and methodological literature where useful. Separate desired coverage from verified coverage.
3. Propose the smallest defensible design and its failure conditions. Explain why its evidence and method address the question, including plausible alternative explanations.
4. Acquire and retain original evidence with a query/selection ledger. Extract and validate records; record missingness, duplicate/version lineage and exclusions.
5. Freeze a dataset and analysis specification. Execute bounded operations, preserve code/environment, then inspect diagnostics, sensitivity and contradictory evidence.
6. Report the supported answer, unresolved parts and exact replay artifacts. Changes to sources, assumptions or method create a new linked plan/run.

A simple factual lookup can skip unnecessary experiment stages. The planner must not force a full protocol form onto every request.

## Reusable data and internet evidence

Use existing research records as the authoritative metadata/lineage store. Large original documents and columnar tables should use a versioned content-addressed artifact store, referenced by immutable manifests; decide the storage format in its own implementation batch. Do not turn the disposable feed cache into the research archive or put an entire corpus inside every run JSON.

Preserve original bytes or the explicitly documented provider representation, source identifier/version, retrieval receipt, hash, media type, access/license restrictions and parser provenance. A changed response creates a new object. Snapshot membership, transformations and entity mappings are versioned independently.

Raw collection is reusable across studies. Derived features belong to a named protocol and frozen corpus version. Record field definitions, units, currency, identity, missing-value semantics and timestamp precision. Support documents, numeric tables, events and relationships without forcing all rows into buy/sell signals.

Do not relabel existing transaction/observation imports as a universal event contract: they constrain availability relative to event/measurement time and derive buy/sell signals. A regulation can be published before its effective date, and a future announcement schedule before the announcement. Introduce neutral evidence/time contracts and explicit adapters while preserving old replay semantics and archives. The present daily event-study anchor cannot stand in for an intraday reaction analysis.

Internet research has its own bounded job budget, checkpoints and cancellation. Save queries, dates, filters, result pages, fetched sources, inaccessible documents, selection/exclusion reasons and actual delivered passages. A search engine result count is not a document-universe denominator. Do not infer complete history from a completed search or a provider's maximum date range.

Publication, effective/event, collector-observation and ingestion times remain distinct. For historical execution, use knowledge-time eligibility and historical security membership/mappings; later corrections and modern entity labels cannot silently enter the past. Full retrospective description may use later evidence if clearly scoped, but cannot be labeled a historically tradable signal.

## Methods and an extensible scientific runtime

Compose typed, validated operations for routine analyses. Each estimator declares inputs, applicability, assumptions, output fields, uncertainty/dependence requirements, diagnostic failures and maximum claim scope. A method being callable does not establish that its identification assumptions hold for a particular question.

Allow a path for custom analysis code when existing operations cannot express the design. This expands the earlier fixed-engine-only plan: the application must not execute arbitrary model-generated code in its API process, shell or database. Introduce a separate scientific job boundary before enabling custom code.

Requirements for that later runtime:

- Pin source code, dependency lockfiles, image/runtime digest, random seeds, numerical settings and artifact schemas. Preserve exact submitted code and logs, including failed trials.
- Use OS/container isolation with no application credentials, no host/home/database mounts, read-only selected input artifacts and a bounded output directory. A Node worker thread or `vm` context is not this boundary.
- Separate acquisition from analysis. Analysis is offline by default; an explicit recorded acquisition service mediates permitted network requests and secrets.
- Enforce CPU, memory, wall time, process, output-size and disk quotas; cancellation and process-tree termination; no implicit dependency installation.
- Validate outputs and independently check central calculations/reference fixtures before enabling a method. Keep novel or unvalidated scripts exploratory and inspectable; model critique alone cannot certify them.
- Preserve failed/rejected jobs and reasons. Resume only compatible checkpointed operations; changing code, data or material parameters creates a new execution identity.

Initial releases should expose existing validated methods through the general workflow first. Advanced estimators and custom code become separately declared capabilities after numerical and isolation acceptance; neither should be simulated by model-written prose.

## Scientific review and claims

Document synthesis requires a search/selection scope and cited source passages. Descriptive work requires measurement and coverage checks. Prediction requires availability-safe features, chronological validation and a meaningful baseline. Trading additionally requires public information timing, historical universe, prices, executable rules, costs and portfolio mechanics. Causal analysis requires a defensible identification argument, comparison and method-specific diagnostics.

Record trial history and holdout access, multiple comparisons, overlapping events, effective sample size, missingness, survivorship and censoring where relevant. Results should expose uncertainty and sensitivity; do not silently promote correlation, an event return or an in-sample fit into causality or an investable edge.

AI document annotations must cite exact original spans/page or section references, record model/prompt/configuration and parsing versions, and pass schema and human-sample validation. Preserve model inputs/outputs and ambiguity. Avoid giving coders subsequent outcomes; modern model training may still embed hindsight, so outcome-blind coding is not proof of historical implementability.

## Three distinct reproducibility promises

| Promise | Evidence required | Does not establish |
| --- | --- | --- |
| Audit the answer | Sources, exact spans, inclusion/exclusion ledger, code and result references | That every relevant document was found |
| Replay the calculation | Frozen inputs, transformations, code/engine, environment, parameters and checksums | That a live API/model would return the same data/output today |
| Independently replicate the study | Collection recipe, source inventory, access restrictions, extraction/coding rules and method specification | Identical provider revisions or bitwise equality across numerical environments |

Export exact originals where redistribution is permitted, otherwise identify restricted artifacts and required access without advertising a self-contained public package. Offline mode must fail explicitly for missing artifacts; it must not quietly fetch replacements. Replaying preserved AI annotations is different from regenerating them with a nondeterministic model.

## Delivery batches and acceptance

| Batch | Concrete delivery | Release gate |
| --- | --- | --- |
| 1. Historical corpus foundation | General source inventory, immutable document artifacts, checkpointed acquisition, versioned parsing and coverage manifests | A bounded real corpus reconciles discovery/download/parse counts, failures and versions; original bytes survive restart/export |
| 2. General investigation graph | Persistent generic protocols/graph/job journal; small typed tools for existing data and engines | Two unfamiliar non-policy questions construct different justified workflows without adding question-specific routing |
| 3. Evidence and method integration | Dataset derivations/temporal joins, source spans, locked analysis and report claims | Inputs/results trace to the original hypothesis; incompatible timing/methods fail visibly; saved runs replay offline |
| 4. Scientific job runtime | Isolated pinned execution and inspectable custom code | Isolation/resource/network tests plus independent numerical benchmarks; no application secrets or unselected data reach a job |
| 5. Research evaluation | Source audits, reasoning review and held-out question suite | Task fidelity, extraction accuracy, coverage, numerical correctness and claim restraint assessed separately |

Example acceptance questions: legislative language versus later contract obligations; earnings disclosures versus later margins; macroeconomic releases versus sector returns using actual release vintages; and a question the planner cannot identify causally. New questions must use existing composable contracts rather than acquire their own bespoke planner branch. If a source/estimator is absent, save the relevant design, collect supported evidence and identify the exact missing part.

Reuse `research-store.mjs`, source-document/evidence storage patterns, connector and contract job recovery, observation/relationship contracts, `research-analysis.mjs` journals, memory boundaries and portable exports. Extract coherent adapters rather than enlarge `run.mjs`, `tools.mjs`, research routes or `App.tsx`. Keep new production modules near 100–250 lines, the existing 300-line soft ceiling and 600-line tested hard limit, with no new large-file exceptions.

The immediate implementation priority is historical document/data acquisition plus the general investigation contract. Preserve the incompatible legacy-backtest guard while replacing the assessment-only dead end with a validated planning/execution path. More topic-specific backtest screens alone will not meet this requirement.
