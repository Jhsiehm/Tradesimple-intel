import { FIGURE_LIMITS, object, number, point, text } from "./researchFiguresCore.mjs";

const validDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Only actual calendar points are visualized. Summary returns never imply a path. */
export function backtestFigures(entry, body) {
  if (body.building || !Array.isArray(body.curve) || !body.curve.length) return [];
  const rows = body.curve.slice(0, Math.floor(FIGURE_LIMITS.points / 2));
  if (
    rows.some(
      (row) =>
        !object(row) ||
        !validDate(row.d) ||
        (row.s !== null && number(row.s) === null) ||
        (row.b !== null && number(row.b) === null),
    )
  )
    return [];
  if (rows.some((row, i) => i > 0 && row.d <= rows[i - 1].d)) return [];
  return [
    {
      id: `${entry.id}-recorded-daily-curve`,
      title: "Recorded daily portfolio and benchmark",
      kind: "line",
      xLabel: "Recorded trading date",
      yLabel: "Recorded index level",
      unit: "index level",
      format: "number",
      totalPoints: body.curve.length,
      sourceRefs: [entry.id],
      notes: [
        "Actual daily result points only; no path is inferred from headline returns.",
        "Recorded computation does not independently establish source completeness, historical tradability or absence of look-ahead bias.",
        ...(rows.length < body.curve.length
          ? [`Only the first ${rows.length} daily rows are displayed; later dates are omitted.`]
          : []),
      ],
      series: [
        ["s", "Portfolio"],
        ["b", text(body.rules?.benchmark, "Benchmark")],
      ].map(([key, label]) => ({
        id: key,
        label,
        points: rows.map((row, i) => point(entry.id, `/curve/${i}/${key}`, row.d, row[key])),
      })),
    },
  ];
}
