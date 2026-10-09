import type { DrawerModel } from "../types";
import { CCY_CHART, COUNTRY_CCY, type EconEvent } from "./FxBoard";

export type CalendarTab = "sessions" | "earnings" | "macro" | "lobbying" | "pacs";

export type Meeting = {
  id: string;
  date: string;
  chamber: string;
  title: string;
  location?: string;
  status?: string;
  type?: string;
  committees?: { name: string; system: string }[];
  bills?: { id: string; label: string }[];
  nominations?: number;
  documents?: { name: string; url: string }[];
  videos?: { name: string; url: string }[];
  link?: string;
};

export function econModel(e: EconEvent): DrawerModel {
  const code = COUNTRY_CCY[e.country];
  const pair = code ? CCY_CHART[code] : "";
  return {
    title: `${e.country} · ${e.event}`,
    meta: `${e.date} ${e.time} ET · ${e.tier === "high" ? "High impact" : "Medium impact"} · Nasdaq economic calendar`,
    rows: [
      { label: "Actual", value: e.actual || "Not released" },
      { label: "Consensus", value: e.consensus || "—" },
      { label: "Previous", value: e.previous || "—" },
      { label: "Surprise", value: e.surprise ? `${e.surprise} consensus` : "—" },
      { label: "Currency", value: code || "—" }
    ],
    blocks: e.description ? [{ title: "What it measures", lines: [e.description] }] : undefined,
    links: [
      ...(pair ? [{ label: "Chart", value: `${code === "USD" ? "US Dollar Index" : pair.replace("=X", "")} with Fed, CPI, and macro marks`, action: `inst:${pair}` }] : []),
      ...(code && code !== "USD" ? [{ label: "Chart", value: "US Dollar Index (DXY)", action: "inst:DX-Y.NYB" }] : []),
      ...(code === "USD" ? [
        { label: "Chart", value: "EUR/USD", action: "inst:EURUSD=X" },
        { label: "Chart", value: "USD/JPY", action: "inst:USDJPY=X" },
        { label: "Chart", value: "Bitcoin", action: "inst:BTC-USD" }
      ] : [])
    ]
  };
}
