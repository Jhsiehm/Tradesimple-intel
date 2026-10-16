# Research tools workspace

## Scope

The research tool views use a quieter, less text-heavy workspace with readable controls, flat record lists, and expandable methodology. This treatment applies to the eleven tools selected from `ResearchBoard.tsx`: Guided experiment, Data Hub, Contract evidence, Relationships, Experiments, Convergence, Event studies, Stress tests, Notebooks, Memory, and Paired research. Research Home, its composer, and its brand presentation are outside this change.

`src/research/workspace.css` scopes the shared treatment to the non-home research board. Component markup remains the source of truth for workflows and disclosures. This document records the implemented surface, not completion of every proposed research feature.

## Navigation and layout

Tool views offer a Research home button and a native select grouped into Get started, Evidence, Test an idea, and Keep and reuse findings. Keep the native keyboard interaction and accessible “Research tool” label. Changing tools resets the board's scroll position to the top.

Content has a maximum width of 1120px. Desktop padding is 28px above, 56px below, and a responsive 16–56px at the sides. At 720px and below, use 20px/16px/40px padding and single-column mappings and record rows. Lists remain bounded, independently scrollable regions rather than expanding into long walls of records.

## Visual treatment

| Role | Value |
| --- | --- |
| Background | `#12191e` |
| Primary / secondary text | `#e1e8ec` / `#a6b4bd` |
| Subdued text | `#96a6b2` |
| Dividers | `#34424c` |
| Input background | `#182229` |
| Action and focus accent | `#b7d9dd` |
| Primary action text | `#14262d` |
| Hover / selected row | `#1c2a32` / `#243943` |
| Neutral status background | `#20323b` |
| Error background / text | `#35292a` / `#efc3b9` |

Use system sans-serif for the workspace. Main headings are 26px/600, secondary headings 16px/600, body text 14px with 1.65 line height, and labels 13px. Reserve monospace for source contents and technical data. Tables use tabular numerals.

Forms have horizontal separators and spacing instead of enclosing cards. Record lists use flat rows, with an inset accent and `aria-pressed` for supported selections. Inputs and action buttons use 5px corners; primary actions have a minimum height of 40px. Keep focus visible with a 2px outline and retain scrollable containers for wide data and source text.

## Progressive disclosure

Keep the task, essential inputs, and current result available at first glance. Put detailed explanations behind descriptive native disclosures without removing the underlying information. Implemented examples include execution assumptions, contract retrieval limits, Convergence provenance and timing, event-window exclusions, stress calculation rules, relationship-date semantics, memory cutoffs, and paired-comparison registration conditions.

Disclosures reduce initial reading; they do not change the research contracts. Preserve visible warnings that affect the current action, the distinction between historical and live inputs, source limitations, and failed or partial results.

## Data Hub

Transaction signals and Numeric observations have distinct selectors with brief descriptions. Both branches remain mounted while switching between these data kinds, retaining their in-memory draft and selected-record state. This is not a promise of persistence across tool navigation, refresh, or browser sessions.

Imports are collapsible and initially open when no dataset is selected. File contents, column mapping, supported coverage, and detailed date semantics have separate disclosures. Numeric-observation history merging is also collapsed until requested.

Saved datasets form a library beside the selected record. With a selection, the library occupies 210–260px and the detail area takes the remaining width. At 900px and below, they stack and the library list is capped at 180px. Selected record headings receive focus when the selected ID changes. Transaction details expose their source, limitations, checksum, and preview through a disclosure; the experiment action remains easy to find.

Observation details prioritize threshold-signal creation. Source histories, historical lookups, revision policy, and provenance remain inspectable. The form distinguishes realized measurements from forecast vintages, previews actual matching observations, and retains explicit entity-to-ticker assumptions. First-publication signals do not substitute later corrections. Forecast eligibility requires publication before the target date; the interface reports excluded records and does not imply that missing history can be detected automatically.

## Purposeful motion and feedback

Busy messages carrying `research-working` show a 12px spinner on a 900ms rotation while their actual request state is busy. Do not use that indicator as simulated analysis or estimated progress. Status messages enter with a neutral 4px vertical movement over 320ms; this motion does not imply a favorable research outcome. Buttons use 140ms feedback and a small pressed offset.

Reduced-motion preferences disable the workspace's animations and transitions. Status and error text remain available without motion. Preserve `role="status"` and `role="alert"` semantics, readable error styling, disabled-state behavior, and real request-driven feedback.

## Verification boundary

Implementation checks reported for this pass include 892 passing tests, a successful build, navigation through all eleven tools at 1280px desktop and 390px mobile widths without document overflow, and a completed synthetic forecast derivation in the final mobile layout. The selected heading received focus, the save confirmation appeared, and switching data kinds retained the derived result. These are engineering checks, not user testing or validation of research conclusions.
