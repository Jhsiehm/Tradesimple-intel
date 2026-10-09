import type { CongressMode, EarthBase, Section } from "../types";

export const SECTIONS: { id: Section; label: string; blurb: string }[] = [
  { id: "congress", label: "Congress", blurb: "Votes, bills, members, committees" },
  { id: "markets", label: "Markets", blurb: "Trades, filings, shorts, holdings" },
  { id: "contracts", label: "Contracts", blurb: "Federal contract actions · by agency, ticker, district, or member" },
  { id: "news", label: "News", blurb: "Global wires and X" },
  { id: "districts", label: "Districts", blurb: "Plants and headquarters on the map" },
  { id: "strait", label: "Strait", blurb: "Ships, news, and open imagery" },
  { id: "map", label: "Map", blurb: "Records in a window · draw a line between two of them" }
];

export const MODE_BLURB: Record<CongressMode, string> = {
  votes: "Roll calls · close votes first",
  bills: "Bills by latest action",
  members: "Every seat · click for the member card",
  committees: "Committees · members, bills, meetings"
};

export type MarketView = "board" | "globals" | "fx" | "crypto" | "positions" | "supply" | "chart";

export const BASE_TITLE: Record<EarthBase, string> = {
  dark: "Vector basemap",
  sat: "Esri World Imagery · mixed capture dates, not current",
  live: "GOES + Himawari frames every 10 min · scrub back 30h",
  daily: "VIIRS NOAA-20 daily true color · scrub back 30 days",
  night: "Black Marble night lights · 2016 composite"
};

export function utcNow() {
  return new Date().toISOString();
}
