import { useEffect, useState } from "react";
import { api } from "./api";
import type { LiveImagery, LiveLayer } from "../types";

const POLL = 5 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function useLive(active: boolean) {
  const [live, setLive] = useState<LiveImagery | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancel = false;
    const load = () => api<LiveImagery>("/api/earth/live").then((res) => { if (!cancel) setLive(res); }).catch(() => null);
    void load();
    const timer = window.setInterval(load, POLL);
    return () => { cancel = true; window.clearInterval(timer); };
  }, [active]);
  return live;
}

export function frameAt(layer: LiveLayer, t: number) {
  let best = layer.ranges[0]?.start ?? t;
  for (const r of layer.ranges) {
    if (t < r.start) break;
    best = Math.min(r.end, r.start + Math.floor((t - r.start) / r.step) * r.step);
  }
  return best;
}

export function liveDomain(live: LiveImagery) {
  const starts = live.layers.map((l) => l.ranges[0].start);
  const ends = live.layers.map((l) => l.ranges[l.ranges.length - 1].end);
  return { start: Math.max(...starts), end: Math.max(...ends), step: 10 * 60 * 1000 };
}

export function dailyDomain(live: LiveImagery) {
  const end = Date.parse(`${live.daily.complete}T00:00:00Z`);
  return { start: end - 30 * DAY, end, step: DAY };
}

export function liveTiles(live: LiveImagery, t: number) {
  return live.layers.map((layer) => {
    const frame = frameAt(layer, t);
    const stamp = new Date(frame).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { key: layer.key, name: layer.name, frame, maxzoom: layer.maxzoom, tiles: [layer.template.replace("{time}", stamp)] };
  });
}

export function dailyTiles(live: LiveImagery, t: number) {
  const { start, end } = dailyDomain(live);
  const day = new Date(Math.max(start, Math.min(end, t))).toISOString().slice(0, 10);
  return { day, tiles: [live.daily.template.replace("{time}", day)] };
}
