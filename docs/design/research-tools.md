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

## Feedback and disclosure follow-up

Notebook evidence and follow-ups use collapsible sections with attachment and open-task counts. Contract evidence keeps coverage, timing assumptions and warnings visible while monthly mappings and transaction previews are expandable. Job selection is disabled during requests to prevent overlapping selections.

Initial loading indicators now cover relationship selectors, relationships, event studies, stress tests, memory, paired research, notebooks and contract retrievals. Notebook and memory updates show request-driven activity; active contract retrievals show the recorded completed-partition count without estimating percent completion or remaining time. Notebook and contract empty states wait for initial loading to finish.

## Execution history extension

Execution history extends the established slate operational workspace. It is available under **Keep and reuse findings** in the Research tool selector and through **Inspect execution history** in Memory. Research home remains available in the shared navigation. The registry requires the local server; the static demo does not provide this view.

The view inspects recorded controlled analyses, including isolated, context-aware, and paired runs. Ordinary conversations are excluded. Search matches question, memory mode, or execution ID without case sensitivity, and the status selector offers completed, failed, aborted, clarification, and incomplete. Both filters apply to the latest 200 records returned to the view; the match count is not a count across the entire stored history, and there is no older-record browsing control. Refresh reloads the list and any selected execution. It is manual, not a live polling or restart action.

Flat, selectable rows show question, status, mode, and creation timestamp. Selection uses the existing inset accent and `aria-pressed` treatment. On desktop, the bounded library sits beside the selected detail in the shared 210–260px library column with a 32px gap. At 900px and below the library and detail stack; the search and status controls stack at 720px and below. The selected heading receives focus when the execution ID changes. Long questions, timestamps, recorded text, and payloads wrap within their available width.

The detail prioritizes execution status, recorded provider and model, model/tool request counts, journal-event count, and recorded answer text. Only completed executions label that text **Recorded answer**; other statuses use **Recorded text · may be partial**. Incomplete means no terminal record exists and may indicate a running or interrupted execution. Keep that uncertainty visible. Recorded errors appear as alerts, missing text has an explicit empty state, and missing provider/model metadata is identified as unrecorded. Answer previews show the first 1,000 characters with a control to expand the complete recorded text. Presentation reconstructs the text from journal events; it does not rerun the analysis or infer success from an absent terminal record.

**Memory supplied** discloses the saved-revision count, snapshot ID, memory cutoff, and recorded notebook titles, revisions, and conclusions. This is execution-time context: it does not establish current approval, and the memory cutoff does not constrain live external sources. Keep these qualifications with the disclosure.

The execution trail initially hides stream events; **Include streamed tokens and status events** reveals them and resets pagination. Pages contain at most 30 visible events. Each event is a native disclosure labeled with sequence, event type or tool detail, and timestamp. Opening it renders a formatted raw payload preview capped at 50,000 characters, in a wrapping monospace region with a 360px maximum height and scrolling. Truncation is disclosed. **Open full journal JSON** opens the selected execution's API record in a new tab for the complete payload; event pagination and preview limits do not imply server-side partial loading of the selected journal.

**Integrity and limitations** exposes the execution ID and journal head hash. The server checks the stored hash chain on read. Checksums detect inconsistency; they do not certify source truth, reproduce a hosted model, or make recorded citation identifiers proof of claim support. Loading and error feedback retain the shared request-driven status/alert treatment, with selection disabled while a request is busy. Distinguish an empty history from filters with no matches.

Review disposition for this extension was **ship**, based on source inspection and the desktop/mobile captures in `.impeccable/review/analysis-history/`. Browser verification covered incomplete, failed, and completed records, status filtering, event pagination, and a 390px layout without document overflow. The production build and two summary tests passed. At this documentation handoff, full-suite verification remained pending an unrelated rate-gate timing fix; the earlier verification count above belongs to the prior workspace pass and is not a result for this extension. These checks establish interface behavior, not the validity of recorded research conclusions.

### Utility layout and feedback follow-through

Event studies, Stress tests, and Contract evidence use the same responsive saved-library / selected-detail composition as Data Hub and Execution history. Libraries stack above details on narrow screens. Experiments and Convergence keep saved collections in labeled disclosures so a selected result is not buried below the library. Stress scenarios can be individually collapsed without deleting draft values.

Opening a different record and adding a scenario give brief movement feedback. Working indicators remain tied to real busy/loading states; no completion percentage is invented. Reduced-motion preferences disable these animations. Notebook and Memory filter controls share the readable input treatment. Research Home retains its existing visual identity.

Verification: production build and 917 tests passed before the final scenario disclosure change; subsequent typecheck/build validates that markup. All twelve utility views were opened at 390px without document-level horizontal overflow. Event-study desktop and Convergence mobile layouts were visually inspected. This is not a live-provider acceptance test of every utility.

Execution history now offers “Export execution and notebook evidence (.zip)” below the trail. Adjacent instructions explain the standalone verification command and distinguish calculation replay from model regeneration. The download was exercised in isolated browser QA; the existing responsive styles accommodate the control at 390px.

Memory approval review conditionally offers an Earlier approval selector when a reviewed revision has older active approvals. Keeping them active is the default. Selecting replacement shows the consequence beside the reason field and changes the action to “Approve and replace earlier revision.” After success, only the selected older revision retires; historical context inspection shows the existing unusable-context warning. Synthetic browser verification covered replacement and the warning on a 390px viewport.
