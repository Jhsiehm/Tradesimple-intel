# Statistical validity remediation — 2026-10-22

The current calculations are exploratory research diagnostics. They do not certify an investable edge. This audit separates corrected implementation errors from open questions that require new data, independent validation, and prospective evaluation.

## Implemented controls

- Reality engine version advances from 3 to 4, invalidating the existing backtest and signal-search caches through their existing version keys. Saved research engines are content-addressed; old archive exports retain their original source files rather than silently replaying with new calculations.
- An unsuccessful timing placebo no longer becomes evidence of stock-selection skill. The verdict explicitly says neither skill is established by that result.
- Signal search computes its member-cluster p-value from the unrounded statistic. Both member and week p-values, plus BH adjusted values, retain full precision through decisions and output. This prevents a small p-value rounding to zero or a value just above a threshold being accepted.
- Student upper tails use the incomplete-beta tail directly, avoiding loss from subtracting a nearly-one CDF. Diagnostic display fields remain rounded for compatibility; verdict decisions use unrounded bootstrap endpoints and placebo results.
- Search warnings explain FDR as an expectation of a proportion over repeated experiments under assumptions. They no longer multiply the chosen threshold by this run's number of discoveries to claim an expected false count. Warnings state that overlapping variants can violate BH dependence assumptions and that correction covers only this search.
- `inferenceApplicability(trades)` checks valid holding intervals, at least ten entry-week blocks, and overlap between holdings assigned to different entry-week blocks. The sweep includes shared exit/entry dates conservatively. In these cases, reality verdicts withhold inference and signal search excludes the variant from testing with recorded reasons. Member-based search testing requires ten members; otherwise it retains the existing week estimator.

Ten blocks/members is an operational minimum, not a statistical guarantee. Passing the screen is labeled `exploratory`, never `validated`. Existing numerical diagnostics remain available to inspect and reproduce, including when inference is withheld; consumers must show their applicability warning.

## Why withhold instead of installing another estimator

An entry-week bootstrap resamples trades as independent week blocks. Multiweek holdings can share realized returns across those blocks. A one-way member standard error likewise does not automatically address common market shocks across members. A larger standard error than the iid estimate alone does not prove calibration. These issues need a defined estimand and dependence model before choosing a calendar-time, multiway, or other estimator.

The screen identifies an observable violation without pretending that grouping overlapping trades solves every dependence problem. We have not introduced a connected-component estimator whose effective number of independent groups could collapse to one for ordinary rolling strategies.

## Independent numerical validation

`test/statistical-reference-fixtures.json` was generated locally with SciPy 1.13.1 (`scipy.stats.t.sf`, `scipy.stats.false_discovery_control(method='bh')`) and a separate NumPy intercept-only sandwich matrix calculation. It covers positive/negative Student tails, including t=100 with 30 degrees of freedom, a four-cluster CR1 example, and unordered/tied BH inputs. Tests compare values with relative tolerance 1e-11. Existing Cauchy closed-form checks provide another independent reference.

Regression tests also cover near-threshold rounding, malformed p-values, cross-week overlap, same-date overlap, insufficient blocks, invalid intervals, positive diagnostic intervals being overridden by withheld inference, and actual variant evaluation. The existing planted weekly short-hold strategy still qualifies for exploratory ranking; noisy overlapping variants now appear as untested. Node and Python generated replication tests continue to reproduce the numerical diagnostics.

## Remaining work before confirmatory use

- Validate calibration under realistic common shocks, serial dependence, persistent issuer/member effects, heterogeneous holding durations, unequal group sizes, and missing outcomes. Nonoverlapping dates do not prove independence.
- Independently validate the random-entry placebo's exchangeability assumptions and its missing-draw behavior. Its p-value is a diagnostic conditional on its sampling scheme, not a general test of skill.
- Choose and preregister a portfolio-level estimand, dependence estimator, and minimum information requirements appropriate to the selected strategy. Trade means and portfolio returns answer different questions.
- Record all attempted variants and all historical holdout exposure. A trial ledger makes repeated experimentation auditable; it does not by itself supply the number of independent tests or eliminate selection bias.
- Reserve an untouched prospective evaluation. A retrospective split already examined by researchers cannot be made untouched by renaming it.

## Method references

[R's official p.adjust documentation](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/p.adjust.html) defines FDR and distinguishes BH from the more general-dependence BY correction. Applying BY would not repair invalid input p-values, so this change does not substitute it as a blanket solution.

[Cameron and Miller, A Practitioner's Guide to Cluster-Robust Inference](https://cameron.econ.ucdavis.edu/research/Cameron_Miller_JHR_2015_February.pdf) explains independence across clusters, the importance of cluster counts, few-cluster problems, and multiway dependence. The ten-block screen is this application's conservative triage policy; it is not a threshold prescribed by that paper.
