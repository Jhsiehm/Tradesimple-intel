export type Section = "congress" | "markets" | "districts" | "strait";
export type Chamber = "house" | "senate";
export type MarketLayer = "politicians" | "insiders" | "whales" | "shorts";

export type ListItem = {
  id: string;
  title: string;
  meta: string;
  tone?: "yea" | "nay" | "up" | "down" | "";
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
};

export type Stage = { name: string; reached: boolean };

export type DrawerModel = {
  title: string;
  meta?: string;
  stages?: Stage[];
  rows: { label: string; value: string }[];
  blocks?: { title: string; lines: string[] }[];
};
