import { listObservations, getObservations } from "../domain/research-observations.mjs";
import {
  createInvestigation,
  getInvestigation,
  listInvestigations,
  runInvestigation,
} from "../domain/workflow/investigations.mjs";
import { INVESTIGATION_PROTOCOL_SCHEMA } from "./investigationSchema.mjs";
import { interpretResearch } from "../../shared/researchIntent.mjs";

const object = (properties, required = []) => ({ type: "object", additionalProperties: false, properties, required });
const id = { type: "string", description: "Exact saved inv_ investigation ID." };
const wrapped = (investigation) => ({
  ok: true,
  source: "Saved research investigation",
  asOf: investigation.evaluation?.evaluatedAt || investigation.updatedAt || investigation.createdAt || "",
  latency: "Saved local-owner protocol/result; source assertions and historical completeness remain unverified.",
  investigation,
  protocolLifecycle:
    "Saved protocols are immutable. A blocked design does not automatically become executable after import; create a new resolved protocol with actual snapshot IDs and required design choices, then execute it.",
  downloads: {
    json: `/api/research/investigations/${investigation.id}/export`,
    archive: investigation.archiveAvailable ? `/api/research/investigations/${investigation.id}/archive` : null,
  },
});

export const INVESTIGATION_TOOLS = [
  {
    name: "research_sources",
    label: "Research source inventory",
    description:
      "List up to 200 saved numeric observation snapshots, or inspect one exact snapshot's fields, coverage, source conditions and first 10 rows. No new data is collected. Importer assertions and unaudited history remain limits. IDs are needed for a composed study; never invent them.",
    parameters: object({ snapshotId: { type: "string", description: "Optional exact obs_ ID to inspect." } }),
    run(db, args) {
      if (!args.snapshotId)
        return {
          ok: true,
          source: "Saved observation inventory",
          items: listObservations(db),
          limit: 200,
          coverage: "Latest saved snapshots only; not an exhaustive source or historical coverage census.",
        };
      const snapshot = getObservations(db, args.snapshotId);
      return {
        ok: true,
        source: snapshot.source,
        asOf: snapshot.createdAt,
        snapshot: {
          id: snapshot.id,
          name: snapshot.name,
          contentHash: snapshot.contentHash,
          version: snapshot.version,
          fields: [...new Set(snapshot.events.flatMap(Object.keys))],
          coverage: snapshot.coverage,
          ownership: snapshot.ownership,
          license: snapshot.license,
          caveats: snapshot.caveats,
          preview: snapshot.events.slice(0, 10),
          totalRows: snapshot.events.length,
        },
      };
    },
  },
  {
    name: "research_create_investigation",
    label: "Save research design",
    description:
      "Save an immutable general investigation protocol and composed workflow over exact saved observations. Retain the requested family and record missing requirements. Descriptive operations can execute; causal/predictive/strategy/document plans remain blocked until supported. A blocked design cannot automatically resume after import: create a new resolved protocol. Saving is not execution. Never submit invented rows. Render downloads.json as an exact Markdown link; offer downloads.archive only when non-null.",
    parameters: object({ protocol: INVESTIGATION_PROTOCOL_SCHEMA }, ["protocol"]),
    run(db, args, _call, context) {
      if (!context?.question) throw Error("An original user question is required to create a study through Ask.");
      const intent = context.intent || interpretResearch(context.question);
      if (intent.route === "assessment" && intent.family !== "descriptive" && args.protocol?.family === "descriptive") {
        throw Error(
          "Preserve the requested " +
            intent.family +
            " family and record unsupported requirements. A descriptive plan cannot silently replace this question.",
        );
      }
      const question = intent.contextQuestion
        ? intent.contextQuestion + "\n\nFollow-up: " + context.question
        : context.question;
      return wrapped(createInvestigation(db, { ...args.protocol, question }));
    },
  },
  {
    name: "research_run_investigation",
    label: "Execute research workflow",
    description:
      "Freeze actual saved source snapshots and run this exact composed descriptive protocol. Provide the inspected revision. Unsupported families or unresolved requirements return a saved gap finding. No causal, predictive or strategy result is established.",
    parameters: object(
      { id, revision: { type: "integer", minimum: 1, description: "Exact inspected investigation revision." } },
      ["id", "revision"],
    ),
    run: async (db, args, _call, context) =>
      wrapped(await runInvestigation(db, args.id, { revision: args.revision, signal: context?.signal })),
  },
  {
    name: "research_inspect_investigation",
    label: "Inspect saved study",
    description:
      "With no ID list up to 100 latest saved investigations. With an exact ID inspect its protocol, output summaries, exclusions and claim limits. Does not run or refresh evidence. Export URLs identify frozen inputs and replay artifacts when available.",
    parameters: object({ id }),
    run(db, args) {
      if (!args.id)
        return {
          ...listInvestigations(db),
          source: "Saved research investigation inventory",
          latency: "Latest 100 saved investigations; not a source coverage census.",
        };
      const investigation = getInvestigation(db, args.id);
      if (!investigation) throw Error("Investigation not found.");
      return wrapped(investigation);
    },
  },
];
