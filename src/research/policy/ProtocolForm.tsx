import { useState } from "react";
import type { PolicyProtocol } from "./types";
import { nyDate } from "../../../shared/dates.mjs";

export const originalQuestion =
  "Does trading on publicly available congressional votes, committee markups, bill introductions, or bill passage before they appear in news coverage produce higher returns than SPY? Test two years and separately one month.";
const day = (date: Date) => date.toISOString().slice(0, 10);
export function defaultProtocol(): PolicyProtocol {
  const end = new Date(`${nyDate()}T00:00:00Z`),
    start = new Date(end),
    holdout = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  holdout.setUTCMonth(holdout.getUTCMonth() - 6);
  return {
    schemaVersion: 1,
    title: "Legislative action before news · defense pilot",
    question: originalQuestion,
    billIds: ["hr-119-1968"],
    from: day(start),
    to: day(end),
    universe: ["LMT", "RTX", "NOC", "GD", "HII"],
    eventTypes: ["vote", "markup", "introduced", "passed", "enacted"],
    benchmark: "SPY",
    sectorBenchmark: "ITA",
    latencySeconds: 60,
    holdingMinutes: 60,
    costBps: 10,
    holdoutFrom: day(holdout),
    newsArchive: "gdelt-doc2",
    newsTimeBasis: "publication",
  };
}
const list = (value: string) => [
  ...new Set(
    value
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];
export function ProtocolForm({
  initial,
  busy,
  onCreate,
  onCancel,
}: {
  initial?: PolicyProtocol;
  busy: boolean;
  onCreate: (protocol: PolicyProtocol) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial || defaultProtocol);
  const [bills, setBills] = useState(draft.billIds.join(", "));
  const [symbols, setSymbols] = useState(draft.universe.join(", "));
  const update = <K extends keyof PolicyProtocol>(key: K, value: PolicyProtocol[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const billIds = list(bills).map((x) => x.toLowerCase()),
    universe = list(symbols).map((x) => x.toUpperCase());
  const validation =
    draft.title.trim().length < 3 || draft.question.trim().length < 10
      ? "Add a descriptive title and preserve your research question."
      : !billIds.length || billIds.some((x) => !/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-\d+-\d+$/.test(x))
        ? "Use bill IDs in type-congress-number order, such as hr-119-1968."
        : !universe.length
          ? "Specify the company symbols to investigate."
          : !draft.from || !draft.to || draft.from > draft.to
            ? "Choose a study start before its end."
            : !draft.holdoutFrom || draft.holdoutFrom <= draft.from || draft.holdoutFrom > draft.to
              ? "Choose a holdout start after the first study day and within the study period."
              : !draft.eventTypes.length
                ? "Select at least one legislative action."
                : !Number.isInteger(draft.latencySeconds) || draft.latencySeconds < 0 || draft.latencySeconds > 3600
                  ? "Processing delay must be a whole number from 0 to 3,600 seconds."
                  : !Number.isInteger(draft.holdingMinutes) || draft.holdingMinutes < 1 || draft.holdingMinutes > 390
                    ? "Holding time must be a whole number from 1 to 390 minutes."
                    : !Number.isFinite(draft.costBps) || draft.costBps < 0 || draft.costBps > 1000
                      ? "Round-trip trading cost must be from 0 to 1,000 basis points."
                      : "";
  const windowPreset = (months: number) => {
    const end = new Date(`${draft.to || nyDate()}T00:00:00Z`),
      start = new Date(end),
      split = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - months);
    split.setUTCDate(split.getUTCDate() - Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000 / 4)));
    setDraft((previous) => ({ ...previous, from: day(start), holdoutFrom: day(split) }));
  };
  return (
    <form
      className="policy-protocol"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validation) onCreate({ ...draft, billIds, universe });
      }}
    >
      <fieldset className="research-form" disabled={busy}>
        <legend>{initial ? "New version from this protocol" : "Define the study"}</legend>
        <p>
          Each saved study locks its question and trading rules. This version evaluates one window: {draft.from} through{" "}
          {draft.to}. Create a separate version for the other requested window; the original research question is
          preserved.
        </p>
        <label>
          Study title
          <input required maxLength={200} value={draft.title} onChange={(e) => update("title", e.target.value)} />
        </label>
        <label>
          Research question
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={draft.question}
            onChange={(e) => update("question", e.target.value)}
          />
        </label>
        <div className="research-mapping">
          <label>
            Bill IDs
            <input
              required
              value={bills}
              onChange={(e) => setBills(e.target.value)}
              aria-describedby="policy-bill-help"
            />
          </label>
          <label>
            Company universe
            <input required value={symbols} onChange={(e) => setSymbols(e.target.value)} />
          </label>
        </div>
        <p id="policy-bill-help" className="policy-note">
          The bill and defense companies are a starting example. Inclusion is not evidence that a company benefits.
          Dated, reviewed exposure mappings are required.
        </p>
        <fieldset className="policy-event-types">
          <legend>Eligible legislative actions</legend>
          {[
            ["vote", "Votes"],
            ["markup", "Committee markups"],
            ["introduced", "Introductions"],
            ["passed", "Passage"],
            ["enacted", "Enactment"],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={draft.eventTypes.includes(value)}
                onChange={(e) =>
                  update(
                    "eventTypes",
                    e.target.checked ? [...draft.eventTypes, value] : draft.eventTypes.filter((x) => x !== value),
                  )
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="policy-inline-actions">
          <span>Window presets</span>
          <button type="button" className="panels-btn" onClick={() => windowPreset(24)}>
            Two years
          </button>
          <button type="button" className="panels-btn" onClick={() => windowPreset(1)}>
            One month
          </button>
        </div>
        <div className="research-mapping">
          <label>
            Start date
            <input type="date" required value={draft.from} onChange={(e) => update("from", e.target.value)} />
          </label>
          <label>
            End date
            <input type="date" required value={draft.to} onChange={(e) => update("to", e.target.value)} />
          </label>
          <label>
            Chronological holdout starts
            <input
              type="date"
              required
              value={draft.holdoutFrom}
              onChange={(e) => update("holdoutFrom", e.target.value)}
            />
          </label>
        </div>
        <p className="policy-note">
          Date defaults follow Washington’s calendar. Action scope uses the source action date; availability and holdout
          assignment use UTC dates. A historical split remains exploratory. An untouched prospective holdout requires
          rules registered before the test period.
        </p>
        <div className="research-mapping">
          <label>
            Market benchmark
            <input value={draft.benchmark} readOnly />
          </label>
          <label>
            Sector benchmark (optional)
            <input
              value={draft.sectorBenchmark || ""}
              onChange={(e) => update("sectorBenchmark", e.target.value.toUpperCase() || null)}
            />
          </label>
          <label>
            Processing delay (seconds)
            <input
              type="number"
              required
              min={0}
              max={3600}
              value={draft.latencySeconds}
              onChange={(e) => update("latencySeconds", e.target.valueAsNumber)}
            />
          </label>
          <label>
            Holding time (minutes)
            <input
              type="number"
              required
              min={1}
              max={390}
              value={draft.holdingMinutes}
              onChange={(e) => update("holdingMinutes", e.target.valueAsNumber)}
            />
          </label>
          <label>
            Round-trip cost (basis points)
            <input
              type="number"
              required
              min={0}
              max={1000}
              step="0.1"
              value={draft.costBps}
              onChange={(e) => update("costBps", e.target.valueAsNumber)}
            />
          </label>
        </div>
        <div className="research-mapping">
          <label>
            News archive
            <input value={draft.newsArchive} readOnly />
          </label>
          <label>
            News timing comparison
            <select
              value={draft.newsTimeBasis}
              onChange={(e) => update("newsTimeBasis", e.target.value as PolicyProtocol["newsTimeBasis"])}
            >
              <option value="publication">Article publication time</option>
              <option value="archive-first-seen">Archive first observation (narrower test)</option>
            </select>
          </label>
        </div>
        <p className="policy-note">
          {draft.newsTimeBasis === "publication"
            ? "Requires exact, cited publication timestamps. Imported timing assertions remain conditional until independently verified. Archive discovery time is not publication time."
            : "This narrower study compares against archive observation. It cannot establish trading before publication or before all news coverage."}{" "}
          Trading is evaluated after public release plus processing delay. This pilot measures event returns, not an
          investable portfolio.
        </p>
        {validation && <p className="policy-note">{validation}</p>}
        <div className="research-actions">
          <button type="submit" className="bt-run" disabled={Boolean(validation)}>
            Save locked study
          </button>
          {onCancel && (
            <button type="button" className="panels-btn" onClick={onCancel}>
              Cancel new version
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
