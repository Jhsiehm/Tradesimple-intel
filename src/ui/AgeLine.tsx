import { AGE_RULE, ageLine, freshnessLabel, tradeAge, type TradeAge } from "../../shared/tradeAge.mjs";
import "./age.css";

/**
 * "filed 2h ago · traded 38d ago · 38d filing lag" with a freshness tag on the trade date. Pass a row's `age`, or the
 * raw `kind` / `eventAt` / `filedAt`. Ages are recomputed at render, so they stay true as time passes.
 */
export function AgeLine({ age, kind = "", eventAt = "", filedAt = "", baseSeverity }: { age?: TradeAge | null; kind?: string; eventAt?: string; filedAt?: string; baseSeverity?: string }) {
  const now = Date.now();
  const a = tradeAge({ kind: age?.kind || kind, eventAt: age?.eventAt || eventAt, filedAt: age?.filedAt || filedAt }, now);
  const text = ageLine(a, now);
  if (!text) return null;
  const why = `${AGE_RULE}${baseSeverity ? ` Before the age rule this row was ${baseSeverity.toUpperCase()}.` : ""}`;
  return (
    <span className={`age-line${a.tier ? ` age-${a.tier}` : ""}`} title={why}>
      {a.tier && a.word ? <b className="age-tier">{freshnessLabel(a.tier)}</b> : null}
      <span>{text}</span>
      {baseSeverity ? <span className="age-down">aged from {baseSeverity}</span> : null}
    </span>
  );
}
