import { importObservations } from "../../server/domain/research-observations.mjs";

export function investigationFixture(db) {
  const save = (name, metric, values) =>
    importObservations(db, {
      name,
      source: "Explicit synthetic integration fixture",
      ownership: "Test only",
      license: "Test fixture",
      format: "json",
      content: JSON.stringify(
        values.map((value, index) => ({
          id: name + index,
          entityId: "issuer:" + ["AAA", "BBB"][index],
          metric,
          unit: "USD million",
          value,
          eventAt: "2025-02-01",
          availableAt: "2025-02-02",
          sourceUrl: "https://example.com/" + name,
        })),
      ),
    }).snapshot;
  const revenue = save("Revenue", "revenue", [12, 20]),
    costs = save("Costs", "operating costs", [5, 8]);
  const question = "Describe operating surplus across the two saved companies using revenue less operating costs.";
  const protocol = {
    title: "Saved company operating surplus",
    question,
    hypothesis: "Compare reported revenue less operating costs.",
    family: "descriptive",
    population: "The two explicitly saved issuers",
    unitOfAnalysis: "issuer-period",
    outcome: "Revenue less operating costs in USD million",
    comparison: "Operating costs from the same issuer-period",
    from: "2025-01-01",
    to: "2025-12-31",
    knownAt: "2026-01-01T00:00:00Z",
    assumptions: ["These synthetic values test arithmetic and integration, not financial findings."],
    unresolved: [],
    nodes: [
      { id: "revenue", op: "source", snapshotId: revenue.id, mode: "first-publication" },
      { id: "costs", op: "source", snapshotId: costs.id, mode: "first-publication" },
      {
        id: "paired",
        op: "join",
        left: "revenue",
        right: "costs",
        keys: [
          { left: "entityId", right: "entityId" },
          { left: "eventAt", right: "eventAt" },
        ],
        how: "inner",
      },
      { id: "surplus", op: "difference", input: "paired", left: "value", right: "right_value", output: "surplus" },
      { id: "summary", op: "summarize", input: "surplus", value: "surplus", groupBy: [] },
    ],
    outputs: ["surplus", "summary"],
  };
  return { revenue, costs, question, protocol };
}
