import { reusedLabel } from "../../shared/answerCache.mjs";
import { missingNote } from "../../shared/slots.mjs";
import { spendLine } from "../../shared/spend.mjs";
import type { AskStatus, Turn } from "./types";
import "./spend.css";

/** "$3.21 of $20 this month" in the sheet header; amber from 80% of the budget, with the budget note on hover. */
export function SpendLine({ status }: { status: AskStatus | null }) {
  const spend = status?.spend;
  const text = spendLine(spend);
  if (!spend || !text) return null;
  const title = [
    spend.note || "Estimated Ask model spend this month (US Eastern), including scheduled tasks and web searches.",
    spend.tasks ? `Scheduled tasks: $${spend.tasks.toFixed(2)}.` : "",
    spend.web ? `Web searches: $${spend.web.toFixed(2)}.` : "",
    spend.estimated ? `$${spend.estimated.toFixed(2)} priced from the price table (the provider reported no cost).` : "",
    "Set the cap with ASK_MONTHLY_BUDGET_USD."
  ].filter(Boolean).join(" ");
  return <span className="ask-spend" data-level={spend.level} title={title}>{text}</span>;
}

/** Under a replayed answer: when it was written, and Re-ask to run it again. Then any figure that did not fill. */
export function ReuseNote({ turn, busy, onReask }: { turn: Turn; busy: boolean; onReask: () => void }) {
  const done = turn.done;
  if (!done) return null;
  const missing = missingNote(done.slots?.missing || []);
  return (
    <>
      {done.reused ? (
        <p className="ask-reused" role="status">
          {reusedLabel(done.reused.at)}{done.reused.model ? ` · ${done.reused.model}` : ""}
          <button type="button" className="link" disabled={busy} onClick={onReask}>Re-ask</button>
        </p>
      ) : null}
      {missing ? <p className="ask-warn">{missing}</p> : null}
    </>
  );
}
