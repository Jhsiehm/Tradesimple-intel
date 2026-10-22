import test from "node:test";
import assert from "node:assert/strict";
import { shortStudyWindow, studyPreview } from "../src/ask/figures/reviewModel.ts";

const study = {
  id: "exp_full_study_identifier",
  label: "HII",
  coverage: "count-reconciled-within-declared-scope · 1/1 partitions; historical completeness not certified.",
  timing: "assumed · defense 90d / civilian 7d; original publication not independently verified.",
  window: "2025-01-14 to 2025-06-02",
  rules: "Benchmark SPY · next-open · hold 20d · cooldown 7d · cost/slippage 10/5 bps",
  ref: "t1",
  path: "/studies/0",
};

test("compact study summaries retain historical and publication uncertainty without changing original evidence", () => {
  const original = structuredClone(study);
  const preview = studyPreview(study);
  assert.equal(preview.coverage, "1/1 partitions reconciled; history not certified.");
  assert.equal(preview.timing, "Assumed delays; original publication unverified.");
  assert.equal(preview.window, "Jan 14 – Jun 2, 2025");
  assert.deepEqual(study, original);
  assert.equal(
    studyPreview({ ...study, coverage: "partial · 0/1 partitions; historical completeness not certified." }).coverage,
    "Partial · 0/1 partitions; history not certified.",
  );
  assert.match(
    studyPreview({
      ...study,
      timing: "verified · defense 0d / civilian 0d; original publication not independently verified.",
    }).timing,
    /Recorded as verified; original publication not independently verified/,
  );
});

test("unfamiliar saved coverage and timing remain visible rather than being guessed or relabeled", () => {
  for (const value of [
    "unknown",
    "Complete data",
    "partial · 1/1 partitions; coverage pending.",
    "source-specific evidence",
  ])
    assert.deepEqual(studyPreview({ ...study, coverage: value, timing: value }), {
      coverage: value,
      timing: value,
      window: "Jan 14 – Jun 2, 2025",
    });
  assert.deepEqual(studyPreview({ ...study, coverage: "", timing: "", window: "" }), {
    coverage: "Collection coverage not recorded.",
    timing: "Public availability not recorded.",
    window: "Study period not recorded.",
  });
});

test("study periods shorten only real canonical dates and retain cross-year context", () => {
  assert.equal(shortStudyWindow("2024-02-29 to 2025-01-01"), "Feb 29, 2024 – Jan 1, 2025");
  for (const value of [
    "unknown to unknown",
    "2025-02-29 to 2025-03-01",
    "2025-13-01 to 2025-03-01",
    "2025",
    "recorded period",
  ])
    assert.equal(shortStudyWindow(value), value);
});
