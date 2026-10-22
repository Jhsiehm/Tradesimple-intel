# A research terminal that answers the intended question

Status: implementation plan, October 20, 2026. The [first routing/capability delivery](routing-release.md) and [bounded legislative policy pilot](policy-pilot.md) are implemented. The pilot delivers locked protocols, versioned collection, conditional paired-event calculations and frozen replay; audited historical pre-news coverage and broader methods remain incomplete.

Scope expanded October 21: the target is an [open financial research sandbox](sandbox.md) using platform data and internet evidence, with [historical collection and saving](historical-corpus.md). It must construct new study workflows without a bespoke route per hypothesis. These additions are specifications, not delivered capabilities. The [terminal-rs reference audit](terminal-rs-reference.md) informs reusable patterns and explicitly records what that repository does not supply.

October 22: the [first composed workflow implementation](workflow-release.md) connects ordinary Ask requests to saved observations, immutable investigation plans, compatible descriptive graphs and offline replay. It replaces the assessment-only dead end when that toolchain is available while preserving source/family/access guards. Corpus acquisition, broader validated methods and isolated custom scientific execution remain unfinished.

## Objective and success criterion

Turn a question into a traceable investigation: preserve its meaning, establish what evidence exists, choose an appropriate method, execute validated calculations, assess the limitations, and produce an answer whose claims can be inspected and reproduced. Accept broad questions for investigation without promising that every question is empirically answerable.

The first acceptance case is policy-to-markets research. A question about committee markups, legislation, regulation, contracts, or lobbying must not silently become a replay of officials' personal stock disclosures. Congressional-trade research remains a supported task when that is what the question requests.

The plan has two supporting specifications:

- [Research methods, evidence, and the worked policy example](methodology.md).
- [Architecture, module boundaries, and verification](architecture.md).

## Initial diagnosis before P0, October 20

This table records the original diagnosis. The delivered routing correction now precedes legacy planning and removes unresolved default source selection; the policy pilot adds its bounded workflow. Consult [sandbox.md](sandbox.md) for the current capability audit and remaining orchestration gaps.

| Existing capability | Reuse | Gap to address |
| --- | --- | --- |
| `shared/backtestAsk.mjs` | Preferences and explicit trade-strategy rules | `questionSources` adds Congress for legislative words and defaults to Congress when no source matches; `buildSpec` uses the first source. |
| `server/ai/run.mjs` | Bounded tool execution, streaming, model routing | Backtest planning precedes a general study design. Prior runs can influence follow-ups before their research meaning is resolved. |
| `shared/agent.mjs`, `shared/ask.mjs` | Numerical grounding, references, caveats | Requiring a backtest after a backtest word can reinforce an inappropriate calculation. Numerical consistency does not establish relevance or causal identification. |
| `server/ai/tools.mjs` | Existing source lookups and `run_backtest` | Dataset, event-study, relationship, observation, and experiment workflows are not exposed as a coherent research toolchain. |
| `server/domain/research-store.mjs` | Immutable datasets, engines, runs, notebook revisions | Add investigation/protocol records through migrations and references, rather than duplicate these stores. |
| `shared/eventStudy.mjs`, `server/domain/event-studies.mjs` | Market-adjusted and market-model windows over frozen prices | Inputs are inherited buy/sell signals; this is not a general policy-event model or a causal policy estimator. |
| `server/domain/research-events.mjs` | Frozen import/provenance patterns | Current transaction imports require buy/sell and availability at or after event time; future-effective policy announcements need a distinct event contract. |
| `server/domain/research-observations.mjs`, `relationship-history.mjs` | Versioned observations and temporal relationships | Need a common evidence contract and eligibility checks across sources. |
| `server/domain/convergence.mjs`, `research-stress.mjs` | Locked comparisons, holdout evaluation and stress analysis | Integrate with investigations; audit statistical applicability before broadening claims. |
| `research-analysis.mjs`, `research-archive.mjs`, `research-replay.mjs` | Execution journal and portable calculation evidence | Preserve full investigation lineage and report-level claim links. A replay verifies a calculation, not its interpretation. |
| Congress, USAspending, LDA, SEC and market feeds | Current source integrations | Historical completeness, document versions, exact publication times, historical company mappings, and delisted prices vary or are absent. |

This is a source-code diagnosis, not a reconstruction of the user's exact failed conversation. Inspect that execution if available before declaring its individual root cause closed.

## Product contract

1. Preserve the original question and a visible operational interpretation. Distinguish changing the research task from refining an existing task.
2. State what can be answered now, with which evidence and limitations. A partial result identifies the unanswered part.
3. Use the least complex defensible method. A factual lookup does not require a trading strategy; a trading backtest does not establish causality.
4. No implicit source substitution. Suggest alternatives with their differences; never report an alternative as the requested study.
5. Separate observation, inference, prediction and causal claims. Missing data and inconclusive results are legitimate outcomes.
6. Show the important assumptions and parameters beside results. Clarify only unresolved choices that materially change the question or result; otherwise use visible, versioned defaults.
7. Preserve a structured claim ledger, provenance, exclusions and reproducibility package. A citation's existence alone does not establish that it supports a sentence.
8. Keep normal conversation fast. Detailed workflows apply when the task needs them, not to every message or factual question.

## Supported research families

| Family | Required reasoning/artifact | Initial delivery |
| --- | --- | --- |
| Factual lookup or accounting | Source records, definition, scope and reconciled counts | Existing tools plus relevance checks |
| Document/history investigation | Versioned primary documents, chronology, quoted evidence, coding rules | Legislation and regulation pilot |
| Descriptive empirical study | Population, variables, missingness, distribution and uncertainty | General event/observation datasets |
| Predictive investigation | Target, feature availability, baseline, chronological validation and calibration | Explicit supported adapters; no generic claim of predictive validity |
| Trading strategy | Signal, public availability, universe, execution, costs and out-of-sample evaluation | Existing backtests and validated new signal adapters |
| Causal investigation | Estimand, identification argument, comparison, assumptions and diagnostics | Feasibility/design first; validated estimator added only when justified |
| Evidence synthesis or methodological question | Search scope, source selection, conflicting evidence and limits | Structured evidence synthesis; no fabricated computation |
| Unsupported or underspecified task | Precise missing capability/data or focused clarification | Honest bounded answer; no fallback portfolio |

## Delivery sequence and release gates

Stages are dependency ordered. Their completion is determined by acceptance evidence, not elapsed time. Start with one narrow vertical slice and expand after it passes.

### P0 — Preserve task meaning and stop wrong analyses

Scope: a structured research-intent contract and server-side guard ahead of legacy planning, follow-up inheritance, computation retries, and model tool dispatch.

- Separate research family, domain, requested outcome and data source. Preserve multiple domains in the user's question.
- Treat legislative activity and officials' personal trading as distinct. Contract/lobbying mentions do not settle whether the question is a return study, procurement study, or historical explanation.
- Permit the legacy planner only for a compatible, resolved signal-strategy request. Unsupported/mixed tasks receive a capability assessment rather than a default source.
- Preserve existing saved specs and direct backtest API contracts; version new intent/protocol records separately.
- An unrelated new question must not inherit a prior source. Distinguish explicit reruns from new investigations.
- Make an insufficient-data answer an acceptable terminal state for retry logic.

Exit gate: all routing acceptance cases in architecture.md pass, including typo/paraphrase and follow-up cases; every attempted incompatible calculation is refused with a useful reason. Explicit congressional and insider backtests still work. This stage fixes routing, not historical policy-data coverage.

### P1 — Plan, capability assessment and investigation record

Scope: reusable study protocol, capabilities registry and evidence readiness assessment.

- Return a concise plan covering target, universe, exposure, outcome, timing, method, comparison and unresolved choices.
- Query actual configured source and method capabilities. Distinguish an API integration from verified history for the requested period.
- Persist protocol versions, dataset requirements, assessment results, decisions and execution status using the existing research database and journal.
- Present available, partial, requires clarification and unavailable states with reasons. Do not invent a readiness percentage.
- When the user runs an analysis, freeze that protocol version and its material defaults. Ordinary authorized lookups/computation do not need an additional permission ritual.

Exit gate: a realistic policy query produces a relevant plan and source audit; it either selects compatible evidence or stops with an exact gap. Editing assumptions creates a traceable revision. No calculation may bypass capability checks.

### P2 — General evidence and event datasets

Depends on P1; supplies the inputs used by P3 and P4.

- Introduce versioned events, documents, relationships and observations with temporal/provenance fields described in architecture.md.
- Preserve bill actions and published text versions, regulatory document stages, contract transactions/corrections and original/amended lobbying filings independently.
- Add provider adapters incrementally: Congress.gov/GovInfo first; Federal Register plus official-document links next; extend existing contract and LDA retrievals.
- Freeze source payloads and parsing/mapping versions. Retain missingness and amendment history; never rewrite a historical snapshot with a current provider response.
- Introduce explicit historical company/security mapping status and an auditable exposure table. Current mappings are sensitivity assumptions when historical evidence is missing.
- Carry neutral events without forcing buy/sell. Trade signals are optional derived datasets with their own rules.

Exit gate: a bounded real historical corpus has raw evidence, coverage denominators, reconciled versions, time eligibility, source links and reviewed exposure mappings. Unknown historical public availability prevents a strict tradability claim.

### P3 — First complete policy investigation

Depends on P0–P2. Deliver the worked example in methodology.md as a saved, inspectable investigation.

- Select one policy domain and date range based on source feasibility; do not retrospectively choose whichever sample performs best.
- Build a timeline and coded exposure dataset with visible citations and ambiguous cases.
- Run a descriptive price-event analysis using validated frozen inputs, then an explicitly separate executable strategy if timing/prices permit.
- Connect findings to the assistant, charts, existing event-study view, notebook and portable export.
- Compare what the requested study needed with what was actually executed.

Exit gate: the user's policy question produces relevant evidence and either a reproducible result or a useful, bounded inability finding. No congressional portfolio appears unless explicitly requested as a separate comparison.

### P4 — General research execution and validation

Depends on P2; can expand after the first P3 slice passes.

- Expose the existing dataset, experiment, event-study and relationship services through small typed tools and one capability registry.
- Add method-specific validation: dataset compatibility, chronological splits, overlap handling, sample dependence, uncertainty, costs and sensitivity.
- Separate literature/document synthesis, descriptive studies, prediction and strategy results. Add causal estimators only with the method review and reference validation in methodology.md.
- Record attempted specifications and holdout accesses. Edited hypotheses are new exploratory variants, not fresh confirmation.
- Large computations use bounded resumable jobs with cancellation and durable provenance.

Exit gate: multiple research families pass independent benchmarks, statistical fixtures and claim-scope tests; unsupported methods remain unavailable rather than silently approximated.

### P5 — Reporting, evaluation and operational release

Built throughout P0–P4; required for release of each capability.

- Report the original question, actual design, data coverage, key findings, uncertainty, contradictory evidence, robustness and unresolved questions.
- Link each material claim to a source span or calculation output and its parameters.
- Export source manifests, transformations, engine versions, outputs and a master replay command subject to source licensing/access constraints.
- Benchmark task fidelity and scientific restraint alongside factual accuracy, runtime, cost and reproducibility.
- Roll out through a capability flag and a recorded routing decision. Retain a tested rollback and exact replay of prior run formats.

Exit gate: the end-to-end acceptance matrix, recovery/export checks and production build pass. A human review evaluates the reasoning on the fixed research benchmark. Passing software tests is not academic validation of a conclusion.

## First implementation batch

Implement P0, a minimal P1 protocol/capability response, and their relevant UI feedback before adding more estimators. Keep P2 dataset contracts in view so P0 does not hard-code another narrow research model.

Concrete changes: extract research routing from `run.mjs`; add task/source compatibility checks to dispatch; remove the implicit Congress selection from new general-research requests; narrow the retry requirement; preserve explicit legacy backtest behavior; display the interpreted question and exact capability gap; add focused regression tests. Commit these independently of provider ingestion and method-engine changes.

Do not represent this first batch as a completed general research terminal. Its first measurable improvement is answering the intended task or clearly explaining why it cannot yet be executed.

## Engineering constraints and risks

- Target 100–250 readable lines per new production module and 300 as a soft ceiling; enforce the existing 600-line hard limit. No minification, giant JSX lines, or new large-file exceptions to evade the intent.
- Split by responsibility, not arbitrary line count. Pure contracts/calculations stay in `shared`; I/O/orchestration in `server`; UI in `src`.
- `src/App.tsx` is already 887 lines. Add no research orchestration there; use a small integration hook/component and extract touched responsibilities when necessary.
- Do not accumulate orchestration in `server/ai/run.mjs` (388 lines) or tools in `tools.mjs` (446 lines). Extract coherent modules as capabilities are added.
- Historical data availability is the main feasibility risk; orchestration cannot manufacture original publication times, historical securities, or missing documents.
- LLM extraction and newer model training can introduce retrospective knowledge. Preserve rules/model versions, blind coding to outcomes where possible, and qualify strict historical-availability claims.
- Method labels and citation counts can create false confidence. Release gates must check applicability and claim support, not presentation alone.

## Decisions and deferred choices

Use the current Node/React/SQLite structure and tested calculation engines first. Do not introduce a second research database or execute arbitrary model-generated code in the application. The expanded sandbox requirement permits a later isolated scientific job runtime behind typed datasets/results, with pinned code/dependencies, independent numerical validation and explicit resource/data-access boundaries before enablement. Node worker threads alone do not provide that isolation. General composable study construction must not depend on a fixed menu of question-specific workflows; see sandbox.md for delivery and acceptance.

Dataset licensing, required historical prices/security mappings, compute budgets and supported jurisdictions are resolved by the feasibility assessment for each capability. No purchase, subscription or new external credential is assumed by this plan.

Progress is tracked in the existing implementation roadmap. The supporting specifications contain the contracts, academic references, evaluation cases and methodological restrictions required before claiming a capability is delivered.
