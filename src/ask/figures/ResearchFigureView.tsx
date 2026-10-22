import { useId, useMemo, useState } from "react";
import type { ResearchFigure } from "../../../shared/researchFigures.mjs";
import { Chip } from "../Answer";
import type { Step } from "../types";
import { FigurePlot } from "./FigurePlot";
import { COLORS, displayUnit, downloadFigure, figureRows, formatValue, isFigureDate } from "./model";

type Props = { figure: ResearchFigure; steps: Map<string, Step>; onChip: (step: Step) => void };

export function ResearchFigureView({ figure, steps, onChip }: Props) {
  const title = useId();
  const [hidden, setHidden] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [dots, setDots] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const allRows = useMemo(() => figureRows(figure), [figure]);
  const rows = allRows.filter((row) => !hidden.includes(row.seriesId));
  const selected = rows.find((row) => row.key === selection) || rows.find((row) => row.point.y != null) || rows[0];
  const sourcePoints = figure.series.reduce((sum, series) => sum + series.points.length, 0);
  const visibleSeries = figure.series.slice(0, 12).filter((series) => !hidden.includes(series.id));
  const dates = allRows.every((row) => isFigureDate(row.point.x));
  const numericX = allRows.every((row) => typeof row.point.x === "number" && Number.isFinite(row.point.x));
  const kind = figure.kind === "line" && dates ? "line" : figure.kind === "scatter" && numericX ? "scatter" : "bar";
  const view = kind === "bar" && dots ? "dot" : kind;
  const unit = displayUnit(figure);
  const missing = rows.filter((row) => row.point.y == null).length;
  const toggle = (id: string) => {
    if (hidden.includes(id)) setHidden(hidden.filter((value) => value !== id));
    else if (visibleSeries.length > 1) setHidden([...hidden, id]);
  };
  const download = () => {
    try {
      downloadFigure(figure, rows);
      setExportMessage(`CSV prepared with ${rows.length} displayed rows and source references.`);
    } catch {
      setExportMessage("CSV could not be prepared. The displayed data remains available in the table.");
    }
  };

  return (
    <figure className="research-figure" aria-labelledby={title}>
      <header className="rf-head">
        <h4 id={title}>{figure.title}</h4>
        <div className="rf-actions">
          {kind === "bar" ? (
            <div className="rf-views" role="group" aria-label={`${figure.title} chart view`}>
              <button type="button" aria-pressed={!dots} onClick={() => setDots(false)}>
                Bars
              </button>
              <button type="button" aria-pressed={dots} onClick={() => setDots(true)}>
                Dots
              </button>
            </div>
          ) : null}
          <button type="button" onClick={download} disabled={!rows.length}>
            Download displayed CSV
          </button>
        </div>
      </header>
      <p className="rf-axis-labels">
        {figure.xLabel}
        {figure.xUnit ? ` (${figure.xUnit})` : ""}
        <span aria-hidden="true"> · </span>
        {figure.yLabel}
        {unit ? ` (${unit})` : ""}
      </p>
      <div className="rf-legend" role="group" aria-label={`${figure.title} series`}>
        {figure.series.slice(0, 12).map((series, index) => {
          const visible = !hidden.includes(series.id);
          return (
            <button
              key={series.id}
              type="button"
              aria-pressed={visible}
              disabled={visible && visibleSeries.length === 1}
              onClick={() => toggle(series.id)}
              title={
                visible && visibleSeries.length === 1
                  ? "At least one series stays visible"
                  : `${visible ? "Hide" : "Show"} ${series.label}`
              }
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path
                  d={index % 3 === 0 ? "M2 7h10" : index % 3 === 1 ? "M7 2v10M2 7h10" : "M3 3l8 8M3 11l8-8"}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth="2.5"
                />
              </svg>
              {series.label}
            </button>
          );
        })}
      </div>
      {rows.some((row) => row.point.y != null) ? (
        <FigurePlot figure={figure} rows={rows} selected={selected?.key || ""} view={view} onSelect={setSelection} />
      ) : (
        <p className="rf-notice">
          No numeric values are available for the visible series. Missing values are listed in the data table.
        </p>
      )}
      {selected ? (
        <div className="rf-selection" aria-live="polite" aria-atomic="true">
          <div>
            <span>
              {selected.series} · {selected.point.label}
            </span>
            <strong>
              {formatValue(selected.point.y, figure)}
              {figure.format === "number" && figure.unit ? ` ${figure.unit}` : ""}
            </strong>
          </div>
          {String(selected.point.x) !== selected.point.label || figure.xUnit ? (
            <p>
              {figure.xLabel}: {String(selected.point.x)}
              {figure.xUnit ? ` ${figure.xUnit}` : ""}
            </p>
          ) : null}
          <div className="rf-provenance">
            <span>Source</span>
            <Chip id={selected.point.ref} steps={steps} onChip={onChip} />
            <details className="rf-point-details">
              <summary>Observation details</summary>
              {selected.point.detail ? <p>{selected.point.detail}</p> : null}
              <code>{selected.point.path}</code>
            </details>
          </div>
        </div>
      ) : null}
      <figcaption>
        <p className="rf-scope">
          {rows.length} displayed values{hidden.length ? ` · ${hidden.length} series hidden` : ""}
          {missing ? ` · ${missing} missing` : ""}
          {figure.totalPoints > sourcePoints
            ? ` · ${figure.totalPoints.toLocaleString("en-US")} source points available`
            : ""}
          .
        </p>
        {sourcePoints > allRows.length ? (
          <p className="rf-notice">
            Display limited to {allRows.length} points. The plot, table, and CSV do not represent the full dataset.
          </p>
        ) : null}
        {figure.kind !== kind ? (
          <p className="rf-notice">
            Shown as categories because the source does not provide valid{" "}
            {figure.kind === "line" ? "dates for a time series" : "numeric x coordinates"}.
          </p>
        ) : null}
        {figure.notes.length ? (
          <ul className="rf-notes">
            {figure.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
        <p className="rf-sources">
          Sources{" "}
          {figure.sourceRefs.map((ref) => (
            <Chip key={ref} id={ref} steps={steps} onChip={onChip} />
          ))}
        </p>
      </figcaption>
      <details className="rf-data">
        <summary>Data table · {rows.length} displayed rows</summary>
        <div className="rf-table-wrap" role="region" aria-label={`${figure.title} data table`} tabIndex={0}>
          <table>
            <caption>Displayed data; raw numeric values are preserved exactly as received.</caption>
            <thead>
              <tr>
                <th scope="col">Series / observation</th>
                <th scope="col">{figure.xLabel}</th>
                <th scope="col">
                  {figure.yLabel}
                  {unit ? ` (${unit})` : ""}
                </th>
                <th scope="col">Raw value{figure.format !== "number" ? " (fraction)" : ""}</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={selected?.key === row.key ? "is-selected" : undefined}>
                  <th scope="row">
                    <button type="button" onClick={() => setSelection(row.key)}>
                      {row.series} · {row.point.label}
                    </button>
                    {row.point.detail ? <small>{row.point.detail}</small> : null}
                  </th>
                  <td>{String(row.point.x)}</td>
                  <td className="numeric">{formatValue(row.point.y, figure)}</td>
                  <td className="numeric">{row.point.y == null ? "Missing" : String(row.point.y)}</td>
                  <td>
                    <Chip id={row.point.ref} steps={steps} onChip={onChip} />
                    <code>{row.point.path}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="rf-export-status" role="status">
        {exportMessage}
      </p>
    </figure>
  );
}
