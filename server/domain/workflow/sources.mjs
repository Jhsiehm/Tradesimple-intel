import { getObservations, resolveObservations, verifyObservationComposition } from "../research-observations.mjs";
import { timestamp } from "../research-events.mjs";
import { hashOf } from "../research-store.mjs";

export const SOURCE_BYTES = 16 * 1024 * 1024;

/** Scalar normalized observations only; originals remain intact in the separate frozen snapshots. */
export function projectSnapshot(snapshot, node, knownAt) {
  const resolution = resolveObservations(snapshot, { mode: node.mode, knownAt });
  return {
    snapshotId: snapshot.id,
    mode: node.mode,
    rows: resolution.items.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value),
        ),
      ),
    ),
    provenance: {
      snapshotId: snapshot.id,
      snapshotHash: hashOf(snapshot),
      contentHash: snapshot.contentHash,
      version: snapshot.version,
      source: snapshot.source,
      ownership: snapshot.ownership,
      license: snapshot.license,
      availabilityBasis: snapshot.availabilityBasis,
      knownAt: resolution.knownAt,
      caveats: [...(snapshot.caveats || []), ...resolution.caveats],
    },
    coverage: resolution.coverage,
    decisions: resolution.decisions,
  };
}

export function pinSources(db, protocol) {
  const refs = [],
    issues = [];
  for (const node of protocol.nodes.filter((node) => node.op === "source")) {
    let snapshot;
    try {
      snapshot = getObservations(db, node.snapshotId);
    } catch (error) {
      if (error.message !== "Observation snapshot not found.") throw error;
      issues.push({ nodeId: node.id, snapshotId: node.snapshotId, code: "missing-source", message: error.message });
      continue;
    }
    refs.push({
      nodeId: node.id,
      snapshotId: snapshot.id,
      mode: node.mode,
      snapshotHash: hashOf(snapshot),
      contentHash: snapshot.contentHash,
      version: snapshot.version,
    });
  }
  return { refs, issues };
}

export function freezeSources(db, protocol, refs) {
  const originals = {},
    sources = {};
  const resolve = protocol.family === "descriptive" && protocol.unresolved.length === 0;
  for (const ref of refs) {
    const snapshot = getObservations(db, ref.snapshotId);
    if (hashOf(snapshot) !== ref.snapshotHash) throw Error("Workflow source differs from its pinned snapshot.");
    originals[snapshot.id] = snapshot;
    const node = protocol.nodes.find((node) => node.id === ref.nodeId);
    if (resolve) sources[node.id] = projectSnapshot(snapshot, node, protocol.knownAt);
  }
  if (Buffer.byteLength(JSON.stringify(originals)) > SOURCE_BYTES)
    throw Error("Workflow original snapshots exceed 16 MiB. Narrow or split the study.");
  return { sources, originals };
}

/** Verify exact originals and source decisions; callback is used only for drafts in a live store/backup. */
export function verifySourceReferences(record, lookupSnapshot) {
  const nodes = record.protocol.nodes.filter((node) => node.op === "source");
  if (
    !Array.isArray(record.sourceRefs) ||
    !Array.isArray(record.sourceIssues) ||
    record.sourceRefs.length + record.sourceIssues.length !== nodes.length
  )
    throw Error("Workflow source manifest mismatch.");
  const covered = new Set();
  for (const ref of [...record.sourceRefs, ...record.sourceIssues]) {
    const node = nodes.find((node) => node.id === ref.nodeId);
    if (!node || covered.has(ref.nodeId) || node.snapshotId !== ref.snapshotId)
      throw Error("Workflow source identity mismatch.");
    covered.add(ref.nodeId);
  }
  for (const issue of record.sourceIssues)
    if (issue.code !== "missing-source") throw Error("Workflow source issue is invalid.");
  const frozen = record.evaluation;
  const resolve = record.protocol.family === "descriptive" && record.protocol.unresolved.length === 0;
  if (frozen && Buffer.byteLength(JSON.stringify(frozen.originals)) > SOURCE_BYTES)
    throw Error("Workflow source originals exceed storage budget.");
  for (const ref of record.sourceRefs) {
    const node = nodes.find((node) => node.id === ref.nodeId);
    if (ref.mode !== node.mode) throw Error("Workflow source revision policy mismatch.");
    const snapshot = frozen ? frozen.originals[ref.snapshotId] : lookupSnapshot?.(ref.snapshotId);
    if (!snapshot) throw Error("Workflow pinned source snapshot is missing.");
    if (
      snapshot.id !== ref.snapshotId ||
      hashOf(snapshot) !== ref.snapshotHash ||
      snapshot.contentHash !== ref.contentHash ||
      snapshot.version !== ref.version
    )
      throw Error("Workflow source snapshot checksum mismatch.");
    verifyObservationComposition(snapshot);
    if (
      frozen &&
      resolve &&
      hashOf(projectSnapshot(snapshot, node, record.protocol.knownAt)) !== hashOf(frozen.inputs.sources[ref.nodeId])
    )
      throw Error("Workflow frozen source resolution mismatch.");
  }
  if (frozen) {
    if (
      Object.keys(frozen.originals).sort().join() !==
        [...new Set(record.sourceRefs.map((ref) => ref.snapshotId))].sort().join() ||
      Object.keys(frozen.inputs.sources).sort().join() !==
        (resolve ? record.sourceRefs : [])
          .map((ref) => ref.nodeId)
          .sort()
          .join()
    )
      throw Error("Workflow frozen source manifest has unreferenced or missing inputs.");
  }
}

/** Capture the exact observation vintage resolver alongside the pure calculation engine. */
export function sourceResolverText() {
  return `import { createHash } from 'node:crypto';\nconst hashOf = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');\n${timestamp.toString()}\n${resolveObservations.toString()}\nexport ${projectSnapshot.toString()}\n`;
}
