# Interactive research figures

Research answers can include interactive figures derived deterministically from successful tool evidence. The model does not write chart code or invent a chart specification. The figures expose recorded observations and provenance; their presence does not certify a study's methods, source coverage, or empirical conclusions.

## Evidence to display

`shared/researchFigures.mjs` projects the current turn's successful tool results into a bounded plain-data contract. Raw tool bodies take precedence over model-trimmed bodies. Adapters support:

| Evidence | Display |
| --- | --- |
| `research_audit_saved_studies` | Recorded portfolio/benchmark returns, excess returns, collection stages, and exclusions |
| `research_run_investigation` / `research_inspect_investigation` | Completed, executed descriptive outputs with explicit compatible numeric units and semantics |
| `research_sources` | Compatible saved numeric observation previews with explicit units and semantics |
| `run_backtest` | Actual recorded daily portfolio and benchmark points when valid dated curve data is returned |

Executed outcomes and audits receive priority over input previews. The same investigation revision is not charted twice. A blocked design, failed tool result, unsupported output, or result with no finite numeric observations produces no figure.

Each point retains its exact raw value, tool reference, and JSON source path. The contract contains labels, units, format, series, notes, and the reported source row/category count. It accepts bars, lines, and numeric scatter coordinates; the renderer's support does not imply that every adapter emits every representation.

Summary returns support categorical bar or dot comparisons. They never become an inferred daily performance curve. Actual curves require valid ordered calendar dates. The UI also rejects invalid or ambiguous saved time coordinates and falls back to labeled categories with a notice. Missing values remain `null`, not zero.

Percent and percentage-point values retain their raw fractions. For example, `0.0138` displays as `1.38%` or `1.38 pp`, according to the recorded format; the exact-data table separately preserves `0.0138`. Displayed unit captions use `%` or `percentage points`, while the raw column remains a fraction.

## Bounds and scope

The server and saved-chat cleaner accept at most six figures with 240 points across all series per figure. They inspect at most 32 recent evidence entries; compatible workflow/source adapters examine at most 120 input rows. Text is bounded, tool references must be canonical `t1`–`t999999`, and source paths must be bounded JSON pointers. Arbitrary HTML, scripts, executable expressions, and unknown fields do not survive normalization.

The UI separately limits rendering to 12 figures, 12 series, and 600 rows per figure as a defensive fallback. Normal server and saved-chat data already satisfy the tighter shared bounds. The plot shows at most 80 visible rows; the table and CSV include the full displayed selection, within these limits. A preview is not the full underlying dataset, and omitted observations are not zero.

The exclusions adapter displays at most 20 known reason categories, balancing selection across studies. Notes disclose the known category total and upstream omitted-counter fields. Unknown upstream names and overlaps cannot be added to the known category count. Collection receipt, normalized-record, and signal counts describe overlapping stages, not additive portions of one total.

## Interaction and persistence

`src/ask/figures/ResearchFigures.tsx` provides a figure selector and optional Show all figures view. `ResearchFigureView.tsx` provides bar/dot alternatives for categorical data, series controls that retain at least one visible series, an exact selected-value rail, source chips, notes, and an expandable data table. `FigurePlot.tsx` renders the bounded SVG and supports hover, touch selection, and keyboard point navigation with arrows, Home, and End.

Filtering changes the display only. It does not edit a saved study, recalculate a result, or change its conclusions. Selection and view controls are transient UI state.

The final Ask event includes `figures`; `src/agent/TurnView.tsx` places them before the answer narrative. `src/ask/chats.ts` preserves and normalizes figures when keeping and loading conversations. Older chats without figures still load. This is browser-local conversation persistence, not a new research archive or a replay guarantee. Answer cache identity 9 prevents reuse of answers from before this contract.

Download displayed CSV includes raw values, formatted values, units, references, source paths, notes, and scope. String cells that could become spreadsheet formulas are neutralized; real negative numeric values retain their numeric sign. CSV export explicitly describes itself as displayed data rather than the full underlying dataset.

## Research limits

Saved-study figures inspect recorded results. They do not execute a new backtest, replay arithmetic, reconcile all historical source documents, or establish when a signal was publicly available. Unequal windows, cooldowns, partial collection, assumed publication delays, missing counters, and unverified historical ownership remain explicit. A visual comparison is not a ranking of signal quality or evidence of causation.

The system note in `server/ai/researchVisualNote.mjs` requires those distinctions and forbids calling a calculation merely to decorate an inspection request. The saved-review routing guard prevents stale portfolio context or the word “returns” from silently substituting a fresh strategy run.

## Visual fit

Figures inherit the terminal's matte near-black green surface, shared system fonts, borders, and focus treatment. The local series colors live in `src/ask/figures/model.ts`; they distinguish series rather than replace financial or political semantics. The chart's 600px layout adjustment, scroll limits, and series palette belong to this component, not the entire design system. The extracted incumbent system is recorded in `DESIGN.md`.

## Verification on 2026-10-22

The actual browser acceptance prompt was:

> Compare my saved LMT and HII procurement studies. Show interactive graphs of recorded returns, excess returns, source coverage and exclusions. Explain partial coverage and assumed publication dates, and cite the saved evidence. Keep this to inspection of saved records.

The live answer used one `research_audit_saved_studies` call and produced four figures; no new backtest was run. It showed the saved HII portfolio return (`0.0829`), LMT excess (`-0.0742`), and the LMT cooldown exclusion count (`2163`) with source references and paths. It retained partial-coverage and assumed-timing warnings. The narrative used the existing cited evidence fallback when grounding checks did not pass; figures remained projections of the actual audit evidence.

Browser checks exercised figure selection, bars/dots, series toggles, point selection, keyboard End navigation, exact table values, and CSV download. The CSV preserved the negative raw excess, its `/studies/1/stats/excessTotal` source path, and scope warnings. The conversation was kept, the page reloaded, and the saved answer reopened with all four figures, units, and source paths intact.

Desktop (1346×900) and narrow-screen (390×844) captures are saved at `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. Two bounded inspection rounds corrected the displayed return-unit caption. The independent finish review marked that fix ready to ship, with no material fix remaining. The manual UI detector returned no findings.

The final full suite passed all 1,186 tests with no failures, skips, or cancellations. `npm run build` (TypeScript and Vite) and `npm run format:check` passed. Relevant regression tests include `researchFigures`, `researchFiguresBounds`, `researchFiguresAsk`, `researchFiguresUi`, `savedStudyExecutionGuard`, and the descriptive investigation/routing tests. Fixtures verify software behavior; these checks do not establish scientific validity or historical completeness.
