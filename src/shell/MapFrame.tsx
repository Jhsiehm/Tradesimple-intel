import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Earth, EarthSettings, MapFlash, Marker } from "../types";
import { VOTE_FILL } from "../congress/voteMap";

const MAP_FILL: Record<string, string> = { ...VOTE_FILL, Focus: "#e2b657", Site: "#3f7287", HQ1: "#2c4f60", HQ2: "#3f7287", HQ3: "#5f9bb0", State: "#26333f" };

type Props = {
  geojson?: GeoJSON.FeatureCollection;
  idProp?: string;
  colorProp?: string;
  /** Choropleth fill opacity; defaults by base. */
  fill?: number;
  markers?: Marker[];
  earth?: Earth | null;
  settings: EarthSettings;
  center: [number, number];
  zoom: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  live?: { key: string; tiles: string[]; maxzoom: number }[];
  dailyTiles?: string[];
  flash?: MapFlash | null;
  /** Shipping lanes only belong on ocean views; district and vote maps hide them. */
  lanes?: boolean;
  arcs?: { lines: GeoJSON.FeatureCollection; ends: GeoJSON.FeatureCollection } | null;
  onArc?: (action: string) => void;
  /** Dark ground, pitched camera, block buildings. No satellite. */
  massing?: boolean;
};

type Sky = Parameters<maplibregl.Map["setSky"]>[0];

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const BASES = ["dark", "sat", "daily", "night"] as const;
const LIVE_ORDER = ["himawari", "goesWest", "goesEast"];
/** Maps whose base style and core layers are in place. */
const STYLED = new WeakSet<maplibregl.Map>();
const SKY = {
  "sky-color": "#04070a",
  "horizon-color": "#18232d",
  "fog-color": "#090f14",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.4,
  "fog-ground-blend": 0.2,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0]
} as unknown as Sky;

function trackIcon() {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return { width: size, height: size, data: new Uint8Array(size * size * 4) };
  g.clearRect(0, 0, size, size);
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(16, 3);
  g.lineTo(26, 28);
  g.lineTo(16, 22);
  g.lineTo(6, 28);
  g.closePath();
  g.fill();
  return { width: size, height: size, data: g.getImageData(0, 0, size, size).data };
}

function webgl2Ok() {
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
}

export function MapFrame({
  geojson,
  idProp = "id",
  colorProp,
  fill,
  markers = [],
  earth,
  settings,
  center,
  zoom,
  selectedId,
  onSelect,
  live,
  dailyTiles,
  flash,
  lanes = true,
  arcs,
  onArc,
  massing = false
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const onArcRef = useRef(onArc);
  const idPropRef = useRef(idProp);
  idPropRef.current = idProp;
  const [failed, setFailed] = useState(() => typeof document !== "undefined" && !webgl2Ok());
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;
  onArcRef.current = onArc;
  /** `ready` can outlive its map across a hot remount; only a map whose own style finished loading takes layers. */
  const loadedMap = () => (ready && mapRef.current && STYLED.has(mapRef.current) ? mapRef.current : null);

  useEffect(() => {
    if (failed || !el.current || mapRef.current) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el.current,
        center,
        zoom,
        maxPitch: 75,
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {},
          layers: [{ id: "bg", type: "background", paint: { "background-color": "#06080b" } }],
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf"
        }
      });
    } catch {
      setFailed(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "nautical" }), "bottom-right");
    map.on("error", (event) => {
      const msg = String(event.error?.message || event.error || "");
      if (/webgl/i.test(msg) || /GPUInitialization/i.test(msg)) setFailed(true);
    });
    map.on("load", () => {
      map.addSource("base", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "base-fill", type: "fill", source: "base", paint: { "fill-color": "#12171c", "fill-opacity": 0.92 } });
      map.addLayer({ id: "base-line", type: "line", source: "base", paint: { "line-color": "#9aa7b2", "line-width": 1 } });
      map.addLayer({ id: "base-focus", type: "line", source: "base", filter: ["==", ["get", "vote"], "Focus"], paint: { "line-color": "#f3e2ae", "line-width": 2.2 } });
      map.addLayer({ id: "base-pick", type: "line", source: "base", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#3df0ff", "line-width": 1.5 } });
      map.addSource("arcs", { type: "geojson", data: EMPTY });
      map.addSource("arc-ends", { type: "geojson", data: EMPTY });
      map.addLayer({ id: "arcs-glow", type: "line", source: "arcs", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["*", ["get", "w"], 4], "line-opacity": 0.08, "line-blur": 3 } });
      map.addLayer({ id: "arcs", type: "line", source: "arcs", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["get", "w"], "line-opacity": 0.72 } });
      map.addLayer({
        id: "arc-ends",
        type: "circle",
        source: "arc-ends",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 2.5, 50, 6],
          "circle-color": "#06080b",
          "circle-stroke-width": 1.2,
          "circle-stroke-color": ["match", ["get", "kind"], "member", "#4aa8ff", "agency", "#d9b45a", "#e4e7e6"]
        }
      });
      const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "arc-pop", maxWidth: "340px", offset: 8 });
      const showTip = (event: maplibregl.MapLayerMouseEvent, text: string) => {
        map.getCanvas().style.cursor = "pointer";
        tip.setLngLat(event.lngLat).setText(text).addTo(map);
      };
      map.on("mousemove", "arcs", (event) => showTip(event, String(event.features?.[0]?.properties?.tip || "")));
      map.on("mousemove", "arc-ends", (event) => {
        const p = event.features?.[0]?.properties;
        if (p) showTip(event, `${p.label}\n${p.n} linked record${Number(p.n) === 1 ? "" : "s"} in this window`);
      });
      ["arcs", "arc-ends"].forEach((id) => {
        map.on("mouseleave", id, () => { tip.remove(); map.getCanvas().style.cursor = "crosshair"; });
        map.on("click", id, (event) => {
          const action = event.features?.[0]?.properties?.action;
          if (action) onArcRef.current?.(String(action));
        });
      });
      map.addSource("marks", { type: "geojson", data: EMPTY });
      map.addImage("track", trackIcon(), { sdf: true });
      map.addLayer({
        id: "marks",
        type: "circle",
        source: "marks",
        filter: ["!", ["has", "bearing"]],
        paint: {
          "circle-radius": ["coalesce", ["get", "size"], 5],
          "circle-color": ["coalesce", ["get", "color"], "#e2b657"],
          "circle-opacity": 0.85,
          "circle-stroke-width": ["case", ["get", "hot"], 2, 1],
          "circle-stroke-color": ["case", ["get", "hot"], "#f3e2ae", "#06080b"]
        }
      });
      map.addLayer({
        id: "marks-label",
        type: "symbol",
        source: "marks",
        filter: ["==", ["get", "hot"], true],
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-max-width": 16,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-optional": true
        },
        paint: { "text-color": "#f3e2ae", "text-halo-color": "#06080b", "text-halo-width": 1.4 }
      });
      map.addLayer({
        id: "marks-track",
        type: "symbol",
        source: "marks",
        filter: ["has", "bearing"],
        layout: {
          "icon-image": "track",
          "icon-size": ["case", ["get", "hot"], 0.72, 0.5],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        },
        paint: { "icon-color": ["coalesce", ["get", "color"], "#3df0ff"], "icon-halo-color": "#06080b", "icon-halo-width": 1 }
      });
      ["marks", "marks-track"].forEach((id) => {
        map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", id, () => { map.getCanvas().style.cursor = "crosshair"; });
        map.on("click", id, (event) => {
          const idHit = event.features?.[0]?.properties?.id;
          if (idHit) onSelectRef.current?.(String(idHit));
        });
      });
      map.on("click", "base-fill", (event) => {
        if (map.queryRenderedFeatures(event.point, { layers: ["arcs", "arc-ends"] }).length) return;
        const id = event.features?.[0]?.properties?.[idPropRef.current];
        if (id) onSelectRef.current?.(String(id));
      });
      map.getCanvas().style.cursor = "crosshair";
      STYLED.add(map);
      setReady(true);
    });
    mapRef.current = map;
    const fit = new ResizeObserver(() => map.resize());
    fit.observe(el.current);
    return () => {
      fit.disconnect();
      map.remove();
      mapRef.current = null;
      pushedGeojson.current = null;
      setReady(false);
    };
    // Map is created once; later effects push data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  const [lon, lat] = center;
  const markersKey = markers.map((m) => `${m.id}:${m.lon},${m.lat}:${m.bearing ?? ""}:${m.size}:${m.color}:${m.hot}:${m.label}`).join("|");
  const pushedGeojson = useRef<GeoJSON.FeatureCollection | undefined | null>(null);

  const camera = useRef<{ view: string; massing: boolean; lon: number; lat: number; zoom: number } | null>(null);

  useEffect(() => {
    const map = loadedMap();
    if (!map || !earth) return;
    addEarth(map, earth);
    const imagery = !massing && settings.base !== "dark";
    BASES.forEach((base) => map.setLayoutProperty(`img-${base}`, "visibility", !massing && (settings.base === base || (base === "daily" && settings.base === "live")) ? "visible" : "none"));
    LIVE_ORDER.forEach((key) => { if (map.getLayer(`live-${key}`)) map.setLayoutProperty(`live-${key}`, "visibility", !massing && settings.base === "live" ? "visible" : "none"); });
    map.setLayoutProperty("labels", "visibility", !massing && settings.labels && imagery ? "visible" : "none");
    map.setLayoutProperty("roads", "visibility", !massing && settings.labels && settings.base === "sat" ? "visible" : "none");
    map.setLayoutProperty("dark-labels", "visibility", !massing && settings.labels && !imagery && settings.base === "dark" ? "visible" : "none");
    map.setPaintProperty("base-fill", "fill-opacity", massing ? 0 : fill ?? (colorProp ? (imagery ? 0.42 : 0.8) : 1));
    map.setPaintProperty("bg", "background-color", massing ? "#101418" : "#06080b");
    map.setPaintProperty("base-line", "line-color", "#9aa7b2");
    map.setPaintProperty("base-line", "line-width", 1);
    map.setPaintProperty("base-line", "line-opacity", 1);
    ["lanes-minor", "lanes-middle", "lanes-major", "choke-dot", "choke-label"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", !massing && settings.lanes && lanes ? "visible" : "none");
    });
    if (map.getLayer("hillshade") && massing) map.setLayoutProperty("hillshade", "visibility", "none");
  }, [ready, earth, settings.base, settings.labels, settings.lanes, live?.length, lanes, colorProp, fill, massing]);

  useEffect(() => {
    const map = loadedMap();
    if (!map || !earth) return;
    addEarth(map, earth);
    if (earth.lanes) (map.getSource("lanes") as maplibregl.GeoJSONSource).setData(earth.lanes);
    if (earth.chokepoints) (map.getSource("chokepoints") as maplibregl.GeoJSONSource).setData(earth.chokepoints);
  }, [ready, earth]);

  const liveKey = (live || []).map((l) => l.tiles[0]).join("|");
  useEffect(() => {
    const map = loadedMap();
    if (!map || !earth) return;
    addEarth(map, earth);
    const daily = map.getSource("img-daily") as maplibregl.RasterTileSource | undefined;
    if (daily && dailyTiles?.length && (daily as unknown as { tiles?: string[] }).tiles?.[0] !== dailyTiles[0]) daily.setTiles(dailyTiles);
    const byKey = new Map((live || []).map((l) => [l.key, l]));
    LIVE_ORDER.forEach((key) => {
      const layer = byKey.get(key);
      const id = `live-${key}`;
      if (!layer) return;
      const source = map.getSource(id) as maplibregl.RasterTileSource | undefined;
      if (source) {
        if ((source as unknown as { tiles?: string[] }).tiles?.[0] !== layer.tiles[0]) source.setTiles(layer.tiles);
        return;
      }
      map.addSource(id, { type: "raster", tiles: layer.tiles, tileSize: 256, maxzoom: layer.maxzoom, attribution: "NASA EOSDIS GIBS · NOAA · JMA" });
      map.addLayer({ id, type: "raster", source: id, layout: { visibility: settings.base === "live" ? "visible" : "none" }, paint: { "raster-fade-duration": 0 } }, "hillshade");
    });
    // Keys stand in for tile arrays rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, earth, liveKey, dailyTiles?.[0]]);

  useEffect(() => {
    const map = loadedMap();
    if (!map || !flash) return;
    const box = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = flash.title;
    const meta = document.createElement("span");
    meta.textContent = flash.meta;
    box.append(meta, title);
    box.addEventListener("click", () => onSelectRef.current?.(flash.id));
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "flash-pop", maxWidth: "260px", offset: 10 })
      .setLngLat([flash.lon, flash.lat])
      .setDOMContent(box)
      .addTo(map);
    const timer = window.setTimeout(() => popup.remove(), 9000);
    return () => { window.clearTimeout(timer); popup.remove(); };
  }, [ready, flash]);

  useEffect(() => {
    const map = loadedMap();
    if (!map || !earth) return;
    addEarth(map, earth);
    const relief = massing || settings.view === "3d";
    // MapLibre cannot fog terrain on the globe projection, so relief runs on mercator.
    map.setProjection({ type: !massing && settings.view === "globe" ? "globe" : "mercator" });
    if (!massing && settings.view === "2d") map.setSky({ "atmosphere-blend": 0 } as unknown as Sky);
    else map.setSky(SKY);
    map.setTerrain(!massing && relief ? { source: "dem", exaggeration: 1.6 } : null);
    map.setLayoutProperty("hillshade", "visibility", !massing && relief ? "visible" : "none");
    if (map.getLayer("buildings-3d")) map.setLayoutProperty("buildings-3d", "visibility", relief ? "visible" : "none");
    ["city-water", "city-park", "city-roads"].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", massing ? "visible" : "none");
    });
  }, [ready, earth, settings.view, massing]);

  /** One camera move per change: a new target flies there; a view toggle only pitches; leaving the globe restores the target. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const prev = camera.current;
    camera.current = { view: settings.view, massing, lon, lat, zoom };
    const relief = massing || settings.view === "3d";
    const globe = !massing && settings.view === "globe";
    const target = !prev || prev.massing !== massing || prev.lon !== lon || prev.lat !== lat || prev.zoom !== zoom || (prev.view === "globe" && !globe);
    map.easeTo({
      ...(target ? { center: [lon, lat] as [number, number] } : {}),
      pitch: massing ? 46 : relief ? 64 : 0,
      bearing: massing ? -18 : relief ? map.getBearing() : 0,
      zoom: target ? zoom : globe ? (map.getZoom() > 3 ? 2.2 : map.getZoom()) : Math.max(map.getZoom(), zoom),
      duration: 700
    });
  }, [ready, settings.view, massing, lon, lat, zoom]);

  useEffect(() => {
    const map = loadedMap();
    if (!map) return;
    const source = map.getSource("base") as maplibregl.GeoJSONSource | undefined;
    if (source && pushedGeojson.current !== geojson) {
      source.setData(geojson || EMPTY);
      pushedGeojson.current = geojson;
    }
    if (colorProp) {
      map.setPaintProperty("base-fill", "fill-color", [
        "match",
        ["get", colorProp],
        ...Object.entries(MAP_FILL).flat(),
        "#12171c"
      ] as unknown as maplibregl.ExpressionSpecification);
    } else {
      map.setPaintProperty("base-fill", "fill-color", "#12171c");
    }
    if (map.getLayer("base-pick")) map.setFilter("base-pick", ["==", ["get", idProp], selectedId || ""]);
    (map.getSource("marks") as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: markers.map((m) => ({
        type: "Feature",
        properties: { id: m.id, label: m.label, size: m.size ?? 5, color: m.color ?? "#e2b657", hot: !!m.hot, ...(m.bearing == null ? {} : { bearing: m.bearing }) },
        geometry: { type: "Point", coordinates: [m.lon, m.lat] }
      }))
    });
    // Keys stand in for array props that the parent rebuilds on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, geojson, colorProp, idProp, markersKey, selectedId]);

  useEffect(() => {
    const map = loadedMap();
    if (!map) return;
    (map.getSource("arcs") as maplibregl.GeoJSONSource | undefined)?.setData(arcs?.lines || EMPTY);
    (map.getSource("arc-ends") as maplibregl.GeoJSONSource | undefined)?.setData(arcs?.ends || EMPTY);
  }, [ready, arcs]);

  if (failed) {
    return (
      <div className="map map-fallback" role="status">
        <p>
          <strong>Map needs WebGL2</strong>
          <span>Open in Chrome/Safari, or switch to Floor for chamber seats.</span>
        </p>
      </div>
    );
  }

  return <div ref={el} className="map" />;
}

function addBuildings(map: maplibregl.Map, layer: Earth["layers"]["buildings"]) {
  if (map.getSource("osm-buildings") || !map.getLayer("marks")) return;
  try {
    map.addSource("osm-buildings", {
      type: "vector",
      url: layer?.tilejson || "https://tiles.openfreemap.org/planet",
      attribution: layer?.attribution || "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors"
    });
    map.addLayer({
      id: "buildings-3d",
      type: "fill-extrusion",
      source: "osm-buildings",
      "source-layer": "building",
      minzoom: 13,
      filter: ["!=", ["get", "hide_3d"], true],
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8],
          0, "#8b98a3",
          28, "#c5ced6",
          100, "#e7eef3"
        ],
        "fill-extrusion-height": ["case", [">", ["coalesce", ["get", "render_height"], 0], 0], ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": false
      }
    }, "marks");
    const under = "buildings-3d";
    map.addLayer({
      id: "city-water",
      type: "fill",
      source: "osm-buildings",
      "source-layer": "water",
      layout: { visibility: "none" },
      paint: { "fill-color": "#10181c" }
    }, under);
    map.addLayer({
      id: "city-park",
      type: "fill",
      source: "osm-buildings",
      "source-layer": "landuse",
      filter: ["in", ["get", "class"], ["literal", ["park", "grass", "cemetery"]]],
      layout: { visibility: "none" },
      paint: { "fill-color": "#161c18" }
    }, under);
    map.addLayer({
      id: "city-roads",
      type: "line",
      source: "osm-buildings",
      "source-layer": "transportation",
      minzoom: 12,
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#3c4854",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.3, 14, 0.8, 16, 2.2]
      }
    }, under);
  } catch {
    /* Skyline tiles are optional. The map still pitches. */
  }
}

function addEarth(map: maplibregl.Map, earth: Earth) {
  const { layers } = earth;
  addBuildings(map, layers.buildings);
  if (map.getSource("img-dark")) return;
  const raster = (id: string, key: Exclude<keyof Earth["layers"], "buildings">, before: string, paint: Record<string, number> = {}) => {
    const layer = layers[key];
    map.addSource(id, { type: "raster", tiles: layer.tiles, tileSize: 256, maxzoom: layer.maxzoom, attribution: layer.attribution });
    map.addLayer({ id, type: "raster", source: id, layout: { visibility: "none" }, paint }, before);
  };
  BASES.forEach((base) => raster(`img-${base}`, base, "base-fill", base === "night" ? { "raster-saturation": -0.2 } : {}));
  map.addSource("dem", { type: "raster-dem", tiles: layers.terrain.tiles, tileSize: 256, maxzoom: layers.terrain.maxzoom, encoding: "terrarium", attribution: layers.terrain.attribution });
  map.addSource("dem-shade", { type: "raster-dem", tiles: layers.terrain.tiles, tileSize: 256, maxzoom: layers.terrain.maxzoom, encoding: "terrarium" });
  map.addLayer({
    id: "hillshade",
    type: "hillshade",
    source: "dem-shade",
    layout: { visibility: "none" },
    paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#000000", "hillshade-highlight-color": "#d8d0b0" }
  }, "base-fill");
  raster("roads", "roads", "marks", { "raster-opacity": 0.7 });
  raster("labels", "labels", "marks");
  raster("dark-labels", "darkLabels", "marks");

  map.addSource("lanes", { type: "geojson", data: earth.lanes || EMPTY });
  const width = (base: number) => ["interpolate", ["linear"], ["zoom"], 1, base, 6, base * 2.4] as maplibregl.ExpressionSpecification;
  map.addLayer({
    id: "lanes-minor",
    type: "line",
    source: "lanes",
    filter: ["==", ["get", "type"], "Minor"],
    paint: { "line-color": "#6fa0a8", "line-opacity": 0.55, "line-width": width(0.6), "line-dasharray": [2, 2] }
  }, "marks");
  map.addLayer({
    id: "lanes-middle",
    type: "line",
    source: "lanes",
    filter: ["==", ["get", "type"], "Middle"],
    paint: { "line-color": "#8fc3c9", "line-opacity": 0.7, "line-width": width(0.9) }
  }, "marks");
  map.addLayer({
    id: "lanes-major",
    type: "line",
    source: "lanes",
    filter: ["==", ["get", "type"], "Major"],
    paint: { "line-color": "#e2b657", "line-opacity": 0.9, "line-width": width(1.4) }
  }, "marks");
  map.addSource("chokepoints", { type: "geojson", data: earth.chokepoints || EMPTY });
  map.addLayer({
    id: "choke-dot",
    type: "circle",
    source: "chokepoints",
    paint: { "circle-radius": 4, "circle-color": "#06080b", "circle-stroke-color": "#e2b657", "circle-stroke-width": 1.5 }
  }, "marks");
  map.addLayer({
    id: "choke-label",
    type: "symbol",
    source: "chokepoints",
    minzoom: 1.5,
    layout: {
      "text-field": ["upcase", ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 10,
      "text-letter-spacing": 0.08,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true
    },
    paint: { "text-color": "#e8d49a", "text-halo-color": "#06080b", "text-halo-width": 1.4 }
  }, "marks");
  map.on("click", "choke-dot", (event) => {
    const point = event.features?.[0]?.geometry;
    if (point?.type === "Point") map.flyTo({ center: point.coordinates as [number, number], zoom: Math.max(map.getZoom(), 6.5), duration: 1200 });
  });
  map.on("mouseenter", "choke-dot", () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", "choke-dot", () => { map.getCanvas().style.cursor = "crosshair"; });
}
