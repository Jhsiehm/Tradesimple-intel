import { amountShort, dayLabel, verbOf } from "../../shared/sentences.mjs";
import type { StatusLine } from "../types";
import type { FeedRow } from "./TodayBoard";
import { lastName } from "./filingMap";

const LATE = 45;

function placeOf(row: FeedRow) {
  if (row.chamber === "senate") return row.state || "—";
  const district = String(row.district || "");
  if (district.includes("-")) return district;
  if (!district || district === "0") return row.state || "—";
  const number = String(Number(district) || district);
  return row.state ? `${row.state}-${number}` : number;
}

/** Corner plate and the bottom index for the week's filings on the Congress map. */
export function FilingOverlay({
  rows,
  status,
  selectedId,
  onSelect,
  onFollow
}: {
  rows: FeedRow[];
  status: StatusLine;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFollow: (action: string) => void;
}) {
  const row = rows.find((item) => item.id === selectedId) || null;
  const refYear = row ? Number((row.filed || row.traded || "").slice(0, 4)) : new Date().getFullYear();
  const late = row?.lag != null && row.lag > LATE;

  return (
    <>
      <aside className="filing-plate">
        {row ? (
          <>
          <p className="place">{placeOf(row)}</p>
          <p className="sentence">
            {row.person}{" "}
            <b className={row.side === "buy" ? "buy" : row.side === "sell" ? "sell" : ""}>{verbOf(row)}</b>{" "}
            {amountShort(row.amount)}{" "}
            <span className="sym">{row.symbol || row.asset}</span>
          </p>
          <p className="when">
            traded {dayLabel(row.traded, refYear)}, filed {dayLabel(row.filed, refYear)}
            {row.lag != null ? <> · <b className={late ? "late" : ""}>{row.lag}d</b></> : null}
          </p>
          <p className="filing-acts">
            {row.bioguide ? <button type="button" onClick={() => onFollow(`timeline:${row.bioguide}`)}>Timeline</button> : null}
            {row.symbol && row.inJoin ? <button type="button" onClick={() => onFollow(`chart:${row.symbol}`)}>Chart</button> : null}
            {row.link ? <a href={row.link} target="_blank" rel="noopener noreferrer">Filing</a> : null}
          </p>
          </>
        ) : <p className="when">No filings in this window.</p>}
        <p className="src" title={[status.source, status.asOf, status.latency].filter(Boolean).join(" · ")}>{status.source}{status.asOf ? ` · ${status.asOf}` : ""}{status.latency ? ` · ${status.latency}` : ""}</p>
      </aside>
      {rows.length ? (
        <div className="filing-index" aria-label="This week's filings">
          {rows.map((item, index) => {
            const itemLate = item.lag != null && item.lag > LATE;
            return (
              <button key={item.id} type="button" className={item.id === row?.id ? "on" : ""} onClick={() => onSelect(item.id)}>
                {String(index + 1).padStart(2, "0")} {lastName(item.person)} {item.symbol || "—"}{" "}
                <b className={itemLate ? "late" : ""}>{item.lag != null ? `${item.lag}d` : ""}</b>
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
