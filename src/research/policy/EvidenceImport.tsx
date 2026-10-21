import { useRef, useState } from "react";
import { evidenceLabels, type EvidenceKind, type EvidenceRecord } from "./types";

const guidance: Record<EvidenceKind, { note: string; example: object }> = {
  events: {
    note: "Event date and public release are separate. A date-only action does not support an intraday entry. Preserve precision and the basis for availability.",
    example: {
      id: "event-id",
      billId: "hr-119-1968",
      type: "vote",
      title: "Recorded vote",
      eventAt: "2025-03-11T18:00:00Z",
      eventPrecision: "instant",
      publicAt: "2025-03-11T18:02:00Z",
      publicPrecision: "instant",
      availabilityBasis: "importer-asserted",
      firstSeenAt: "2025-03-11T18:03:00Z",
      sourceUrl: "https://www.congress.gov/",
      sourceRecordId: "source-record-id",
      sourceHash: "sha256-of-source-record",
    },
  },
  news: {
    note: "Associate each reviewed article with its exact legislative event using eventId and reviewed: true. A query match alone is not a reviewed event association. Supply publication time only when supported; preserve archive observation separately. These examples show the format, not real evidence.",
    example: {
      id: "news-id",
      eventId: "event-id",
      billId: "hr-119-1968",
      reviewed: true,
      publishedAt: "2025-03-11T18:30:00Z",
      firstSeenAt: "2025-03-11T18:35:00Z",
      sourceUrl: "https://example.org/article",
      title: "Article title",
      archive: "gdelt-doc2",
      timingBasis: "importer-asserted",
      sourceHash: "sha256-of-source-record",
    },
  },
  exposures: {
    note: "Record which companies an action affects and why. A reviewed mapping needs a dated source, a rationale, a direction, and a validity interval established before the trade. No automatic causal mapping is implied.",
    example: {
      id: "exposure-id",
      billId: "hr-119-1968",
      symbol: "LMT",
      side: "long",
      knownAt: "2025-03-10T12:00:00Z",
      validFrom: "2025-03-10T12:00:00Z",
      validTo: "2025-03-31T23:59:59Z",
      sourceUrl: "https://example.org/dated-exposure-evidence",
      rationale: "Documented relationship to this specific bill; researcher reviewed.",
      reviewed: true,
    },
  },
  bars: {
    note: "Supply one-minute OHLC observations for the companies and every selected benchmark. “at” is the bar opening time in UTC. Daily prices cannot resolve trading before news.",
    example: { symbol: "LMT", at: "2025-03-11T18:03:00Z", open: 450, close: 450.1, intervalMinutes: 1 },
  },
  newsCoverage: {
    note: 'State what the archive actually covers and how it was checked. Scope each assertion to a billId or eventId; use scope: "archive-global" only for an explicitly checked archive-wide interval. Coverage records are researcher assertions, not independent certification that every relevant article was captured.',
    example: {
      archive: "gdelt-doc2",
      billId: "hr-119-1968",
      from: "2025-03-01T00:00:00Z",
      to: "2025-03-31T23:59:59Z",
      complete: true,
      basis: "Describe the archive query, pagination, source scope, and the evidence for this assertion.",
    },
  },
};
export function EvidenceImport({
  busy,
  onImport,
}: {
  busy: boolean;
  onImport: (kind: EvidenceKind, records: EvidenceRecord[]) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<EvidenceKind>("exposures");
  const [content, setContent] = useState(""),
    [error, setError] = useState(""),
    [fileName, setFileName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  let records: EvidenceRecord[] = [],
    validation = "";
  if (content.trim()) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== "object" || Array.isArray(row)))
        validation = "Use a JSON array of record objects.";
      else if (parsed.length > 20000) validation = "Import at most 20,000 records at a time.";
      else if (new TextEncoder().encode(content).length > 6 * 1024 * 1024)
        validation = "Import at most 6 MiB of JSON at a time.";
      else records = parsed as EvidenceRecord[];
    } catch {
      validation = "The JSON could not be read. Check commas, quotation marks, and brackets.";
    }
  }
  const submit = async () => {
    setError("");
    if (await onImport(kind, records)) {
      setContent("");
      setFileName("");
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <details className="policy-import">
      <summary>Import missing evidence</summary>
      <fieldset className="research-form" disabled={busy}>
        <legend>Append source records</legend>
        <p>
          Records are appended. Exact duplicates are ignored; conflicting IDs or changed prices are rejected. Create a
          new study to revise conflicting evidence.
        </p>
        <label>
          Evidence type
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as EvidenceKind);
              setError("");
            }}
          >
            {Object.entries(evidenceLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p>{guidance[kind].note}</p>
        <label>
          JSON file
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 6 * 1024 * 1024) {
                setError("Choose a JSON file no larger than 6 MiB.");
                return;
              }
              void file
                .text()
                .then((text) => {
                  setContent(text);
                  setFileName(file.name);
                  setError("");
                })
                .catch(() => setError("This file could not be read. Choose it again or paste its JSON below."));
            }}
          />
        </label>
        <label>
          Or paste JSON
          <textarea
            className="research-data"
            rows={7}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setError("");
            }}
            spellCheck={false}
            placeholder="Paste an array of source records"
          />
        </label>
        <details>
          <summary>Required record format · illustrative values</summary>
          <pre>{JSON.stringify([guidance[kind].example], null, 2)}</pre>
          <p>
            Use your actual evidence and source links. Server validation checks required fields and timing rules before
            evaluation.
          </p>
        </details>
        {(error || validation) && <p role="alert">{error || validation}</p>}
        <div className="research-actions">
          <button
            type="button"
            className="panels-btn"
            disabled={!records.length || Boolean(validation)}
            onClick={() => void submit()}
          >
            Import {records.length ? `${records.length.toLocaleString()} ` : ""}records
          </button>
          {fileName && <span>{fileName}</span>}
        </div>
      </fieldset>
    </details>
  );
}
