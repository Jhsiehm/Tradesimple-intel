export const observation = (id, value, extra = {}) => ({
  id,
  entityId: "jurisdiction:US",
  metric: "inflation",
  unit: "percent",
  value,
  eventAt: "2024-01-10",
  availableAt: "2024-01-10T13:30:00Z",
  ...extra,
});
export const source = (snapshotId, rows, mode = "first-publication") => ({
  snapshotId,
  mode,
  rows,
  provenance: { basis: "synthetic test fixture, not real historical coverage" },
  coverage: { received: rows.length, completeness: "not-certified" },
  decisions: [],
});
export const protocol = (
  nodes = [{ id: "observed", op: "source", snapshotId: "obs_actual", mode: "first-publication" }],
  extra = {},
) => ({
  title: "Descriptive composition fixture",
  question: "What is the observed difference?",
  hypothesis: "The selected observations differ.",
  family: "descriptive",
  population: "Explicit synthetic observations",
  unitOfAnalysis: "one entity-release",
  outcome: "difference in reported numeric values",
  comparison: "paired records, no inferential claim",
  from: "2024-01-01",
  to: "2024-12-31",
  knownAt: "2024-12-31T23:59:59Z",
  assumptions: ["Synthetic arithmetic only"],
  unresolved: [],
  nodes,
  outputs: [nodes.at(-1)?.id].filter(Boolean),
  ...extra,
});
export function macroExample() {
  const nodes = [
    { id: "actual", op: "source", snapshotId: "obs_actual", mode: "first-publication" },
    { id: "consensus", op: "source", snapshotId: "obs_forecast", mode: "first-publication" },
    {
      id: "paired",
      op: "join",
      left: "actual",
      right: "consensus",
      keys: [{ left: "releaseId", right: "releaseId" }],
      how: "inner",
    },
    { id: "surprises", op: "difference", input: "paired", left: "value", right: "right_value", output: "surprise" },
    { id: "summary", op: "summarize", input: "surprises", value: "surprise", groupBy: ["entityId"] },
  ];
  const actual = [
    observation("a1", 3, { releaseId: "r1" }),
    observation("a2", 4, { releaseId: "r2" }),
    observation("a3", 0, { releaseId: "r3" }),
  ];
  const forecast = [
    observation("f1", 2, { releaseId: "r1", metric: "consensus" }),
    observation("f2", 2, { releaseId: "r2", metric: "consensus" }),
    observation("f3", 1, { releaseId: "r3", metric: "consensus" }),
  ];
  return {
    protocol: protocol(nodes),
    sources: { actual: source("obs_actual", actual), consensus: source("obs_forecast", forecast) },
  };
}
