import { REGIONS } from "../news/newsGlobe";
import type { Chamber, Marker, Section } from "../types";

export type MapView = {
  geojson?: GeoJSON.FeatureCollection;
  colorProp?: string;
  markers: Marker[];
  center: [number, number];
  zoom: number;
};

type Sources = {
  section: Section;
  chamber: Chamber;
  strait: { theater?: { lon: number; lat: number; zoom: number } | null; markers: Marker[]; airMarkers: Marker[]; air: boolean };
  news: { globe: boolean; region: string; markers: Marker[] };
  districts: { geojson?: GeoJSON.FeatureCollection; markers: Marker[]; selected?: { lon: number; lat: number; zoom?: number } | null };
  congress: { geojson?: GeoJSON.FeatureCollection; voted: boolean; markers?: Marker[] };
};

/** What the center map shows for the current section. */
export function mapView({ section, chamber, strait, news, districts, congress }: Sources): MapView {
  if (section === "strait" && strait.theater) {
    return { markers: strait.air ? strait.airMarkers : strait.markers, center: [strait.theater.lon, strait.theater.lat], zoom: strait.theater.zoom };
  }
  if (news.globe) {
    const region = REGIONS.find((r) => r.id === news.region) || REGIONS[0];
    return { markers: news.markers, center: region.center, zoom: region.zoom };
  }
  if (section === "districts") {
    const site = districts.selected;
    return { geojson: districts.geojson, colorProp: "vote", markers: districts.markers, center: site ? [site.lon, site.lat] : [-96, 38], zoom: site ? site.zoom ?? 6.5 : 3.2 };
  }
  return { geojson: congress.geojson, colorProp: congress.voted ? "vote" : undefined, markers: congress.markers || [], center: [-96, 38], zoom: chamber === "house" ? 3.3 : 3.1 };
}
