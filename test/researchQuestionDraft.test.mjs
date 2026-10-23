import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuestionDraft,
  emptyQuestionBrief,
  exampleQuestionBrief,
  QUESTION_LIMIT,
  questionBriefIssues,
} from "../src/research/questionDraft.ts";

test("question examples fit Ask without inventing historical scope or claiming execution", () => {
  for (const mode of ["inspect", "design", "execute"]) {
    const brief = exampleQuestionBrief(mode);
    const prompt = buildQuestionDraft(mode, brief);
    assert.ok(prompt.length <= QUESTION_LIMIT, `${mode}: ${prompt.length}`);
    assert.equal(brief.from, "");
    assert.equal(brief.to, "");
    assert.doesNotMatch(prompt, /\b20\d\d-\d\d-\d\d\b|study completed|backtest passed/i);
  }
  const saved = buildQuestionDraft("inspect", exampleQuestionBrief("inspect"));
  assert.match(saved, /LMT and HII procurement/);
  assert.match(saved, /Confirm exact matching IDs; ask if missing or ambiguous/);
  assert.match(saved, /Inspection only; do not rerun, replay or start calculations/);
  assert.match(saved, /never invent daily curves/);
});

test("new investigation keeps the unfamiliar hypothesis and requests a design without calculation", () => {
  const hypothesis = "Does shipping disruption predict semiconductor inventory revisions?";
  const prompt = buildQuestionDraft("design", {
    ...emptyQuestionBrief(),
    hypothesis,
    entities: "shipping incidents; semiconductor filings",
    outcome: "inventory revisions, with matched controls",
    timing: "first verified publication time",
  });
  assert.ok(prompt.includes(hypothesis));
  assert.match(prompt, /Design only; do not execute calculations\./);
  assert.match(prompt, /preserve requested sources/);
  assert.match(prompt, /If unsupported, report gaps; do not substitute another study or source/);
  assert.match(prompt, /look-ahead risk/);
  assert.match(prompt, /inputs, method, assumptions and outputs for replay/);
  assert.doesNotMatch(prompt, /Run only a compatible/);
});

test("execution draft permits only supported execution and keeps missing inputs unresolved", () => {
  const blank = buildQuestionDraft("execute", emptyQuestionBrief());
  assert.match(blank, /Ask me for a falsifiable hypothesis/);
  assert.match(blank, /resolving missing inputs and checking actual data coverage/);
  assert.match(blank, /Clarify missing scope/);
  assert.doesNotMatch(blank, /Design only|SPY|2025|LMT/);
  const populated = buildQuestionDraft("execute", {
    ...emptyQuestionBrief(),
    hypothesis: "Compare award amounts across agencies",
    entities: "US federal contract awards; LMT",
    from: "2024-01-01",
    to: "2024-06-30",
    outcome: "award amount and count by agency",
    timing: "source publication date",
  });
  for (const supplied of ["2024-01-01 to 2024-06-30", "LMT", "count by agency", "source publication date"])
    assert.ok(populated.includes(supplied));
  assert.match(populated, /Run only a compatible supported analysis/);
  assert.doesNotMatch(populated, /congressional portfolios|Design only/);
});

test("only explicitly selected registry IDs enter a saved-study draft", () => {
  const records = [
    { id: "exp_a1", title: "LMT procurement" },
    { id: "exp_b2", title: "HII procurement" },
    { id: "exp_c3", title: "Unrelated portfolio" },
  ];
  const unselected = buildQuestionDraft("inspect", exampleQuestionBrief("inspect"), records);
  assert.doesNotMatch(unselected, /exp_[a-z0-9]+/);
  const selected = buildQuestionDraft(
    "inspect",
    { ...emptyQuestionBrief(), studyA: "exp_b2", studyB: "exp_a1", hypothesis: "Compare only these records" },
    records,
  );
  assert.match(selected, /Inspect saved experiments exp_b2, exp_a1/);
  assert.match(selected, /Compare only these records/);
  assert.doesNotMatch(selected, /exp_c3|latest|LMT and HII/);
  assert.match(selected, /Do not substitute unrelated studies/);
  const stale = buildQuestionDraft("inspect", { ...emptyQuestionBrief(), studyA: "exp_d4" }, records);
  assert.match(stale, /Inspect saved experiments exp_d4/);
  assert.match(stale, /resolve these exact records and report any missing IDs without substitution/);
  assert.doesNotMatch(stale, /Inspect saved studies\.|exp_a1|exp_b2|exp_c3/);
  const refreshed = buildQuestionDraft("inspect", { ...emptyQuestionBrief(), studyA: "exp_b2", studyB: "exp_a1" }, []);
  assert.match(refreshed, /Inspect saved experiments exp_b2, exp_a1/);
  assert.match(refreshed, /outside the current registry preview/);
  const invalidBrief = { ...emptyQuestionBrief(), studyA: "exp_missing" };
  assert.equal(buildQuestionDraft("inspect", invalidBrief, records), "");
  assert.match(questionBriefIssues(invalidBrief).join(" "), /Choose a saved study again or clear that selection/);
  const partiallyInvalid = { ...emptyQuestionBrief(), studyA: "exp_a1", studyB: "exp_missing" };
  assert.equal(buildQuestionDraft("inspect", partiallyInvalid, records), "");
});

test("scope validation rejects calendar rollovers, reversed windows and duplicate choices", () => {
  assert.deepEqual(questionBriefIssues(emptyQuestionBrief()), []);
  assert.deepEqual(questionBriefIssues({ ...emptyQuestionBrief(), from: "2024-02-29", to: "2024-03-01" }), []);
  assert.match(questionBriefIssues({ ...emptyQuestionBrief(), from: "2025-02-29" }).join(" "), /real calendar/);
  assert.match(
    questionBriefIssues({ ...emptyQuestionBrief(), from: "2025-03-01", to: "2025-02-01" }).join(" "),
    /end date/,
  );
  assert.match(
    questionBriefIssues({ ...emptyQuestionBrief(), studyA: "exp_a1", studyB: "exp_a1" }).join(" "),
    /different studies/,
  );
});

test("long user scope is preserved for visible budget validation rather than silently truncated", () => {
  const hypothesis = "Long hypothesis ".repeat(80);
  const prompt = buildQuestionDraft("design", { ...emptyQuestionBrief(), hypothesis });
  assert.ok(prompt.includes(hypothesis.trim()));
  assert.ok(prompt.length > QUESTION_LIMIT);
});
