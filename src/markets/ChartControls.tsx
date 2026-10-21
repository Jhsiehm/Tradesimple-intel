import { INTERVALS, RANGES, intervalReason, defaultInterval } from "../../shared/chartWorkspace.mjs";
import type { Settings } from "./chartSettings";
export function ChartControls({
  id,
  settings,
  set,
}: {
  id: number;
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
}) {
  const { interval, range, type, indicator } = settings;
  return (
    <div className="chart-controls">
      <label>
        Interval{" "}
        <select
          aria-label={`Bar interval ${id + 1}`}
          value={interval}
          onChange={(e) => set({ interval: e.target.value })}
        >
          {INTERVALS.map((i) => (
            <option key={i} value={i} disabled={!!intervalReason(i, range)} title={intervalReason(i, range)}>
              {i === "1d" ? "Daily" : i === "1wk" ? "Weekly" : i === "1mo" ? "Monthly" : i}
              {intervalReason(i, range) ? " · unavailable" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Range{" "}
        <select
          aria-label={`History range ${id + 1}`}
          value={range}
          onChange={(e) => set({ range: e.target.value, interval: defaultInterval(e.target.value) })}
        >
          {RANGES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Type{" "}
        <select aria-label={`Chart type ${id + 1}`} value={type} onChange={(e) => set({ type: e.target.value })}>
          <option value="candles">Candles</option>
          <option value="line">Line</option>
        </select>
      </label>
      <label>
        Study{" "}
        <select
          aria-label={`Indicator ${id + 1}`}
          value={indicator}
          onChange={(e) => set({ indicator: e.target.value })}
        >
          {["none", "sma", "ema", "vwap", "rsi", "macd"].map((v) => (
            <option key={v} value={v}>
              {v === "sma" ? "SMA 20 / 50" : v === "ema" ? "EMA 20" : v.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
