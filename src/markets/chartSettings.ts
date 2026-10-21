import type { EvidenceMark } from "./chartEvents";
import { INTERVALS, RANGES, intervalReason, defaultInterval } from "../../shared/chartWorkspace.mjs";
export type Settings = {
  interval: string;
  range: string;
  type: string;
  indicator: string;
  volume: boolean;
  adjusted: boolean;
  extended: boolean;
  zone: string;
  log: boolean;
};
const initial: Settings = {
  interval: "1d",
  range: "6mo",
  type: "candles",
  indicator: "sma",
  volume: true,
  adjusted: false,
  extended: false,
  zone: "UTC",
  log: false,
};
export function hasSavedSettings(id: number) {
  try {
    return !!localStorage.getItem(`intel:chart-settings:${id}`);
  } catch {
    return false;
  }
}
export function saved(id: number): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(`intel:chart-settings:${id}`) || "null");
    if (!s) return initial;
    const interval = INTERVALS.includes(s.interval) && s.interval !== "4h" ? s.interval : "1d",
      range = RANGES.includes(s.range) ? s.range : "6mo";
    return {
      ...initial,
      interval: intervalReason(interval, range) ? defaultInterval(range) : interval,
      range,
      type: s.type === "line" ? "line" : "candles",
      indicator: ["none", "sma", "ema", "vwap", "rsi", "macd"].includes(s.indicator) ? s.indicator : "sma",
      volume: s.volume !== false,
      adjusted: s.adjusted === true,
      extended: s.extended === true,
      zone: s.zone === "Exchange" ? "Exchange" : "UTC",
      log: s.log === true,
    };
  } catch {
    return initial;
  }
}

export type ChartPanelProps = {
  id: number;
  symbol: string;
  group: string;
  active: boolean;
  marks: EvidenceMark[];
  onSelect: (events: EvidenceMark[]) => void;
  onSymbol: (s: string) => void;
  onGroup: (s: string) => void;
  onActive: () => void;
  onWindow: (v: { symbol: string; interval: string; from: string; to: string }) => void;
  initialSpan?: string;
  linkedWindow?: { symbol: string; interval: string; from: string; to: string };
};
