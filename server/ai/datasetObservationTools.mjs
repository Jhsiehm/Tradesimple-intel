import { prepareContractObservations } from "../domain/contractObservationAdapter.mjs";
import { interpretResearch } from "../../shared/researchIntent.mjs";

export const DATASET_OBSERVATION_TOOLS = [
  {
    name: "research_prepare_dataset_observations",
    label: "Prepare saved contract observations",
    description:
      "Prepare an immutable numeric observation snapshot from one exact compatible saved contract dataset listed by research_sources. Reuses only its selected positive-obligation signals, preserving source lineage and actual collector first-observation times; not the full transaction population or verified publication timing. Collects no new data and runs no analysis. May prepare sources for a requested plan, but unavailable for inspection-only requests. Never supply or invent numeric rows.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        datasetId: { type: "string", description: "Exact ds_ ID from research_sources.compatibleDatasets." },
      },
      required: ["datasetId"],
    },
    run(db, args, _call, context) {
      if (!context?.question) throw Error("An original user request is required to prepare saved observations.");
      const intent = context.intent || interpretResearch(context.question);
      if (intent.inspectionOnly) throw Error("This task requests inspection only; do not save prepared observations.");
      return prepareContractObservations(db, args.datasetId);
    },
  },
];
