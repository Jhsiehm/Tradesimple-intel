export type Section = "congress" | "markets" | "contracts" | "news" | "districts" | "strait";
export type Chamber = "house" | "senate";
export type MarketLayer = "politicians" | "insiders" | "whales" | "shorts";
export type CongressMode = "votes" | "bills" | "members" | "committees";
export type EarthBase = "dark" | "sat" | "live" | "daily" | "night";
export type EarthView = "2d" | "globe" | "3d";
export type EarthSettings = { base: EarthBase; view: EarthView; labels: boolean; lanes: boolean };
export type TileLayer = { tiles: string[]; maxzoom: number; source?: string; asOf?: string; attribution?: string; encoding?: string };
export type Earth = {
  layers: Record<"dark" | "sat" | "daily" | "night" | "labels" | "darkLabels" | "roads" | "terrain", TileLayer>;
  lanes?: GeoJSON.FeatureCollection;
  chokepoints?: GeoJSON.FeatureCollection;
  lanesSource?: string;
  lanesAsOf?: string;
};
export type PartyFilter = "all" | "D" | "R" | "I";
export type NewsDesk = "all" | "world" | "markets" | "x";

export type ListItem = {
  id: string;
  title: string;
  meta: string;
  tone?: "yea" | "nay" | "up" | "down" | "close" | "dem" | "rep" | "ind" | "";
  tag?: string;
};

export type StatusLine = {
  source: string;
  asOf: string;
  latency?: string;
};

export type Marker = {
  id: string;
  lon: number;
  lat: number;
  label: string;
  size?: number;
  color?: string;
  hot?: boolean;
};

export type LiveLayer = {
  id: string;
  key: string;
  name: string;
  covers: string;
  lon: number;
  maxzoom: number;
  template: string;
  ranges: { start: number; end: number; step: number }[];
};
export type LiveImagery = {
  asOf: string;
  source: string;
  latency: string;
  gap: string;
  layers: LiveLayer[];
  daily: { id: string; name: string; template: string; maxzoom: number; end: string; complete: string };
};
export type MapFlash = { id: string; lon: number; lat: number; title: string; meta: string };

export type Stage = { name: string; reached: boolean };

export type DrawerLink = {
  label: string;
  value: string;
  action?: string;
  href?: string;
};

export type DrawerTable = {
  title: string;
  cols: string[];
  /** `filing` is the original disclosure; rendered as its own link so `action` can still open the member. */
  rows: { cells: string[]; action?: string; href?: string; filing?: string; tone?: "up" | "down" | "dem" | "rep" | "" }[];
  note?: string;
  /** Shown instead of rows when the feed never looked at this symbol (so an empty list is not read as zero). */
  empty?: string;
};

export type DrawerModel = {
  title: string;
  meta?: string;
  stages?: Stage[];
  rows: { label: string; value: string }[];
  links?: DrawerLink[];
  tables?: DrawerTable[];
  blocks?: { title: string; lines: string[] }[];
  source?: string;
  watch?: string;
};

export type MarkTone = "buy" | "sell" | "file" | "earn" | "lobby" | "pac" | "gov" | "fomc" | "cpi" | "macro";
export type ChartMark = { t: number; label: string; tone?: MarkTone; detail?: string; href?: string };
