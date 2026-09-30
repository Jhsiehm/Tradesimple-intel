import { useEffect, useMemo, useState } from "react";
import { api, when } from "../lib/api";
import type { DrawerModel, ListItem, NewsDesk, StatusLine } from "../types";

export type Headline = {
  id: string;
  source: string;
  feed: string;
  desk: "world" | "markets" | "x";
  title: string;
  link: string;
  post?: string;
  via?: string;
  profile?: string;
  published: string;
  stamped?: string;
  summary: string;
  symbols: string[];
  region?: string;
  geo?: { place: string; lon: number; lat: number; region: string; basis: string } | null;
};

export type FeedHealth = { id: string; name: string; desk: string; region?: string; count: number; ms: number; ok: boolean };

export type Wire = {
  ok: boolean;
  missing?: string;
  detail?: string;
  error?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  errors?: string[];
  feeds?: FeedHealth[];
  items: Headline[];
  mode?: "social";
  tokenMissing?: string;
  trends?: { name: string; url: string; rank: number; fresh: boolean; symbol: string }[];
  trendsAsOf?: string | null;
};

const POLL = 5 * 60 * 1000;
const EDITION_DEMOTE = 12 * 60 * 60 * 1000;

export function useNews(desk: NewsDesk, query: string, selectedId: string | null, active: boolean, region = "all") {
  const [wire, setWire] = useState<Wire | null>(null);
  const [x, setX] = useState<Wire | null>(null);
  const [empty, setEmpty] = useState("Loading wires…");

  useEffect(() => {
    if (!active) return;
    let cancel = false;
    let retry = 0;
    const load = () => {
      window.clearTimeout(retry);
      api<Wire>("/api/news")
        .then((res) => {
          if (cancel) return;
          setWire(res);
          setEmpty(res.items?.length ? "" : res.errors?.[0] || "No headlines returned.");
        })
        .catch((err: Error) => {
          if (cancel) return;
          setEmpty(`${err.message} · retrying in 15s`);
          retry = window.setTimeout(load, 15000);
        });
      api<Wire>("/api/news/x")
        .then((res) => { if (!cancel) setX(res); })
        .catch(() => null);
    };
    load();
    const timer = window.setInterval(load, POLL);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      window.clearTimeout(retry);
    };
  }, [active]);

  const all = useMemo(() => {
    const merged = [...(wire?.items || []), ...(x?.items || [])];
    const key = (h: Headline) => (Date.parse(h.published) || 0) - (h.stamped ? EDITION_DEMOTE : 0);
    return merged.sort((a, b) => key(b) - key(a));
  }, [wire, x]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((h) => desk === "all" || h.desk === desk)
      .filter((h) => region === "all" || h.geo?.region === region)
      .filter((h) => !q || `${h.title} ${h.source} ${h.symbols.join(" ")}`.toLowerCase().includes(q));
  }, [all, desk, query, region]);

  const items: ListItem[] = useMemo(() => filtered.slice(0, 250).map((h) => ({
    id: h.id,
    title: h.title,
    meta: `${h.source}${h.via ? ` · ${h.via}` : ""} · ${h.stamped ? `${h.stamped.slice(5, 10)} edition` : age(h.published)}${h.geo ? ` · ${h.geo.place}` : ""}${h.symbols.length ? ` · ${h.symbols.join(" ")}` : ""}`,
    tone: h.symbols.length ? "close" : ""
  })), [filtered]);

  const selected = useMemo(() => all.find((h) => h.id === selectedId) || null, [all, selectedId]);

  const drawer: DrawerModel | null = useMemo(() => {
    if (!selected) return null;
    return {
      title: selected.title,
      meta: selected.summary || undefined,
      rows: [
        { label: "Source", value: selected.via ? `${selected.source} · posted on ${selected.via}` : selected.source },
        { label: "Desk", value: selected.desk },
        ...(selected.geo ? [{ label: "Place", value: `${selected.geo.place} · ${selected.geo.basis}` }] : []),
        { label: "Published", value: when(selected.published) },
        { label: "Age", value: selected.stamped ? `Feed dates it ${when(selected.stamped)} (print edition); first seen ${age(selected.published)}` : age(selected.published) }
      ],
      links: [
        ...(selected.link ? [{ label: "Article", value: hostOf(selected.link), href: selected.link }] : []),
        ...(selected.post && selected.post !== selected.link ? [{ label: "Post", value: hostOf(selected.post), href: selected.post }] : []),
        ...(selected.profile ? [{ label: "X profile", value: selected.source, href: selected.profile }] : []),
        ...selected.symbols.flatMap((symbol) => [
          { label: "Chart", value: symbol, action: `ticker:${symbol}` },
          { label: "Positions", value: `${symbol} · every filer`, action: `pos:${symbol}` }
        ])
      ],
      source: selected.via ? `${selected.via} · ${selected.feed === "truth" ? "trumpstruth.org archive" : "public.api.bsky.app"}` : undefined
    };
  }, [selected]);

  const status: StatusLine = desk === "x"
    ? { source: x?.source || "X API v2", asOf: when(x?.asOf), latency: x?.missing ? `Set ${x.missing} in .env.local` : x?.latency }
    : { source: wire?.source || "RSS wires", asOf: when(wire?.asOf), latency: wire?.latency };

  return { items, empty: desk === "x" && x?.missing ? `Set ${x.missing} in .env.local. ${x.detail || ""}` : empty, drawer, status, wire, x, all: filtered };
}

export function age(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
