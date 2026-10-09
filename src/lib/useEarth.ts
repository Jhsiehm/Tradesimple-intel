import { useEffect, useState } from "react";
import { api } from "./api";
import type { Earth, EarthSettings } from "../types";

const KEY = "intel:earth";
const DEFAULTS: EarthSettings = { base: "sat", view: "2d", labels: true, lanes: true };

export function useEarth() {
  const [earth, setEarth] = useState<Earth | null>(null);
  const [settings, setSettings] = useState<EarthSettings>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return DEFAULTS;
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let cancel = false;
    api<{ layers: Earth["layers"] }>("/api/earth/imagery")
      .then((res) => { if (!cancel) setEarth((cur) => ({ ...cur, layers: res.layers })); })
      .catch(() => null);
    api<{ lanes: GeoJSON.FeatureCollection; chokepoints: GeoJSON.FeatureCollection; source: string; asOf: string }>("/api/earth/lanes")
      .then((res) => {
        if (cancel) return;
        setEarth((cur) => ({ ...(cur as Earth), lanes: res.lanes, chokepoints: res.chokepoints, lanesSource: res.source, lanesAsOf: res.asOf }));
      })
      .catch(() => null);
    return () => { cancel = true; };
  }, []);

  const update = (next: Partial<EarthSettings>) => setSettings((cur) => ({ ...cur, ...next }));
  const layer = settings.base === "live" ? null : earth?.layers?.[settings.base];
  const credit = [
    settings.base === "live" ? "NASA GIBS · GOES-East + GOES-West GeoColor, Himawari-9 IR, over daily VIIRS where no geostationary feed exists" : "",
    layer ? `${layer.source} · ${layer.asOf}` : "",
    settings.view === "3d" && earth?.layers?.terrain ? `Relief ${earth.layers.terrain.source}` : "",
    settings.view === "3d" && earth?.layers?.buildings ? `${earth.layers.buildings.source} · ${earth.layers.buildings.asOf}` : "",
    settings.lanes && earth?.lanesSource ? `Lanes ${earth.lanesAsOf}` : ""
  ].filter(Boolean).join("  ·  ");

  return { earth: earth?.layers ? earth : null, settings, update, credit };
}
