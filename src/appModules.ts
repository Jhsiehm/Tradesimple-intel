import { lazy } from "react";
import { DEMO } from "./lib/api";
import type { ChartSpan } from "./markets/CandleChart";
import type { StatusLine } from "./types";
export const MapFrame = lazy(() => import("./shell/MapFrame").then((m) => ({ default: m.MapFrame })));
export const RelationsMap = lazy(() => import("./relations/RelationsMap").then((m) => ({ default: m.RelationsMap })));
export const FloorMap = lazy(() => import("./congress/FloorMap").then((m) => ({ default: m.FloorMap })));
export const CalendarBoard = lazy(() => import("./markets/CalendarBoard").then((m) => ({ default: m.CalendarBoard })));
export const MarketStage = lazy(() => import("./markets/MarketStage").then((m) => ({ default: m.MarketStage })));
export const MemberTimeline = lazy(() =>
  import("./congress/MemberTimeline").then((m) => ({ default: m.MemberTimeline })),
);
export const NewsBoard = lazy(() => import("./news/NewsBoard").then((m) => ({ default: m.NewsBoard })));
export const TodayBoard = lazy(() => import("./congress/TodayBoard").then((m) => ({ default: m.TodayBoard })));
export const ContractsBoard = lazy(() =>
  import("./contracts/ContractsBoard").then((m) => ({ default: m.ContractsBoard })),
);
export const ResearchBoard = lazy(() => import("./research/ResearchBoard").then((m) => ({ default: m.ResearchBoard })));
export const BacktestBoard = lazy(() => import("./backtest/BacktestBoard").then((m) => ({ default: m.BacktestBoard })));
/** The demo snapshot has no intraday bars. */
export const OPEN_SPAN: ChartSpan = DEMO ? "1y" : "5m";

export const TRAIL_KEY = "intel:trail:v1";
export const TODAY_SEEN = "intel:today:seen";
export const TODAY_STATUS: StatusLine = {
  source: "House Clerk · Senate eFD",
  asOf: "",
  latency: "Filed up to 45 days after the trade.",
};
export const TIMELINE_STATUS: StatusLine = {
  source: "House Clerk PTR PDFs / Senate eFD",
  asOf: "",
  latency: "Trade date as disclosed; filed up to 45 days later by law.",
};
export type TodayTab = "week" | "leaders" | "bt" | "research";
