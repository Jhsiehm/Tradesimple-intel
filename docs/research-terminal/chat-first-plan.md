# Chat-first research delivery plan

## Goal
Complete supported investigations in Research Terminal chat: question, inspectable plan, evidence, bounded execution, inline results, conversational revision, and reproducible export. Specialist screens stay optional. Preserve the original question, claim limits, source failures, immutable protocols and runs.

## Implementation sequence
1. Reuse the existing investigation toolchain and chart renderer. Add typed, bounded study receipts from actual tool results, rendered inline with plan, evidence, blockers, results and export actions.
2. Carry an explicit saved investigation reference across turns. Resolve it on the server, keep it out of isolated/web-only sessions, and do not rely on truncated model prose for identity. Save research conversations automatically with visible storage failures.
3. Support linked amendments, safe inspection and deterministic replay through existing workflow services. Preserve prior protocols and evaluations; never silently rerun an inspection.
4. Bring the existing policy collection/evaluation workflow into the same assistant interface using bounded tools and distinct claim limits. Do not fabricate missing prices, mappings or publication evidence.
5. Verify full conversational journeys, blocked designs, isolation, stale revisions, persistence, replay and accessible desktop/mobile rendering. Run repository checks and document remaining data/provider limitations.

## Architecture constraints
No replacement database, universal analysis engine, new agent framework, arbitrary code execution, brokerage integration, or unrelated redesign. Reuse server/domain/workflow, server/domain/policy, existing Ask SSE steps and research figures. Structured UI values originate in tool results, never model-written markup. Saved browser chats reference durable owner-local studies; do not claim cross-device chat persistence.

## Release evidence
- A supported descriptive investigation can be planned, run, inspected, amended and exported within chat.
- An unsupported design displays explicit gaps without a substituted calculation.
- Policy collection failures remain visible as missing evidence.
- Changed protocols retain lineage; replay does not refetch source data.
- Reopened chats retain study identity and controls; isolated memory and web-only sourcing do not receive owner-local context.
- Automated checks plus browser inspection at desktop and mobile widths pass.

## Progress
- Baseline inspected: existing composed investigation tools, bounded workflow results, inline figures, immutable policy workflow and browser chat store will be reused.

## Delivered implementation
- Structured study receipts stream from actual tool results before the model finishes answering. Inline cards show plan, missing evidence, bounded source/result previews, exports and assistant actions.
- Chat carries a validated investigation ID; the server inspects its actual record. Controlled-memory and web-only requests do not receive that reference. A subsequent legacy backtest takes over its own follow-up context.
- Research conversations autosave in this browser and restore the active chat. Interrupted work retains study references and asks users to inspect server state before retrying. Storage failures are visible; deleting a conversation suppresses autosave resurrection.
- Workflow amendments preserve the original question and claim family, link to the exact parent revision, and retain previous evaluations. In-app replay compares frozen calculations without refetching source data or writing another evaluation. Changed engines require the exported original-engine archive.
- The assistant can create, inspect, collect, evaluate and replay the existing specialized policy pilot. Its causal/predictive/strategy boundaries, source failures and missing imported evidence remain enforced. Policy protocol amendments and evidence imports remain specialist operations.
- Stateful tool batches execute sequentially and cancellation prevents later queued writes. Independent reads remain parallel.

## Practical limits
This delivers a supported chat workflow, not universal financial analysis. Composed descriptive methods use saved observation snapshots; policy research still needs adequate timestamp, news, exposure and minute-price evidence. The assistant cannot manufacture those prerequisites. Chat storage is browser-local; study records are owner-local in the existing SQLite store. Automatic cross-device chat sync, new providers, causal methods, and automated trading are outside this increment.

## Validation
Automated coverage exercises saved study receipts, identity persistence, browser-record restoration, memory isolation, cache separation, sequential mutation cancellation, immutable amendments and frozen replay. Scripted-provider integration exercises actual Ask routing/tools and emitted chat receipts. Browser checks use explicitly synthetic fixtures, not claimed live financial findings. Desktop/mobile component checks validate inline actions, disclosures, responsive overflow and busy states. Live provider coverage and hosted-model behavior require separate real-data acceptance and are not certified by these checks.

Final verification: production build and TypeScript passed; all 1,277 repository tests passed. Browser checks at 1280px and 390px confirmed inline disclosures, action targeting, busy states and no horizontal page overflow. A second browser check using the actual useAsk hook verified autosave, reload restoration, deletion without resurrection, explicit save, new conversation and reopening. Temporary fixtures and preview servers were removed. No live financial corpus or paid hosted-model acceptance was performed.


## Live preview acceptance — 23 October 2026

Tested the current checkout at http://127.0.0.1:5175/#research (API 8789) using the configured Sonnet 4.6 provider and actual saved HII contract evidence. The older preview at 5173 belongs to another checkout and was left unchanged. Subagents implemented the evidence adapter, reviewed routing, and independently ran repository checks; the coordinating agent performed browser acceptance and integration.

Observed failures and fixes:
- Existing contract datasets could not feed a composed study without manual import. Added an idempotent adapter that validates saved checksums and preserves the exact selected sample, collector-observed timing, original lineage and coverage limits.
- Negated requests such as “do not calculate returns” were classified as trading requests. Narrowly corrected that routing and prevented an incidental audit from replacing a requested plan.
- The assistant confused a metric label with the numeric `value` column and treated provenance limitations as calculation blockers. Exposed the schema, clarified numeric fields and separated assumptions from actual missing requirements in the tool schema. A fresh identical plan-only retest saved a ready draft without execution.
- Generic tool-result trimming hid deeply nested numerical results. Added a compact model view with scalar output rows and exact bounded protocols for safe amendments; oversized protocols are explicitly incomplete.
- Added sum to the versioned descriptive engine. Existing frozen engines remain available in their archives. Inline summary tables show count/total/mean/minimum/maximum, with exact values in exports; USD display rounds to two decimals. Detailed engine limitations expand in place.

Verified browser journeys:
- Discovery and preparation of actual saved evidence without asking for internal IDs.
- Plan-only save; no execution until requested.
- Corrected immutable amendment and run: 9 selected observations, total USD 24,469,369.76, mean USD 2,718,818.862222222, minimum USD 104,399.04, maximum USD 16,504,860.
- Linked threshold amendment (`value >= 500000`): 5 observations, total USD 23,776,881, mean USD 4,755,376.20, minimum USD 565,000, maximum USD 16,504,860. Original study retained.
- Inline replay button returned matches=true. Downloaded the replay ZIP via its chat control; running its frozen replay.mjs offline also returned matches=true.
- Browser reload restored the chat, study controls, numerical table and replay status.
- An unsupported causal policy question saved a blocked causal protocol with missing requirements, no execution and no substituted descriptive study.

Durable evidence: completed parent inv_b405895ea6664eaba8da9b481fa10fa5; filtered child inv_3f4ecc7c1a6b40099256b822fb7bfb4d; fresh ready plan inv_4ad3063e53ff4e06810267b850a0e3c7. Actual source selection is 9 signals from 204 received transactions, excluding 65 non-positive and 130 cooldown-filtered records. These totals describe that selected sample, not all HII spending or a causal/trading finding.

Remaining work should harden this same path rather than add more screens: reduce repetitive model narration and generic charts, narrow tool context to lower latency/cost, and repeat acceptance across additional supported datasets and phrasings. A single successful provider run is not a guarantee of consistent planning. Source authenticity, historical publication verification, causal methods and policy minute-price/news completeness remain outside this acceptance result. No deployment performed.

Final live acceptance: the fresh plan inv_4ad3063e53ff4e06810267b850a0e3c7 executed from its inline control and produced the same nine-record summary at revision 2. Final full suite: 1,288 passed, zero failures/skips. Production build and TypeScript passed; the final summary-table layout was rebuilt and checked in the browser. Screenshot: artifacts/chat-first-live-acceptance/result.jpg. The working preview remains running on port 5175.
