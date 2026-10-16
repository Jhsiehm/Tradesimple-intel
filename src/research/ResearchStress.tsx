import { ActivityFeedback } from "./ActivityFeedback";
import { MultiStressResults } from "./MultiStressResults";
import type { MultiStressReport, StressScenario, PriceChange } from "../../shared/researchStress.mjs";
import { useEffect, useState } from "react";
import { read, write, message, type ExperimentSummary } from "./api";
type Scenario = StressScenario;
type Result = {
  counts: { used: number; signals: number; skipped: number };
  stats: null | {
    total: number;
    benchmarkTotal: number;
    excessTotal: number;
    maxDrawdown: number;
    from: string;
    to: string;
  };
  caveats: { items: { text: string }[] };
};
type Report = {
  kind?: "single-source-stress";
  baseline: Result;
  scenarios: {
    scenario: Scenario;
    priceChanges?: PriceChange[];
    removed: number;
    retained: number;
    result: Result;
    delta: Record<string, number> | null;
    decisions: { signalId: string; originalPublicDate: string; scenarioPublicDate: string; reason: string }[];
  }[];
  caveats: string[];
};
type Plan = {
  id: string;
  title: string;
  hypothesis: string;
  createdAt: string;
  sourceRunId: string;
  sourceInputHash: string;
  priorPlans: number;
  scenarios: Scenario[];
  run: null | { id: string; result: { stress: Report | MultiStressReport } };
};
type Summary = { id: string; title: string; evaluated: boolean; scenarios: number };
const initial = (): Scenario => ({
  id: "scenario-1",
  label: "Seven-day reporting delay",
  delayDays: 7,
  missingPct: 0,
  seed: 42,
  extraCostBps: 0,
  extraSlippageBps: 0,
});
const pct = (n: number | undefined) => (n == null ? "No result" : `${(n * 100).toFixed(2)}%`);
function Rows({ report }: { report: Report }) {
  const rows = [
    { id: "baseline", label: "Frozen baseline", removed: 0, result: report.baseline },
    ...report.scenarios.map((s) => ({
      id: s.scenario.id,
      label: s.scenario.label,
      removed: s.removed,
      result: s.result,
    })),
  ];
  return (
    <div className="research-table">
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Removed signals</th>
            <th>Trades / eligible signals</th>
            <th>Strategy</th>
            <th>Matched benchmark</th>
            <th>Excess</th>
            <th>Max drawdown</th>
            <th>Exposure window</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td>{r.removed}</td>
              <td>
                {r.result.counts.used} / {r.result.counts.signals}
                <small>{r.result.counts.skipped} engine exclusions</small>
              </td>
              <td>{pct(r.result.stats?.total)}</td>
              <td>{pct(r.result.stats?.benchmarkTotal)}</td>
              <td>{pct(r.result.stats?.excessTotal)}</td>
              <td>{pct(r.result.stats?.maxDrawdown)}</td>
              <td>{r.result.stats ? `${r.result.stats.from} → ${r.result.stats.to}` : "No priced trades"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ResearchStress() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]),
    [plans, setPlans] = useState<Summary[]>([]),
    [selected, setSelected] = useState<Plan | null>(null);
  const [comparisons, setComparisons] = useState<{ id: string; title: string; evaluated: boolean }[]>([]),
    [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [experimentId, setExperimentId] = useState(""),
    [title, setTitle] = useState(""),
    [hypothesis, setHypothesis] = useState(""),
    [scenarios, setScenarios] = useState<Scenario[]>([initial()]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = async () => {
    const [e, p, c] = await Promise.all([
      read<{ items: ExperimentSummary[] }>("experiments"),
      read<{ items: Summary[] }>("stress"),
      read<{ items: { id: string; title: string; evaluated: boolean }[] }>("convergence"),
    ]);
    setExperiments(e.items);
    setPlans(p.items);
    setComparisons(c.items);
  };
  useEffect(() => {
    void load()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);
  const action = async (fn: () => Promise<void>) => {
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
  const chooseSource = (id: string) =>
    action(async () => {
      setExperimentId(id);
      setSources([]);
      setScenarios((rows) => rows.map(({ sourceIds, ...s }) => s));
      if (id.startsWith("cv:"))
        setSources(
          (await read<{ plan: { sources: { id: string; label: string }[] } }>(`convergence/${id.slice(3)}`)).plan
            .sources,
        );
    });
  const register = () =>
    action(async () => {
      const out = await write<{ plan: Plan }>("stress", {
        title,
        hypothesis,
        ...(experimentId.startsWith("cv:") ? { convergencePlanId: experimentId.slice(3) } : { experimentId }),
        scenarios,
      });
      setSelected(out.plan);
      await load();
      setNotice("Scenario assumptions are locked. Evaluate this plan to calculate every registered scenario.");
    });
  const evaluate = () =>
    action(async () => {
      if (!selected) return;
      const out = await write<{ plan: Plan }>(`stress/${selected.id}/evaluate`, {});
      setSelected(out.plan);
      await load();
      setNotice("Saved the baseline and every scenario using frozen inputs. No source data was fetched.");
    });
  const update = (index: number, patch: Partial<Scenario>) =>
    setScenarios((rows) => rows.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const report = selected?.run?.result.stress;
  const multi = report?.kind === "convergence-stress" ? report : null;
  const single = report && report.kind !== "convergence-stress" ? report : null;
  return (
    <div className="research-content research-stress">
      <h2>Stress tests</h2>
      <p>
        Test how a saved experiment changes under reporting delays, missing signals, higher costs and dated price
        shocks. Register assumptions before calculation. These are sensitivity checks on an already observed result, not
        a new out-of-sample test.
      </p>
      {loading && (
        <ActivityFeedback className="research-working">Loading experiments and stress plans…</ActivityFeedback>
      )}
      <details open={!selected}>
        <summary>Register stress assumptions</summary>
        <fieldset className="research-form" disabled={busy || loading}>
          <legend>New stress plan</legend>
          <label>
            Source experiment
            <select value={experimentId} onChange={(e) => void chooseSource(e.target.value)}>
              <option value="">Choose a completed experiment</option>
              {experiments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {e.status}
                </option>
              ))}
              {comparisons
                .filter((c) => c.evaluated)
                .map((c) => (
                  <option key={c.id} value={`cv:${c.id}`}>
                    Convergence · {c.title}
                  </option>
                ))}
            </select>
          </label>
          <p>
            Choose an audited single-source experiment or an already evaluated Convergence plan with the current engine.
            Stress cannot open an unseen holdout. Source data, windows and limitations stay frozen.
          </p>
          <label>
            Stress plan title
            <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Expected sensitivity
            <textarea maxLength={4000} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
          </label>
          {scenarios.map((s, index) => (
            <details className="research-scenario" key={s.id} open>
              <summary>
                Scenario {index + 1} · {s.label || "Untitled scenario"}
              </summary>
              <fieldset className="research-form">
                <legend>Scenario settings</legend>
                <label>
                  Scenario label
                  <input value={s.label} maxLength={200} onChange={(e) => update(index, { label: e.target.value })} />
                </label>
                <div className="research-mapping">
                  {sources.length > 0 && (
                    <label>
                      Source to delay or remove
                      <select
                        value={s.sourceIds?.[0] || ""}
                        onChange={(e) => update(index, { sourceIds: e.target.value ? [e.target.value] : undefined })}
                      >
                        <option value="">All frozen sources</option>
                        {sources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {(
                    [
                      ["delayDays", "Extra reporting delay (days)", 90],
                      ["missingPct", "Missing signals (%)", 100],
                      ["seed", "Missingness seed", 4294967295],
                      ["extraCostBps", "Extra cost per side (bps)", 300],
                      ["extraSlippageBps", "Extra slippage per side (bps)", 300],
                    ] as const
                  ).map(([key, label, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        max={max}
                        step={key === "delayDays" || key === "seed" ? 1 : "any"}
                        value={Number.isFinite(s[key]) ? s[key] : ""}
                        onChange={(e) => update(index, { [key]: e.target.value === "" ? NaN : Number(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(s.priceShock)}
                    onChange={(e) =>
                      update(index, {
                        priceShock: e.target.checked ? { date: "", changePct: -20, symbols: [] } : undefined,
                      })
                    }
                  />
                  Add a hypothetical price shock
                </label>
                {s.priceShock && (
                  <>
                    <div className="research-mapping">
                      <label>
                        Shock date
                        <input
                          type="date"
                          value={s.priceShock.date}
                          onChange={(e) => update(index, { priceShock: { ...s.priceShock!, date: e.target.value } })}
                        />
                      </label>
                      <label>
                        Price change (%)
                        <input
                          type="number"
                          min={-95}
                          max={500}
                          step="any"
                          value={Number.isFinite(s.priceShock.changePct) ? s.priceShock.changePct : ""}
                          onChange={(e) =>
                            update(index, {
                              priceShock: {
                                ...s.priceShock!,
                                changePct: e.target.value === "" ? NaN : Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Symbols to shock
                        <input
                          placeholder="AAPL, SPY"
                          value={s.priceShock.symbols.join(",")}
                          onChange={(e) =>
                            update(index, {
                              priceShock: {
                                ...s.priceShock!,
                                symbols: e.target.value
                                  .toUpperCase()
                                  .split(",")
                                  .map((value) => value.trim()),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <p>
                      Apply one lasting price-level change from this date onward. Use exact frozen ticker or benchmark
                      symbols, separated by commas. A symbol used as both asset and benchmark changes in both places.
                      Other symbols stay unchanged. Saved bars must exist before and on/after the date; this does not
                      simulate regulatory causality or market spillovers.
                    </p>
                  </>
                )}
                {scenarios.length > 1 && (
                  <button
                    className="panels-btn"
                    onClick={() => setScenarios((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Remove scenario {index + 1}
                  </button>
                )}
              </fieldset>
            </details>
          ))}
          <details>
            <summary>Scenario calculation rules</summary>
            <p>
              Missingness removes a fixed seeded subset of publication IDs. Costs are added to the baseline; the total
              for each cost field must remain at or below 300 bps per side. Every scenario must change an assumption.
            </p>
          </details>
          <div className="research-actions">
            <button
              className="panels-btn"
              disabled={scenarios.length >= (experimentId.startsWith("cv:") ? 6 : 12)}
              onClick={() =>
                setScenarios((rows) => [
                  ...rows,
                  {
                    ...initial(),
                    id: `scenario-${Math.max(...rows.map((s) => Number(s.id.split("-")[1]))) + 1}`,
                    label: "Higher trading costs",
                    delayDays: 0,
                    extraCostBps: 10,
                  },
                ])
              }
            >
              Add scenario
            </button>
            <button
              className="bt-run"
              disabled={
                !experimentId ||
                !title.trim() ||
                !hypothesis.trim() ||
                scenarios.some(
                  (s) =>
                    !s.label.trim() ||
                    (s.priceShock &&
                      (!s.priceShock.date ||
                        !Number.isFinite(s.priceShock.changePct) ||
                        !s.priceShock.changePct ||
                        !s.priceShock.symbols.length ||
                        s.priceShock.symbols.some((symbol) => !symbol))) ||
                    Object.values(s).some((v) => typeof v === "number" && !Number.isFinite(v)),
                )
              }
              onClick={() => void register()}
            >
              Lock stress plan
            </button>
          </div>
        </fieldset>
      </details>
      {busy && <ActivityFeedback className="research-working">Working with frozen research inputs…</ActivityFeedback>}
      {error && (
        <p role="alert" className="bt-note warn">
          {error}
        </p>
      )}
      {notice && <ActivityFeedback>{notice}</ActivityFeedback>}
      <div className="data-workbench" data-selected={Boolean(selected)}>
        <aside className="data-library" aria-label="Registered plans">
          <h3>Registered plans</h3>
          {!loading && !plans.length ? (
            <p>No stress plans yet. Register the assumptions above to begin.</p>
          ) : (
            <div className="research-list">
              {plans.map((p) => (
                <button
                  className="research-item"
                  key={p.id}
                  disabled={busy}
                  aria-pressed={selected?.id === p.id}
                  onClick={() =>
                    void action(async () => setSelected((await read<{ plan: Plan }>(`stress/${p.id}`)).plan))
                  }
                >
                  <strong>{p.title}</strong>
                  <span>
                    {p.scenarios} scenarios · {p.evaluated ? "Evaluated" : "Registered"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </aside>
        {selected && (
          <section key={selected.id} className="research-content research-result">
            <h3>{selected.title}</h3>
            <p>{selected.hypothesis}</p>
            <p>
              Registered {selected.createdAt} · {selected.priorPlans} earlier stress plans for this exact source run.
            </p>
            <details>
              <summary>Locked assumptions and source</summary>
              <p className="research-hash">
                Source run: {selected.sourceRunId}
                <br />
                Input checksum: {selected.sourceInputHash}
              </p>
              <pre className="research-hash">{JSON.stringify(selected.scenarios, null, 2)}</pre>
            </details>
            {!report && (
              <button className="bt-run" disabled={busy} onClick={() => void evaluate()}>
                Evaluate all registered scenarios
              </button>
            )}
            {report && (
              <>
                {report.scenarios
                  .filter((s) => s.scenario.priceShock)
                  .map((s) => (
                    <details key={s.scenario.id}>
                      <summary>{s.scenario.label} · price shock audit</summary>
                      <p>
                        {s.scenario.priceShock!.changePct}% from {s.scenario.priceShock!.date} on{" "}
                        {s.scenario.priceShock!.symbols.join(", ")}. Multiplier:{" "}
                        {1 + s.scenario.priceShock!.changePct / 100}. Original prices remain frozen in the export.
                      </p>
                      <ul>
                        {s.priceChanges?.map((change) => (
                          <li key={`${change.series}:${change.symbol}`}>
                            {change.symbol} ({change.series}): {change.affectedBars} bars changed, first affected date{" "}
                            {change.firstAffectedDate || "none"}.
                          </li>
                        ))}
                      </ul>
                      <p>
                        Subsequent percentage returns are preserved. Positions opened and closed entirely after the
                        shock may have unchanged returns.
                      </p>
                    </details>
                  ))}
                {multi ? <MultiStressResults report={multi} /> : single ? <Rows report={single} /> : null}
                <details>
                  <summary>Methods and limitations</summary>
                  <ul>
                    {report.caveats.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </details>
                <div className="research-actions">
                  <a className="panels-btn" href={`/api/research/runs/${selected.run!.id}/export`}>
                    Export stress run and source evidence
                  </a>
                  <button
                    className="panels-btn"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const out = await write<{ matches: boolean }>(`runs/${selected.run!.id}/replay`, {});
                        setNotice(
                          out.matches
                            ? "Stress replay verified: all scenario outputs match the frozen record."
                            : "Replay mismatch. Inspect the exported record.",
                        );
                      })
                    }
                  >
                    Verify stress replay
                  </button>
                </div>
                {single?.scenarios.map((s) => (
                  <details key={s.scenario.id}>
                    <summary>{s.scenario.label} · exclusions and signal changes</summary>
                    <ul>
                      {s.result.caveats.items.map((c, i) => (
                        <li key={i}>{c.text}</li>
                      ))}
                    </ul>
                    <p>First 20 signal decisions; the export contains every decision.</p>
                    <div className="research-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Signal</th>
                            <th>Original public date</th>
                            <th>Scenario public date</th>
                            <th>Decision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.decisions.slice(0, 20).map((d) => (
                            <tr key={d.signalId}>
                              <td>{d.signalId}</td>
                              <td>{d.originalPublicDate}</td>
                              <td>{d.scenarioPublicDate}</td>
                              <td>{d.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
