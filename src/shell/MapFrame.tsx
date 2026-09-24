import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Marker } from "../types";

type Props = {
  geojson?: GeoJSON.FeatureCollection;
  idProp?: string;
  colorProp?: string;
  markers?: Marker[];
  rasterTiles?: string[];
  mapTiles?: string[];
  imagery?: "map" | "satellite" | "both";
  center: [number, number];
  zoom: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function MapFrame({
  geojson,
  idProp = "id",
  colorProp,
  markers = [],
  rasterTiles,
  mapTiles,
  imagery = "map",
  center,
  zoom,
  selectedId,
  onSelect
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      center,
      zoom,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#070806" } }],
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf"
      }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => {
      map.addSource("base", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "base-fill",
        type: "fill",
        source: "base",
        paint: {
          "fill-color": "#142016",
          "fill-opacity": 0.9
        }
      });
      map.addLayer({
        id: "base-line",
        type: "line",
        source: "base",
        paint: { "line-color": "#314232", "line-width": 0.6 }
      });
      map.addSource("roads", {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "© Esri"
      });
      map.addLayer({ id: "roads", type: "raster", source: "roads", layout: { visibility: "none" } });
      map.addSource("sat", {
        type: "raster",
        tiles: ["https://example.invalid/{z}/{x}/{y}.jpg"],
        tileSize: 256
      });
      map.addLayer({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" } });
      map.addSource("marks", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "marks",
        type: "circle",
        source: "marks",
        paint: {
          "circle-radius": 5,
          "circle-color": "#e2b657",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#070806"
        }
      });
      map.on("click", "base-fill", (event) => {
        const id = event.features?.[0]?.properties?.[idProp];
        if (id) onSelectRef.current?.(String(id));
      });
      map.on("click", "marks", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id) onSelectRef.current?.(String(id));
      });
      map.getCanvas().style.cursor = "crosshair";
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Map is created once; later effects push data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center, zoom, duration: 400 });
  }, [center, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const source = map.getSource("base") as maplibregl.GeoJSONSource | undefined;
      source?.setData(geojson || EMPTY);
      if (colorProp && map.getLayer("base-fill")) {
        map.setPaintProperty("base-fill", "fill-color", [
          "match",
          ["get", colorProp],
          "Yea", "#1f6b3a",
          "Nay", "#7a3030",
          "Split", "#6a5a28",
          "Present", "#3d4a38",
          "#142016"
        ]);
      } else if (map.getLayer("base-fill")) {
        map.setPaintProperty("base-fill", "fill-color", [
          "case",
          ["==", ["get", idProp], selectedId || ""],
          "#3a4a28",
          "#142016"
        ]);
      }
      const roads = map.getSource("roads") as maplibregl.RasterTileSource | undefined;
      const showMap = (imagery === "map" || imagery === "both") && !!mapTiles?.length;
      if (mapTiles?.length && roads) roads.setTiles(mapTiles);
      if (map.getLayer("roads")) map.setLayoutProperty("roads", "visibility", showMap ? "visible" : "none");
      const sat = map.getSource("sat") as maplibregl.RasterTileSource | undefined;
      const showSat = (imagery === "satellite" || imagery === "both") && !!rasterTiles?.length;
      if (rasterTiles?.length && sat) sat.setTiles(rasterTiles);
      if (map.getLayer("sat")) {
        map.setLayoutProperty("sat", "visibility", showSat ? "visible" : "none");
        map.setPaintProperty("sat", "raster-opacity", imagery === "both" ? 0.72 : 1);
      }
      if (map.getLayer("base-fill")) {
        map.setLayoutProperty("base-fill", "visibility", showSat && imagery === "satellite" ? "none" : "visible");
      }
      const marks = map.getSource("marks") as maplibregl.GeoJSONSource | undefined;
      marks?.setData({
        type: "FeatureCollection",
        features: markers.map((m) => ({
          type: "Feature",
          properties: { id: m.id, label: m.label },
          geometry: { type: "Point", coordinates: [m.lon, m.lat] }
        }))
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [geojson, colorProp, idProp, markers, rasterTiles, mapTiles, imagery, selectedId]);

  return <div ref={el} className="map" />;
}
