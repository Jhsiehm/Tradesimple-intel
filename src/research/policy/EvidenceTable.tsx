import { useState } from "react";
import { evidenceLabels, readable, sourceLink, type EvidenceKind, type PolicyInvestigation } from "./types";

const columns: Record<EvidenceKind, [string, string][]> = {
  events: [
    ["title", "Action"],
    ["billId", "Bill"],
    ["type", "Type"],
    ["eventAt", "Event time"],
    ["eventPrecision", "Event precision"],
    ["publicAt", "Public release"],
    ["publicPrecision", "Release precision"],
    ["availabilityBasis", "Availability evidence"],
    ["firstSeenAt", "First observed"],
  ],
  news: [
    ["title", "Article"],
    ["billId", "Bill"],
    ["eventId", "Event"],
    ["reviewed", "Event association reviewed"],
    ["publishedAt", "Published"],
    ["firstSeenAt", "Archive observation"],
    ["timingBasis", "Timing basis"],
    ["archive", "Archive"],
  ],
  exposures: [
    ["symbol", "Company"],
    ["billId", "Bill"],
    ["eventId", "Event"],
    ["side", "Direction"],
    ["knownAt", "Known at"],
    ["validFrom", "Valid from"],
    ["validTo", "Valid through"],
    ["reviewed", "Reviewed"],
    ["rationale", "Evidence rationale"],
  ],
  bars: [
    ["symbol", "Symbol"],
    ["at", "Bar open · UTC"],
    ["open", "Open"],
    ["close", "Close"],
    ["intervalMinutes", "Interval · minutes"],
  ],
  newsCoverage: [
    ["archive", "Archive"],
    ["billId", "Bill scope"],
    ["eventId", "Event scope"],
    ["scope", "Archive scope"],
    ["from", "From"],
    ["to", "Through"],
    ["complete", "Asserted complete"],
    ["basis", "Researcher evidence for coverage"],
  ],
};
export function EvidenceTable({ investigation }: { investigation: PolicyInvestigation }) {
  const [kind, setKind] = useState<EvidenceKind>("events"),
    [page, setPage] = useState(0);
  const records = investigation.evidence[kind] || [],
    size = 25;
  const pages = Math.max(1, Math.ceil(records.length / size)),
    current = Math.min(page, pages - 1);
  return (
    <section className="policy-evidence" aria-labelledby="policy-evidence-title">
      <h3 id="policy-evidence-title">Inspect evidence and timing</h3>
      <p>
        All times retain their source precision. Missing public or publication timestamps do not mean an event or
        article was absent.
      </p>
      <div className="policy-evidence-tools">
        <label>
          Evidence table
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as EvidenceKind);
              setPage(0);
            }}
          >
            {Object.entries(evidenceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label} · {(investigation.evidence[value as EvidenceKind] || []).length.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <span>{records.length.toLocaleString()} records</span>
      </div>
      {records.length ? (
        <>
          <div
            className="research-table policy-table"
            tabIndex={0}
            role="region"
            aria-label={`${evidenceLabels[kind]} source records`}
          >
            <table>
              <thead>
                <tr>
                  {columns[kind].map(([key, label]) => (
                    <th scope="col" key={key}>
                      {label}
                    </th>
                  ))}
                  {!["bars", "newsCoverage"].includes(kind) && <th scope="col">Source / record</th>}
                </tr>
              </thead>
              <tbody>
                {records.slice(current * size, (current + 1) * size).map((record, index) => (
                  <tr key={readable(record.id || `${record.symbol}-${record.at}-${index}`)}>
                    {columns[kind].map(([key]) => (
                      <td key={key}>{readable(record[key])}</td>
                    ))}
                    {!["bars", "newsCoverage"].includes(kind) && (
                      <td>
                        {sourceLink(record.sourceUrl) ? (
                          <a href={sourceLink(record.sourceUrl)} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        ) : (
                          <span>No source URL</span>
                        )}
                        <small>{readable(record.sourceRecordId || record.id)}</small>
                        {record.sourceHash != null && (
                          <details>
                            <summary>Source hash</summary>
                            <code>{readable(record.sourceHash)}</code>
                          </details>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="policy-pagination">
              <button className="panels-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Previous records
              </button>
              <span>
                Page {current + 1} of {pages}
              </span>
              <button className="panels-btn" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
                Next records
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="policy-empty">
          No {evidenceLabels[kind].toLowerCase()} saved. Collect or import records before evaluating this part of the
          study. This is not evidence of no activity.
        </p>
      )}
      {(investigation.evidence.manifest || investigation.evidence.sources) != null && (
        <details>
          <summary>Collection manifest and source coverage</summary>
          <pre>
            {JSON.stringify(
              { manifest: investigation.evidence.manifest, sources: investigation.evidence.sources },
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </section>
  );
}
