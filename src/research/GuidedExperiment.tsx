import { ActivityFeedback } from "./ActivityFeedback";
import { RelationshipEligibility, emptyRelationshipDraft, parseRelationshipDraft } from "./RelationshipEligibility";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_RULES, type BacktestSource } from "../../shared/backtestSpec.mjs";
import { researchReadiness } from "../../shared/researchReadiness.mjs";
import { read, write, message, type Experiment } from "./api";
const KEY = "research-guided-draft-v1";
const initial = {
  ...emptyRelationshipDraft,
  title: "",
  hypothesis: "",
  tickers: "",
  from: "",
  to: "",
  source: "form4",
  hold: "30",
  cost: "5",
  slippage: "5",
  experimentId: "",
};
type Draft = typeof initial;
function restore(): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.fromEntries(
      Object.entries(initial).map(([key, fallback]) => [key, typeof value?.[key] === "string" ? value[key] : fallback]),
    ) as Draft;
  } catch {
    return initial;
  }
}
export function GuidedExperiment({
  onOpen,
  onTool,
}: {
  onOpen: (id: string) => void;
  onTool: (tab: "data" | "convergence" | "notebooks") => void;
}) {
  const [draft, setDraft] = useState(restore),
    [experiment, setExperiment] = useState<Experiment | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [draft]);
  useEffect(() => {
    let live = true;
    if (draft.experimentId)
      void read<{ experiment: Experiment }>(`experiments/${draft.experimentId}`)
        .then((x) => {
          if (live) setExperiment(x.experiment);
        })
        .catch((e) => {
          if (live) setError(message(e));
        });
    return () => {
      live = false;
    };
  }, [draft.experimentId]);
  const update = (key: keyof Draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value, experimentId: "" }));
    setExperiment(null);
    setError("");
  };
  const universe = [
    ...new Set(
      draft.tickers
        .toUpperCase()
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  ];
  const validDate = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  const relationship = parseRelationshipDraft(draft);
  const issues = [
    relationship.error,
    !draft.title.trim() && "Add a title.",
    !draft.hypothesis.trim() && "Write a falsifiable hypothesis.",
    (!universe.length || universe.length > 40 || universe.some((s) => !/^[A-Z0-9.^-]{1,16}$/.test(s))) &&
      "Enter 1–40 ticker symbols.",
    (!validDate(draft.from) || !validDate(draft.to) || draft.from >= draft.to) &&
      "Choose a valid start date before the end date.",
    (!draft.hold.trim() || !Number.isInteger(+draft.hold) || +draft.hold < 1 || +draft.hold > 730) &&
      "Hold must be 1–730 whole calendar days.",
    [draft.cost, draft.slippage].some((s) => !s.trim() || !Number.isFinite(+s) || +s < 0 || +s > 300) &&
      "Costs and slippage must be 0–300 bps per side.",
    !["form4", "congress", "contracts", "lobbying"].includes(draft.source) && "Choose a supported source.",
  ].filter(Boolean);
  const result = experiment?.run.result;
  const readiness = researchReadiness(result, universe);
  const run = async () => {
    if (busy || issues.length) return;
    setBusy(true);
    setError("");
    try {
      const out = await write<{ experiment: Experiment }>("run", {
        title: draft.title,
        hypothesis: draft.hypothesis,
        ...(experiment ? { parentId: experiment.id } : {}),
        spec: {
          relationship: relationship.policy,
          source: draft.source as BacktestSource,
          filters: { tickers: universe, from: draft.from, to: draft.to },
          rules: {
            ...DEFAULT_RULES,
            holdDays: +draft.hold,
            costBps: +draft.cost,
            slippageBps: +draft.slippage,
            sides: "buy",
            openTrades: "exclude",
          },
        },
      });
      // Preserve the resulting identifier even if navigation unmounted this view during execution.
      const saved = { ...draft, experimentId: out.experiment.id };
      try {
        const current = restore();
        if (
          alive.current ||
          Object.keys(initial).every((key) => current[key as keyof Draft] === draft[key as keyof Draft])
        )
          localStorage.setItem(KEY, JSON.stringify(saved));
      } catch {
        if (alive.current) setStorageError(true);
      }
      if (alive.current) {
        setExperiment(out.experiment);
        setDraft(saved);
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="guided-experiment">
      <h2>Guided experiment</h2>
      <p>
        Define a question, inspect actual source diagnostics, then preserve and review the evidence. No AI key required.
      </p>
      <ol className="research-steps" aria-label="Experiment workflow">
        <li>1 · Define</li>
        <li>2 · Check inputs</li>
        <li>3 · Review frozen evidence</li>
        <li>4 · Compare and document</li>
      </ol>
      <p>
        {storageError
          ? "Browser storage is unavailable. Keep this page open to retain your draft."
          : "Draft saved in this browser. Editing settings clears the displayed check; saved experiments remain immutable."}
      </p>
      <fieldset disabled={busy} className="research-form">
        <legend>Question and test settings</legend>
        <label>
          Experiment title
          <input maxLength={200} value={draft.title} onChange={(e) => update("title", e.target.value)} />
        </label>
        <label>
          Hypothesis
          <textarea
            maxLength={4000}
            value={draft.hypothesis}
            onChange={(e) => update("hypothesis", e.target.value)}
            placeholder="What observation would support or reject this idea?"
          />
        </label>
        <label>
          Declared tickers
          <input
            value={draft.tickers}
            onChange={(e) => update("tickers", e.target.value)}
            placeholder="LMT, RTX, NOC, GD, HII"
          />
        </label>
        <div className="research-mapping">
          <label>
            Signal source
            <select value={draft.source} onChange={(e) => update("source", e.target.value)}>
              <option value="form4">Form 4 insider buys</option>
              <option value="congress">Congressional buys</option>
              <option value="contracts">Contract awards</option>
              <option value="lobbying">Lobbying spikes</option>
            </select>
          </label>
          {(["from", "to", "hold", "cost", "slippage"] as const).map((key, i) => (
            <label key={key}>
              {
                [
                  "Public date from",
                  "Public date through",
                  "Hold (calendar days)",
                  "Cost per side (bps)",
                  "Slippage per side (bps)",
                ][i]
              }
              <input
                type={i < 2 ? "date" : "number"}
                min={i < 2 ? undefined : key === "hold" ? 1 : 0}
                max={i < 2 ? undefined : key === "hold" ? 730 : 300}
                step={key === "hold" ? 1 : "any"}
                value={draft[key]}
                onInput={(e) => update(key, e.currentTarget.value)}
                onChange={(e) => update(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <details>
          <summary>Execution assumptions</summary>
          <p>
            Buy only · next trading day open after public availability · equal weight · SPY · unfinished trades
            excluded. Commission + slippage:{" "}
            {Number.isFinite(+draft.cost + +draft.slippage) ? 2 * (+draft.cost + +draft.slippage) : "—"} bps round trip.
          </p>
        </details>
        <RelationshipEligibility
          value={draft}
          onChange={(next) => {
            setDraft((d) => ({ ...d, ...next, experimentId: "" }));
            setExperiment(null);
            setError("");
          }}
        />
        <p>
          Checking fetches inputs, calculates a diagnostic backtest and saves a frozen experiment, including partial or
          failed results. It is not a certification of complete historical coverage.
        </p>
        {issues.length > 0 && (
          <ul aria-label="Before checking">
            {issues.map((s) => (
              <li key={String(s)}>{s}</li>
            ))}
          </ul>
        )}
        <button className="bt-run" disabled={issues.length > 0 || busy} onClick={() => void run()}>
          {busy
            ? "Checking sources and prices…"
            : experiment
              ? "Check again as a new experiment"
              : "Check inputs and save diagnostic run"}
        </button>
      </fieldset>
      {busy && (
        <ActivityFeedback className="research-working">
          Source and price retrieval can take a minute. Progress percentages are not supplied by the feeds. The saved
          result reports any unfinished loading.
        </ActivityFeedback>
      )}
      {error && (
        <p role="alert" className="bt-note warn">
          {error}
        </p>
      )}
      <section className="research-readiness" aria-label="Data readiness">
        <h3>{readiness.label}</h3>
        <p>{readiness.next}</p>
        {readiness.sourceWarnings.map((text, i) => (
          <p className="bt-note warn" key={i}>
            {text}
          </p>
        ))}
        {result && (
          <>
            <p>
              Checked {experiment?.createdAt} · {result.counts?.signals ?? "—"} signals · {result.counts?.used ?? "—"}{" "}
              trades · {result.counts?.skipped ?? "—"} excluded · {result.counts?.priced ?? "—"} priced signal tickers.
            </p>
            {result.error && <p role="alert">{result.error}</p>}
            <div className="research-table">
              <table>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Execution coverage</th>
                    <th>Trades</th>
                    <th>Public dates of executed trades</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.tickers.map((t) => (
                    <tr key={t.symbol}>
                      <th>{t.symbol}</th>
                      <td>{t.status}</td>
                      <td>{t.trades}</td>
                      <td>{t.first ? `${t.first} → ${t.last}` : "Not established"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Executed-trade dates do not measure the full source history. Names with no executed trades are not
              presumed covered.
            </p>
            {result.feeds?.map((f) => (
              <p key={f.label}>
                <strong>{f.label}</strong> · {f.asOf || "Timestamp unavailable"} · {f.source}
                <br />
                {f.latency}
              </p>
            ))}
            <details>
              <summary>Coverage, timing assumptions and exclusions</summary>
              {result.caveats?.items.map((c) => (
                <p key={c.id}>{c.text}</p>
              ))}
            </details>
            <button className="panels-btn" onClick={() => onOpen(experiment!.id)}>
              Open saved experiment and replay tools
            </button>
          </>
        )}
      </section>
      <div className="research-actions">
        <button className="panels-btn" onClick={() => onTool("data")}>
          Backfill with Data Hub
        </button>
        <button className="panels-btn" onClick={() => onTool("convergence")}>
          Compare completed sources
        </button>
        <button className="panels-btn" onClick={() => onTool("notebooks")}>
          Document the decision
        </button>
      </div>
      <p>
        Convergence requires completed experiments from distinct sources. A completed run can still have source gaps or
        too few observations; review those before locking a comparison.
      </p>
    </section>
  );
}
