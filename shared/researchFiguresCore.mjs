export const FIGURE_LIMITS = Object.freeze({ figures: 6, points: 240, rows: 120, evidence: 32, text: 240 });
export const object = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v));
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export const validRef = (v) => typeof v === "string" && /^t[1-9]\d{0,5}$/.test(v);
export const number = (v) => (finite(v) ? v : null);
export const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
export const text = (v, fallback = "") =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, FIGURE_LIMITS.text) : fallback;
export const pointer = (v) => String(v).replace(/~/g, "~0").replace(/\//g, "~1");
export const human = (v) =>
  text(v)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ");
export const point = (ref, path, label, value, detail = "") => ({
  label: text(label),
  x: text(label),
  y: number(value),
  ref,
  path,
  ...(detail ? { detail: text(detail) } : {}),
});

/** A final server-side output bound; text is always data, never executable markup. */
export function finishFigure(figure) {
  let remaining = FIGURE_LIMITS.points;
  const series = figure.series
    .slice(0, 8)
    .map((item) => {
      const points = item.points.slice(0, remaining);
      remaining -= points.length;
      return { id: text(item.id), label: text(item.label), points };
    })
    .filter((item) => item.points.length);
  if (!series.some((item) => item.points.some((p) => finite(p.y)))) return null;
  const shown = Math.max(0, ...series.map((item) => item.points.length));
  const totalPoints = Math.max(shown, count(figure.totalPoints) ?? shown);
  const notes = [...new Set((figure.notes || []).map((note) => text(note)).filter(Boolean))];
  const previewNote = `Preview: ${shown} of ${totalPoints} source rows/categories displayed per series at most; omitted observations are not zero.`;
  if (shown < totalPoints && !notes.includes(previewNote)) notes.unshift(previewNote);
  const missingNote = "Missing values remain missing; gaps are not zero.";
  if (series.some((item) => item.points.some((p) => p.y === null)) && !notes.includes(missingNote))
    notes.unshift(missingNote);
  return {
    ...figure,
    series,
    notes: notes.slice(0, 16),
    sourceRefs: [...new Set(series.flatMap((s) => s.points.map((p) => p.ref)))],
    totalPoints,
  };
}

export function evidenceBody(entry, rawBodies) {
  if (!entry?.ok || !validRef(entry.id)) return null;
  try {
    const raw = rawBodies?.get(entry.id);
    const body =
      raw === undefined && typeof entry.json === "string" && entry.json.length <= 2_000_000
        ? JSON.parse(entry.json)
        : raw;
    return object(body) && body.ok === true ? body : null;
  } catch {
    return null;
  }
}
