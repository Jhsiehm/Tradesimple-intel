import { pTxt, type Reality } from "../../shared/backtestStats.mjs";

const pts = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const TONE: Record<string, string> = { beat: "up", worse: "down" };

/** Compact "Is it real?" panel: the verdict sentence, then the three checks behind it. */
export function IsItReal({ reality, compact = false }: { reality?: Reality | null; compact?: boolean }) {
  if (!reality) return null;
  const { bootstrap: b, placebo: p, cluster: c, verdict } = reality;
  return (
    <section className={`bt-real${compact ? " compact" : ""}`} aria-label="Is it real?">
      <h3>Is it real? <small>bootstrap, placebo, clustered t · seed {reality.seed}</small></h3>
      <p className={`bt-verdict ${TONE[verdict.level] || ""}`}>{verdict.text}</p>
      {b ? (
        <dl>
          <div title={`Resampling ${b.blocks} entry weeks, ${b.iters} times`}><dt>Mean trade, 95% CI</dt><dd>{pts(b.meanTrade.lo)} to {pts(b.meanTrade.hi)}</dd></div>
          <div title="Per-trade return minus the benchmark over the same days"><dt>Mean excess, 95% CI</dt><dd>{pts(b.meanExcess.lo)} to {pts(b.meanExcess.hi)}</dd></div>
          {p ? <div title={`Same tickers, side, hold; random public dates in the window. Placebo mean ${pts(p.placeboMean)} (middle 95%: ${pts(p.placeboLo)} to ${pts(p.placeboHi)})`}><dt>vs random entries</dt><dd>beat {Math.floor((p.pct ?? 0) * 100)}% of {p.iters} · {pTxt(p.p)}</dd></div> : null}
          {c ? <div title={`Standard error clustered by ${c.members} members, df ${c.df}`}><dt>t, clustered by member</dt><dd>{c.t == null ? "n/a (one member)" : `${c.t.toFixed(2)} · ${pTxt(c.pTwo)} two-sided`}</dd></div> : null}
          {c?.nEff != null ? <div title={`${c.members} members, ${c.weeks} entry weeks`}><dt>Effective sample</dt><dd>≈ {c.nEff} of {reality.n} trades</dd></div> : null}
        </dl>
      ) : null}
      {compact ? null : <p className="bt-basis">In-sample checks on one run. If this spec was picked after trying others, the p-value is too small: see Search for a multiple-testing-corrected view.</p>}
    </section>
  );
}
