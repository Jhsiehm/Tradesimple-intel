import { isGreeting, greetingText } from "../../shared/agent.mjs";
import {
  isModeClear,
  isModeStatement,
  parseSourcing,
  parseStyle,
  mergeSession,
  SOURCING_LABEL,
  STYLE_LABEL,
} from "../../shared/askModes.mjs";
import { isPrefClear, isPrefStatement, parsePrefs, describeValue } from "../../shared/backtestAsk.mjs";
import { describeModes } from "../../shared/askModes.mjs";
export function createQuickReply({ emit, now, t0, model, modes }) {
  return (answer, extra = {}) => {
    emit({ type: "step_progress", phase: "writing" });
    if (answer) emit({ type: "token", delta: answer });
    emit({
      type: "done",
      answer,
      cited: [],
      unknown: [],
      grounding: { checked: 0, unmatched: [], mislabeled: [], miscited: [], uncitedRows: [], scope: [] },
      uncited: false,
      noTools: false,
      greeting: false,
      caveats: [],
      usage: { tokens: 0, toolCalls: 0 },
      ms: now() - t0,
      stopped: "",
      model,
      theory: null,
      table: null,
      retried: false,
      backtests: [],
      clarify: false,
      prefs: null,
      revision: null,
      session: null,
      modes: { sourcing: modes.sourcing, style: modes.style, label: describeModes(modes) },
      ...extra,
    });
    return { modelCalled: false };
  };
}

export function handleQuickQuestion({ question, history, attached, session, now, quick }) {
  if (isGreeting(question) && !history.length && !attached) return quick(greetingText(), { greeting: true });
  if (isModeClear(question)) {
    return quick(
      "Cleared Ask sourcing and style. New answers default to TradeSimple only · terminal style until you change them.",
      { session: { clear: true } },
    );
  }
  if (isModeStatement(question)) {
    const patch = { sourcing: parseSourcing(question) || undefined, style: parseStyle(question) || undefined };
    const next = mergeSession(session, patch, new Date(now()).toISOString());
    const bits = [];
    if (patch.sourcing) bits.push(`sourcing → ${SOURCING_LABEL[patch.sourcing]}`);
    if (patch.style) bits.push(`style → ${STYLE_LABEL[patch.style]}`);
    return quick(
      `Saved for this browser: ${bits.join("; ") || describeModes({ sourcing: next.sourcing || "platform", style: next.style || "terminal" })}.\n\nSay “TradeSimple only”, “use TradeSimple and the web”, or “simplified” any time — including as a follow-up.`,
      { session: { set: next } },
    );
  }
  if (isPrefClear(question))
    return quick("Cleared your backtest preferences. New backtests use the app defaults until you set new ones.", {
      prefs: { clear: true },
    });
  if (isPrefStatement(question)) {
    const values = parsePrefs(question);
    const list = Object.entries(values)
      .map(([p, v]) => `- ${describeValue(p, v)}`)
      .join("\n");
    return quick(
      `Saved as your backtest defaults:\n${list}\n\nThey apply to new backtests unless a question says otherwise. Edit or clear them under Preferences in this panel.`,
      { prefs: { set: values } },
    );
  }

  return null;
}
