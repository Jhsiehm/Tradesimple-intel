const idPatterns = { experimentIds: /^exp_[a-f0-9]{32}$/, datasetIds: /^ds_[a-f0-9]{32}$/ };
const normalized = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");

export function auditSelection(args) {
  const allowed = [...Object.keys(idPatterns), "studyNames"];
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !allowed.includes(k)))
    throw Error("Choose exact saved experimentIds, datasetIds or studyNames.");
  const keys = Object.keys(args);
  if (keys.length > 1) throw Error("Choose only one saved-study selector.");
  if (!keys.length) return { kind: "latest-per-dataset", ids: [] };
  const kind = keys[0],
    values = args[kind];
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.length > 4 ||
    values.some(
      (v) =>
        typeof v !== "string" ||
        (kind === "studyNames"
          ? !v.trim() || v.length > 120 || /[\u0000-\u001f\u007f]/.test(v)
          : !idPatterns[kind].test(v)),
    ) ||
    new Set(values.map(normalized)).size !== values.length
  )
    throw Error("Select 1–4 distinct exact saved IDs or study names.");
  return { kind, ids: values.map((v) => (kind === "studyNames" ? v.trim() : v)) };
}
function latestPerDataset(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.datasetId || row.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function namedMatches(rows, requested) {
  const name = normalized(requested);
  const titleMatches = rows.filter((row) => [row.title, row.datasetName].some((title) => normalized(title) === name));
  const matches = titleMatches.length
    ? titleMatches
    : rows.filter((row) => row.symbols.some((s) => normalized(s) === name));
  const candidates = latestPerDataset(matches);
  return {
    requested,
    status: candidates.length === 1 ? "matched" : candidates.length ? "ambiguous" : "unmatched",
    selectedId: candidates.length === 1 ? candidates[0].id : null,
    candidateIds: candidates.slice(0, 8).map((row) => row.id),
    candidateCount: candidates.length,
  };
}
/** Bounded metadata resolution; ambiguous or absent names never fall back to unrelated records. */
export function discoverAuditStudies(choice, rows) {
  const candidates = latestPerDataset(rows.filter((row) => row.datasetId));
  const resolution = choice.kind === "studyNames" ? choice.ids.map((name) => namedMatches(rows, name)) : [];
  const selectedIds =
    choice.kind === "studyNames"
      ? [...new Set(resolution.flatMap((item) => (item.selectedId ? [item.selectedId] : [])))]
      : choice.kind === "datasetIds"
        ? choice.ids.map((key) => candidates.find((row) => row.datasetId === key)?.id).filter(Boolean)
        : candidates.slice(0, 4).map((row) => row.id);
  return {
    selectedIds,
    discovery: {
      scope:
        "Latest 500 saved experiment metadata rows; exact title/dataset-name or ticker matching only. Ambiguous names require exact IDs; no unrelated replacement.",
      scanned: rows.length,
      scanLimit: 500,
      omittedCandidates: candidates.filter((row) => !selectedIds.includes(row.id)).length,
      unpinnedExperimentsNotSelected: rows.filter((row) => !row.datasetId && !selectedIds.includes(row.id)).length,
      otherCandidateIds: candidates
        .filter((row) => !selectedIds.includes(row.id))
        .slice(0, 8)
        .map((row) => row.id),
      datasetsWithoutStudyInScope:
        choice.kind === "datasetIds"
          ? choice.ids.filter((key) => !candidates.some((row) => row.datasetId === key))
          : [],
      requestedNames: resolution,
      unresolvedNames: resolution.filter((item) => item.status !== "matched").map((item) => item.requested),
      limitation:
        "No match in this bounded inventory does not establish that a study never existed. Exact IDs bypass discovery.",
    },
  };
}
