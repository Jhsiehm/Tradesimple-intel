# Historical relationship snapshots

The relationship registry stores immutable researcher-supplied assertions. It supports companies, securities, facilities, jurisdictions, agencies, institutions, people, industries and policies. It does not automatically populate historical ownership data or replace the current ticker registry.

Create a snapshot by posting `{ "name": "Research scope", "rows": [...] }` to `/api/research/relationships`. Up to 5,000 assertions may be imported atomically. Each row requires:

- `id`: unique assertion ID within the snapshot.
- `relationshipId`: stable ID shared by revisions of one relationship.
- `subject` and `object`: typed stable IDs, such as `company:example`, `facility:plant-1` or `jurisdiction:US-NY`.
- `predicate`: `owns`, `operates`, `located-in`, `regulated-by`, `member-of`, `issued-by` or `exposed-to`.
- `effectiveFrom`, optional `effectiveTo`: dates delimiting the effective interval, including the start and excluding the end.
- `availableAt`: claimed public-availability date or UTC timestamp. Future availability is rejected on import. A date-only assertion becomes eligible at the end of that UTC day.
- `status`: `asserted` (default) or `retracted`.
- `sourceUrl`: evidence URL without embedded credentials.
- Optional `documentHash`: reference to an already archived source document with the same URL.

The same name and identical normalized rows reuse a version. Changed rows create a new immutable snapshot. Each version is a full snapshot, not a patch. Old versions remain queryable. Revisions must retain their subject and predicate; they may correct the object, effective interval or status.

List snapshots with `GET /api/research/relationships`, inspect a full snapshot with `GET /api/research/relationships/:id`, and query it with `POST /api/research/relationships/:id/query`:

```json
{
  "effectiveAt": "2020-07-01",
  "knownAt": "2020-12-31",
  "subject": "company:example",
  "predicate": "owns"
}
```

The query first excludes assertions later than `knownAt`, then selects the latest available revision for each relationship. It then applies `effectiveAt` to the effective interval. An amendment published in 2021 cannot change a lookup whose knowledge cutoff is in 2020. A later corrected interval does affect queries made with a later knowledge cutoff. Retraction repudiates a relationship; an ordinary termination should use `effectiveTo` rather than retraction.

Assertions tied at the latest availability time are returned as ambiguous and excluded from resolved results. The API does not guess which assertion is authoritative. Lack of a matching edge does not establish that no relationship existed.

All dates and relationships are researcher assertions. An archived document proves which content was retained, not that the asserted interpretation or publication date is correct. Exported/full snapshot JSON preserves the assertions, their references and the content hash. Backup/restore includes the registry. The lookup remains separate from calculations unless an experiment explicitly supplies a relationship eligibility policy.

Validation covers later corrections, retractions, date-only availability, conflicting revisions, immutable versions, atomic rejection, API origin protections and backup restoration. Historical provider coverage, approved mappings, provider-backed exposure studies and independent timestamp verification remain future work.

## Experiment eligibility API

An experiment spec may include `relationship` with `snapshotId`, `predicate`, `object`, and `subjects` (an explicit object mapping uppercase tickers to typed subject IDs). For dataset requests to `/api/research/run`, supply this policy alongside `datasetId` and `rules`; source requests include it within `spec`. No policy is applied by default.

For every timing-eligible signal, the effective date and knowledge cutoff are both its public signal day. Entry remains on a later trading day. The latest known revision must match the requested predicate/object. Unmapped symbols, missing matches and ambiguous subject/predicate revisions are excluded before signal/symbol caps. A missing snapshot fails the saved run, rather than silently ignoring the policy.

The run freezes the policy, complete snapshot, per-signal decisions, selected assertion IDs and caveats. Exports include referenced archived documents. Convergence only receives relationship-eligible signals and validates them against the frozen snapshot. Replay uses frozen calculation inputs. This is explicit relationship filtering, not independent verification of identity, publication or causality. Entity mappings are never inferred.

## Experiment forms

Guided experiments and dataset experiments expose an optional Relationship eligibility section. Select an immutable version, choose the required predicate/object, and supply exact ticker-to-subject mappings as JSON. Selecting No relationship restriction disables the policy. Malformed mappings prevent submission. Guided drafts retain policy fields across tool navigation and browser reloads.

Saved experiments display the frozen snapshot name/version, policy mappings and eligible/excluded counts. Rerun preserves the policy while creating a new experiment. Browser acceptance on synthetic data in an isolated database verified rejection of malformed mappings, draft retention, a two-signal dataset reduced to the one signal after relationship publication, exact replay and policy-preserving rerun. Desktop and 390px mobile controls were inspected. Live-provider coverage and standalone relationship JSON download verification remain separate open checks.

## Directed exposure chains

API policies may also include `path`, an ordered list of one to four predicates whose first entry equals `predicate`. For example, `predicate: "owns"`, `path: ["owns", "located-in"]`, and `object: "jurisdiction:US-NY"` requires a company-to-facility-to-jurisdiction chain. Omitting `path` preserves direct-relationship behavior. Both experiment forms can add and remove steps with native predicate selectors, up to four relationships total. Saved-run summaries display the full chain.

Every edge must be effective and known at the same signal-publication cutoff. Traversal is directed, with no reverse or inferred edges. Missing intermediate links exclude the signal. Any ambiguous revision encountered on a visited branch excludes it conservatively, even if another branch reaches the target. Bounded traversal retains one deterministic witness per endpoint instead of enumerating every possible path; decisions contain the witness entity sequence and assertion IDs. It does not compute proportional ownership or economic exposure weights.

Portable-export validation additionally covers exact binary document retention, successful standalone replay after closing the database, missing-document rejection, and detection of changed archive contents. Replay verifies the saved calculation; it does not independently certify the truth of relationship assertions.

Browser acceptance for chain controls used a synthetic company → facility → jurisdiction snapshot and two transaction signals in an isolated in-memory database. The form enforced the four-step limit, allowed steps to be removed, saved a two-step experiment with one eligible/one excluded signal, and verified exact replay. The resulting ZIP retained both witness assertion IDs and the full entity path and replayed standalone. Mobile verification found an inherited toolbar rule hiding Research secondary actions; a Research-scoped override restores these controls without changing the global navigation.
