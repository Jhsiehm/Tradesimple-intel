import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { ArcKind, ArcLink, EventKind, Level } from "../../shared/intel.mjs";

export type IntelScope = { kind: "all"; id: "" } | { kind: "member"; id: string } | { kind: "symbol"; id: string };
export const ALL_SCOPE: IntelScope = { kind: "all", id: "" };

/** `member:P000197`, `symbol:LMT`, or anything else → all of Congress. */
export function scopeOf(value: string): IntelScope {
  const [kind, id = ""] = value.split(":");
  if (kind === "member" && /^[A-Z]\d{6}$/.test(id)) return { kind: "member", id };
  if (kind === "symbol" && /^[A-Za-z.\-]{1,8}$/.test(id)) return { kind: "symbol", id: id.toUpperCase() };
  return ALL_SCOPE;
}

export type IntelKind = { id: EventKind; label: string; source: string; asOf: string; latency: string; total: number; note?: string; error?: string };
export type IntelEvent = { d: number; k: EventKind; label: string; action?: string; link?: string };
export type IntelPlace = { lon: number; lat: number; label: string; kind: "member" | "hq" | "agency"; action: string };
export type Coverage = { total: number; placed: number; noFrom: number; noTo: number };

export type IntelData = {
  ok: boolean;
  error?: string;
  asOf: string;
  ms: number;
  partial?: boolean;
  scope: IntelScope & { label: string };
  from: string;
  to: string;
  len: number;
  days: Partial<Record<EventKind, number[]>>;
  kinds: IntelKind[];
  events: IntelEvent[];
  arcs: {
    places: IntelPlace[];
    actions: string[];
    links: ArcLink[];
    /** Unplaced links as [day, ARC_KINDS index], so the scrubber can count them per window. */
    misses?: [number, number][];
    coverage: Record<ArcKind, Coverage>;
    sources: Record<ArcKind, string>;
    hq: { source: string; asOf: string; placed: number; total: number };
  };
};

export type CaseStat = { label: string; value: string; note?: string };
export type CaseFile = {
  ok: boolean;
  error?: string;
  kind: "member" | "ticker" | "district";
  subject: string;
  headline: string;
  sub?: string;
  signal: { level: Level; label: string; why: string; rule: "hearing" | "activity" };
  stats: CaseStat[];
  asOf: string;
  sources: string[];
};

const scopeQuery = (scope: IntelScope) => (scope.kind === "member" ? `?member=${scope.id}` : scope.kind === "symbol" ? `?symbol=${encodeURIComponent(scope.id)}` : "");

/** Scrubber lanes and arc links for one scope; refetches once while USAspending is still filling the contract lane. */
export function useIntelScope(scope: IntelScope, enabled: boolean) {
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(false);
  const key = `${scope.kind}:${scope.id}`;

  useEffect(() => {
    if (!enabled) return;
    let cancel = false;
    let timer = 0;
    const load = (retry: boolean) => {
      setLoading(true);
      api<IntelData>(`/api/intel/scope${scopeQuery(scope)}`)
        .then((body) => {
          if (cancel) return;
          setData(body);
          if (body.partial && retry) timer = window.setTimeout(() => load(false), 20000);
        })
        .catch((err: Error) => { if (!cancel) setData({ ok: false, error: err.message } as IntelData); })
        .finally(() => { if (!cancel) setLoading(false); });
    };
    load(true);
    return () => { cancel = true; window.clearTimeout(timer); };
    // The key string stands in for the scope object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const current = data && (!data.ok || (data.scope.kind === scope.kind && data.scope.id === scope.id)) ? data : null;
  return { data: current, loading };
}

const caseMemo = new Map<string, { at: number; body: CaseFile }>();

/** `member:A000001`, `ticker:LMT`, or `district:TX-14` → case header for the dossier. */
export function useCaseFile(key: string | undefined) {
  const [body, setBody] = useState<CaseFile | null>(() => (key && caseMemo.get(key)?.body) || null);
  useEffect(() => {
    if (!key) { setBody(null); return; }
    const hit = caseMemo.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) { setBody(hit.body); return; }
    let cancel = false;
    setBody(null);
    const [kind, ...rest] = key.split(":");
    api<CaseFile>(`/api/intel/case/${kind}/${encodeURIComponent(rest.join(":"))}`)
      .then((res) => {
        if (cancel) return;
        if (res.ok && !res.stats.some((s) => /still answering/.test(s.note || ""))) caseMemo.set(key, { at: Date.now(), body: res });
        setBody(res);
      })
      .catch((err: Error) => { if (!cancel) setBody({ ok: false, error: err.message } as CaseFile); });
    return () => { cancel = true; };
  }, [key]);
  return body;
}
