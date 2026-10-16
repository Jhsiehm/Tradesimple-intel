# Portable research evidence

Export frozen run produces an archive with:

- `run.json`: the selected calculation, inputs, outputs and provenance.
- `engine/` and `replay.mjs`: its original deterministic calculation engine.
- `evidence.json`: the selected run and transitive pinned comparison source runs, their original engines, exact imported datasets, available frozen contract evidence blobs, and captured source documents.
- `checksums.json`: hashes for every exported file. Offline replay verifies these before computing.

Extract the archive and run `node replay.mjs`. No network or installed packages are required. Keep the entire archive together; the original dataset contents can be private.

Contract page hashes in a dataset manifest identify response result arrays. The export resolves them against immutable page observations for that job and partition, verifies the payload digest, and includes the original request/response envelope. It does not fetch a current provider response or read a mutable retrieval job to replace the saved evidence. Raw record and mapping blob hashes are also verified. Later job work cannot silently replace a pinned payload.

An unavailable source run, mismatched dataset version/content hash, corrupt original import, or missing pinned contract page fails the export. Recover missing evidence from a verified database backup; do not substitute new provider responses under old identifiers.

The source archive is not a claim that every provider document has been collected. New fetches preserve House PDF bytes, Senate HTML, Form 4 XML/submission text, parsed lobbying API response JSON, and contract-feed request/response JSON. PDFs use base64 with a checksum of the decoded bytes; API JSON preserves the parsed response rather than the original HTTP byte stream. Merged congressional disclosures retain references to both original and amended documents. Collector-observation times do not establish original publication times. Existing cache entries and bulk-history records may lack originals; no retrospective completeness is implied. Imported availability assertions and assumed publication delays remain assumptions. A successful replay establishes calculation reproducibility, not historical completeness, predictive validity or causality.

Verification: tests cover imported bytes, comparison source lineage, immutable contract page selection, missing-evidence failure and archive tampering. Seven existing local runs were exported from a temporary database copy and replayed offline successfully; the live database was unchanged.
