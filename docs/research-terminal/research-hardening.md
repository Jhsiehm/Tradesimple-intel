# Research validity remediation — October 22, 2026

This is the delivery record for the parallel review of data validity, statistical validity and execution realism. It distinguishes implemented controls from evidence that the application still does not possess. Passing software tests does not certify predictive skill, causal identification, historical completeness or executable returns.

## Method and responsibility

Three agents audited and implemented separate workstreams: source/time/identity evidence, statistical methods, and execution accounting. The coordinating agent integrated these changes with reports, AI summaries, immutable archives, repeated-attempt tracking and release checks. Agents then reviewed integrations outside their own implementation scope. Newly discovered cache and archive issues were corrected before release validation.

The sequence was: inspect actual implementation, identify a concrete failure or missing prerequisite, implement the correction or a conservative claim limit, test adverse cases and numerical examples, review integration, then run the repository checks. Source acquisition and prospective performance were not fabricated to complete a checklist.

## Concern-by-concern disposition

| Concern | Implemented response | What remains unestablished |
| --- | --- | --- |
| Historical knowability | Every new source backtest carries `dataValidity` in the response, frozen inputs and provenance. Source-derived dates, assumed contract lags and imported assertions are distinguished. Strict historical tradability remains ineligible. | Original publication timestamps, revision histories and independent timestamp audits. |
| Survivorship and identities | Current universe/mapping limitations and unverified delisted coverage are explicit structured blockers. Loaded bars are assessed separately from historical session completeness. | Historical security master, former constituents, acquisitions, ticker changes and delisting outcomes. |
| Feed omissions and source selection | Reports retain failed/pending/capped source counts, run selection caps, congressional annual-index failures, Form 4 store boundaries and amendment exclusions, and auxiliary contract sampling. | Reconciled population denominators and amendment-complete historical corpora. |
| Overstated statistical interpretation | Removed the inference that an unsuccessful timing placebo proves stock-selection skill. Corrected FDR wording. BH decisions use full-precision p/q values. Student upper tails avoid cancellation. | Calibration under realistic dependence, missingness and the selected sampling scheme. |
| Overlapping observations | Entry-week inference is withheld for invalid intervals, fewer than ten week blocks or holdings overlapping across different week blocks. Applied to individual backtests, signal search and Convergence. | A validated dependence model for longer-horizon strategies and independent calibration; the ten-block screen is an operational floor, not a guarantee. |
| Repeated experimentation | Append-only attempt/outcome inventory records new backtests, signal searches, each search variant and Convergence calculations, including failed and untested attempts. Frozen receipts report overlapping prior attempts. | Comprehensive researcher access tracking across all workflows, earlier activity and external tools; independent trial counts and confirmatory statistical corrections. |
| Trading realism | Results label the curve as a synthetic signal-return simulation, explicitly deny executable-portfolio and live-validation claims, list missing execution prerequisites, and expose mean-trade cost sensitivity. | Versioned holdings/cash accounting, turnover costs, liquidity/borrow evidence, executable quotes and prospective fills. |
| Reproduction and user-facing claims | New modules travel in engine bundles. Nested exports support trial inventories. UI and model summaries suppress withheld inference numbers; explicit unsupported certification phrases are flagged. | Source authenticity and semantic claim verification. The phrase checker is narrow and can miss paraphrases. |

Detailed audits: [data validity](data-validity-audit.md), [statistics](statistical-validity-audit.md), and [execution accounting](execution-realism-audit.md).

## Attempt inventory contract

`server/domain/research-trials.mjs` stores immutable `trial_attempts` and `trial_outcomes` in the existing durable research SQLite database. An attempt is registered before provider loading or calculation in its supported workflow. Search variants are registered before price loading, so price failures cannot erase the family of attempted specifications. Missing outcomes remain visible as unfinished, potentially interrupted attempts.

The inventory uses exact specifications, checksums, ordered registration and declared date/security scope. Missing scope is treated conservatively as potentially overlapping. Counts include unsuccessful attempts and are not the number of statistically independent tests. A cached backtest response reuses its existing receipt; an explicit fresh search reloads prices and creates a new attempt. Renaming a plan does not remove earlier overlapping records.

Convergence retains its original once-per-plan evaluation semantics. Its new receipt also reveals overlapping registered backtest/search activity; the preexisting `priorEvaluations` count remains specifically the number of earlier overlapping Convergence evaluations. Both are historical exposure indicators, not proof that any sample was previously unseen.

The linked read-only endpoint is `GET /api/research/trials/:id`. New frozen run archives include `trials.json` when their run has a receipt. The export includes the root attempt, its search children, and preceding overlapping inventory. This inventory is metadata and outcomes, not a complete standalone replay package for each search variant. The backtest/Convergence archive still contains its exact calculation inputs and original engine.

This is not an all-application access log. Policy, stress, general event-study and other workflows retain their existing records but are not comprehensively counted in this shared inventory. Failed validation before registration does not count as a statistical trial because no outcomes are calculated. Prior activity before this feature is not reconstructed or presented as zero.

## Numerical and operational checks

- Independent reference fixtures cover Student tails, a CR1 covariance calculation and BH adjustment. Method provenance and tolerances are in the statistical audit.
- Hand-computed economic cases demonstrate the difference between fixed-notional trade returns and the daily compounded curve, including short positions, entry/exit costs and missing-bar allocation.
- Integration regressions cover failed-attempt retention, overlapping scopes, immutable history, fresh price reload, search variants withheld from inference, result/provenance agreement, model-output restrictions and UI suppression of unsupported intervals.
- Calculation-engine hashes invalidate changed backtests. Search compatibility also includes search ranking and orchestration code, and data-validity version changes invalidate old assessments.
- Offline archive checks cover backtests, Convergence, notebooks, analysis, paired research and paper ledgers. New files remain constrained by path allowlists, and legacy engine bundles retain compatibility.

Validation result: all 1,104 repository tests passed; TypeScript, production and demo builds passed. Eight focused rendering/replication tests also passed after final explanatory-copy changes. The dependency audit identified a preexisting high-severity Vite issue; Vite was updated within the 8.3 patch line to 8.3.5. Tests and both builds passed again, and the dependency audit reported zero vulnerabilities. This is fixture and repository validation, not a new live provider audit.

## Combined-branch compatibility — October 23, 2026

The research-workflow and validity-hardening branches were integrated with `main` through `6f9c2bc5`. Formatting-only merge conflicts were reconciled without replacing either branch's behavior. The extracted AI backtest-summary module retains inference limits, data-validity reports, execution assessments and trial receipts alongside the workflow tools.

Saved-study inspection now carries bounded copies of those recorded assessments, with their archive origins. Explicit significance claims are checked against the cited study's withheld-inference status, and certification claims remain restricted. Missing legacy assessments stay unknown; inspection does not recalculate or alter frozen studies. The answer-cache identity was advanced to invalidate responses validated under the earlier checks.

Pure numeric summaries were extracted into `backtestMetrics.mjs` to keep the main engine below 600 lines. Exact serialized outputs matched the prior implementation across 26 comparison cases. Frozen engine bundles include the new helper, and the archive tests retain a self-contained three-module legacy replay case.

Final combined validation: all 1,255 repository tests passed, including six new compatibility regressions. TypeScript, production and demo builds, formatting, and staged diff checks passed. No unresolved Git conflict entries or conflict markers remained. These checks establish integration behavior, not historical source completeness or scientific validity.

## Remaining delivery sequence

These are explicit unfinished stages, not claims of delivered research-grade performance.

### 1. Audit one bounded source corpus

Start with a declared Form 4 population and period. Preserve SEC source payloads, accession/version IDs, parser versions, collection receipts and all inclusion/exclusion decisions. Reconcile requested issuers and filing counts to returned and parsed records. Resolve amendments without backdating corrected content. Review an outcome-blind human sample and report parsing, identity and timing errors with denominators.

Exit condition: another reviewer can reproduce the included population and explain every known exclusion; unknown completeness remains qualified. Corpus size or successful HTTP requests alone cannot pass this gate.

### 2. Supply historical security and price evidence

Obtain an auditable security master with effective and knowledge dates, historical universe membership, delisted returns, corporate actions and exchange sessions. Resolve mappings before examining strategy outcomes. Compare a sample of adjusted returns against an independent source and retain reconciliation results.

Exit condition: the declared universe includes relevant former securities and every price/mapping assumption is traceable. Until then, studies are explicitly restricted to their observed current-registry sample.

### 3. Implement a separately versioned funded simulator

Specify initial capital, cash rules, position aggregation, order sizing, capital rejection, turnover, execution time, costs, dividends, settlement and short financing. Define behavior on missing bars, halts and delistings before implementing it. Reconcile every quantity and cash flow against hand-worked cases and an independent implementation. Existing frozen signal-return engines must remain replayable unchanged.

Exit condition: holdings, cash, fees and equity reconcile under adverse cases. Even then, executable performance requires appropriate quote/liquidity/borrow evidence; bookkeeping alone cannot certify fills.

### 4. Validate inference and prospective evidence

Choose the primary estimand, baseline, dependence method, cost assumptions and stopping rule before evaluating the designated future period. Validate false-positive behavior and interval coverage under common shocks, serial dependence, unequal clusters and missingness. Register every subsequent variant and retain adverse results.

Prospective collection must begin after an actual protocol registration and preserve observation timestamps, decisions and execution evidence. This document is a proposed delivery sequence, not a registered strategy or a forward test. No future performance can be certified by today's implementation work.

Exit condition: an independently reviewable report distinguishes in-sample exploration, historical holdout exposure, prospective outcomes and economic execution feasibility. A null or adverse result is acceptable research; an asserted edge without those prerequisites is not.
