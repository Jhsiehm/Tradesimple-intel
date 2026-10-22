import { citationRefs, groundingCheck } from "../../shared/ask.mjs";
import { citationCheck } from "../../shared/citations.mjs";
import { scopeCheck } from "../../shared/claimScope.mjs";
import { slotEvidence } from "../../shared/slots.mjs";
import { studyAuditClaims } from "../../shared/studyAuditClaims.mjs";
import { studyAuditReport } from "../../shared/studyAuditReport.mjs";
import { flaggedItems } from "../../shared/revise.mjs";

export function checkAnswerEvidence(answer, evidence, { used, question } = {}) {
  const { cited, unknown } = citationRefs(answer, evidence);
  const pool = slotEvidence(evidence, used);
  const grounding = {
    ...groundingCheck(answer, pool),
    ...citationCheck(answer, pool),
    scope: [...scopeCheck(answer, evidence), ...studyAuditClaims(answer, evidence, question)],
  };
  return { cited, unknown, grounding, uncited: evidence.length > 0 && cited.length === 0 && answer.length > 0 };
}

export function guardedStudyReport(answer, evidence, check) {
  return flaggedItems(check(answer)).length ? studyAuditReport(evidence) : null;
}
