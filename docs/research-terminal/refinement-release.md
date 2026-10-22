# Research brief, comparison, and execution refinement

This refinement connects three parts of the existing research flow: stating a question, judging the recorded evidence, and choosing whether to calculate. It preserves freeform questions and the existing trusted calculation engines. It does not turn configuration, a saved result, or an interactive chart into evidence of scientific validity.

## Question to protocol

The guided question brief separates saved-record inspection, new-study design, and supported execution. It produces an editable draft rather than submitting a question or running a calculation. Available saved study IDs may be chosen explicitly; the guide does not silently pick unrelated records. Missing dates, entities, methods, or evidence stay unresolved rather than being filled with invented defaults.

The brief carries the hypothesis or question, population/source scope, period, comparison/outcome, public-availability requirements, and requested evidence displays. The generated draft respects the existing 800-character Ask boundary; an oversized draft is rejected with a useful correction rather than silently truncated. The user can continue to write directly in the normal question field. Undo draft replacement applies only while that generated draft is still present; starting another conversation resets the guide's draft history rather than restoring text from the previous conversation.

Separating a proposed design from execution follows the purpose of declaring an analysis plan before a test and distinguishing exploratory from planned work. See the [Center for Open Science's preregistration guidance](https://www.cos.io/initiatives/prereg). A local question brief or saved protocol is not an OSF registration, proof of prior non-observation, or protection against every form of researcher discretion.

## Recorded comparisons before returns

Named saved studies are selected from a bounded owner-local inventory using exact titles/dataset names or ticker matches. Explicit experiment IDs retain precedence. A name that identifies multiple datasets is ambiguous; an unmatched name does not authorize substitution with a recent unrelated study. The audit records unresolved selections and its discovery boundary.

The audit compares recorded design fields, with source paths for differences and missing evidence. Its readiness labels mean:

| Label | Meaning |
| --- | --- |
| Not directly comparable | Recorded design fields differ, required fields are missing, or a selection/evidence condition prevents a direct comparison. |
| Listed fields match only | The listed recorded fields match. This does not validate causality, historical tradability, complete coverage, or a common risk exposure. |
| Single study | One saved record is described; there is no pairwise ranking. |

The chart surface places this assessment before performance. It shows each study's collection coverage, public availability, period, and trading rules. Full IDs, source references, comparison checks, and gaps remain inspectable. Concise plot labels no longer require reading long experiment hashes; exact identity remains in the selection, review disclosure, data table, and export.

Portfolio and benchmark bars are adjacent for each study. Collection-stage counts remain overlapping stages rather than a stacked total. Missing values remain missing. CSV includes the displayed comparison context and its provenance, and keeps the distinction between displayed data and the underlying research dataset.

Older saved figures without comparison metadata still load and explicitly state that comparison checks were not attached. They are not retroactively certified. A new audit retrieves the new comparison receipt.

## Execution is a separate scope

`shared/researchExecutionScope.mjs` recognizes explicit design-only instructions. `shared/researchCompatibility.mjs` enforces the scope at tool dispatch as well as planning:

- Design only permits evidence inspection and a proposed/saved protocol, but blocks `run_backtest`, `search_signals`, and `research_run_investigation`.
- Saved-evidence inspection also blocks creation of a new investigation. A model cannot replace the requested inspection with another study.
- A later explicit execution request is interpreted anew and may run a compatible supported analysis. Unsupported method/source requirements still apply.

An edit to a proposed plan retains the last explicit design-only restriction in the supplied user history. A command to run the calculation can release that restriction; merely mentioning a backtest while changing its planned benchmark does not. Saved composed investigations use their own inspection tool rather than being substituted with a legacy experiment audit.

These are deterministic tool boundaries, not a reliance on the model following a sentence in a prompt. Model/tool failures, unsupported methods, ambiguous identities, partial coverage, and unverified timing remain reportable outcomes. Answer cache identity 10 prevents old answers from bypassing the refined receipt and scope behavior.

## Module boundaries

Question construction, question UI, name selection, comparison readiness, figure review normalization, review presentation, and execution scope live in separate focused modules. For example, `questionDraft.ts` is 115 lines, `ResearchQuestionGuide.tsx` 194, `study-audit-selection.mjs` 90, `study-audit-comparison.mjs` 137, `researchFiguresReview.mjs` 97, and `StudyReview.tsx` 83. Shared contracts remain pure and have declaration files. Existing file-size and dependency checks still apply; `server/ai/run.mjs` remains 717 lines against its existing 723-line limit. No large-file exemption or dependency was added.

The implementation continues to support only the actual engines and acquired evidence described in [the workflow release](workflow-release.md), [historical corpus notes](historical-corpus.md), and [policy pilot](policy-pilot.md). It does not supply arbitrary custom code execution, establish a complete historical document universe, or validate a pre-news trading edge.

## Verification on 2026-10-22

Independent debug review found and verified fixes for prefixed design-only requests, planning edits retaining scope, negated execution commands, lowercase/repeated named-study clauses, and review attribution across separate audits. Invalid or stale explicit study selections cannot silently become an unrelated inventory request. The manual UI detector returned no findings.

The generated saved-study inspection draft was 457 characters. The live request selected `studyNames: ["LMT", "HII"]` and made one `research_audit_saved_studies` call (152ms tool time; about 42 seconds total response time). It resolved these exact pre-existing saved records:

| Study | Experiment | Recorded comparison evidence |
| --- | --- | --- |
| LMT | `exp_01f145d19f774eeea87c0f2028f56b5a` | Partial collection, 0/1 partitions; 30-day cooldown |
| HII | `exp_1b4d44e3f3b045bba740b35891287d0a` | Count reconciliation within scope, 1/1 partitions; 7-day cooldown |

The answer produced four figures and a **Not directly comparable** assessment. It disclosed different cooldowns, result windows, and engine records; assumed 90-day defense / 7-day civilian publication delays; and the limits of collection counts. It did not run a fresh calculation or replay the saved arithmetic. Model prose still had grounding flags, so the final answer used the deterministic cited evidence report. The figures and comparison receipt retained their tool-derived evidence independently of that prose.

The negative LMT excess remained `-7.42 pp` with raw value `-0.0742` and source path `/studies/0/stats/excessTotal`. The actual downloaded CSV retained that path, full experiment IDs, comparison checks and gaps, the human-readable Not directly comparable label, and the displayed-data scope warning. This export is not a complete underlying study package.

The generated design-only legislation question also saved a blocked protocol without executing it. That demonstrates scope preservation and an explicit unresolved design; it does not resolve historical publication timing, news coverage, document completeness, or the proposed pre-news trading hypothesis.

Question, report, and chart captures are stored as `.impeccable/review/refinement/{question,report,chart}-{desktop,mobile}.png`: six captures at desktop 1396×900 and narrow-screen 390×844, with no horizontal overflow. A fresh independent finish review marked those captured surfaces ready to ship with no material fix. The final functional draft-Undo reset was made after these captures; a read-only check of the current guide found an empty draft and no stale Undo control, without changing the user's latest conversation. It does not introduce a new visual world.

The user started a new conversation before keeping this acceptance answer. These captures and the CSV record the live result; this run is not claimed as a kept browser conversation. The underlying experiment records already existed independently of browser chat persistence.

The final rerun after the draft-Undo adjustment passed all 1,213 tests with no failures, skips, or cancellations (56.1 seconds). The TypeScript/production build, formatting, dependency/file-size checks, and diff checks passed. Software checks demonstrate engineering behavior; they do not establish empirical conclusions.
