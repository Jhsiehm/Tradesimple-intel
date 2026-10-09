import type { DrawerModel, DrawerTable } from "../types";
import { toggleSymbol, useWatch } from "../lib/useWatch";
import { CaseHeader } from "../intel/CaseHeader";
import { CaseSection } from "../intel/CaseSection";
import { IconLabel } from "../ui/icons/Icon";
import { actionIcon } from "../ui/icons/commandIcon";

export function Drawer({
  model,
  onClose,
  onPin,
  onFollow,
  embedded,
  source
}: {
  model: DrawerModel;
  onClose: () => void;
  onPin?: () => void;
  onFollow?: (action: string) => void;
  embedded?: boolean;
  source?: string;
}) {
  const { hasSymbol } = useWatch();
  const watched = model.watch ? hasSymbol(model.watch) : false;
  const star = model.watch ? (
    <button className={watched ? "star on" : "star"} title={watched ? "Remove from watchlist" : "Add to watchlist"} onClick={() => toggleSymbol(model.watch!)}><IconLabel icon={watched ? "star-on" : "star"}>{watched ? "Watching" : "Watch"}</IconLabel></button>
  ) : null;
  const src = model.source || source;
  const kind = model.caseKey?.split(":")[0];
  return (
    <aside className={embedded ? "drawer embedded" : "drawer"} role="dialog" aria-label={model.title}>
      {embedded ? null : (
        <div className="drawer-bar">
          <span>DOSSIER</span>
          <span className="drawer-actions">
            {star}
            {onPin ? <button className="ghost" onClick={onPin} title="Pin as a card that stays across views"><IconLabel icon="pin" hide>Pin</IconLabel></button> : null}
            <button className="ghost" onClick={onClose} title="Close (Esc)"><IconLabel icon="close" hide>Close</IconLabel></button>
          </span>
        </div>
      )}
      <div className="drawer-body">
        {model.caseKey ? <CaseHeader caseKey={model.caseKey} /> : null}
        {embedded ? (star ? <p className="drawer-star">{star}</p> : null) : <h2>{model.title}</h2>}
        {model.meta ? <p className="meta">{model.meta}</p> : null}
        {model.stages ? (
          <ol className="ladder">
            {model.stages.map((stage) => (
              <li key={stage.name} className={stage.reached ? "reached" : undefined}>
                {stage.name}
              </li>
            ))}
          </ol>
        ) : null}
        {model.rows.length ? (
          <dl className="kv">
            {model.rows.map((row, index) => (
              <span key={`${index}:${row.label}`} style={{ display: "contents" }}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </span>
            ))}
          </dl>
        ) : null}
        {model.links?.map((link, index) => link.href ? (
          <a key={`${index}:${link.href}`} className="drill" href={link.href} target="_blank" rel="noreferrer">
            <span><IconLabel icon="external">{link.label}</IconLabel></span>
            <strong>{link.value}</strong>
          </a>
        ) : (
          <button key={`${index}:${link.action}`} className="drill" disabled={!link.action} onClick={() => link.action && onFollow?.(link.action)}>
            <span><IconLabel icon={actionIcon(link.action)}>{link.label}</IconLabel></span>
            <strong>{link.value}</strong>
          </button>
        ))}
        {model.tables?.map((table) => (
          <CaseSection key={table.title} kind={kind} title={table.title} count={table.empty ? "—" : table.rows.length}>
            <DataTable table={table} onFollow={onFollow} />
          </CaseSection>
        ))}
        {model.blocks?.map((block) => (
          <CaseSection key={block.title} kind={kind} title={block.title}>
            {block.lines.length ? block.lines.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            )) : <p>None on this feed.</p>}
          </CaseSection>
        ))}
        {src ? <p className="drawer-src"><em>SOURCE</em> {src}</p> : null}
      </div>
    </aside>
  );
}

function DataTable({ table, onFollow }: { table: DrawerTable; onFollow?: (action: string) => void }) {
  const filings = table.rows.some((row) => row.filing);
  return (
    <>
      {table.note ? <p className="table-note">{table.note}</p> : null}
      {table.rows.length ? (
        <div className="dt-scroll">
          <table className="dt">
            <thead>
              <tr>{table.cols.map((col) => <th key={col}>{col}</th>)}{filings ? <th>Filing</th> : null}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => {
                const live = Boolean(row.action || row.href);
                return (
                  <tr
                    key={index}
                    className={`${live ? "live" : ""} ${row.tone ? `tone-${row.tone}` : ""}`.trim()}
                    onClick={() => {
                      if (row.action) onFollow?.(row.action);
                      else if (row.href) window.open(row.href, "_blank", "noreferrer");
                    }}
                  >
                    {row.cells.map((cell, i) => <td key={i}>{cell}</td>)}
                    {filings ? (
                      <td>
                        {row.filing ? <a className="dt-filing" href={row.filing} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the original disclosure"><IconLabel icon="external">View</IconLabel></a> : "—"}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p>{table.empty || "None on this feed."}</p>}
    </>
  );
}
