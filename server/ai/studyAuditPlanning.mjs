/** Saved-result review is evidence inspection, never an instruction to run a replacement strategy. */
export function savedStudyNames(question) {
  const text = String(question || "");
  const contexts = [
    ...[
      ...text.matchAll(
        /\b(?:saved|stored|frozen)\s+([^!?;\n]{0,200}?)\b(?:stud(?:y|ies)|experiments?|backtests?|results?)\b/gi,
      ),
    ].map((m) => m[1]),
    ...[
      ...text.matchAll(
        /\b(?:saved|stored|frozen)\s+(?:stud(?:y|ies)|experiments?|backtests?|results?)\s+(?:for|named|called|titled)\s+([^!?;\n]{1,160})/gi,
      ),
    ].map((m) => m[1].split(/\.(?:\s|$)/)[0].split(/\b(?:with|using|against|explain|show|export)\b/i)[0]),
  ];
  const prose = new Set(
    "I A AN THE MY OUR ALL AND OR AI API CSV PDF UTC USD JSON HTML ID IDS ETF ETFS LATEST NEWEST RECENT MOST FOUR THREE TWO ONE".split(
      " ",
    ),
  );
  const names = [];
  for (const context of contexts) {
    names.push(...[...context.matchAll(/["“]([^"”\n]{1,120})["”]/g)].map((m) => m[1].trim()));
    const rest = context.replace(/["“][^"”\n]*["”]/g, " ");
    for (const piece of rest.split(/\s+(?:and|or|versus|vs\.?)\s+|[,/&]/i)) {
      let name = piece
        .trim()
        .split(/\s+/)
        .filter((word) => !prose.has(word.toUpperCase()))
        .join(" ");
      // A source descriptor following a ticker is not part of that ticker's name.
      const described =
        /^(\$?[a-z][a-z0-9]{0,7}(?:[.-][a-z])?)\s+(?:procurement|contracts?|legislative|legislation|regulatory|regulation|insider|congressional|stock|portfolio)(?:\s+[\w-]+)*$/i.exec(
          name,
        );
      if (described) name = described[1];
      if (/^\$?[a-z][a-z0-9]{0,7}(?:[.-][a-z])?$/i.test(name)) name = name.replace(/^\$/, "").toUpperCase();
      if (name && name.length <= 120) names.push(name);
    }
  }
  const seen = new Set();
  return names
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}
export function savedStudyAuditArgs(question) {
  const text = String(question || "");
  if (
    !/\b(?:saved|stored|frozen)\s+[^!?;\n]{0,240}?\b(?:stud(?:y|ies)|experiments?|backtests?|results?)\b/i.test(text) ||
    !/\b(?:compare|review|audit|inspect|explain|check)\b/i.test(text)
  )
    return null;
  // A requested fresh execution keeps its execution/assessment route; reviewing its result is secondary.
  const actions = text
    .toLowerCase()
    .replace(
      /\b(?:do not|don't|never|without)\s+(?:run|execute|perform|re-?run|back-?test|replay)\b(?:(?![;.!?\n]|\b(?:and\s+then|then|but|however|instead|also)\b)[\s\S]){0,240}/g,
      " ",
    );
  if (
    /(?:^|\b(?:and|then|also|please|now|to|you)\s+|[,;.!?]\s*)(?:re-?run|back-?test|replay)\b/i.test(actions) ||
    /\b(?:run|execute|perform)\s+(?:(?:an?|the|my|new|fresh|saved|these|those|this|that)\s+)*(?:back-?test|replay|stud(?:y|ies)|experiment|workflow|analysis)\b/i.test(
      actions,
    )
  )
    return null;
  const experimentIds = [...new Set(text.match(/\bexp_[a-f0-9]{32}\b/g) || [])];
  const datasetIds = [...new Set(text.match(/\bds_[a-f0-9]{32}\b/g) || [])];
  if (experimentIds.length) return { experimentIds: experimentIds.slice(0, 4) };
  if (datasetIds.length) return { datasetIds: datasetIds.slice(0, 4) };
  const studyNames = savedStudyNames(text);
  if (studyNames.length) return { studyNames };
  return {};
}

export const STUDY_AUDIT_NOTE = [
  "Saved-study review: use research_audit_saved_studies for experiment comparisons and coverage/timing claims. research_memory alone is a summary, not a collection audit.",
  "The audit inspects frozen saved evidence; it does not execute or replay a calculation. Only an actual replay result can establish a replay match. A saved successful calculation does not establish complete source coverage, historical tradability or scientific validity.",
  "Named-study discovery matches exact title/dataset name or ticker within a bounded inventory. Report unmatched and ambiguous requestedNames explicitly; never substitute an unrelated result. Exact experiment IDs have precedence. A missing bounded match is not proof that a study never existed.",
  "Use comparison.readiness for deterministic recorded-design limits and actionable missing evidence. listed-fields-match-only allows descriptive comparison of listed records, not a causal effect or investable edge. Missing/mismatched design fields or unresolved named selection prevent a direct comparison.",
  "Report collection status per study, raw receipts versus normalized versions versus selected signals, exclusions by reason, assumed publication dates, and unresolved historical ownership. Count reconciliation applies only to its declared scope, never an entire history.",
  "Compare rules and actual benchmark windows. Different cooldowns or windows prevent ranking signal quality from headline returns. Explain supported descriptive comparisons separately from unsupported causal, predictive or pre-news claims.",
  "Preserved legacy caveats can use the wrong source terminology. Prefer the audit's source-specific timing semantics: procurement availability gaps are not stock-filing deadlines. Entry after an assumed date cannot prove absence of look-ahead bias.",
  "Cite the exact audit ref in every table row and after each coverage, exclusion, timing or verification claim. Describe unknown or unsupported fields explicitly. A tool-call limit or outstanding grounding flag means the answer remains incomplete, not validated research.",
].join("\n");
