import { citationUnits } from "./citations.mjs";
import { numbersIn } from "./ask.mjs";

export function savedAuditResults(evidence) {
  return evidence.flatMap((entry) => {
    if (!entry.ok || entry.tool !== "research_audit_saved_studies") return [];
    try {
      const body = JSON.parse(entry.json);
      return body.ok && Array.isArray(body.studies) ? [{ id: entry.id, body }] : [];
    } catch {
      return [];
    }
  });
}

const partial = (study) => study.coverage?.partitionStatus === "partial";
const namesStudy = (text, study) =>
  [study.id, study.datasetId, ...(study.symbols || [])]
    .filter(Boolean)
    .some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
const clauses = (text) => text.split(/\s*(?:;|,(?!\d)|\b(?:and|but|although|however|while|yet)\b)\s*/i);
const clean = (text) => text.replace(/["'“”‘’`*]/g, "").trim();

/** Negation must govern this claim, not another fact elsewhere in its sentence. */
function denied(text, match) {
  const before = clean(text.slice(0, match.index));
  const after = clean(text.slice(match.index + match[0].length));
  if (
    /\b(?:not|never)\s+(?:fully\s+|independently\s+)?(?:verified|validated|matched|consistent|confirmed|successful)\b/i.test(
      match[0],
    )
  )
    return true;
  if (/\b(?:not|never|without evidence of|unsupported claim of|inapplicable claim of)\s*$/i.test(before)) return true;
  if (
    /\b(?:cannot|can't|could not|does not|do not|did not)\s+(?:establish|prove|demonstrate|claim|confirm|verify|guarantee|rule out)(?:\s+\w+){0,4}$/i.test(
      before,
    )
  )
    return true;
  if (/\b(?:incorrect|wrong)\s+to\s+(?:claim|say|assert)\s+(?:\w+\s*){0,4}$/i.test(before)) return true;
  return (
    /^(?:(?:is|are|was|were|remains?|has been|have been)\s+)?(?:not\s+(?:established|verified|proven|demonstrated|complete|reconciled)|unsupported|unproven|inapplicable|incorrect|wrong|false)\b/i.test(
      after,
    ) || /^(?:cannot|can't|could not)\s+(?:be\s+)?(?:established|verified|proven|demonstrated|claimed)\b/i.test(after)
  );
}
function positive(text, pattern) {
  return [...text.matchAll(new RegExp(pattern.source, "gi"))].some((match) => !denied(text, match));
}
function scopedUnits(answer, studies) {
  let active = null;
  return citationUnits(answer).map((unit) => {
    const named = studies.filter((study) => namesStudy(unit.text, study));
    if (named.length) active = named.length === 1 ? named[0].id : null;
    if (/\b(?:both|all|each)\b/i.test(unit.text)) active = null;
    return { ...unit, studyId: active };
  });
}
const belongs = (unit, study) => !unit.studyId || unit.studyId === study.id;
function reasonPattern(key) {
  if (key === "nonPositiveObligation")
    return /non[\s_-]*positive|nonPositiveObligation|(?:negative|zero).{0,20}obligation/i;
  if (key === "ambiguousIdentity") return /ambiguousIdentity|\bambiguous\b(?![\s_-]*versions?\b)/i;
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(words.join("[\\s_-]*"), "i");
}
const ledgerFields = (study) =>
  Object.entries(study.exclusions || {}).filter(
    ([key, value]) => !["origin", "recorded", "omittedFields"].includes(key) && typeof value === "number" && value > 0,
  );

/** Narrow, evidence-backed checks of explicit overclaims; these do not certify arbitrary scientific prose. */
export function studyAuditClaims(answer, evidence, question = "") {
  const audits = savedAuditResults(evidence);
  if (!audits.length) return [];
  const allStudies = audits.flatMap((audit) => audit.body.studies);
  const units = scopedUnits(answer, allStudies);
  const out = [];
  const add = (raw, refs, note) => {
    if (!out.some((item) => item.note === note)) out.push({ kind: "research", raw, refs, note });
  };
  for (const unit of units) {
    const cited = audits.filter((audit) => unit.refs.includes(audit.id));
    const selected = cited.length ? cited : audits;
    const refs = selected.map((audit) => audit.id),
      studies = selected.flatMap((audit) => audit.body.studies);
    for (const text of clauses(unit.text)) {
      if (
        positive(
          text,
          /\b(?:no |absence of )look[- ]ahead(?: bias)?\b|\blook[- ]ahead(?: bias)? (?:was |is )?(?:eliminated|absent|ruled out)\b/i,
        )
      )
        add(
          text,
          refs,
          "Saved evidence inspection does not establish absence of look-ahead bias; publication timing and historical tradability remain unverified.",
        );
      if (
        positive(
          text,
          /\b(?:replay(?:ed)?|arithmetic|calculations?)\b.{0,60}\b(?:verified|validated|matched|consistent|confirmed|successful)\b|\b(?:verified|validated|confirmed)\b.{0,40}\b(?:replay|arithmetic|calculations?)\b/i,
        )
      )
        add(
          text,
          refs,
          "The saved-study audit did not replay or verify calculation arithmetic. Report completed-as-recorded separately from an actual replay match.",
        );
      if (
        positive(text, /\b(?:complete|fully (?:collected|reconciled)|count[- ]reconciled)\b/i) &&
        studies.some(
          (study) =>
            partial(study) &&
            (unit.studyId === study.id || /\b(?:both|all|each)\b/i.test(text) || namesStudy(text, study)),
        )
      )
        add(
          text,
          refs,
          "At least one named collection is partial. Report each collection's completed/total partitions; do not describe both collections as complete or reconciled.",
        );
      if (
        studies.some((study) => /contract|procurement/i.test(study.source || "")) &&
        positive(
          text,
          /\b(?:45[- ]day|45 days)\b.{0,40}\b(?:filing|filed|deadline|late)\b|\b(?:filing|filed)\b.{0,40}\b45[- ]day/i,
        )
      )
        add(
          text,
          refs,
          "Stock-filing deadline labels are inapplicable to procurement. Use the source's assumed or observed availability policy, not archived stock-disclosure terminology.",
        );
    }
  }
  const refs = audits.map((audit) => audit.id),
    studies = allStudies;
  for (const study of studies) {
    const relevant = units.filter((unit) => belongs(unit, study));
    const name = (study.symbols || []).join("/") || study.id;
    if (
      /\bcoverage\b/i.test(question) &&
      partial(study) &&
      !relevant.some((unit) => /\bpartial|\bincomplete/i.test(unit.text))
    )
      add(
        "Missing partial-collection disclosure",
        refs,
        `The requested coverage discussion omits the partial collection for ${name}.`,
      );
    if (/\bexclusions?\b|\bexcluded\b/i.test(question) && study.exclusions?.recorded) {
      for (const [key, count] of ledgerFields(study)) {
        if (
          !relevant.some(
            (unit) =>
              reasonPattern(key).test(unit.text) &&
              numbersIn(unit.text).some((n) => !n.pct && !n.bps && n.value * n.scale === count),
          )
        )
          add(
            "Missing exclusion ledger",
            refs,
            `Report the saved ${name} exclusion reason and count: ${key} = ${count}.`,
          );
      }
    }
    if (
      /\b(?:publication|timing)\b/i.test(question) &&
      study.timing?.mode === "assumed" &&
      !relevant.some((unit) =>
        /\b(?:publication|availability|timing|delay)\b.{0,60}\bassum\w*|\bassum\w*.{0,60}\b(?:publication|availability|timing|delay)\b/i.test(
          unit.text,
        ),
      )
    )
      add(
        "Missing publication assumption",
        refs,
        `The saved ${name} publication timing uses assumed delays and must be disclosed; retrieval does not establish historical availability.`,
      );
  }
  return out.slice(0, 12);
}
