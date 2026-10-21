# Research methods and evidence specification

Companion to [the delivery plan](plan.md). These are proposed requirements, not a claim that every method is implemented or every dataset is available.

## From a question to a testable design

A structured protocol retains the original question alongside its operational definition. It records the hypothesis and alternatives; population and unit of analysis; geography and period; event/exposure; outcome; comparison or baseline; estimand; method; timing; exclusions; uncertainty; robustness; and the allowable scope of conclusions. Unknown fields remain unresolved, not silently defaulted into another task.

A factual query can be answered from records. A historical narrative needs an evidence chronology. A predictive question needs held-out outcomes. A causal question needs an identification argument. A trading question additionally needs executable information timing and portfolio mechanics. One investigation can contain several explicitly separated analyses.

Before estimating outcomes, preserve the planned primary analysis and label alternatives as exploratory. A locked local protocol records what was fixed when; it is not public preregistration and cannot undo earlier access to outcomes. The rationale for specifying outcomes and analyses in advance is illustrated by [Casey, Glennerster and Miguel, *Reshaping Institutions*](https://www.gsb.stanford.edu/faculty-research/publications/reshaping-institutions-evidence-aid-impacts-using-pre-analysis-plan).

## Evidence is multidimensional

Record evidence status along separate dimensions rather than award a generic research-grade score:

| Dimension | Required assessment |
| --- | --- |
| Task fidelity | Does the evidence and computation answer the operational question? |
| Provenance | Primary record, derivative source, imported assertion, or researcher interpretation? |
| Coverage | Requested/observed populations, dates, pages and failed partitions; known and unknown omissions |
| Timing | Exact publication, date-only publication, first observation, or assumed availability |
| Identity | Historical exact mapping, reviewed mapping, current-only assumption, ambiguous or unmapped |
| Method applicability | Required assumptions, diagnostics, dependence, effective sample and scope |
| Reproducibility | Frozen inputs, transformations, runtime/engine, environment, seeds and verified outputs |
| Robustness | Sensitivity performed, contradicting results, held-out evidence and unresolved weaknesses |

Reproducibility does not certify original sources, completeness or causality. An inconclusive result may be well executed. No result can upgrade missing timing or identity evidence through fluent explanation.

## Time and historical information

Keep `eventAt`, `publishedAt`, `effectiveAt`, `firstObservedAt`, `ingestedAt`, revision times and the source's own update fields separate. Store precision, timezone, uncertainty bounds and evidence for each time. A document date is not automatically its public-release timestamp; a source update time is not necessarily first publication.

For a historically tradable strategy, every input, relationship and transformation must satisfy its declared availability policy at the decision time. Use timestamp-aware as-of joins; never join an old event to today's revised document or current corporate parent without disclosing that assumption.

An exact after-close release enters no earlier than an eligible subsequent session under the execution model. Date-only release uses a declared conservative later-session rule and session-calendar sensitivity; that rule does not establish the actual historical release time. First-observed dates support a collector-observed strategy, not an original-publication strategy. An assumed lag supports a sensitivity analysis labeled as such. Unknown availability cannot support a strict point-in-time tradability claim.

Model-generated document labels require additional care. A modern language model may know later legislation, awards or returns. Freeze the input documents, extraction rules, model/prompt and coding outputs; hide outcomes from coding where feasible; manually audit a held-out sample. Describe retrospective coding as retrospective unless stronger evidence establishes historically feasible production of the same signal. Frozen source inputs alone do not remove model-training leakage.

## Documents, events, exposure and signals are distinct

A document can support several events. Several documents can describe the same event. An event may affect multiple entities; a company may have opposing exposures. A signal is a declared transformation of eligible evidence into a decision, not an intrinsic buy/sell property of a bill.

- Legislation: retain introduced, amended, reported, passed, enrolled and enacted stages and exact text versions; do not project final language backwards. Published bill versions are identified separately in [GovInfo's bill documentation](https://www.govinfo.gov/help/bills), with related actions/text endpoints documented by the [Library of Congress](https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/BillEndpoint.md). A markup may require committee documents beyond the bill API; absence there does not establish no markup.
- Regulation: separate proposed rule, final rule, public inspection, publication, correction, delay and effective date. Use [Federal Register API documentation](https://www.federalregister.gov/reader-aids/developer-resources/rest-api) for discovery and retain official GovInfo document links for verification. An announced future effective date can be known before the date it takes effect.
- Procurement: distinguish authorization, appropriation, solicitation, award, modification, obligation, deobligation, ceiling and outlay. Transaction action dates and modifications are separate fields in the [USAspending transaction contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/transactions.md). A current award summary is not a historical news-release series.
- Lobbying: retain client, registrant, covered period, issue description, filing/posting evidence and amendments. Quarterly activity is disclosed after it occurred; [Senate filing deadlines](https://www.senate.gov/legislative/Public_Disclosure/filing_deadlines.htm) illustrate that distinction. Do not backdate a spending signal to the quarter's start or use future filings to determine when a threshold was first observable.
- Exposure: record the evidence connecting policy to a sector, product, program, recipient or security; validity and knowledge dates; coding rule and reviewer/model version; ambiguity and alternatives. A text mention is a candidate relationship, not proof of an economic benefit or causal connection.

## Method selection and statistical requirements

### Descriptive history and evidence synthesis

Define source selection and search scope; retain a document/version inventory and evidence excerpts. Separate source statements from analyst interpretation. Reconcile conflicting documents and expose retrieval failures. Use supported charts and counts without claiming an exhaustive literature review or population census when collection is bounded.

For coded text, establish a codebook and inclusion rule before market-outcome inspection. Review a blind sample against human labels and report error categories, precision/recall where appropriate, and reviewer disagreements. Deterministic text diffs and exact section citations support, but do not themselves validate, semantic interpretation.

### Financial event studies

Use published event-study principles to define an event window, a separate estimation window, and expected returns before interpreting abnormal returns. [MacKinlay (1997), *Event Studies in Economics and Finance*](https://www.jstor.org/stable/2729691), is the foundational reference. The default output is a descriptive association around events; a causal claim requires additional identification.

Extend the existing frozen-price engine instead of reimplementing it wholesale. Keep existing market-adjusted and market-model versions reproducible. Add neutral event anchors without forcing buy/sell, clarify whether an anchor measures publication-session reaction or a later tradable session, and use the exchange calendar explicitly.

Required diagnostics include missing estimation/event sessions, unstable expected-return estimates, repeated issuer events, concurrent market events, overlapping windows and sensitivity to event-time uncertainty. Report raw returns, expected returns, abnormal returns and CAR with weighting definitions and inclusion/exclusion counts. Do not treat event count as independent sample size when events share issuers, dates or exposure shocks.

The present connected ticker/window CR1 uncertainty is an existing limited method to audit, not a universal independence solution. Report its group count and degeneracy; avoid inferential claims when effective groups are inadequate. Evaluate appropriate dependence-aware resampling or inference against reference implementations before adding confidence intervals. Keep earnings and macro-event contamination visible; post-event variables are not automatic valid controls.

### Trading strategy evaluation

A strategy protocol specifies the universe, point-in-time signal, decision and execution time, holding/exit, position sizing, cash and capital constraints, overlapping positions, costs, slippage, liquidity and benchmark. Report executable net portfolio performance separately from average event returns. Do not sum independent hypothetical trades into an impossible portfolio.

Use chronological development, validation and held-out evaluation. Separate overlapping labels/event windows across splits; choose any embargo from information overlap and holding horizon, not an arbitrary magic duration. Tune on development data, record all variants and count holdout accesses. A repeatedly consulted holdout becomes development evidence; require a new untouched period or qualify the claim.

Keep survivorship, delisting, historical constituents, security changes, corporate actions and adjustment basis explicit. When present-day registry or incomplete prices are all that exist, label the restricted universe and forbid a market-wide historical generalization.

Report economic magnitude, turnover, drawdown, exposure, sample length and cost sensitivity. Register all attempted configurations, including failures and negative results. [Bailey and López de Prado's Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) addresses selection and non-normality under its assumptions; it is not a universal certification. Do not calculate it from invented trial counts or apply it to an incompatible return sample. Multiple-testing procedures must match the declared hypothesis family and dependence assumptions.

### Prediction beyond returns

Define the target (for example a later contract obligation), target horizon, censoring, outcome availability and population at risk. Start with a meaningful naive/base-rate baseline. Use chronological splits and report calibration, discrimination and task-relevant errors, including uncertainty and imbalance. The same award cannot leak into both the exposure rule and its future outcome label. A good explanatory fit on retrospectively chosen winners is not predictive evidence.

### Causal policy analysis

Specify a target effect and a causal graph or explicit identification argument before selecting an estimator. Consider anticipation, endogenous policy selection, spillovers, contemporaneous policies and the choice of comparison units. A regression coefficient or before/after return is not by itself causal.

If an appropriate difference-in-differences design exists, audit parallel-trend plausibility, anticipation, treatment timing, control contamination and dependence. Passing a pretrend test does not prove the identifying assumption. [Sun and Abraham](https://arxiv.org/abs/1804.05785) show problems with standard lead/lag two-way fixed-effects estimates under staggered timing and heterogeneous effects. Do not apply an absorbing-treatment estimator automatically to repeated, reversible policy shocks.

Dependence-aware inference matters: [Bertrand, Duflo and Mullainathan](https://economics.mit.edu/sites/default/files/2022-08/How%20Much%20Should%20We%20Trust%20Differences%20in%20Difference.pdf) demonstrate false significance from conventional treatment of serial correlation. Clustering and resampling must follow the assignment/dependence structure and effective cluster count.

Synthetic controls, discontinuities or instruments are future optional capabilities, each requiring its own assumptions, diagnostics, numerical validation and applicability checks. Initially return a causal feasibility/design report if the data or identification is inadequate. Do not package an associational event study as a substitute causal result.

## Worked first investigation: policy information, procurement and returns

Original intent: investigate whether legislative or regulatory developments and lobbying activity reveal investable information about later government business and affected companies.

This is a linked investigation with three distinct questions:

1. What information actually changed at each public policy milestone, and which firms had documented exposure then?
2. Did those exposed firms subsequently receive different procurement outcomes, or exhibit different market behavior, relative to a declared baseline?
3. Could a strategy using only eligible information have acted on that relationship after costs?

### Pilot design

Choose one domain (for example a specific procurement program) and a feasible period after the source audit. This is a proposed example, not a preselected historically profitable sample. Define the company universe using pre-event records or state the current-universe limitation. Do not select firms because they later won awards or had high returns.

Preserve each selected bill/rule version, legislative action, amendment and regulatory milestone. Code the economic change using exact text spans and a published codebook: funding amount/change, eligible recipients, restricted technologies or other relevant dimensions. Retain ambiguous and contradictory mappings. A budget authorization is not automatically an appropriation or an award.

Predeclare the exposure measure using relationships available before the event. Separate direct recipients, parent/subsidiary links, suppliers, and broader industry exposure. No winner or return data may determine the primary exposure assignment.

For procurement, define future net obligations or another exact outcome, accounting for modifications and deobligations. Keep source update/availability uncertainty, coverage boundaries and censored outcome horizons. Report a descriptive association first; causal or predictive extensions require their own prerequisites.

For returns, choose a primary event window and expected-return model on development data and lock it before evaluation. Annotate prior anticipation, related policy milestones, earnings and sector-wide news. Define overlap treatment without selectively discarding bad outcomes.

Only then define a strategy: when the signal was observable, how it translated to positions, when entry could occur, the capital constraints and costs. Keep lobbying signals as separately timed filings or declared covariates; a later quarterly report cannot be read at an earlier markup date.

### What the first report must contain

- The original question and the exact question the executed design can answer.
- A source inventory, event chronology and exposure table with document spans, identities and timing status.
- A flow of candidate events to included observations, with every exclusion reason and relevant denominator.
- Descriptive results and, if supported, separately labeled strategy/predictive results; uncertainty and economic magnitude.
- Placebo/negative-control and sensitivity checks appropriate to the design, preserving dependence rather than blindly shuffling observations.
- Competing explanations, adverse results, coverage/identity/timing limitations and the consequence of each limitation for claims.
- A replay package and a clear statement of what remains untested. Never manufacture observations to populate the report.

If the historical publication or exposure mapping fails, produce the chronology and feasibility findings, identify a data-retrieval or prospective-collection path, and stop the unsupported trading conclusion. That is a completed feasibility investigation, not a completed backtest.

## Reproducibility and external standards

Follow the spirit of the [AEA Data and Code Availability Policy](https://www.aeaweb.org/journals/data/data-code-policy): document data provenance/access, supply calculation code and execution instructions, and preserve the details needed for independent verification. This is an engineering target, not a claim of AEA endorsement or compliance certification.

Extend the existing archive with protocol versions, source/identity manifests, code/model/prompt versions, environment and seeds, extraction/coding outputs, exclusion tables, trial history, claim ledger and generated tables. A master command should regenerate deterministic calculations and report figures. Model text is recorded, not promised to regenerate identically from an external hosted service.

Restricted-source licenses may prevent redistribution; include the permitted metadata, access conditions and hashes, and distinguish an executable calculation package from an independently obtainable complete dataset. Checksums detect mutation, not authenticity. Separate engineering verification, methodological review and empirical conclusions in all delivery claims.
