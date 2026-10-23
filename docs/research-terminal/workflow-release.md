# Composable descriptive investigations — October 22, 2026

Status: implemented first workflow slice. This connects saved numeric evidence to assistant-created study graphs; it is not the completed general research sandbox or a historical document corpus.

## What changed

Ordinary owner-local Ask requests with the complete study toolchain can now proceed beyond the conservative capability receipt. The assistant can discover saved observation snapshots, inspect their fields and source conditions, save an investigation, execute a compatible descriptive graph, inspect the saved result and offer frozen exports. A new English-language hypothesis does not require another question-specific analysis handler.

The incompatible legacy-backtest guard remains active. An unresolved legislative, causal or predictive question cannot become a personal stock-disclosure portfolio. The trusted original question and inherited research context are preserved; Ask rejects an attempted downgrade of a recognized unsupported research family to descriptive calculation.

The graph composes source selection, typed scalar filters, exact one-to-one joins, explicit numeric differences and descriptive summaries. It can combine different snapshots and produce different transformations without a separate topic-specific runner. This is a small vocabulary of reusable operators, not arbitrary code execution.

## Workflow and actual limits

1. Import and review numeric observations through the existing Data Hub. Source identity, units, availability, ownership and usage conditions remain importer assertions.
2. Ask a question that identifies the intended population, quantities and comparison. The assistant may discover saved snapshots or explain missing evidence.
3. Save the original question, operational hypothesis, research family, population, unit, outcome, comparison, dates, knowledge cutoff, assumptions, unresolved requirements and graph.
4. Execute only a descriptive plan with supported real inputs and resolved requirements. Other families can retain an honest blocked design, including unknown dates as null.
5. Inspect output previews, source references, counts, missing/unmatched/excluded records and limitations. Download full JSON evidence or a frozen executable ZIP.

The first source adapter accepts existing immutable numeric observation snapshots. Web discovery and platform lookups remain available under their existing sourcing settings, but their results are not automatically converted into numeric study datasets. Full legislative documents, PDF/OCR acquisition, historical corpus backfills and a general scientific runtime remain separate unfinished deliveries.

Forecast/revision semantics use the existing observation resolver before filtering or joins. First-publication and latest-known selection are explicit. Date-only publication is known at the end of its UTC day. The requested event range and knowledge cutoff are distinct; derived rows cannot become known earlier than the latest required input.

Exact joins do not infer time lags, security mappings or economic relationships. Duplicate keys fail instead of multiplying observations. Missing keys do not match. Differences require compatible units and retain ordered operand metadata; matching units alone do not prove economic comparability.

Summaries retain n, mean, minimum, maximum, units, metric semantics and provenance. They refuse mixed measures in one group. These calculations do not supply confidence intervals, significance, predictive validation, causal identification, portfolio mechanics or investability claims.

## Saved evidence and replay

Investigations live in append-only, hash-checked revisions in the existing research database. Normalized duplicate creation is idempotent; repeated execution returns the same frozen result. Failed/cancelled attempts preserve their status and hashes. Material protocol changes create a distinct investigation; a general editable protocol/trial ledger remains future work.

Execution pins exact observation snapshots, raw imported content and source restrictions, vintage decisions, resolved rows, protocol, engine/resolver source, environment metadata, exclusion ledgers and results. Bounded list/inspection responses contain previews; exports contain the full retained evidence.

The ZIP contains its original pure engine, exact source resolver, source snapshots, checksums and `replay.mjs`. Extract and run `node replay.mjs` using Node 22.13 or later. It requires no application database, installed packages, provider credentials or network. It recomputes source selection and the deterministic workflow against the frozen originals.

This replays calculations and saved semantic assertions. It does not regenerate model reasoning, verify importer claims, prove historical completeness or independently replicate an empirical conclusion. The new study record is not a full journal of every ordinary Ask model message.

Backup verification includes the workflow revision chain, summaries, source references, original snapshots and frozen input/engine/result hashes. Restores create a new destination. A frozen self-contained study does not substitute a current provider response for missing originals.

## Access and operational boundaries

- Controlled-memory requests cannot discover or consume study datasets through these tools. Notebook approval does not grant dataset access. The denial applies to model tool definitions and dispatch.
- Web-only sourcing cannot inspect saved platform data. Both platform and combined sourcing can use the study tools.
- Scheduled free-form prompts retain the conservative path. They cannot create/run/read general investigations through the new toolchain.
- Stateful create/run calls are excluded from answer reuse. Cache revalidation also refuses to execute previously recorded write calls.
- Trusted calculations run in bounded worker threads: at most two active calculations, 15-second execution limit and 192 MiB JavaScript heap limit. Cancellation propagates from Ask/API disconnects; optimistic revision checks prevent concurrent overwrite.
- These workers protect API responsiveness for trusted code. They do not provide a security sandbox for arbitrary generated scripts.
- Plans are bounded to 16 nodes, four sources and eight outputs. Tables, intermediate rows, input/output bytes, persisted records and public previews have explicit limits. Limits produce failures or gap findings rather than truncated completed studies.

## Interface

Ask tools:

- `research_sources`: list saved snapshots or inspect one source.
- `research_create_investigation`: preserve a plan and pin source references.
- `research_run_investigation`: freeze and execute the exact inspected revision.
- `research_inspect_investigation`: list saved investigations or inspect an exact record.

Owner-local API:

| Endpoint | Operation |
| --- | --- |
| `GET /api/research/investigations` | List saved investigation summaries and method limits |
| `POST /api/research/investigations` | Create with `{protocol}` |
| `GET /api/research/investigations/:id` | Inspect bounded saved record |
| `POST /api/research/investigations/:id/run` | Run with the inspected `{revision}` |
| `GET /api/research/investigations/:id/export` | Download complete JSON evidence |
| `GET /api/research/investigations/:id/archive` | Download frozen executable ZIP after evaluation |

Ask renders only explicitly allowed local study export links; arbitrary model-generated URLs remain plain text. This does not add another research screen or replace the existing terminal visual system.

## Acceptance evidence and next delivery

Tests exercise two different graphs through the actual Ask handler with a synthetic model and imported fixtures: a revenue-minus-cost join/difference/summary and a threshold-filtered summary. The hand-worked first example has differences 7 and 12, mean 9.5 and n=2. These are explicit synthetic verification values, not market findings.

Additional cases cover unsupported causal plans, family narrowing, inherited context, controlled memory, sourcing, scheduled-tool denial, stateful-cache replay, vintages before filtering, duplicate joins, units, missing values, numeric overflow, large provenance, conservative timing, idempotency, cross-connection conflict, worker failure/cancellation, API methods/origins, offline archive replay and backup/restore corruption.

The engineering acceptance is distinct from live-model research quality. No live-provider question benchmark, historical completeness audit or empirical investment result is established by these fixtures.

Release verification: all 1,127 tests passed with `INTEL_TEST=1 node --test --test-concurrency=1 'test/*.test.mjs'`; TypeScript/production build and repository formatting checks passed. Independent read-only review covered family preservation, memory/sourcing/cache boundaries, time and arithmetic semantics, recovery and replay. The export links passed rendered React safety checks and the scoped UI detector reported no findings. New production modules are at most 276 formatted lines; no boundary exceptions were added.

The next dependent delivery is [historical evidence acquisition](historical-corpus.md): discover and preserve official originals with measured coverage, then connect them through typed evidence adapters. Broader transformations and independently validated methods can extend the same graph. Custom scientific scripts require the isolated runtime and acceptance gates in [sandbox.md](sandbox.md).
