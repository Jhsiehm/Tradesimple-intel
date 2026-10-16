import { ActivityFeedback } from "./ActivityFeedback";
import { ConnectorRetrievals } from "./ConnectorRetrievals";
import { useEffect, useRef, useState } from "react";
import { post } from "../lib/api";
import { message, read, write, type DatasetSummary } from "./api";
const fields = [
  "id",
  "entityId",
  "metric",
  "unit",
  "value",
  "eventAt",
  "availableAt",
  "sourceUrl",
  "observationId",
  "status",
  "observationType",
  "targetAt",
];
type Observation = {
  observationType?: "forecast";
  targetAt?: string;
  id: string;
  observationId?: string;
  status?: "asserted" | "retracted";
  entityId: string;
  metric: string;
  unit: string;
  value: number | null;
  eventAt: string;
  availableAt: string;
  sourceUrl: string;
};
type Summary = {
  id: string;
  name: string;
  version: number;
  contentHash: string;
  coverage: { received: number; valid: number; rejected: number; entities: number; metrics: string[] };
};
type Snapshot = Summary & {
  composition?: {
    reason: string;
    identityNamespace: string;
    received: number;
    unique: number;
    sources: { id: string; contentHash: string }[];
  };
  events: Observation[];
  source: string;
  ownership: string;
  license: string;
  caveats: string[];
};
type Preview = {
  ok: boolean;
  coverage: Summary["coverage"];
  preview: Observation[];
  errorCount: number;
  errors: { row: number; field: string; message: string }[];
  error?: string;
  content?: string;
  format?: string;
  source?: string;
  retrieval?: { pages: number; rows: number; complete: boolean };
};
type Resolution = {
  mode: string;
  knownAt: string | null;
  items: Observation[];
  coverage: { selected: number; ambiguous: number; retracted: number; notYetKnown: number };
  decisions: { observationId: string; reason: string; assertionIds: string[] }[];
};
function forecastEligible(row: Observation) {
  return (
    row.observationType !== "forecast" ||
    Date.parse(row.availableAt) + (/^\d{4}-\d{2}-\d{2}$/.test(row.availableAt) ? 86400000 - 1 : 0) <
      Date.parse(row.targetAt || "")
  );
}
function ObservationTable({ rows }: { rows: Observation[] }) {
  if (!rows.length)
    return <p>No selected observations to display. Review the validation or revision decisions for exclusions.</p>;
  return (
    <div className="research-table">
      <table>
        <thead>
          <tr>
            <th>Record / entity</th>
            <th>Observation</th>
            <th>Event / issuance</th>
            <th>Target</th>
            <th>Available date</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.id}
                <small>{r.entityId}</small>
                {r.observationId && <small>Observation: {r.observationId}</small>}
              </td>
              <td>
                {r.metric}
                <small>{r.observationType === "forecast" ? "Forecast" : "Realized"}</small>
                <small>{r.status === "retracted" ? "Retracted" : `${r.value} ${r.unit}`}</small>
              </td>
              <td>{r.eventAt}</td>
              <td>{r.targetAt || "—"}</td>
              <td>{r.availableAt}</td>
              <td>
                <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ObservationHub({ onRun }: { onRun: (dataset: DatasetSummary) => void }) {
  const [items, setItems] = useState<Summary[]>([]),
    [selected, setSelected] = useState<Snapshot | null>(null);
  const [connectors, setConnectors] = useState<{ id: string; label: string; resumable?: boolean; kind?: string }[]>([]),
    [connector, setConnector] = useState("");
  const [draft, setDraft] = useState({ name: "", source: "", ownership: "", license: "", format: "csv", content: "" });
  const [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [measure, setMeasure] = useState(""),
    [operator, setOperator] = useState("lt"),
    [threshold, setThreshold] = useState(""),
    [side, setSide] = useState("buy");
  const [observationType, setObservationType] = useState("realized");
  const [bindings, setBindings] = useState<Record<string, string>>({}),
    [derived, setDerived] = useState<DatasetSummary | null>(null);
  const [first, setFirst] = useState<Resolution | null>(null),
    [lookup, setLookup] = useState<Resolution | null>(null),
    [knownAt, setKnownAt] = useState("");
  const [mergeIds, setMergeIds] = useState<string[]>([]),
    [mergeName, setMergeName] = useState(""),
    [mergeReason, setMergeReason] = useState(""),
    [namespace, setNamespace] = useState("");
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selected) selectedHeading.current?.focus();
  }, [selected?.id]);
  const revision = useRef(0);
  const load = async () => {
    const out = await read<{
      items: Summary[];
      connectors: { id: string; label: string; resumable?: boolean; kind?: string }[];
    }>("observations");
    setItems(out.items);
    setConnectors(out.connectors || []);
  };
  useEffect(() => {
    void load()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);
  const changed = () => {
    revision.current++;
    setPreview(null);
    setError("");
    setNotice("");
  };
  const edit = (key: keyof typeof draft, value: string) => {
    changed();
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const select = async (s: Snapshot) => {
    const out = await write<{ result: Resolution }>(`observations/${s.id}/resolve`, { mode: "first-publication" });
    setFirst(out.result);
    setLookup(null);
    setKnownAt("");
    setSelected(s);
    setObservationType(s.events[0].observationType || "realized");
    setName(`${s.name} threshold`);
    setMeasure(JSON.stringify([s.events[0].metric, s.events[0].unit]));
    setThreshold("");
    setBindings({});
    setDerived(null);
  };
  const inspect = async (id: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    setNotice("");
    try {
      await select((await read<{ snapshot: Snapshot }>(`observations/${id}`)).snapshot);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await post<Preview>("/api/research/observations/preview", { ...draft, mapping, connector });
      if (out.error) throw Error(out.error);
      if (out.content !== undefined) {
        setDraft((d) => ({
          ...d,
          content: out.content!,
          format: out.format || "json",
          source: out.source || d.source,
        }));
        setConnector("");
      }
      setPreview(out);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!preview?.ok) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await write<{ snapshot: Snapshot }>("observations", { ...draft, mapping });
      await select(out.snapshot);
      setPreview(null);
      setNotice(`Saved ${out.snapshot.name} · v${out.snapshot.version}.`);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const merge = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    setNotice("");
    try {
      const out = await write<{ snapshot: Snapshot }>("observations/merge", {
        name: mergeName,
        reason: mergeReason,
        identityNamespace: namespace,
        snapshotIds: mergeIds,
      });
      await select(out.snapshot);
      await load();
      setNotice(
        `Saved merged history ${out.snapshot.name} · v${out.snapshot.version}. Original snapshots remain intact.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const query = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    setLookup(null);
    try {
      setLookup(
        (await write<{ result: Resolution }>(`observations/${selected.id}/resolve`, { mode: "latest-known", knownAt }))
          .result,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const measures = selected ? [...new Set(selected.events.map((e) => JSON.stringify([e.metric, e.unit])))] : [];
  const [metric, unit] = measure ? (JSON.parse(measure) as [string, string]) : ["", ""];
  const numeric = threshold.trim() !== "" && Number.isFinite(Number(threshold));
  const matching =
    first?.items.filter(
      (e) =>
        (e.observationType || "realized") === observationType &&
        forecastEligible(e) &&
        e.value !== null &&
        e.metric === metric &&
        e.unit === unit &&
        numeric &&
        {
          lt: e.value < Number(threshold),
          lte: e.value <= Number(threshold),
          gt: e.value > Number(threshold),
          gte: e.value >= Number(threshold),
        }[operator],
    ) || [];
  const entities = [...new Set(matching.map((e) => e.entityId))];
  const derive = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    setNotice("");
    try {
      const out = await write<{ dataset: DatasetSummary; transformation: { selected: number; signals: number } }>(
        `observations/${selected.id}/derive`,
        {
          name,
          observationType,
          metric,
          unit,
          operator,
          threshold: Number(threshold),
          side,
          bindings: Object.fromEntries(
            entities.map((entity) => [
              entity,
              (bindings[entity] || "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ]),
          ),
        },
      );
      setDerived(out.dataset);
      setNotice(
        `Saved ${out.transformation.signals} signal${out.transformation.signals === 1 ? "" : "s"} from ${out.transformation.selected} matching observation${out.transformation.selected === 1 ? "" : "s"}. The source snapshot and transformation are preserved.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="research-content observation-hub">
      <p>
        Turn measurements or forecasts into testable signals. Keep event and publication dates separate. Limit: 5,000
        rows / 2 MiB.
      </p>
      <ConnectorRetrievals
        connectors={connectors}
        disabled={busy}
        onUse={(result) => {
          changed();
          setDraft((d) => ({ ...d, ...result }));
          setConnector("");
        }}
      />
      <details open={!selected} className="data-import">
        <summary>Add measurements or forecasts</summary>
        <fieldset className="research-form" disabled={busy}>
          <legend>Import observations</legend>
          <div className="research-mapping">
            <label>
              Observation dataset name
              <input value={draft.name} maxLength={120} onChange={(e) => edit("name", e.target.value)} />
            </label>
            <label>
              Source label
              <input value={draft.source} maxLength={300} onChange={(e) => edit("source", e.target.value)} />
            </label>
            <label>
              Ownership label
              <input value={draft.ownership} maxLength={300} onChange={(e) => edit("ownership", e.target.value)} />
            </label>
          </div>
          <label>
            License or usage conditions
            <textarea value={draft.license} maxLength={2000} onChange={(e) => edit("license", e.target.value)} />
          </label>
          <p>Ownership and usage labels are your assertions, not verified permissions.</p>
          <details>
            <summary>How dates, forecasts and corrections work</summary>
            <ul>
              <li>
                For forecasts, set observationType to forecast. eventAt is the original issuance; targetAt is the future
                date being forecast. availableAt records when that publication became public.
              </li>
              <li>
                Each issuance needs a new observationId. Corrections retain the original issuance and target. Realized
                outcomes use separate IDs.
              </li>
              <li>
                Each publication has a unique id; corrections share an observationId. Retractions use status retracted
                with an empty value.
              </li>
              <li>
                Include full history in one snapshot, or combine saved histories explicitly. Separate versions are never
                automatically merged.
              </li>
            </ul>
          </details>
          <div className="research-mapping">
            <label>
              Observation input
              <select
                value={connector ? `api:${connector}` : draft.format}
                onChange={(e) => {
                  changed();
                  if (e.target.value.startsWith("api:")) setConnector(e.target.value.slice(4));
                  else {
                    setConnector("");
                    setDraft((d) => ({ ...d, format: e.target.value }));
                  }
                }}
              >
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                {connectors.map((c) => (
                  <option key={c.id} value={`api:${c.id}`}>
                    {c.kind === "sqlite" ? "Database" : "API"} · {c.label}
                  </option>
                ))}
              </select>
            </label>
            {!connector && (
              <label>
                Choose observation file
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    changed();
                    const ticket = revision.current;
                    if (file.size > 2 * 1024 * 1024) {
                      setError("File exceeds 2 MiB.");
                      return;
                    }
                    try {
                      const content = await file.text();
                      if (ticket === revision.current)
                        setDraft((d) => ({ ...d, content, format: /\.json$/i.test(file.name) ? "json" : "csv" }));
                    } catch (e) {
                      if (ticket === revision.current) setError(message(e));
                    }
                  }}
                />
              </label>
            )}
          </div>
          {!connector && (
            <details>
              <summary>Paste or inspect file contents</summary>
              <label>
                Observation content
                <textarea
                  className="research-data"
                  value={draft.content}
                  onChange={(e) => edit("content", e.target.value)}
                  placeholder="id,entityId,metric,unit,value,eventAt,availableAt,sourceUrl"
                />
              </label>
            </details>
          )}
          {connector && (
            <p>
              Validation reads the configured connection. Saving imports that exact preview without reading the source
              again. Incomplete API pagination is refused. Database reads preserve query and row checksums.
            </p>
          )}
          <details>
            <summary>Observation column mapping</summary>
            <p>
              Use exact headers. Entities need a type, such as facility:plant-1. Units, availability dates and HTTP(S)
              evidence URLs are required.
            </p>
            <div className="research-mapping">
              {fields.map((f) => (
                <label key={f}>
                  {f}
                  {f === "targetAt"
                    ? " (required for forecasts)"
                    : ["observationId", "status", "observationType"].includes(f)
                      ? " (optional)"
                      : ""}
                  <input
                    value={mapping[f] ?? f}
                    onChange={(e) => {
                      changed();
                      setMapping((m) => ({ ...m, [f]: e.target.value }));
                    }}
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="research-actions">
            <button
              className="bt-run"
              disabled={
                ![draft.name, draft.ownership, draft.license].every((v) => v.trim()) ||
                (!connector && (!draft.content.trim() || !draft.source.trim()))
              }
              onClick={() => void validate()}
            >
              Validate observations
            </button>
            {preview?.ok && (
              <button className="bt-run" onClick={() => void save()}>
                Save observation snapshot
              </button>
            )}
          </div>
        </fieldset>
      </details>
      {busy && <ActivityFeedback className="research-working">Working…</ActivityFeedback>}
      {error && (
        <p role="alert" className="bt-note warn">
          {error}
        </p>
      )}
      {notice && <ActivityFeedback>{notice}</ActivityFeedback>}
      {preview && (
        <section>
          <h3>Observation validation</h3>
          {preview.retrieval && (
            <p>
              API retrieval completed: {preview.retrieval.pages} pages · {preview.retrieval.rows} records. This does not
              certify historical coverage.
            </p>
          )}
          <p>
            {preview.coverage.valid} valid / {preview.coverage.received} observations · {preview.coverage.rejected}{" "}
            rejected. Imports require every row to pass.
          </p>
          {preview.errors.length > 0 && (
            <ul>
              {preview.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row} · {e.field}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {preview.errorCount > 100 && <p>Showing the first 100 of {preview.errorCount} errors.</p>}
          <ObservationTable rows={preview.preview} />
        </section>
      )}
      <details>
        <summary>Combine snapshot histories</summary>
        <fieldset className="research-form" disabled={busy}>
          <legend>Merge explicitly selected histories</legend>
          <p>
            Select 2–20 snapshots sharing an observation ID namespace and identical source, ownership and license
            labels. Exact repeated publications are deduplicated. Conflicting IDs or changed observation identities stop
            the merge. The combined source package must fit the 2 MiB limit.
          </p>
          <label>
            Merged history name
            <input maxLength={120} value={mergeName} onChange={(e) => setMergeName(e.target.value)} />
          </label>
          <label>
            Shared observation ID namespace
            <input
              maxLength={300}
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="Provider and series defining these observation IDs"
            />
          </label>
          <label>
            Reason for combining these histories
            <textarea maxLength={2000} value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} />
          </label>
          {items.length < 2 ? (
            <p>Import at least two snapshots to combine their histories.</p>
          ) : (
            <div className="observation-merge-sources">
              {items.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={mergeIds.includes(s.id)}
                    disabled={!mergeIds.includes(s.id) && mergeIds.length >= 20}
                    onChange={(e) =>
                      setMergeIds((ids) => (e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id)))
                    }
                  />
                  {s.name} · v{s.version} · {s.coverage.received} publication{" "}
                  {s.coverage.received === 1 ? "record" : "records"}
                </label>
              ))}
            </div>
          )}
          <p>
            {mergeIds.length} snapshots selected. Your namespace statement records a research assumption; it does not
            verify the provider’s IDs.
          </p>
          <button
            className="bt-run"
            disabled={mergeIds.length < 2 || !mergeName.trim() || !namespace.trim() || !mergeReason.trim()}
            onClick={() => void merge()}
          >
            Save merged history
          </button>
        </fieldset>
      </details>
      <div className="data-workbench" data-selected={Boolean(selected)}>
        <aside className="data-library" aria-label="Saved datasets">
          {" "}
          <h3>
            Your observation datasets <span className="research-count">{items.length}</span>
          </h3>
          {loading ? (
            <ActivityFeedback className="research-working">Loading observations…</ActivityFeedback>
          ) : !items.length ? (
            <p>No observation snapshots yet. Validate a file above to begin.</p>
          ) : (
            <div className="research-list">
              {items.map((s) => (
                <button
                  className="research-item"
                  key={s.id}
                  disabled={busy}
                  aria-pressed={selected?.id === s.id}
                  onClick={() => void inspect(s.id)}
                >
                  <strong>
                    {s.name} · v{s.version}
                  </strong>
                  <span>
                    {s.coverage.received} publication {s.coverage.received === 1 ? "record" : "records"} ·{" "}
                    {s.coverage.entities} {s.coverage.entities === 1 ? "entity" : "entities"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
        {selected && (
          <section key={selected.id} className="research-content research-result">
            <h3 ref={selectedHeading} tabIndex={-1}>
              {selected.name} · v{selected.version}
            </h3>
            <p>
              {selected.source} · {selected.ownership}
            </p>
            <p>Usage: {selected.license}</p>
            <details>
              <summary>Review source, history and selection policy</summary>
              <details>
                <summary>Source snapshot and limitations</summary>
                <ul>
                  {selected.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="research-hash">{selected.contentHash}</p>
                <a href={`/api/research/observations/${selected.id}`} target="_blank" rel="noreferrer">
                  Inspect complete snapshot JSON
                </a>
                <p>First 10 observations</p>
                <ObservationTable rows={selected.events.slice(0, 10)} />
              </details>
              {selected.composition && (
                <details>
                  <summary>Merged source provenance</summary>
                  <p>{selected.composition.reason}</p>
                  <p>Shared ID namespace: {selected.composition.identityNamespace}</p>
                  <p>
                    {selected.composition.received} source publications combined into {selected.composition.unique}{" "}
                    unique records.
                  </p>
                  <ul>
                    {selected.composition.sources.map((source) => (
                      <li key={source.id}>
                        <a href={`/api/research/observations/${source.id}`} target="_blank" rel="noreferrer">
                          Inspect {items.find((s) => s.id === source.id)?.name || source.id}
                        </a>
                        <p className="research-hash">{source.contentHash}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <details>
                <summary>Inspect values known at a date</summary>
                <fieldset className="research-form" disabled={busy}>
                  <legend>Publication history lookup</legend>
                  <label>
                    Knowledge cutoff
                    <input
                      value={knownAt}
                      onChange={(e) => {
                        setKnownAt(e.target.value);
                        setLookup(null);
                      }}
                      placeholder="2025-01-08 or 2025-01-08T12:00:00Z"
                    />
                  </label>
                  <p>
                    Date-only cutoffs and publications use the end of the UTC day. This lookup does not alter the
                    first-publication signals below.
                  </p>
                  <button className="bt-run" disabled={!knownAt.trim()} onClick={() => void query()}>
                    Resolve known observations
                  </button>
                </fieldset>
                {lookup && (
                  <>
                    <ActivityFeedback>
                      As of {lookup.knownAt}: {lookup.coverage.selected} selected · {lookup.coverage.retracted}{" "}
                      retracted · {lookup.coverage.ambiguous} ambiguous · {lookup.coverage.notYetKnown} not yet known.
                    </ActivityFeedback>
                    <ObservationTable rows={lookup.items.slice(0, 20)} />
                    <p>Showing up to 20 selected observations.</p>
                    <details>
                      <summary>Revision decisions</summary>
                      <ul>
                        {lookup.decisions.slice(0, 100).map((d) => (
                          <li key={d.observationId}>
                            {d.observationId}: {d.reason} · {d.assertionIds.join(", ") || "No known publication"}
                          </li>
                        ))}
                      </ul>
                      {lookup.decisions.length > 100 && (
                        <p>Showing the first 100 decisions. The resolve API returns the complete audit.</p>
                      )}
                    </details>
                  </>
                )}
              </details>
              {first && (
                <details>
                  <summary>Signal selection and revision policy</summary>
                  <p>
                    First-publication policy: {first.coverage.selected}{" "}
                    {first.coverage.selected === 1 ? "observation" : "observations"} available for threshold selection;{" "}
                    {first.coverage.ambiguous} ambiguous and {first.coverage.retracted} first-publication retractions
                    excluded. Later corrections do not create or erase earlier signals. Missing history cannot be
                    detected automatically.
                  </p>
                </details>
              )}
            </details>
            <fieldset
              className="research-form"
              disabled={busy}
              onChange={() => {
                setDerived(null);
                setNotice("");
              }}
            >
              <legend>Create threshold signals</legend>
              <label>
                Observation type
                <select value={observationType} onChange={(e) => setObservationType(e.target.value)}>
                  <option value="realized">Realized measurements</option>
                  <option value="forecast">Forecast vintages</option>
                </select>
              </label>
              <label>
                Signal dataset name
                <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="research-mapping">
                <label>
                  Measured quantity
                  <select value={measure} onChange={(e) => setMeasure(e.target.value)}>
                    {measures.map((m) => {
                      const [quantity, units] = JSON.parse(m);
                      return (
                        <option key={m} value={m}>
                          {quantity} ({units})
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Comparison
                  <select value={operator} onChange={(e) => setOperator(e.target.value)}>
                    <option value="lt">Below</option>
                    <option value="lte">At or below</option>
                    <option value="gt">Above</option>
                    <option value="gte">At or above</option>
                  </select>
                </label>
                <label>
                  Threshold ({unit})
                  <input type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
                </label>
                <label>
                  Signal direction
                  <select value={side} onChange={(e) => setSide(e.target.value)}>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </label>
              </div>
              <ActivityFeedback className="research-match">
                {numeric
                  ? `${matching.length} matching observation${matching.length === 1 ? "" : "s"} across ${entities.length} ${entities.length === 1 ? "entity" : "entities"}.`
                  : "Enter a threshold to preview matching observations."}
              </ActivityFeedback>
              <p>
                Signals use the first publication. Later corrections cannot replace it; missing history cannot be
                detected automatically.
              </p>
              {observationType === "forecast" && (
                <p>
                  {first?.items.filter(
                    (e) =>
                      e.observationType === "forecast" &&
                      e.metric === metric &&
                      e.unit === unit &&
                      !forecastEligible(e),
                  ).length || 0}{" "}
                  excluded: first publication was not available before the target date.
                </p>
              )}
              <details>
                <summary>How signal dates and values are used</summary>
                <p>
                  Each signal retains its publication date. Forecast signals use the original issuance as their event
                  date and keep the target in the lineage; they never use the realized outcome. The measured value is
                  not a position size. Date-only publication means the end of that UTC day. Post-target corrections
                  remain inspectable.
                </p>
              </details>
              {entities.length > 0 && (
                <>
                  <p>
                    Map each matching entity to exact registered tickers, separated by commas. These are your research
                    assumptions; economic exposure is not independently verified.
                  </p>
                  <div className="research-mapping">
                    {entities.map((entity) => (
                      <label key={entity}>
                        {entity}
                        <input
                          value={bindings[entity] || ""}
                          onChange={(e) => setBindings((b) => ({ ...b, [entity]: e.target.value }))}
                          placeholder="AAPL, MSFT"
                        />
                      </label>
                    ))}
                  </div>
                </>
              )}
              <button
                className="bt-run"
                disabled={!name.trim() || !numeric || !matching.length || entities.some((e) => !bindings[e]?.trim())}
                onClick={() => void derive()}
              >
                Save derived signals
              </button>
            </fieldset>
            {derived && (
              <button className="bt-run" onClick={() => onRun(derived)}>
                Create experiment from derived signals
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
