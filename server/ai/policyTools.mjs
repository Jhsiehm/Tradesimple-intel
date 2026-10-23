import {
  createPolicyInvestigation,
  getPolicyInvestigation,
  listPolicyInvestigations,
  collectPolicyInvestigation,
  evaluatePolicyInvestigation,
} from "../domain/policy/investigations.mjs";
import { replayPolicyInvestigation } from "../domain/policy/replay.mjs";
import { interpretResearch } from "../../shared/researchIntent.mjs";
import { researchExecutionRefusal } from "../../shared/researchExecutionScope.mjs";
import { POLICY_PROTOCOL_SCHEMA } from "./policySchema.mjs";

const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", description: "Exact saved policy_ investigation ID." };
const revision = { type: "integer", minimum: 1, description: "Exact revision returned by inspection; never guess." };
const mutation = object({ id, revision }, ["id", "revision"]);
export const POLICY_TOOL_NAMES = new Set([
  "research_policy_create",
  "research_policy_inspect",
  "research_policy_collect",
  "research_policy_evaluate",
  "research_policy_replay",
]);
export const POLICY_WRITE_TOOL_NAMES = new Set([
  "research_policy_create",
  "research_policy_collect",
  "research_policy_evaluate",
]);

function guard(context, action) {
  if (!context?.question) throw Error("An original user question is required for policy research actions.");
  context.signal?.throwIfAborted();
  const intent = context.intent || interpretResearch(context.question);
  const refusal = researchExecutionRefusal(
    intent,
    action === "create" ? "research_create_investigation" : "research_run_investigation",
  );
  if (refusal) throw Error(refusal);
  return intent;
}

const pick = (value, keys) =>
  Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));
// Defense in depth: all preview strings/collections are bounded and raw records never enter chat.
function preview(value, depth = 0) {
  if (typeof value === "string")
    return value.length > 2000 ? value.slice(0, 2000) + "… [truncated; export contains full value]" : value;
  if (!value || typeof value !== "object") return value;
  if (depth >= 6) return "[nested detail omitted; inspect export]";
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => preview(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["payload", "raw", "body", "inputs", "engineFiles"].includes(key))
      .slice(0, 60)
      .map(([key, item]) => [key, preview(item, depth + 1)]),
  );
}
function savedClaimFamily(question) {
  const family = interpretResearch(question).family;
  // The generic router treats any bill+returns question as strategy; explicit descriptions can be narrower.
  if (
    family === "strategy" &&
    /\b(?:descriptive|describe|summarize)\b/i.test(question) &&
    !/\b(?:strateg\w*|trad(?:e|es|ing)|back-?test|profit\w*|invest\w*|edge|outperform\w*|predict\w*|caus\w*)\b/i.test(
      question,
    )
  )
    return "descriptive";
  return family;
}

// Keep source receipts inspectable without sending minute bars or raw provider payloads to the model.
export function policyInvestigationSummary(investigation) {
  const evidence = investigation.evidence || {};
  const counts = Object.fromEntries(
    ["events", "news", "exposures", "bars", "newsCoverage", "sources"].map((kind) => [
      kind,
      (evidence[kind] || []).length,
    ]),
  );
  const result = investigation.result;
  return {
    ...pick(investigation, [
      "schemaVersion",
      "id",
      "revision",
      "status",
      "createdAt",
      "updatedAt",
      "protocol",
      "protocolHash",
      "lastError",
    ]),
    evaluation: investigation.evaluation
      ? pick(investigation.evaluation, ["inputHash", "resultHash", "engineHash", "evaluatedAt", "revision"])
      : null,
    evidence: {
      counts,
      sources: preview((evidence.sources || []).slice(0, 20)),
      events: preview((evidence.events || []).slice(0, 10)),
      news: preview((evidence.news || []).slice(0, 10)),
      newsCoverage: preview((evidence.newsCoverage || []).slice(0, 10)),
      manifest: evidence.manifest ? preview(evidence.manifest) : null,
      gaps: preview((evidence.gaps || []).slice(0, 30)),
      previewLimit: 10,
      notice:
        "Evidence previews are bounded. Full evidence and price bars remain in the saved export; counts report all saved rows.",
    },
    readiness: investigation.readiness
      ? preview(pick(investigation.readiness, ["ready", "gaps", "asOf", "counts", "claimCeiling"]))
      : null,
    result: result
      ? {
          ...preview(
            pick(result, [
              "schemaVersion",
              "asOf",
              "status",
              "executed",
              "claimCeiling",
              "counts",
              "summary",
              "limitations",
            ]),
          ),
          rows: preview((result.rows || []).slice(0, 20)),
          exclusions: preview((result.exclusions || []).slice(0, 20)),
          gaps: preview((result.gaps || []).slice(0, 30)),
          previewLimit: 20,
          totalRows: (result.rows || []).length,
          totalExclusions: (result.exclusions || []).length,
        }
      : null,
  };
}
const wrapped = (investigation) => ({
  ok: true,
  source: "Saved policy investigation",
  asOf: investigation.updatedAt,
  policyInvestigation: policyInvestigationSummary(investigation),
  latency:
    "Saved evidence and conditional descriptive calculations. No causal, predictive, portfolio-performance or investable-edge claim is established.",
  downloads: {
    json: `/api/research/policy/${investigation.id}/export`,
    archive: investigation.evaluation ? `/api/research/policy/${investigation.id}/archive` : null,
  },
});
function inspected(db, args) {
  if (!Number.isInteger(args.revision) || args.revision < 1) throw Error("Provide the exact inspected revision.");
  const investigation = getPolicyInvestigation(db, args.id);
  if (investigation.revision !== args.revision)
    throw Error("This investigation changed. Inspect it before trying again.");
  return investigation;
}
export const POLICY_TOOLS = [
  {
    name: "research_policy_create",
    label: "Save policy research plan",
    description:
      "Save a locked paired legislative-event versus news-entry protocol. Preserve the original question. Requires explicit dates, verified bill IDs, universe and material assumptions; ask for missing choices. This specialized pilot is not a general causal, predictive or strategy engine. No evidence is invented or imported. Saving is not execution.",
    parameters: object({ protocol: POLICY_PROTOCOL_SCHEMA }, ["protocol"]),
    async run(db, args, _call, context) {
      const intent = guard(context, "create");
      const question = intent.contextQuestion
        ? `${intent.contextQuestion}\n\nFollow-up: ${context.question}`
        : context.question;
      return wrapped(await createPolicyInvestigation(db, { ...args.protocol, question }));
    },
  },
  {
    name: "research_policy_inspect",
    label: "Inspect policy investigation",
    description:
      "List latest saved policy investigations or inspect an exact policy_ ID, its locked plan, evidence counts, gaps, bounded result previews and export links. Does not collect or calculate. Expand via the JSON export for full evidence.",
    parameters: object({ id }),
    run(db, args) {
      return args.id
        ? wrapped(getPolicyInvestigation(db, args.id))
        : { ...listPolicyInvestigations(db), source: "Saved policy investigation inventory", limit: 100 };
    },
  },
  {
    name: "research_policy_collect",
    label: "Collect cited policy evidence",
    description:
      "Collect cited legislative actions and bounded news discovery for the inspected locked policy protocol. Provider failures remain evidence gaps. Does not manufacture prices, exposures or news completeness. Requires exact revision. Not permitted for design-only or inspection-only tasks.",
    parameters: mutation,
    async run(db, args, _call, context) {
      guard(context, "collect");
      inspected(db, args);
      return wrapped(
        await collectPolicyInvestigation(db, args.id, { revision: args.revision, signal: context.signal }),
      );
    },
  },
  {
    name: "research_policy_evaluate",
    label: "Evaluate conditional policy study",
    description:
      "Evaluate and freeze this exact inspected protocol using real saved evidence, or save explicit insufficiency findings. Only conditional paired event-return comparisons are implemented, not causal, predictive or portfolio strategy results. Requires exact revision and a compatible user question.",
    parameters: mutation,
    async run(db, args, _call, context) {
      const intent = guard(context, "evaluate");
      const saved = inspected(db, args);
      if (
        [intent.family, savedClaimFamily(saved.protocol.question)].some((family) =>
          ["causal", "predictive", "strategy"].includes(family),
        )
      )
        throw Error(
          "This pilot only supports conditional descriptive paired event returns. Preserve the requested claim; ask the user to explicitly choose and save a new narrower descriptive question before evaluating.",
        );
      return wrapped(
        await evaluatePolicyInvestigation(db, args.id, { revision: args.revision, signal: context.signal }),
      );
    },
  },
  {
    name: "research_policy_replay",
    label: "Verify frozen policy calculation",
    description:
      "Recompute a frozen policy evaluation to verify deterministic numeric equality. This does not refresh sources, establish evidence accuracy or certify the original claim. Requires exact inspected revision; not permitted in design-only or inspection-only tasks.",
    parameters: mutation,
    async run(db, args, _call, context) {
      guard(context, "replay");
      const investigation = inspected(db, args);
      const replay = await replayPolicyInvestigation(db, args.id, { signal: context.signal });
      context.signal?.throwIfAborted();
      return { ...wrapped(investigation), replay };
    },
  },
];
