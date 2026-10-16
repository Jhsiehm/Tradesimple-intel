import {getObservations,verifyObservationDerivation} from './research-observations.mjs';
import { getSourceDocument } from './source-documents.mjs';
/** Freeze the transitive evidence behind an export; no provider requests or mutable job lookups. */
import { getDataset, getEngine, getRun, hashOf } from './research-store.mjs';
import { blob } from './evidence/store.mjs';
export function archiveEvidence(db, root) {
  const runs = {}, engines = {}, datasets = {}, blobs = {}, documents = {}, visiting = new Set();
  function visit(run) {
    if (visiting.has(run.id)) throw new Error('Cyclic research lineage; export refused.');
    if (runs[run.id]) return;
    visiting.add(run.id);
    runs[run.id] = run;
    engines[run.engineId] ||= getEngine(db, run.engineId);
    for (const record of Array.isArray(run.provenance?.records) ? run.provenance.records : Object.values(run.provenance?.records || {}).flat()) {
      for (const ref of [...(record.sourceDocuments || []), ...(record.sourceDocument ? [record.sourceDocument] : [])]) {
      const document = documents[ref.hash] || getSourceDocument(db, ref.hash);
      if (document.contentHash !== ref.contentHash || document.url !== ref.url) throw new Error('Source document does not match its frozen record reference.');
      documents[ref.hash] = document;
      }
    }
    const relationship = run.provenance?.relationship;
    if (relationship) {
      const snapshot = relationship.snapshot;
      if (!snapshot || snapshot.id !== relationship.policy.snapshotId || hashOf(snapshot.rows) !== snapshot.contentHash) throw new Error('Frozen relationship snapshot checksum mismatch.');
      for (const row of snapshot.rows) if (row.documentHash) {
        const document = documents[row.documentHash] || getSourceDocument(db, row.documentHash);
        if (document.url !== row.sourceUrl) throw new Error('Relationship evidence URL mismatch.');
        documents[row.documentHash] = document;
      }
    }
    const reference = run.provenance?.dataset;
    if (reference) {
      const dataset = getDataset(db, reference.id);
      if (!dataset || dataset.contentHash !== reference.contentHash || dataset.version !== reference.version) throw new Error('Frozen source dataset is missing or does not match the run.');
      if (typeof dataset.rawContent !== 'string' || hashOf(dataset.rawContent) !== dataset.rawHash) throw new Error('Original dataset content checksum mismatch.');
      datasets[dataset.id] = dataset;
      const manifest = dataset.manifest;
      if(manifest?.observation){verifyObservationDerivation(dataset);const original=getObservations(db,manifest.observation.snapshot.id);if(hashOf(original)!==hashOf(manifest.observation.snapshot))throw Error('Derived observation source differs from its pinned snapshot.');}
      if (manifest) {
        const hashes = new Set([manifest.mappingHash, ...(manifest.versions || []).map(v => v.rawHash)].filter(Boolean));
        // Partition hashes identify result arrays, not the stored request/response envelope.
        // Resolve only immutable observations whose payload digest belongs to this frozen partition.
        for (const partition of manifest.partitions || []) {
          const expected = new Set(partition.hashes || []), found = new Set();
          if (!expected.size) continue;
          const observations = db.prepare('SELECT hash FROM research.evidence_observations WHERE job_id=? AND partition_id=? ORDER BY page').all(manifest.jobId || '', partition.id || '');
          for (const observation of observations) {
            const page = blob(db, observation.hash), digest = hashOf(page.response?.results);
            if (expected.has(digest)) { blobs[observation.hash] = page; found.add(digest); }
          }
          if ([...expected].some(hash => !found.has(hash))) throw new Error('Frozen evidence page is missing or does not match its recorded payload.');
        }
        for (const hash of hashes) if (!blobs[hash]) blobs[hash] = blob(db, hash);
      }
    }
    for (const reference of run.provenance?.sourceRuns || []) {
      const source = getRun(db, reference.runId);
      if (!source || source.inputHash !== reference.inputHash) throw new Error('Frozen comparison source is missing or does not match its pinned checksum.');
      visit(source);
    }
    visiting.delete(run.id);
  }
  visit(root);
  return { schemaVersion: 1, rootRunId: root.id, runs, engines, datasets, blobs, documents, limitations: [
    'Imported raw content and frozen contract response blobs are included when present in the referenced datasets.',
    'Built-in sources retain the parsed records saved with their runs. Original PDFs, XML and provider responses are not universally archived.',
    'The archive preserves saved calculations and evidence, not proof of historical completeness or verified publication timing.'
  ] };
}
