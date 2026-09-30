import { toggleSymbol, useWatch } from "../lib/useWatch";
import type { Section } from "../types";
import { PANEL_TITLE, type PanelKind } from "./Panels";
import type { Rail } from "./useRail";

type Action = { label: string; why: string; run: () => void };

type Props = {
  open: boolean;
  onOpen: (open: boolean) => void;
  section: Section;
  /** Symbol in view (chart, supply board, or dossier); empty when none. */
  focusSymbol: string;
  fallbackSymbol: string;
  cardCount: number;
  rail: Rail;
  onToggleRail: () => void;
  onResetRail: () => void;
  onCollapseAll: () => void;
  onCloseAll: () => void;
  openPanel: (kind: PanelKind, symbol?: string) => void;
  openPositions: (symbol: string) => void;
  pinSymbol: (symbol: string) => void;
  showChart: (symbol: string) => void;
};

export function PanelsMenu(props: Props) {
  const { open, onOpen, focusSymbol, fallbackSymbol, rail, openPanel, openPositions, pinSymbol } = props;
  const { watch } = useWatch();
  const symbol = focusSymbol || fallbackSymbol;
  const suggestions = suggest(props, watch.symbols.includes(focusSymbol));
  const workspaces: Action[] = [
    { label: `Ticker research · ${symbol}`, why: "Chart, dossier, positions, and supply chain together", run: () => { props.showChart(symbol); pinSymbol(symbol); openPositions(symbol); openPanel("supply", symbol); } },
    { label: "Congress money trail", why: "Watchlist, last buyers, and headlines", run: () => { openPanel("watch"); openPanel("lastbuy"); openPanel("wire"); } },
    { label: "Global macro & arbitrage map", why: "World indices, ADR premiums, and X trending", run: () => { openPanel("globals"); openPanel("x"); } }
  ];
  const run = (fn: () => void) => () => { fn(); onOpen(false); };
  const row = (a: Action) => (
    <button key={a.label} className="panels-row" onClick={run(a.run)}>
      <strong>{a.label}</strong><span>{a.why}</span>
    </button>
  );

  return (
    <>
      <button className="ghost panels-btn" aria-expanded={open} onClick={() => onOpen(!open)}>Panels{props.cardCount ? ` · ${props.cardCount}` : ""}</button>
      {open ? (
        <div className="panels-menu" role="menu">
          <h4>Pin a panel <small>stays open across tabs · drag, resize from any edge, – to collapse</small></h4>
          <div className="panels-grid">
            {(["watch", "x", "lastbuy", "wire", "globals"] as PanelKind[]).map((k) => (
              <button key={k} onClick={run(() => openPanel(k))}>
                {PANEL_TITLE[k]}
                {k === "watch" ? <small>{watch.symbols.length} tickers · {watch.members.length} members</small> : null}
              </button>
            ))}
            <button onClick={run(() => openPanel("supply", symbol))}>Supply chain<small>{symbol}</small></button>
          </div>
          {suggestions.length ? (
            <>
              <h4>Suggested for this view</h4>
              {suggestions.map(row)}
            </>
          ) : null}
          <h4>Workspaces</h4>
          {workspaces.map(row)}
          <h4>Layout</h4>
          <div className="panels-grid">
            <button onClick={props.onToggleRail}>{rail.open ? "Hide list panel" : "Show list panel"}<small>or press {"\\"}</small></button>
            <button onClick={props.onResetRail}>Reset list width<small>{rail.w}px now</small></button>
            <button onClick={props.onCollapseAll}>Collapse all cards</button>
            <button onClick={run(props.onCloseAll)}>Close all cards</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function suggest({ section, focusSymbol: s, openPanel, openPositions, pinSymbol }: Props, watched: boolean): Action[] {
  const globals = (why: string): Action => ({ label: "Global markets", why, run: () => openPanel("globals") });
  const xPulse = (why: string): Action => ({ label: "X pulse", why, run: () => openPanel("x") });
  return [
    ...(s ? [
      { label: `Supply chain · ${s}`, why: "Suppliers, customers, linked indexes, co-movement", run: () => openPanel("supply", s) },
      { label: `Positions · ${s}`, why: "Every Congress, insider, and fund filer, with the last buyer", run: () => openPositions(s) },
      { label: `Dossier · ${s}`, why: "Quote, lobbying, PACs, contracts, district seats", run: () => pinSymbol(s) },
      { label: `${watched ? "★ Unwatch" : "☆ Watch"} ${s}`, why: "Keep it on the watchlist card", run: () => toggleSymbol(s) }
    ] : []),
    ...(section === "congress" ? [
      { label: "Last buyers", why: "Who in Congress bought each name most recently", run: () => openPanel("lastbuy") },
      { label: "Watchlist", why: "Latest trade for each watched member", run: () => openPanel("watch") }
    ] : []),
    ...(section === "markets" && !s ? [
      { label: "Last buyers", why: "Most recent Congress and insider buys", run: () => openPanel("lastbuy") },
      globals("World indices and ADR premiums while you scan US names")
    ] : []),
    ...(section === "news" ? [
      xPulse("Trending topics and market-moving accounts beside the wires"),
      globals("See which markets are reacting to the headline")
    ] : []),
    ...(section === "strait" ? [
      globals("TAIEX, Hang Seng, Nikkei, and the TSMC ADR premium"),
      { label: "Supply chain · TSM", why: "Who depends on Taiwan fabs", run: () => openPanel("supply", "TSM") },
      xPulse("OSINT accounts and what is trending")
    ] : []),
    ...(section === "districts" ? [
      { label: "Headlines", why: "Wire stories for companies with plants on the map", run: () => openPanel("wire") }
    ] : [])
  ];
}
