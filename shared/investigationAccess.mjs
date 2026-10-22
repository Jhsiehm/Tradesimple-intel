/** Study tools are owner-local. Controlled notebook memory grants no dataset or study access. */
export const INVESTIGATION_TOOL_NAMES = new Set([
  "research_sources",
  "research_create_investigation",
  "research_run_investigation",
  "research_inspect_investigation",
]);
export const INVESTIGATION_WRITE_TOOLS = new Set(["research_create_investigation", "research_run_investigation"]);

export function investigationAccessRefusal(name, { memory, scheduled, sourcing } = {}) {
  if (!INVESTIGATION_TOOL_NAMES.has(name)) return "";
  if (memory) return "Study datasets and investigations are outside this controlled notebook-memory scope.";
  if (scheduled) return "General study tools are unavailable in scheduled prompts; use an explicit investigation.";
  if (sourcing === "web") return "Saved platform datasets and investigations are unavailable with web-only sourcing.";
  return "";
}
