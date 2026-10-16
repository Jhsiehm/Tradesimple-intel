import { ActivityFeedback } from "./ActivityFeedback";
import { PaperTrading } from "./PaperTrading";
import { ResearchToolNav } from "./ResearchToolNav";
import { AnalysisHistory } from "./AnalysisHistory";
import { EventStudies } from "./EventStudies";
import { ResearchStress } from "./ResearchStress";
import { ResearchPairs } from "./ResearchPairs";
import { ResearchMemory } from "./ResearchMemory";
import { RelationshipEligibility, emptyRelationshipDraft, parseRelationshipDraft } from "./RelationshipEligibility";
import { RelationshipHistory } from "./RelationshipHistory";
import type { AskApi } from "../ask/useAsk";
import type { AgentContext } from "../agent/context";
import { GuidedExperiment } from "./GuidedExperiment";
import { ContractEvidence } from "./ContractEvidence";
import { ResearchHome } from "./ResearchHome";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_RULES } from "../../shared/backtestSpec.mjs";
import type { StageList } from "../types";
import { DEMO } from "../lib/api";
import { BacktestResults } from "../backtest/BacktestResults";
import { Notebooks } from "./Notebooks";
import { ConvergenceLab } from "./ConvergenceLab";
import { DataHub, EventTable } from "./DataHub";
import { read, write, message, type DatasetSummary, type Experiment, type ExperimentSummary } from "./api";
import "../backtest/backtest.css";
import "./research.css";
import "./workspace.css";
export function ResearchBoard({
  ask,
  context,
  onClose,
  onFollow,
  onList,
}: {
  ask: AskApi;
  context: AgentContext;
  onClose: () => void;
  onFollow: (action: string) => void;
  onList: (list: StageList) => void;
}) {
  const [tab, setTab] = useState<
    | "experiments"
    | "data"
    | "convergence"
    | "notebooks"
    | "home"
    | "guided"
    | "contractEvidence"
    | "relationships"
    | "memory"
    | "pairs"
    | "stress"
    | "eventStudies"
    | "analyses"
    | "paper"
  >("home");
  const [items, setItems] = useState<ExperimentSummary[]>([]),
    [selected, setSelected] = useState<Experiment | null>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null),
    [title, setTitle] = useState(""),
    [hypothesis, setHypothesis] = useState("");
  const [holdDays, setHoldDays] = useState(30),
    [costBps, setCostBps] = useState(5),
    [slippageBps, setSlippageBps] = useState(5),
    [sides, setSides] = useState("buy");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [relationshipDraft, setRelationshipDraft] = useState(emptyRelationshipDraft);
  const relationship = parseRelationshipDraft(relationshipDraft);
  const ticket = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab !== "home") bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);
  useEffect(() => {
    ask.setHome(tab === "home");
  }, [tab, ask.setHome]);
  const [copied, setCopied] = useState(false);
  const load = async () => {
    const out = await read<{ items: ExperimentSummary[] }>("experiments");
    setItems(out.items || []);
  };
  useEffect(() => {
    void load()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    onList({
      title: "Research",
      blurb: "Experiments and versioned datasets",
      empty: "Inspect saved experiments in the center board.",
      items: [],
      status: {
        source: "Local research registry",
        asOf: selected?.createdAt || "",
        latency: "Frozen snapshots; original feed timing is preserved per run.",
      },
    });
  }, [onList, selected]);
  const open = async (id: string) => {
    const t = ++ticket.current;
    setError("");
    setNotice("");
    setDataset(null);
    setBusy(true);
    try {
      const out = await read<{ experiment: Experiment }>(`experiments/${id}`);
      if (t === ticket.current) {
        setSelected(out.experiment);
        setItems((current) =>
          current.some((e) => e.id === out.experiment.id) ? current : [out.experiment, ...current],
        );
        setTab("experiments");
        setCopied(false);
        history.replaceState(null, "", `#research/${out.experiment.id}`);
      }
    } catch (e) {
      if (t === ticket.current) setError(message(e));
    } finally {
      if (t === ticket.current) setBusy(false);
    }
  };
  useEffect(() => {
    const onHash = () => {
      const id = location.hash.match(/^#research\/(exp_[a-f0-9]+)$/)?.[1];
      if (id) void open(id);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => {
      ticket.current++;
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  const run = async (fresh?: Experiment) => {
    if (!fresh && relationship.error) {
      setError(relationship.error);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await write<{ experiment: Experiment }>(
        "run",
        fresh
          ? {
              title: `${fresh.title.slice(0, 180)} · rerun`,
              hypothesis: fresh.hypothesis,
              parentId: fresh.id,
              spec: fresh.run.result.spec,
              datasetId: fresh.run.provenance.dataset?.id,
              rules: fresh.run.result.spec.rules,
            }
          : {
              title,
              hypothesis,
              datasetId: dataset?.id,
              relationship: relationship.policy,
              rules: { ...DEFAULT_RULES, holdDays, costBps, slippageBps, sides },
            },
      );
      setSelected(out.experiment);
      setTab("experiments");
      setCopied(false);
      history.replaceState(null, "", `#research/${out.experiment.id}`);
      setDataset(null);
      await load();
      setNotice(
        out.experiment.run.result.ok
          ? "Saved a new immutable run. Inspect its coverage and caveats below."
          : "The run failed and its error was preserved. You can rerun it later.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const replay = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const out = await write<{ matches: boolean }>(`runs/${selected.runId}/replay`, {});
      setNotice(
        out.matches
          ? "Replay verified: all engine outputs and statistical checks match the saved run exactly. No data was fetched."
          : "Replay mismatch. Export and inspect this run before relying on it.",
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const result = selected?.run.result;
  return (
    <div className="board bt research" data-home={tab === "home"}>
      <header className="board-head">
        <div className="board-title">
          <strong>Research</strong>
          <span>Preserve what you tested and the evidence behind it.</span>
          <button className="tl-close" onClick={onClose} aria-label="Close research">
            ×
          </button>
        </div>
        {tab === "home" ? (
          <div className="bt-tabs">
            <button className="on" onClick={() => setTab("home")}>
              Research home
            </button>
            <button onClick={() => setTab("guided")}>Guided experiment</button>
            <button onClick={() => setTab("contractEvidence")}>Contract evidence</button>
            <button onClick={() => setTab("experiments")}>Experiments</button>
            <button onClick={() => setTab("data")}>Data Hub</button>
            <button onClick={() => setTab("convergence")}>Convergence</button>
            <button onClick={() => setTab("eventStudies")}>Event studies</button>
            <button onClick={() => setTab("stress")}>Stress tests</button>
            <button onClick={() => setTab("relationships")}>Relationships</button>
            <button onClick={() => setTab("memory")}>Memory</button>
            <button onClick={() => setTab("notebooks")}>Notebooks</button>
          </div>
        ) : (
          <ResearchToolNav value={tab} onSelect={setTab} />
        )}
      </header>
      <div ref={bodyRef} className="board-scroll bt-body">
        {tab !== "experiments" && error && (
          <p role="alert" className="bt-note warn">
            {error}
          </p>
        )}
        {DEMO ? (
          <p className="bt-note">
            The research registry requires the local server and is not available in the static demo.
          </p>
        ) : tab === "home" ? (
          ask.open ? (
            <div className="research-portable-placeholder">
              <p>Your investigation is open in the portable panel.</p>
              <button className="bt-run" onClick={ask.close}>
                Return conversation here
              </button>
            </div>
          ) : (
            <ResearchHome ask={ask} context={context} onFollow={onFollow} onTool={setTab} />
          )
        ) : tab === "guided" ? (
          <GuidedExperiment onOpen={(id) => void open(id)} onTool={setTab} />
        ) : tab === "contractEvidence" ? (
          <ContractEvidence
            onDataset={(id) => {
              void read<{ dataset: DatasetSummary }>("datasets/" + id)
                .then((out) => {
                  setDataset(out.dataset);
                  setTitle(out.dataset.name + " v" + out.dataset.version);
                  setHypothesis("");
                  setSelected(null);
                  setTab("experiments");
                  setNotice("");
                  setError("");
                })
                .catch((e) => setError(message(e)));
            }}
          />
        ) : tab === "paper" ? (
          <PaperTrading />
        ) : tab === "analyses" ? (
          <AnalysisHistory />
        ) : tab === "pairs" ? (
          <ResearchPairs ask={ask} onBack={() => setTab("memory")} />
        ) : tab === "memory" ? (
          <ResearchMemory
            onHistory={() => setTab("analyses")}
            ask={ask}
            onPairs={() => setTab("pairs")}
            onNotebooks={() => setTab("notebooks")}
            onStart={(question, memory) => {
              ask.setHome(true);
              setTab("home");
              void ask.run(question, { memory });
            }}
          />
        ) : tab === "eventStudies" ? (
          <EventStudies />
        ) : tab === "stress" ? (
          <ResearchStress />
        ) : tab === "relationships" ? (
          <RelationshipHistory />
        ) : tab === "notebooks" ? (
          <Notebooks />
        ) : tab === "convergence" ? (
          <ConvergenceLab />
        ) : tab === "data" ? (
          <DataHub
            onRun={(d) => {
              ticket.current++;
              setDataset(d);
              setTitle(`${d.name} v${d.version}`);
              setHypothesis("");
              setSelected(null);
              history.replaceState(null, "", "#research");
              setTab("experiments");
              setNotice("");
              setError("");
            }}
          />
        ) : (
          <section className="research-content">
            <h2>Experiments</h2>
            <p className="bt-note">
              Saved runs are immutable. Replay uses frozen inputs; rerun creates a new record. Imports and experiments
              belong to this server’s owner. Source timestamps are retained; institutional team permissions are not part
              of this release.
            </p>
            {loading && <ActivityFeedback className="research-working">Loading experiments…</ActivityFeedback>}
            <div className="research-actions">
              <button className="panels-btn" onClick={() => onFollow("bt:")}>
                Open Backtest
              </button>
              <button className="panels-btn" onClick={() => setTab("data")}>
                Import dataset
              </button>
            </div>
            {!loading && !items.length && !dataset && !selected && (
              <p>
                Save a result from Backtest, or import transaction signals to create your first experiment. Failed and
                negative results can be preserved too.
              </p>
            )}
            {items.length > 0 && (
              <details className="research-library-disclosure" open={!selected}>
                <summary>Saved experiments · {items.length}</summary>
                <div className="research-list">
                  {items.map((e) => (
                    <button
                      disabled={busy}
                      aria-pressed={selected?.id === e.id}
                      className="research-item"
                      key={e.id}
                      onClick={() => void open(e.id)}
                    >
                      <strong>{e.title}</strong>
                      <span>
                        {e.status} · {e.createdAt.slice(0, 19).replace("T", " ")} UTC
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            )}
            {dataset && (
              <fieldset disabled={busy} className="research-form">
                <legend>
                  New experiment · {dataset.name} v{dataset.version}
                </legend>
                <label>
                  Title
                  <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                  Hypothesis
                  <textarea value={hypothesis} maxLength={4000} onChange={(e) => setHypothesis(e.target.value)} />
                </label>
                <div className="research-mapping">
                  <label>
                    Hold (calendar days)
                    <input
                      type="number"
                      min={1}
                      max={730}
                      value={holdDays}
                      onChange={(e) => setHoldDays(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Cost per side (bps)
                    <input
                      type="number"
                      min={0}
                      max={300}
                      value={costBps}
                      onChange={(e) => setCostBps(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Slippage per side (bps)
                    <input
                      type="number"
                      min={0}
                      max={300}
                      value={slippageBps}
                      onChange={(e) => setSlippageBps(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Signal side
                    <select value={sides} onChange={(e) => setSides(e.target.value)}>
                      <option value="buy">Buys</option>
                      <option value="sell">Sells as shorts</option>
                      <option value="both">Both</option>
                    </select>
                  </label>
                </div>
                <p>
                  SPY benchmark · equal weight · entry on the next trading day at the open. Price history is retrieved
                  from the existing market feed, then frozen with the run.
                </p>
                <RelationshipEligibility value={relationshipDraft} onChange={setRelationshipDraft} />
                {relationship.error && <p role="alert">{relationship.error}</p>}
                <button
                  className="bt-run"
                  disabled={
                    Boolean(relationship.error) ||
                    !title.trim() ||
                    !Number.isFinite(holdDays) ||
                    holdDays < 1 ||
                    holdDays > 730 ||
                    costBps < 0 ||
                    costBps > 300 ||
                    slippageBps < 0 ||
                    slippageBps > 300
                  }
                  onClick={() => void run()}
                >
                  Run and save experiment
                </button>
              </fieldset>
            )}
            {busy && (
              <ActivityFeedback className="research-working">
                Working… A new run can take up to a minute while source data loads.
              </ActivityFeedback>
            )}
            {error && (
              <p role="alert" className="bt-note warn">
                {error}
              </p>
            )}
            {notice && <ActivityFeedback className="bt-note">{notice}</ActivityFeedback>}
            {selected && (
              <section key={selected.id} className="research-content research-result">
                <h2>{selected.title}</h2>
                <p>{selected.hypothesis || "No hypothesis recorded."}</p>
                <p>
                  Saved {selected.createdAt} ·{" "}
                  {!result?.ok ? "Run failed" : result.building ? "Partial input coverage" : "Run completed"}
                  {selected.parentId ? ` · derived from ${selected.parentId}` : ""}
                </p>
                <div className="research-actions">
                  <button
                    className="panels-btn"
                    disabled={busy || !selected.run.inputCounts}
                    onClick={() => void replay()}
                  >
                    Verify offline replay
                  </button>
                  <a className="panels-btn" href={`/api/research/runs/${selected.runId}/export`}>
                    Export frozen run
                  </a>
                  <button className="panels-btn" disabled={busy} onClick={() => void run(selected)}>
                    Rerun as new experiment
                  </button>
                </div>
                {selected.run.provenance.relationship && (
                  <details>
                    <summary>Frozen relationship eligibility</summary>
                    <p>
                      {selected.run.provenance.relationship.eligible} eligible ·{" "}
                      {selected.run.provenance.relationship.excluded} excluded from{" "}
                      {selected.run.provenance.relationship.received} timing-eligible signals.
                    </p>
                    <p>
                      {selected.run.provenance.relationship.snapshot.name} v
                      {selected.run.provenance.relationship.snapshot.version} ·{" "}
                      {(
                        selected.run.provenance.relationship.policy.path || [
                          selected.run.provenance.relationship.policy.predicate,
                        ]
                      ).join(" → ")}{" "}
                      {selected.run.provenance.relationship.policy.object}
                    </p>
                    {selected.run.provenance.relationship.policy.minPathWeight !== undefined && (
                      <>
                        <p>
                          Minimum path weight: {selected.run.provenance.relationship.policy.minPathWeight}. The
                          strongest fully weighted known path is used; this does not set position sizes.
                        </p>
                        <div
                          className="research-table"
                          tabIndex={0}
                          role="region"
                          aria-label="Weighted relationship decisions"
                        >
                          <table>
                            <thead>
                              <tr>
                                <th>Signal / ticker</th>
                                <th>Path weight</th>
                                <th>Decision</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selected.run.provenance.relationship.decisions?.slice(0, 20).map((d) => (
                                <tr key={d.signalId}>
                                  <td>
                                    {d.signalId}
                                    <small>{d.symbol}</small>
                                  </td>
                                  <td>{d.pathWeight ?? "Unknown"}</td>
                                  <td>{d.reason.replaceAll("-", " ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p>First 20 decisions shown. Export contains every decision and exact assertion IDs.</p>
                      </>
                    )}
                    <p>
                      Resolved at each signal’s public date. Researcher-supplied identities and availability are not
                      independently verified.
                    </p>
                    <pre className="research-hash">
                      {JSON.stringify(selected.run.provenance.relationship.policy.subjects, null, 2)}
                    </pre>
                    <p>Export the frozen run for the full snapshot and per-signal exclusions.</p>
                  </details>
                )}
                <details>
                  <summary>Input manifest and event lineage</summary>
                  <p>
                    {selected.run.inputCounts
                      ? `${selected.run.inputCounts.signals} engine signals · ${selected.run.inputCounts.priced} priced symbols · ${selected.run.inputCounts.benchmarks} benchmarks`
                      : "No calculation inputs: see the recorded failure."}
                  </p>
                  <p>
                    {selected.run.provenance.recordCount} source records preserved ·{" "}
                    {selected.run.provenance.matchedSignals} matched signals before caps.
                  </p>
                  <p>{selected.run.provenance.identityBasis}</p>
                  <p className="research-hash">
                    Input checksum: {selected.run.inputHash}
                    <br />
                    Engine checksum: {selected.run.engineId}
                    <br />
                    Identity version: {selected.run.provenance.identityVersion}
                  </p>
                  {selected.run.provenance.events.length > 0 && (
                    <>
                      <p>
                        First 20 normalized events; export contains all inputs and source records retained by the
                        adapters.
                      </p>
                      <EventTable events={selected.run.provenance.events} />
                    </>
                  )}
                </details>
                {result?.ok ? (
                  <BacktestResults
                    frozen
                    key={selected.runId}
                    run={{ ...result, runId: selected.runId }}
                    onFollow={onFollow}
                    onCopy={() => {
                      void navigator.clipboard
                        ?.writeText(`${location.origin}${location.pathname}#research/${selected.id}`)
                        .then(() => setCopied(true))
                        .catch((e) => setError(message(e)));
                    }}
                    copied={copied}
                  />
                ) : (
                  <p className="bt-note warn">{result?.error || "Run did not produce a result."}</p>
                )}
              </section>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
