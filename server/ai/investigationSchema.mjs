const str = (description) => ({ type: "string", description });
const strings = (description) => ({ type: "array", items: str(description), maxItems: 20 });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const ref = str("An earlier node ID, or an explicit own-property field name as appropriate.");

export const INVESTIGATION_PROTOCOL_SCHEMA = object({
  title: str("Short study title."),
  question: str("Original research question. The server preserves the actual current user question."),
  hypothesis: str("Operational hypothesis, with the intended claim preserved."),
  family: { type: "string", enum: ["descriptive", "predictive", "causal", "strategy", "document"] },
  population: str("Target population and its selection rules."),
  unitOfAnalysis: str("Unit at which observations are compared."),
  outcome: str("Precisely defined outcome and units."),
  comparison: str("Comparison or baseline; explicitly state if none."),
  from: {
    type: ["string", "null"],
    description: "First event/measurement date, YYYY-MM-DD; null only for a blocked design with an unknown period.",
  },
  to: {
    type: ["string", "null"],
    description: "Last event/measurement date, YYYY-MM-DD; null only for a blocked design with an unknown period.",
  },
  knownAt: {
    type: ["string", "null"],
    description:
      "UTC knowledge cutoff; null only for a blocked design with unresolved timing. Availability assertions remain unverified.",
  },
  assumptions: strings(
    "Material assumption and its rationale. For a retrospective descriptive summary of an explicitly selected saved sample, retain unverified publication dates, historical entity mapping, and sample-selection limits here. They limit interpretation but do not prevent arithmetic over those saved rows.",
  ),
  unresolved: strings(
    "Only requirements whose absence prevents the requested calculation or claim. Use [] for a fully specified descriptive summary over an existing saved numeric snapshot. Plan-only is not a blocker. A bounded inspection preview does not mean the remaining frozen rows are missing. Unverified original publication or historical ownership belongs in assumptions for retrospective selected-sample descriptions; it is a blocker for historical trading or causal claims.",
  ),
  nodes: {
    type: "array",
    maxItems: 16,
    items: {
      oneOf: [
        object({
          id: ref,
          op: { const: "source", type: "string" },
          snapshotId: str("Exact saved obs_ snapshot ID."),
          mode: { type: "string", enum: ["first-publication", "latest-known"] },
        }),
        object({
          id: ref,
          op: { const: "filter", type: "string" },
          input: ref,
          field: ref,
          operator: { type: "string", enum: ["eq", "ne", "gt", "gte", "lt", "lte"] },
          value: { type: ["string", "number", "boolean", "null"] },
        }),
        object({
          id: ref,
          op: { const: "join", type: "string" },
          left: ref,
          right: ref,
          keys: { type: "array", minItems: 1, maxItems: 4, items: object({ left: ref, right: ref }) },
          how: { type: "string", enum: ["inner", "left"] },
        }),
        object({
          id: ref,
          op: { const: "difference", type: "string" },
          input: ref,
          left: ref,
          right: ref,
          output: ref,
        }),
        object({
          id: ref,
          op: { const: "summarize", type: "string" },
          input: ref,
          value: str(
            "Exact numeric column name from inspected fields, usually value for source observations. The metric label such as selected_contract_obligation is not a numeric column name.",
          ),
          groupBy: strings("Exact group field name; preserve metric and unit compatibility."),
        }),
      ],
    },
  },
  outputs: strings("Node ID to expose as a final output."),
});
