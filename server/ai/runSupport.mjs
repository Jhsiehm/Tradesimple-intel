/** Shared classifications and context-size accounting for the Ask loop. */
export const estimate = (messages) =>
  Math.ceil(
    messages.reduce((n, m) => n + String(m.content || "").length + JSON.stringify(m.toolCalls || "").length, 0) / 4,
  );
export const COMPUTE = new Set([
  "run_backtest",
  "research_run_investigation",
  "research_replay_investigation",
  "research_policy_evaluate",
  "research_policy_replay",
]);
export const WEB = new Set(["web_search", "web_fetch"]);
export const REF = /\[(t\d+(?:\s*,\s*t\d+)*)\]/g;
