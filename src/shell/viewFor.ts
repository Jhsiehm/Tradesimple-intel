import { districtGeoid, parseDistrict } from "../../shared/districts.mjs";
import type { Chamber, CongressMode, EarthSettings, MarketLayer, Section } from "../types";
import type { MarketView } from "./sections";
import type { DistrictLayer } from "../districts/useDistricts";
import type { ContractScope } from "../contracts/useContracts";

/** The screen parts a navigation sets together. Back (Alt+←) restores these fields as they were left. */
export type View = {
  section: Section;
  chamber: Chamber;
  mode: CongressMode;
  voteView: "map" | "floor";
  mapLayer: "votes" | "filings";
  districtLayer: DistrictLayer;
  marketView: MarketView;
  layer: MarketLayer;
  newsView: "board" | "globe";
  selectedId: string | null;
  /** Satellite imagery under a data map. Off by default; imagery-first maps ignore it. */
  imagery: boolean;
  /** Intel arcs on a data map without a member or ticker scope. */
  arcs: boolean;
};

export const START_VIEW: View = {
  section: "congress",
  chamber: "house",
  mode: "votes",
  voteView: "floor",
  mapLayer: "filings",
  districtLayer: "sites",
  marketView: "board",
  layer: "politicians",
  newsView: "board",
  selectedId: null,
  imagery: false,
  arcs: false
};

export type ViewPatch = Partial<View> & {
  /** Close the timeline, the Today board, and the calendar so the section owns the center. */
  stage?: true;
  /** Drop an explicitly opened dossier so the selection's own drawer shows. */
  dossier?: null;
  /** `all`, `member:ID`, or `symbol:SYM` for the time scrubber. */
  scope?: string;
  contracts?: ContractScope;
  /** Unpinned cards belong to the section being left. */
  dropCards?: true;
  /** Show the list panel. */
  rail?: true;
};

const VIEW_KEYS = Object.keys(START_VIEW) as (keyof View)[];

const leave = (section: Section): ViewPatch => ({ stage: true, section, dossier: null });

/**
 * What a navigation action sets. `null` means the action is not a pure view change
 * (cards, charts, timeline, roll pick) and App handles it.
 */
export function viewFor(action: string, at: { intelOn: boolean }): ViewPatch | null {
  const [kind, ...rest] = action.split(":");
  const v = rest.join(":");
  switch (kind) {
    case "section":
      return { ...leave(v as Section), selectedId: null, scope: "all", dropCards: true };
    case "mode":
      return { ...viewFor("section:congress", at), mode: v as CongressMode };
    case "view":
      return { ...viewFor("section:markets", at), marketView: v as MarketView };
    case "layer":
      return { ...viewFor("section:markets", at), layer: v as MarketLayer };
    case "bill":
      return { ...leave("congress"), mode: "bills", voteView: "map", mapLayer: "votes", selectedId: v };
    case "vote":
      return { ...leave("congress"), mode: "votes", mapLayer: "votes", chamber: v.startsWith("senate") ? "senate" : "house", selectedId: v };
    case "committee": {
      const chamber: Chamber | undefined = v.startsWith("HS") ? "house" : v.startsWith("SS") ? "senate" : undefined;
      return { ...leave("congress"), mode: "committees", ...(chamber ? { chamber } : {}), selectedId: v };
    }
    case "hq":
      return { ...leave("districts"), districtLayer: "hq", selectedId: v ? `hq:${v.toUpperCase()}` : null, rail: true };
    case "site":
      return v ? { ...leave("districts"), districtLayer: "sites", selectedId: v, rail: true } : null;
    case "district": {
      const geoid = districtGeoid(parseDistrict(v));
      return geoid ? { ...leave("districts"), selectedId: geoid, rail: true } : null;
    }
    case "contracts": {
      const [k, ...val] = v.split(":");
      const scoped = k === "symbol" || k === "place" || k === "member";
      return { ...leave("contracts"), selectedId: null, contracts: scoped ? { kind: k as ContractScope["kind"], value: val.join(":").toUpperCase() } : { kind: "all", value: "" } };
    }
    case "scope":
      return at.intelOn ? { scope: v } : { ...leave("congress"), voteView: "map", mapLayer: "votes", selectedId: null, scope: v };
    default:
      return null;
  }
}

/** Patch the view; fields the patch leaves out keep their value. */
export function applyView(view: View, patch: ViewPatch): View {
  const next = { ...view };
  for (const key of VIEW_KEYS) if (patch[key] !== undefined) (next as Record<string, unknown>)[key] = patch[key];
  return next;
}

/** Only the view fields, for storing on a trail entry. */
export function viewOnly(view: View): View {
  return Object.fromEntries(VIEW_KEYS.map((key) => [key, view[key]])) as View;
}

export type MapLook = {
  /** The map's subject is records: a vote, filings, district, or HQ choropleth. */
  data: boolean;
  /** Satellite, clouds, and relief are on screen. */
  imagery: boolean;
  /** Base settings the map renders with: data maps without imagery run flat and dark. */
  earth: EarthSettings;
  /** Choropleth fill opacity. */
  fill: number;
  /** Intel arcs draw on the map. */
  arcs: boolean;
  /** The records time control under the map: the intel window, the week's filing index, or none. */
  records: "window" | "filings" | null;
};

/**
 * How the center map looks. Records maps sit on the flat dark base at full fill with no arcs,
 * unless the user opts into imagery or arcs, or a member/ticker scope makes the arcs the subject.
 * `onMap` is false while a board (Today, timeline, calendar) covers the map.
 */
export function mapLook(view: View, at: { onMap: boolean; scoped: boolean; settings: EarthSettings }): MapLook {
  const data = at.onMap && ((view.section === "congress" && view.voteView === "map") || view.section === "districts");
  const imagery = at.onMap && (!data || view.imagery);
  const filings = data && view.section === "congress" && view.mapLayer === "filings";
  return {
    data,
    imagery,
    earth: data && !imagery ? { ...at.settings, base: "dark", view: "2d" } : at.settings,
    fill: !data ? 1 : imagery ? 0.7 : 0.92,
    arcs: data && !filings && (at.scoped || view.arcs),
    records: !data ? null : filings ? "filings" : "window"
  };
}

const SECTION_LABEL: Record<string, string> = { congress: "Congress", markets: "Markets", contracts: "Contracts", news: "News", districts: "Districts", strait: "Strait", map: "Map" };

/** Trail and ⌘K recents label. `who` names a bioguide id. */
export function trailLabel(action: string, who: (bioguide: string) => string): string {
  const [kind, ...rest] = action.split(":");
  const v = rest.join(":");
  if (kind === "member") return `${who(v)} · card`;
  if (kind === "timeline") return `${who(v)} · timeline`;
  if (kind === "scope") return `Map scope · ${v.startsWith("member:") ? who(v.slice(7)) : v.slice(7) || "all Congress"}`;
  if (kind === "contracts") {
    const [k, val] = v.split(":");
    return k === "member" ? `Contracts · ${who(val)} district` : k === "all" || !val ? "Contracts · all agencies" : `Contracts · ${val}`;
  }
  if (kind === "district") return `${v} · district dossier`;
  const label: Record<string, string> = {
    section: SECTION_LABEL[v] || v,
    map: "Map · city",
    ticker: `${v} dossier`,
    chart: `${v} chart`,
    inst: `${v} chart`,
    pos: `${v} positions`,
    supply: `${v} supply chain`,
    hq: `${v} headquarters`,
    site: "District site",
    bill: `Bill ${v}`,
    vote: `Roll call ${v}`,
    committee: `Committee ${v}`,
    mode: `Congress · ${v}`,
    view: `Markets · ${v}`,
    layer: `Markets · ${v}`,
    calendar: "Calendar",
    alerts: "Alerts",
    today: v === "leaders" ? "Leaderboards" : "This week in Congress trading"
  };
  return label[kind] || action;
}
