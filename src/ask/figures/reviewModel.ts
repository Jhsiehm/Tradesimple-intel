import type { ResearchFigureReview } from "../../../shared/researchFigures.mjs";

type Study = ResearchFigureReview["studies"][number];

/** Shorten only the known audit vocabulary; unfamiliar saved text remains intact. */
export function studyPreview(study: Study) {
  const coverage =
    /^(count-reconciled-within-declared-scope|partial|unknown) · (\d+|unknown)\/(\d+|unknown) partitions; historical completeness not certified\.$/.exec(
      study.coverage,
    );
  const timing =
    /^(assumed|observed|verified|unknown) · defense (\d+|unknown)d \/ civilian (\d+|unknown)d; original publication not independently verified\.$/.exec(
      study.timing,
    );
  const counts = coverage ? `${coverage[2]}/${coverage[3]} partitions` : "";
  const timingLabels: Record<string, string> = {
    assumed: "Assumed delays; original publication unverified.",
    observed: "Collector observed; original publication unverified.",
    verified: "Recorded as verified; original publication not independently verified.",
    unknown: "Unknown timing; original publication unverified.",
  };
  return {
    coverage: coverage
      ? coverage[1] === "count-reconciled-within-declared-scope"
        ? `${counts} reconciled; history not certified.`
        : `${coverage[1] === "partial" ? "Partial" : "Unknown"} · ${counts}; history not certified.`
      : study.coverage || "Collection coverage not recorded.",
    timing: timing ? timingLabels[timing[1]] : study.timing || "Public availability not recorded.",
    window: shortStudyWindow(study.window),
  };
}

/** UTC formatting is presentation only; exact recorded dates remain in Design details and exports. */
export function shortStudyWindow(value: string): string {
  if (!value) return "Study period not recorded.";
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(value);
  if (!match) return value;
  const dates = match.slice(1).map((day) => new Date(`${day}T00:00:00Z`));
  if (dates.some((date, i) => !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== match[i + 1]))
    return value;
  const format = (date: Date, year: boolean) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(year ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    }).format(date);
  return `${format(dates[0], dates[0].getUTCFullYear() !== dates[1].getUTCFullYear())} – ${format(dates[1], true)}`;
}
