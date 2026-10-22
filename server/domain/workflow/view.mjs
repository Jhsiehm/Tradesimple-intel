/** Bounded inspection summaries; full inputs, originals and ledgers require explicit export. */
const scalars = (value) =>
  Object.fromEntries(
    Object.entries(value || {}).filter(
      ([, field]) => field === null || ["string", "number", "boolean"].includes(typeof field),
    ),
  );
function briefRow(row) {
  return {
    ...scalars(row),
    ...(row.groupValues ? { groupValues: scalars(row.groupValues) } : {}),
    ...(Array.isArray(row.lineage)
      ? {
          lineageCount: row.lineage.length,
          lineagePreview: row.lineage.slice(0, 5).map(scalars),
        }
      : {}),
    ...(Array.isArray(row.memberIds)
      ? {
          memberCount: row.memberIds.length,
          memberPreview: row.memberIds.slice(0, 10),
        }
      : {}),
  };
}
function briefStep(step) {
  const audit = step.ledger || {};
  const ledger = { ...scalars(audit) };
  for (const [key, value] of Object.entries(audit))
    if (Array.isArray(value)) {
      ledger[`${key}Count`] = value.length;
      ledger[`${key}Preview`] = value.slice(0, 10).map((item) => (typeof item === "object" ? scalars(item) : item));
    }
  const source = step.source;
  const decisionCounts = {};
  for (const decision of source?.decisions || [])
    decisionCounts[decision.reason] = (decisionCounts[decision.reason] || 0) + 1;
  return {
    ...scalars(step),
    ledger,
    ...(source
      ? {
          source: {
            snapshotId: source.snapshotId,
            mode: source.mode,
            coverage: source.coverage,
            provenance: { ...scalars(source.provenance), caveats: source.provenance?.caveats?.slice(0, 10) || [] },
            decisionCounts,
            decisionPreview: (source.decisions || []).slice(0, 10).map(scalars),
          },
        }
      : {}),
  };
}

export function workflowView(record) {
  const { evaluation, result, ...rest } = record;
  return {
    ...rest,
    executed: Boolean(result?.executed),
    archiveAvailable: Boolean(evaluation),
    result: result
      ? {
          version: result.version,
          status: result.status,
          executed: result.executed,
          claimScope: result.claimScope,
          gaps: result.gaps,
          limitations: result.limitations,
          outputs: Object.fromEntries(
            Object.entries(result.outputs).map(([id, output]) => [
              id,
              {
                rowCount: output.rows?.length || 0,
                preview: (output.rows || []).slice(0, 5).map(briefRow),
              },
            ]),
          ),
          steps: (result.steps || []).map(briefStep),
        }
      : null,
    evaluation: evaluation
      ? {
          baseRevision: evaluation.baseRevision,
          evaluatedAt: evaluation.evaluatedAt,
          inputHash: evaluation.inputHash,
          resultHash: evaluation.resultHash,
          engineHash: evaluation.engineHash,
          originalsHash: evaluation.originalsHash,
        }
      : null,
  };
}
