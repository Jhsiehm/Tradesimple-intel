import { lazy, Suspense } from "react";
import type { MarketView } from "../shell/sections";
import type { ChartMark, DrawerModel } from "../types";
import type { ChartSpan } from "./CandleChart";
import { econModel } from "./CalendarBoard";
import { GlobalBoard } from "./GlobalBoard";
import { SupplyBoard } from "./SupplyBoard";

const CandleChart = lazy(() => import("./CandleChart").then((m) => ({ default: m.CandleChart })));
const CryptoBoard = lazy(() => import("./CryptoBoard").then((m) => ({ default: m.CryptoBoard })));
const FxBoard = lazy(() => import("./FxBoard").then((m) => ({ default: m.FxBoard })));
const PositionsBoard = lazy(() => import("./PositionsBoard").then((m) => ({ default: m.PositionsBoard })));
const QuoteBoard = lazy(() => import("./QuoteBoard").then((m) => ({ default: m.QuoteBoard })));

type Props = {
  view: MarketView;
  chart: { symbol: string; span: ChartSpan; marks: ChartMark[]; onSpan: (s: ChartSpan) => void; onBack: () => void };
  supplySymbol: string;
  onSupplySymbol: (symbol: string) => void;
  showChart: (symbol: string, span: ChartSpan) => void;
  openPositions: (symbol: string) => void;
  openMember: (bioguide: string) => void;
  pinSymbol: (symbol: string) => void;
  onDossier: (model: DrawerModel) => void;
  onFollow: (action: string) => void;
};

/** Center pane for the Markets section. */
export function MarketStage(props: Props) {
  return (
    <Suspense fallback={<p className="stage-loading">Loading board…</p>}>
      <Board {...props} />
    </Suspense>
  );
}

function Board({ view, chart, supplySymbol, onSupplySymbol, showChart, openPositions, openMember, pinSymbol, onDossier, onFollow }: Props) {
  if (view === "chart") return <CandleChart symbol={chart.symbol} span={chart.span} onSpan={chart.onSpan} onBack={chart.onBack} marks={chart.marks} />;
  if (view === "positions") return <PositionsBoard onOpen={openPositions} onMember={openMember} />;
  if (view === "globals") return <GlobalBoard onOpen={(symbol) => showChart(symbol, "6mo")} />;
  if (view === "supply") return <SupplyBoard symbol={supplySymbol} onSymbol={onSupplySymbol} onOpen={onFollow} />;
  if (view === "fx") return <FxBoard onOpen={(symbol) => showChart(symbol, "5m")} onEvent={(e) => onDossier(econModel(e))} />;
  if (view === "crypto") return <CryptoBoard onOpen={(symbol) => showChart(symbol, "5m")} />;
  return <QuoteBoard onOpen={(symbol) => { showChart(symbol, "5m"); pinSymbol(symbol); }} onMap={() => onFollow("hq:")} />;
}
