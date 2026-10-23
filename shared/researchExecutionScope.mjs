/** Explicit planning requests do not authorize executing a calculation described in the plan. */
export function designOnlyRequested(question) {
  const text = String(question || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ");
  return (
    /\b(?:research\s+)?(?:design|plan|protocol)\s+only\b/.test(text) ||
    (/\b(?:draft|design|propose|plan)\b/.test(text) &&
      /\b(?:do not|don't|never)\s+(?:execute|run|perform)\s+(?:(?:any|a|an|the|new)\s+)*(?:calculations?|analys[ei]s|experiments?|backtests?|replays?|workflows?)\b/.test(
        text,
      ))
  );
}

/** A described backtest or a change to a plan is not an execution command. */
export function executionRequested(question) {
  const text = String(question || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return /(?:^|[.;!?]\s*|\b(?:and|then|also|now)\s+)(?:(?:can|could|would|will)\s+you\s+|please\s+|go ahead(?: and)?\s+|i (?:want|would like) (?:you )?to\s+)*(?:run|execute|perform|re-?run|back-?test|replay|optimi[sz]e)\b/.test(
    text,
  );
}

/** Inspection applies to both frozen legacy studies and composed investigations. */
export function inspectionOnlyRequested(question) {
  const text = String(question || "").toLowerCase();
  return (
    !executionRequested(text) &&
    /\b(?:inspect|review|audit|compare|explain|check|describe)\b/.test(text) &&
    (/\b(?:saved|stored|frozen)\s+(?:[\w'-]+\s+){0,8}(?:stud(?:y|ies)|investigations?|experiments?|backtests?|results?)\b/.test(
      text,
    ) ||
      /\binv_[a-f0-9]{32}\b/.test(text))
  );
}

/** Planning edits retain the user's last supplied scope until an explicit execution request. */
export function resolveDesignOnly(question, history = []) {
  if (designOnlyRequested(question)) return true;
  if (executionRequested(question) || inspectionOnlyRequested(question)) return false;
  for (const turn of (Array.isArray(history) ? history : []).slice(-32).reverse()) {
    if (turn?.role !== "user") continue;
    if (designOnlyRequested(turn.content)) return true;
    if (executionRequested(turn.content)) return false;
  }
  return false;
}

const EXECUTION_TOOLS = new Set(["run_backtest", "search_signals", "research_run_investigation"]);

export function researchExecutionRefusal(intent, tool) {
  if (intent?.inspectionOnly && (EXECUTION_TOOLS.has(tool) || tool === "research_create_investigation"))
    return "This task requests inspection of saved evidence, not a fresh calculation or new study. Do not create or execute a study unless the user explicitly requests it.";
  if (intent?.designOnly && EXECUTION_TOOLS.has(tool))
    return "This task requests a research design only. Inspect evidence and propose or save a protocol, but do not execute calculations until the user requests execution.";
  return "";
}
