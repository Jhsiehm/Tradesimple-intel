import { ActivityFeedback } from "./ActivityFeedback";
import { useEffect, useState } from "react";
import { read, write, message } from "./api";
type Result = { content: string; format: string; source: string };
type Retrieval = {
  id: string;
  connector: string;
  createdAt: string;
  status: "ready" | "partial" | "complete";
  pages: number;
  rows: number;
  result?: Result;
};
export function ConnectorRetrievals({
  connectors,
  disabled,
  onUse,
}: {
  connectors: { id: string; label: string; resumable?: boolean }[];
  disabled: boolean;
  onUse: (result: Result) => void;
}) {
  const [items, setItems] = useState<Retrieval[]>([]),
    [selected, setSelected] = useState<Retrieval | null>(null),
    [connector, setConnector] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = async () => setItems((await read<{ items: Retrieval[] }>("retrievals")).items);
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const resume = async (job: Retrieval) => {
    const out = await write<{ job: Retrieval; error?: string }>(`retrievals/${job.id}/resume`, {});
    setSelected(out.job);
    if (out.error) setError(out.error);
    await load();
  };
  return (
    <details>
      <summary>Recoverable API retrievals · {items.length} recent</summary>
      <p>
        Completed pages stay on this server if a later request fails. Resume uses the saved cursor; only completed
        retrievals can enter validation. Limits: 20 pages, 5,000 rows and 2 MiB.
      </p>
      <fieldset className="research-form" disabled={busy || disabled}>
        <label>
          Paginated connection
          <select value={connector} onChange={(e) => setConnector(e.target.value)}>
            <option value="">Choose a connection</option>
            {connectors
              .filter((c) => c.resumable)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <div className="research-actions">
          <button
            type="button"
            className="panels-btn"
            disabled={!connector}
            onClick={() =>
              void act(async () => {
                const out = await write<{ job: Retrieval }>("retrievals", { connector });
                setSelected(out.job);
                await load();
                await resume(out.job);
              })
            }
          >
            Start retrieval
          </button>
          <button type="button" className="panels-btn" onClick={() => void act(load)}>
            Refresh retrievals
          </button>
        </div>
      </fieldset>
      {busy && <ActivityFeedback className="research-working">Retrieving or reading saved pages…</ActivityFeedback>}
      {error && <p role="alert">{error}</p>}
      {notice && <ActivityFeedback>{notice}</ActivityFeedback>}
      {!items.length && <p>No retrievals saved yet. Configure a cursor-paginated connection to begin.</p>}
      <div className="research-list">
        {items.map((job) => (
          <button
            type="button"
            className="research-item"
            key={job.id}
            disabled={busy || disabled}
            aria-pressed={selected?.id === job.id}
            onClick={() =>
              void act(async () => setSelected((await read<{ job: Retrieval }>(`retrievals/${job.id}`)).job))
            }
          >
            <strong>
              {job.connector} · {job.status === "complete" ? "Complete" : "Incomplete"}
            </strong>
            <span>
              {job.pages} saved pages · {job.rows} rows · {job.createdAt}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <section>
          <h3>
            {selected.connector} · {selected.pages} pages retained
          </h3>
          <p>
            {selected.status === "complete"
              ? "Pagination completed. Validate the records before saving a dataset."
              : "No complete result is saved. The retrieval may have stopped or still be running in another session."}
          </p>
          <div className="research-actions">
            {selected.result ? (
              <button
                type="button"
                className="panels-btn"
                disabled={busy || disabled}
                onClick={() => {
                  onUse(selected.result!);
                  setNotice("Loaded the completed retrieval into the import draft. Validate it before saving.");
                }}
              >
                Use completed retrieval
              </button>
            ) : (
              <button
                type="button"
                className="panels-btn"
                disabled={busy || disabled}
                onClick={() => void act(() => resume(selected))}
              >
                Resume saved retrieval
              </button>
            )}
          </div>
          <p>
            Upstream cursors may expire and source data may change between requests. Retained pages record when they
            were retrieved; completion does not prove a consistent historical snapshot.
          </p>
        </section>
      )}
    </details>
  );
}
