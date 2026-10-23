/** Bounded retrospective reuse of saved selected contract signals; never a provider fetch. */
import { getDataset, listDatasets, hashOf } from "./research-store.mjs";
import { importObservations, prepareObservations } from "./research-observations.mjs";

export function contractObservationInput(dataset) {
  if (!dataset || dataset.sourceFamily !== "contracts" || dataset.format !== "evidence")
    throw Error("Choose a saved contract evidence dataset.");
  if (!Array.isArray(dataset.events) || !dataset.events.length)
    throw Error("This dataset has no selected contract signals to prepare.");
  if (typeof dataset.rawContent !== "string" || hashOf(dataset.rawContent) !== dataset.rawHash)
    throw Error("Contract source checksum mismatch.");
  if (hashOf({ manifest: dataset.manifest, events: dataset.events }) !== dataset.contentHash)
    throw Error("Contract selection checksum mismatch.");
  const limits = [
    "Only the saved positive-obligation, cooldown-selected signals are included; this is not the full transaction population.",
    "Availability is the collector's recorded first-observation time, not original public availability. Original assumed signal dates remain in lineage only.",
    "Retrospective descriptive use only; no historical tradability, causal effect or predictive validity is established.",
    ...(dataset.caveats || []),
  ];
  const items = dataset.events.map((event) => {
    if (!event.original?.firstObservedAt || !Number.isFinite(event.value) || event.value <= 0)
      throw Error("Each selected contract requires a recorded first-observation time and positive numeric obligation.");
    return {
      id: event.id,
      observationId: event.id,
      entityId: event.entity?.companyId || event.entity?.securityId,
      metric: "selected_contract_obligation",
      unit: "USD",
      value: event.value,
      eventAt: event.eventAt,
      availableAt: event.original.firstObservedAt,
      sourceUrl: event.sourceUrl,
      lineage: {
        datasetId: dataset.id,
        contentHash: dataset.contentHash,
        rawHash: dataset.rawHash,
        originalSignal: event,
      },
    };
  });
  return {
    name: `Selected contract obligations · ${dataset.id}`,
    source: "Saved USAspending contract evidence; selected sample; collector-observed timing only",
    ownership: "Owner-local saved research evidence; original dataset ownership assertions retained",
    license:
      "Source usage conditions remain those of the original saved evidence; this conversion grants no new rights.",
    format: "json",
    content: JSON.stringify({
      items,
      provenance: {
        adapter: "selected-contract-observations-v1",
        datasetId: dataset.id,
        contentHash: dataset.contentHash,
        rawHash: dataset.rawHash,
        manifest: dataset.manifest,
        limits,
      },
    }),
  };
}

export function listCompatibleContractDatasets(db) {
  return listDatasets(db).flatMap((brief) => {
    try {
      const dataset = getDataset(db, brief.id);
      const input = contractObservationInput(dataset);
      const preview = prepareObservations(input);
      if (!preview.ok) return [];
      return [
        {
          ...brief,
          selectedRows: dataset.events.length,
          underlyingReceived: dataset.coverage?.received ?? null,
          metric: "selected_contract_obligation",
          unit: "USD",
          scope: "Selected positive-obligation signals only; not all transactions",
          availability: "Collector first-observed time, not verified publication",
          sourceDatasetCaveats: dataset.caveats || [],
        },
      ];
    } catch {
      return [];
    }
  });
}

export function prepareContractObservations(db, datasetId) {
  const dataset = getDataset(db, datasetId);
  const input = contractObservationInput(dataset);
  const result = importObservations(db, input);
  if (!result.ok)
    throw Error(`Saved contract observations failed validation: ${result.errors.map((e) => e.message).join(" ")}`);
  const { provenance } = JSON.parse(input.content);
  return {
    ok: true,
    source: input.source,
    snapshot: {
      id: result.snapshot.id,
      name: result.snapshot.name,
      contentHash: result.snapshot.contentHash,
      coverage: result.snapshot.coverage,
      fields: [...new Set(result.snapshot.events.flatMap(Object.keys))],
      preview: result.snapshot.events.slice(0, 10),
      totalRows: result.snapshot.events.length,
    },
    provenance,
    message:
      "Saved selected numeric observations. No analysis was executed. Use this exact snapshot ID in a descriptive plan.",
  };
}
