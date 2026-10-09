/**
 * Cover page of an XML Schedule 13D / 13G (EDGAR schema in use since December 2024): the first reporting person, the
 * event date that required the filing, percent of class and aggregate shares. Older SC 13D/G filings are HTML or text
 * and return nulls; callers then show the form without a name.
 */
export function parseSchedule13(xml) {
  const text = String(xml || "");
  const first = (...names) => {
    for (const name of names) {
      const m = new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]+?)\\s*</(?:\\w+:)?${name}>`, "i").exec(text);
      if (m) return decode(m[1]);
    }
    return "";
  };
  const percent = Number(first("classPercent", "percentOfClass", "percentOfClassRepresented"));
  const shares = Number(first("reportingPersonBeneficiallyOwnedAggregateNumberOfShares", "aggregateAmountOwned", "aggregateAmountBeneficiallyOwned"));
  return {
    form: first("submissionType"),
    person: first("reportingPersonName", "nameOfReportingPerson", "reportingPersonNames"),
    eventDate: usToIso(first("eventDateRequiresFilingThisStatement", "dateOfEvent", "eventDate")),
    percent: Number.isFinite(percent) && first("classPercent", "percentOfClass", "percentOfClassRepresented") ? percent : null,
    shares: Number.isFinite(shares) && shares > 0 ? shares : null,
    issuerCik: first("issuerCik")
  };
}

function usToIso(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
