/** Saved-result review is evidence inspection, never an instruction to run a replacement strategy. */
export function savedStudyAuditArgs(question) {
  const text = String(question || "");
  if (
    !/\b(?:saved|stored|frozen)\s+(?:[\w-]+\s+){0,6}(?:stud(?:y|ies)|experiments?|backtests?|results?)\b/i.test(text) ||
    !/\b(?:compare|review|audit|inspect|explain|check)\b/i.test(text)
  )
    return null;
  // A requested fresh execution keeps its execution/assessment route; reviewing its result is secondary.
  const actions = text
    .toLowerCase()
    .replace(
      /\b(?:do not|don't|never|without)\s+(?:re-?run|back-?test|replay)(?:\s+(?:or|and)\s+(?:re-?run|back-?test|replay))*/g,
      " ",
    );
  if (
    /(?:^|\b(?:and|then|also|please|now|to|you)\s+|[,;.!?]\s*)(?:re-?run|back-?test|replay)\b/i.test(actions) ||
    /\b(?:run|execute)\s+(?:(?:an?|the|my|new|saved|these|those|this|that)\s+)*(?:back-?test|replay|stud(?:y|ies)|experiment|workflow|analysis)\b/i.test(
      actions,
    )
  )
    return null;
  const experimentIds = [...new Set(text.match(/\bexp_[a-f0-9]{32}\b/g) || [])];
  const datasetIds = [...new Set(text.match(/\bds_[a-f0-9]{32}\b/g) || [])];
  if (experimentIds.length) return { experimentIds: experimentIds.slice(0, 4) };
  if (datasetIds.length) return { datasetIds: datasetIds.slice(0, 4) };
  return {};
}

export const STUDY_AUDIT_NOTE = [
  "Saved-study review: use research_audit_saved_studies for experiment comparisons and coverage/timing claims. research_memory alone is a summary, not a collection audit.",
  "The audit inspects frozen saved evidence; it does not execute or replay a calculation. Only an actual replay result can establish a replay match. A saved successful calculation does not establish complete source coverage, historical tradability or scientific validity.",
  "No-ID discovery is bounded and selects latest saved experiments per dataset, not necessarily the studies the user named. Match exact IDs and requested datasets; if missing, state the selection gap and inspect exact IDs. Do not substitute an unrelated result or claim a census.",
  "Report collection status per study, raw receipts versus normalized versions versus selected signals, exclusions by reason, assumed publication dates, and unresolved historical ownership. Count reconciliation applies only to its declared scope, never an entire history.",
  "Compare rules and actual benchmark windows. Different cooldowns or windows prevent ranking signal quality from headline returns. Explain supported descriptive comparisons separately from unsupported causal, predictive or pre-news claims.",
  "Preserved legacy caveats can use the wrong source terminology. Prefer the audit's source-specific timing semantics: procurement availability gaps are not stock-filing deadlines. Entry after an assumed date cannot prove absence of look-ahead bias.",
  "Cite the exact audit ref in every table row and after each coverage, exclusion, timing or verification claim. Describe unknown or unsupported fields explicitly. A tool-call limit or outstanding grounding flag means the answer remains incomplete, not validated research.",
].join("\n");
