# Routing correction: first delivery

Implemented October 20, 2026. Scope: P0 plus a minimal capability assessment from P1 in [the plan](plan.md).

The subsequent [debug verification](debug-verification.md) records the exact contract and pre-news request corrections, cache identity version 5, and current refresh limitations.

## User-visible behavior

The actual failed legislative/lobbying/regulatory/procurement question now returns **Research capability assessment — no backtest executed**. It retains all four domains, the requested two-year and one-month periods, and SPY. It explains which lookups and replay components exist, which require configuration, and the historical timing, exposure and method requirements preventing the combined study.

A generic “backtest this idea” asks for the intended signal instead of selecting Congress. A user can explicitly request a narrower supported replay afterward. Existing source-specific replays and parameter/result follow-ups remain available. Factual bill questions can still reach evidence tools, while incompatible portfolio calculations are blocked.

Assessments carry a structured `done.research` receipt. The visible confidence line identifies a capability assessment, with no study executed and no source-history audit. They do not call a model or calculation tool. Configuration checks reveal only status, never keys. No assertion of a real edge, historical population coverage or causal inference is produced by the assessment.

## Enforcement and compatibility

- `shared/researchIntent.mjs`: structured conservative recognition, common spelling variants, explicit exclusions, task scope and policy follow-up handling.
- `shared/researchCompatibility.mjs`: source/method compatibility at dispatch.
- `server/ai/researchCapabilities.mjs`: implemented capability/configuration inventory; historical coverage remains unaudited.
- `server/ai/researchRouting.mjs`: feasibility receipt and proposed plan, plus scope instructions for ordinary model requests.
- `server/ai/run.mjs`: early assessment, prior/legacy planning integration, and guards before tool execution and after source merging.
- `shared/taskSchedule.mjs`: refuses incompatible policy replay scheduling, including references to an unrelated older portfolio.
- `shared/answerCache.mjs`: identity version 4 invalidates older reusable answers. Prior saved conversation text is not rewritten.

Existing direct API backtest specifications and stored calculation engines are unchanged. The read-only `assess_research_capabilities` tool is available to the assistant's platform/both sourcing modes. Model tool calls cannot use a different source to evade the interpreted task. Routine authorized computations retain the existing execution flow.

## Verification

All 1,001 repository tests pass with `INTEL_TEST=1 node --test --test-concurrency=1 'test/*.test.mjs'`; TypeScript and the production build pass. The 23 focused routing tests cover the original question, paraphrases, spelling variants, negation, procurement/causal outcomes, separate and combined sources, unknown source requests, factual questions, prior-run changes, narrow explicit replacements, source substitution, optimization, scheduling, configuration secrecy, cache identity, and assessment metadata. Existing legacy, follow-up, model-routing and citation tests remain part of the full regression suite.

Browser/API acceptance exercised the running localhost service. The policy question returned HTTP 200 with all requested domains, `executed:false`, zero model tokens, zero tool calls and no backtest cards. The research page visibly rendered the capability report and its distinct status. See `artifacts/research-routing/` for the captured preview.

## Limits and next implementation stage

This does not execute the desired combined policy strategy yet. Legislative/regulatory event ingestion, historical publication evidence, temporal exposure mappings and validated general research execution remain subsequent stages. The inventory checks implemented features and configuration, not source health or historical completeness.

The recognizer is a conservative local routing guard rather than a universal semantic understanding system. The explicit source guard also protects unresolved computation requests, but general factual source selection still depends on the existing assistant. Expand the benchmark with real failures and implement the versioned protocol/feasibility service before claiming arbitrary research-grade execution.
