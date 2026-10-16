import { ALERT_RULE } from "../../shared/intel.mjs";
import { AGE_RULE } from "../../shared/tradeAge.mjs";
import { RESEARCH_RULE } from "../../shared/taskSchedule.mjs";
import { when } from "../lib/api";

export type AlertSource = { label: string; source: string; asOf?: string; latency: string };

// Keep explanations tied to the same rules used elsewhere in the app.
const RULES = ALERT_RULE.split(/(?<=\.)\s+(?=[A-Z]+:|Otherwise)/);
const highRules = (RULES.find((rule) => rule.startsWith("HIGH:")) || "").replace(/^HIGH: /, "").split("; ");
const sentence = (text: string) => text.replace(/^or /, "").replace(/^\w/, (letter) => letter.toUpperCase());

export function AlertsGuide({ sources }: { sources: AlertSource[] }) {
  return (
    <div className="alerts-guide">
      <p className="alerts-intro">
        Highest priority first, then newest filing. Expand a topic to see how the queue works.
      </p>
      <details>
        <summary>
          <span className="sev-high">High priority</span>
          <small>Largest or most significant signals</small>
        </summary>
        <ul>
          {highRules.map((rule) => (
            <li key={rule}>{sentence(rule)}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>
          <span className="sev-elevated">Elevated priority</span>
          <small>Notable filings and activity</small>
        </summary>
        <p>{sentence((RULES.find((rule) => rule.startsWith("ELEVATED:")) || "").replace(/^ELEVATED: /, ""))}</p>
      </details>
      <details>
        <summary>
          <span>Routine & exceptions</span>
          <small>Other updates and planned sales</small>
        </summary>
        <p>{RULES.find((rule) => rule.startsWith("Otherwise"))}</p>
      </details>
      <details>
        <summary>
          <span>Trade age</span>
          <small>Why older trades can rank lower</small>
        </summary>
        <p>{AGE_RULE}</p>
      </details>
      {sources.some((source) => source.label === "Research tasks") ? (
        <details>
          <summary>Research task alerts</summary>
          <p>{RESEARCH_RULE}</p>
        </details>
      ) : null}
      <details>
        <summary>
          <span>Sources & timing</span>
          <small>Coverage, filing delays, and refreshes</small>
        </summary>
        <p>The queue covers the last 90 days by filed date. It refreshes every 5 minutes and after each live push.</p>
        <dl className="alerts-sources">
          {sources.map((source) => (
            <div key={source.label}>
              <dt>{source.label}</dt>
              <dd>{source.source}</dd>
              <dd>{source.latency}</dd>
              {source.asOf ? <dd>As of {when(source.asOf)}</dd> : null}
            </div>
          ))}
        </dl>
        {!sources.length ? <p>Source status will appear when the feed loads.</p> : null}
      </details>
    </div>
  );
}
