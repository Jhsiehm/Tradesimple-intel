# Research workspace UI cleanup

This change makes the question and evidence easier to use within the existing matte terminal. It changes presentation and navigation, not research methods, acquired data, execution permissions, or the meaning of recorded results.

## Question entry

The question field now precedes the optional guide. **Ask question** is the primary action, with its keyboard shortcut available in the button title. Short help explains what to include; the character count appears when a draft exists. The Sources and model choices remain beside the action. When execution is unavailable, the connection notice remains an alert and offers Retry connection.

**Refine your question** starts collapsed. Draft type, examples, and Customize the draft remain available inside it. Inserting a draft fills the editable question without submitting it; the user can review or undo the replacement. The existing question limit, scope validation, and execution guards remain in force.

## Saved work and tools

The Saved list initially shows the first three conversations in the existing pinned/recency order. Show all expands the list. Filtering searches the full saved collection rather than the three-row preview; it returns all matches. Pin, rename, delete, and deletion Undo remain available.

Research tools use native disclosures for secondary groups, while Evidence remains visible. Run context places connection, sources, memory, attached context, tool counts, and the latest tool receipt in a disclosure. Active progress, web-only or isolated-memory restrictions, interruptions, run limits, and tool failures still have visible status or warning text.

Model choices use readable model names. Exact provider/model IDs remain in option metadata and the expanded execution trace. A completed step summary is shorter; its disclosure retains the raw model ID and tool records. Review notes expose the unresolved-check count before their detailed changes.

## Results and provenance

Recorded comparison review keeps readiness, study periods, collection status, and public-availability uncertainty visible. **Design details** holds exact study IDs, source paths, recorded dates, trading rules, complete coverage/timing text, comparison checks, and evidence gaps. Preview wording shortens only recognized audit vocabulary; unfamiliar saved text remains intact.

The chart still exposes selected values and source chips directly. **Observation details** holds the selected point's explanatory metadata and exact JSON path. Figure selection, series controls, exact-data tables, and CSV export retain the recorded values and provenance. CSV scope and uncertainty are preserved. Saved figures without comparison metadata show an explicit warning rather than an inferred review.

The focused modules are `ResearchSavedConversations.tsx`, `ResearchRunContext.tsx`, `ResearchQuestionGuide.tsx`, `SavedChats.tsx`, `StudyReview.tsx`, and `figures/reviewModel.ts`, with scoped question/sidebar/figure CSS. The incumbent design system is unchanged.

## Verification on 2026-10-22

The final full suite passed all 1,216 tests with no failures, skips, or cancellations. TypeScript and production build passed, as did repository formatting. The final singular unresolved-check wording also passed formatting and TypeScript checks. Evidence logs are `/tmp/tradesimple-ui-clean-final-tests.log`, `/tmp/tradesimple-ui-clean-final-build.log`, and `/tmp/tradesimple-ui-clean-format.log`.

An independent source review found that a saved-list preview could limit filter matches. The correction moved the limit to display only; the reviewer signed off that fix. This is a source-level check, not a claim that every saved-list interaction was exercised in the browser.

Desktop acceptance at 1396×900 verified draft insertion and Undo. Submitting a question entered the busy state, but completion of that fresh answer was not verified because the browser connection became unreliable. An existing saved conversation loaded successfully. Its figure picker displayed LMT excess `-7.42 pp`; Observation details exposed `/studies/1/stats/excessTotal`. That older conversation lacked attached comparison metadata, and the expected warning remained visible.

Desktop captures are `/tmp/tradesimple-ui-clean-desktop.png` and `/tmp/tradesimple-ui-clean-results.png`. The finish review scored the desktop surface 4/5 with no material issue; the results-specific follow-up also found no material issue. Mobile automation did not successfully apply the intended 390px viewport to the original tab, so this pass does not establish mobile acceptance or complete responsive coverage.

The manual detector invocation exited successfully with empty output. That is not recorded as a substantive clean scan or an accessibility certification.

## Follow-up acceptance on 2026-10-22

Both outstanding core flows were subsequently completed through the actual preview UI, using fresh questions that explicitly identified the same two saved studies. Neither question authorized new calculations or replay.

| Check | Desktop | Mobile layout |
| --- | --- | --- |
| Fresh answer completed | 44.4 seconds; one saved-study audit | 43.3 seconds; one saved-study audit |
| Interactive figures | Four figures; exact excess return inspected | Four figures; selection and arrow-key navigation verified |
| Source inspection | Source chip opened the matching audit step | Same audit source, with exact selected observation path |
| Save and reopen | Saved as “Usability desktop · LMT & HII”; reopened with charts and review intact | Saved as “Usability mobile · LMT & HII”; reopened with charts and review intact |

The mobile viewport was verified from the rendered page as 390×844, with document width 390px after the answer rendered. The sidebar opened, Escape closed it and restored focus, and selecting a saved answer closed it. The background main region carried its inert attribute while the sidebar was open. This verifies the responsive browser layout, not physical-device touch or virtual-keyboard behavior.

The mobile chart CSV download preserved raw excess fractions `-0.0742` and `0.0138`, percentage-point display values, exact study IDs, source paths, comparison checks, and uncertainty. The exported scope explicitly remained the displayed data.

The desktop narrative failed its verification gate and correctly fell back to recorded evidence with a visible explanation. The mobile answer retained a generated narrative. Passing these interaction checks does not certify every generated statement; narrative reliability remains an answer-quality follow-up.

Evidence: `/tmp/tradesimple-usability-desktop-reopened.png`, `/tmp/tradesimple-usability-mobile-entry.png`, `/tmp/tradesimple-usability-mobile-chart.png`, and `/tmp/tradesimple-usability-mobile-saved.png`. Application code was unchanged during this acceptance run.

These checks concern the user flow. Neither a cleaner interface nor passing software tests establishes historical completeness, public availability before news coverage, causal validity, or a profitable strategy.
