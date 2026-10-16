import type { MultiStressReport } from "../../shared/researchStress.mjs";
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
export function MultiStressResults({ report }: { report: MultiStressReport }) {
  const arms = [
    { id: "baseline", label: "Frozen baseline", removed: 0, result: report.baseline },
    ...report.scenarios.map((s) => ({
      id: s.scenario.id,
      label: s.scenario.label,
      removed: s.removed,
      result: s.result,
    })),
  ];
  return (
    <>
      {(["development", "holdout"] as const).map((period) => (
        <section key={period}>
          <h3>{period === "development" ? "Development" : "Previously evaluated holdout"}</h3>
          <div className="research-table" tabIndex={0} role="region" aria-label={`${period} stress comparisons`}>
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Variant</th>
                  <th>Total removed</th>
                  <th>Decisions / trades</th>
                  <th>Strategy</th>
                  <th>Full-window SPY</th>
                  <th>Excess</th>
                  <th>Engine exclusions</th>
                </tr>
              </thead>
              <tbody>
                {arms.flatMap(
                  (a) =>
                    a.result.periods[period]?.variants.map((v) => (
                      <tr key={`${a.id}:${v.id}`}>
                        <td>{a.label}</td>
                        <td>{v.label}</td>
                        <td>{a.removed}</td>
                        <td>
                          {v.counts.decisions} / {v.counts.executed}
                        </td>
                        <td>{pct(v.windowStats.strategyReturn)}</td>
                        <td>{pct(v.windowStats.benchmarkReturn)}</td>
                        <td>{pct(v.windowStats.excess)}</td>
                        <td>{v.counts.excluded}</td>
                      </tr>
                    )) || [],
                )}
              </tbody>
            </table>
          </div>
          <p>
            Window: {report.baseline.periods[period]?.from} to {report.baseline.periods[period]?.to}. Total removed
            covers all sources and periods. A strategy with no executed positions remains in cash; inspect its decision
            count and exclusions.
          </p>
        </section>
      ))}
      {report.scenarios.map((s) => (
        <details key={s.scenario.id}>
          <summary>{s.scenario.label} · source changes and ablations</summary>
          <p>{s.removed} publications removed across frozen sources. Cost changes apply to every variant.</p>
          <div className="research-table">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Omitted source</th>
                  <th>Combined minus omitted-source excess</th>
                  <th>Combined / other trades</th>
                </tr>
              </thead>
              <tbody>
                {(["development", "holdout"] as const).flatMap(
                  (period) =>
                    s.result.periods[period]?.ablations.map((a, i) => (
                      <tr key={`${period}:${i}`}>
                        <td>{period}</td>
                        <td>{a.source}</td>
                        <td>{a.deltaExcess == null ? "No comparison" : pct(a.deltaExcess)}</td>
                        <td>
                          {a.fullTrades} / {a.withoutTrades}
                        </td>
                      </tr>
                    )) || [],
                )}
              </tbody>
            </table>
          </div>
          <p>
            First 30 publication decisions. Export contains all source decisions, confirmation evidence, exclusions and
            statistical caveats.
          </p>
          <div className="research-table">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Publication</th>
                  <th>Original → scenario date</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {s.decisions.slice(0, 30).map((d) => (
                  <tr key={`${d.sourceId}:${d.signalId}`}>
                    <td>{d.sourceLabel}</td>
                    <td>{d.signalId}</td>
                    <td>
                      {d.originalPublicDate} → {d.scenarioPublicDate}
                    </td>
                    <td>{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </>
  );
}
