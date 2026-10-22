import type { ResearchFigure, ResearchFigurePoint } from "../../../shared/researchFigures.mjs";

export const COLORS = ["#5be4b4", "#77bcff", "#f0c56d", "#d69bff", "#ff9286", "#66d7e5"];
export const MAX_ROWS = 600;
export type FigureRow = {
  key: string;
  seriesId: string;
  series: string;
  color: string;
  point: ResearchFigurePoint;
};

/** Reject Date.parse calendar normalization and ambiguous/local timestamp offsets. */
export function figureDateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z)?$/.exec(value);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  const expected = match[2]
    ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${(match[5] || "").padEnd(3, "0")}Z`
    : `${match[1]}T00:00:00.000Z`;
  return canonical === expected ? milliseconds : null;
}

export const isFigureDate = (value: unknown): boolean => figureDateMs(value) !== null;

export function displayUnit(figure: Pick<ResearchFigure, "format" | "unit">): string {
  return figure.format === "percent" ? "%" : figure.format === "percentage-points" ? "percentage points" : figure.unit;
}

export function figureRows(figure: ResearchFigure): FigureRow[] {
  const rows: FigureRow[] = [];
  figure.series.slice(0, 12).forEach((series, s) => {
    for (let p = 0; p < series.points.length && rows.length < MAX_ROWS; p++) {
      rows.push({
        key: `${s}:${p}`,
        seriesId: series.id,
        series: series.label,
        color: COLORS[s % COLORS.length],
        point: series.points[p],
      });
    }
  });
  return rows;
}

export function formatValue(value: number | null, figure: ResearchFigure, compact = false): string {
  if (value == null || !Number.isFinite(value)) return "Missing";
  const scaled = figure.format === "number" ? value : value * 100;
  const number = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: compact ? 2 : 8,
    ...(compact && Math.abs(scaled) >= 10_000 ? { notation: "compact" as const } : {}),
  }).format(scaled);
  return `${number}${figure.format === "percent" ? "%" : figure.format === "percentage-points" ? " pp" : ""}`;
}

/** Quote every cell and neutralize spreadsheet formulas in strings, retaining real numeric negatives. */
const csvCell = (value: string | number) => {
  const text =
    typeof value === "number" ? String(value) : /^[\s\x00-\x20]*[=+\-@]|^[\t\r]/.test(value) ? `'${value}` : value;
  return `"${text.replaceAll('"', '""')}"`;
};

export function figureCsv(figure: ResearchFigure, rows: FigureRow[]): string {
  const records: (string | number)[][] = [
    ["Record", "Series", "Label", "X", "Y raw", "Display value", "Unit", "Source ref", "Source path", "Detail"],
    [
      "Figure",
      "",
      figure.title,
      figure.xLabel,
      "",
      figure.yLabel,
      figure.unit,
      "",
      "",
      `Format: ${figure.format}; x unit: ${figure.xUnit || "unspecified"}`,
    ],
    [
      "Scope",
      "",
      `${rows.length} displayed rows; ${figure.totalPoints} available source points`,
      "",
      "",
      "",
      "",
      "",
      "",
      "This export contains the displayed data, not the full underlying dataset.",
    ],
    ...figure.notes.map((note) => ["Note", "", "", "", "", "", "", "", "", note]),
    ...figure.sourceRefs.map((ref) => ["Source", "", "", "", "", "", "", ref, "", ""]),
    ...rows.map(({ series, point: p }) => [
      "Data",
      series,
      p.label,
      p.x,
      p.y ?? "",
      formatValue(p.y, figure),
      figure.unit,
      p.ref,
      p.path,
      p.detail || "",
    ]),
  ];
  return "\uFEFF" + records.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadFigure(figure: ResearchFigure, rows: FigureRow[]) {
  const url = URL.createObjectURL(new Blob([figureCsv(figure, rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${figure.id.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "research-figure"}-displayed.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
