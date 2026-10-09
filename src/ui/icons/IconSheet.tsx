import { Icon, IconLabel } from "./Icon";
import { ICON_NAMES, type IconName } from "./names";
import { NAV } from "./nav";
import { CONGRESS } from "./congress";
import { MARKETS } from "./markets";
import { MAP } from "./map";
import { ACTIONS } from "./actions";
import { RELATIONS } from "./relations";

const MEANING: Record<IconName, string> = {
  today: "Today · this week's filings", congress: "Congress section", markets: "Markets section", contracts: "Federal contracts",
  news: "News wires", districts: "Districts · location", strait: "Strait · shipping", map: "Map section · map view",
  calendar: "Calendar", globe: "Globe view · global indices", city: "City skyline",
  house: "House chamber", senate: "Senate chamber", votes: "Votes · roll calls", bills: "Bills", members: "Members · representative",
  committees: "Committees", floor: "Floor seating chart", filings: "Trade filings", form4: "SEC Form 4 · insiders", hearing: "Hearings",
  roll: "Roll-call lane", trade: "Trades", pac: "PAC money", leaders: "Leaderboards", timeline: "Member timeline",
  chart: "Chart (GP)", board: "Equity board", fx: "FX", crypto: "Crypto", positions: "Positions (POS)", supply: "Supply chain (SPLC)",
  star: "Watch", "star-on": "Watching",
  view2d: "2D view", cube: "3D view", lanes: "Shipping lanes", imagery: "Imagery under the data", labels: "Map labels", hq: "Headquarters",
  sites: "Plants and sites", air: "Aircraft", military: "Military aircraft", satellite: "Satellite mosaic", live: "Live frames",
  daily: "Daily true color", night: "Night lights", filter: "Filter", arc: "Show on map · arcs",
  search: "Search", back: "Back", close: "Close", collapse: "Collapse", expand: "Expand", "chevron-down": "Fold open",
  "chevron-right": "Folded", pin: "Pin card", share: "Share", link: "Copy link", external: "Open source filing", check: "Mark read",
  checks: "Mark all read", dismiss: "Dismiss", restore: "Restore", bell: "Alerts", grip: "Drag", command: "Command line (⌘K)",
  panels: "Panels", dossier: "Dossier (DES)", recent: "Recent", feed: "Feeds · source, as-of, lag", reset: "Reset scope",
  lobbying: "Lobbying (LDA)", agency: "Federal agency", firm: "Lobbying registrant", company: "Company outside the join table",
  ticker: "Ticker", insider: "Form 4 filer", theory: "Your theory · not from a data source", "user-node": "Node you added",
  draw: "Draw a theory", fit: "Fit to view", undo: "Undo", redo: "Redo", "zoom-in": "Zoom in", "zoom-out": "Zoom out",
  export: "Export theories", import: "Import theories", layout: "Re-run layout", more: "Show more", trash: "Remove"
};

const GROUPS: [string, readonly string[]][] = [
  ["Sections", Object.keys(NAV)],
  ["Congress and records", Object.keys(CONGRESS)],
  ["Markets", Object.keys(MARKETS)],
  ["Map", Object.keys(MAP)],
  ["Actions", Object.keys(ACTIONS)],
  ["Relationship map", Object.keys(RELATIONS)]
];

/** Dev-only review sheet at `#icons`: every icon at 14, 16, and 20 px, plus in-button samples. */
export function IconSheet() {
  return (
    <main className="icon-sheet">
      <h1>TradeSimple Intel · icon set</h1>
      <p>{ICON_NAMES.length} icons · 16×16 grid · 1.5 stroke · currentColor · sizes 14 / 16 / 20 and 16 in accent</p>
      {GROUPS.map(([title, names]) => (
        <section key={title}>
          <h2>{title}</h2>
          <div className="icon-grid">
            {(names as IconName[]).map((n) => (
              <div key={n} className="icon-cell">
                <span>
                  <Icon name={n} size={14} />
                  <Icon name={n} size={16} />
                  <Icon name={n} size={20} />
                  <Icon name={n} size={16} className="accent" />
                </span>
                <code>{n}</code>
                <small>{MEANING[n]}</small>
              </div>
            ))}
          </div>
        </section>
      ))}
      <h2>In buttons</h2>
      <div className="icon-demo">
        <button aria-pressed="true"><IconLabel icon="congress">Congress</IconLabel></button>
        <button><IconLabel icon="votes">Votes</IconLabel></button>
        <button><IconLabel icon="filings">Filings</IconLabel></button>
        <button><IconLabel icon="globe">Globe</IconLabel></button>
        <button><IconLabel icon="cube">3D</IconLabel></button>
        <button><IconLabel icon="share">Share</IconLabel></button>
        <button><IconLabel icon="external">Filing</IconLabel></button>
        <button aria-label="Close"><Icon name="close" /></button>
      </div>
    </main>
  );
}
