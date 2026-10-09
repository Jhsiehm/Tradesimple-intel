import { dailyDomain, dailyTiles, liveDomain, liveTiles, useLive } from "../lib/useLive";
import { NEWS_WINDOW, useNewsGlobe } from "../news/newsGlobe";
import type { Headline } from "../news/useNews";
import type { EarthBase } from "../types";
import { span, stamp, type Domain, type TimeNote } from "./TimeBar";

type Args = {
  /** Map is on screen and no calendar covers it. */
  mapOn: boolean;
  base: EarthBase;
  newsGlobe: boolean;
  headlines: Headline[];
  clock: string;
  mapTime: number | null;
};

/** Time domain for the scrubber: live satellite frames, daily VIIRS passes, or the news-globe window. */
export function useMapClock({ mapOn, base, newsGlobe, headlines, clock, mapTime }: Args) {
  const live = useLive(mapOn && (base === "live" || base === "daily"));
  const minute = Math.floor(Date.parse(clock) / 600000) * 600000;
  const domain: Domain | null = !mapOn ? null
    : base === "live" && live ? liveDomain(live)
    : base === "daily" && live ? dailyDomain(live)
    : newsGlobe ? { start: minute - 48 * 3600000, end: minute, step: 600000 }
    : null;
  const cursor = mapTime ?? domain?.end ?? Date.now();
  const liveLayers = live && base === "live" ? liveTiles(live, cursor) : undefined;
  const dailyLayer = live ? dailyTiles(live, base === "daily" ? cursor : Date.now()) : undefined;
  const globe = useNewsGlobe(headlines, mapTime == null ? Date.parse(clock) : base === "daily" ? cursor + 86400000 : cursor);
  const title = base === "live" ? "IMAGERY TIME · LIVE SAT" : base === "daily" ? "IMAGERY TIME · DAILY PASS" : "HEADLINE TIME";
  const notes: TimeNote[] = [
    ...(liveLayers || []).map((l) => {
      const old = Date.now() - l.frame;
      return { label: l.name.split(" ")[0], text: `${stamp(l.frame).slice(6)} · ${span(old)} old`, tone: old > 2 * 3600000 ? "stale" as const : "ok" as const };
    }),
    ...(base === "live" && dailyLayer ? [{ label: "VIIRS", text: `${dailyLayer.day} under Europe, Africa, Mideast, India` }] : []),
    ...(base === "daily" && dailyLayer ? [{ label: "VIIRS NOAA-20", text: `${dailyLayer.day} · one polar pass per day` }] : []),
    ...(newsGlobe ? [{ label: "NEWS", text: `${globe.count} tagged headlines at ${globe.places} places · ${NEWS_WINDOW / 3600000}h window` }] : [])
  ];
  return { domain, liveLayers, dailyLayer, globe, title, notes };
}
