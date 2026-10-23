/** Study tools are owner-local. Controlled notebook memory grants no dataset or study access. */
export const INVESTIGATION_TOOL_NAMES = new Set([
  "research_sources",
  "research_create_investigation",
  "research_run_investigation",
  "research_inspect_investigation",
  "research_amend_investigation",
  "research_replay_investigation",
]);
export const POLICY_TOOL_NAMES = new Set(["research_policy_create", "research_policy_inspect", "research_policy_collect", "research_policy_evaluate", "research_policy_replay"]);
export const INVESTIGATION_WRITE_TOOLS = new Set(["research_prepare_dataset_observations","research_create_investigation", "research_run_investigation", "research_amend_investigation", "research_policy_create", "research_policy_collect", "research_policy_evaluate"]);
export const OWNER_RESEARCH_TOOL_NAMES = new Set([...INVESTIGATION_TOOL_NAMES, "research_prepare_dataset_observations", ...POLICY_TOOL_NAMES, "research_audit_saved_studies"]);

export function investigationAccessRefusal(name, { memory, scheduled, sourcing } = {}) {
  if (!OWNER_RESEARCH_TOOL_NAMES.has(name)) return "";
  if (memory) return "Study datasets and investigations are outside this controlled notebook-memory scope.";
  if (scheduled) return "General study tools are unavailable in scheduled prompts; use an explicit investigation.";
  if (sourcing === "web") return "Saved platform datasets and investigations are unavailable with web-only sourcing.";
  return "";
}
