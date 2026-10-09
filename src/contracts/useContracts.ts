import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { usd, when } from "../lib/format";
import type { DrawerModel, ListItem, StatusLine } from "../types";

export type ContractScope = { kind: "all" | "symbol" | "place" | "member"; value: string };
export type ContractSort = "recent" | "largest";

export type Award = {
  id: string; award: string; recipient: string; uei: string; symbol: string | null; date: string; amount: number; mod: string;
  description: string; agency: string; subAgency: string; naics: string; place: string; district: string; link: string;
};
type Feed = {
  ok: boolean; error?: string; note?: string; source?: string; asOf?: string; latency?: string;
  window?: { days: number; from: string; to: string };
  scope?: { symbol?: string; parents?: string[]; place?: string; member?: { bioguide: string; name: string; chamber: string; party: string } };
  items: Award[];
};
export type Contractor = {
  symbol: string; name: string; sector: string; industry: string; fy: number | null; obligations: number;
  revenue: number | null; revenueFy: number | null; share: number | null; byYear: { fy: number; amount: number }[]; parents: number;
};
export type Board = {
  ok: boolean; building?: boolean; error?: string; note?: string; source?: string; asOf?: string; latency?: string; progress?: { done: number; total: number; failed?: number };
  index?: { name: string; joined: number; constituents: number; fy: number | null; obligations: number };
  sectors?: { sector: string; obligations: number; names: number }[];
  items: Contractor[];
};
export type Dod = { ok: boolean; error?: string; note?: string; source?: string; asOf?: string; latency?: string; items: { id: string; title: string; link: string; published: string }[] };

type Seat = { bioguide: string; name: string; chamber: string; state: string; district: string; party: string };

const AGENCY: Record<string, string> = {
  "Department of Defense": "DoD", "National Aeronautics and Space Administration": "NASA", "Department of Health and Human Services": "HHS",
  "Department of Energy": "DOE", "Department of Homeland Security": "DHS", "Department of Veterans Affairs": "VA", "General Services Administration": "GSA",
  "Department of State": "State", "Department of Transportation": "DOT", "Department of the Treasury": "Treasury", "Department of Justice": "DOJ",
  "Department of the Interior": "Interior", "Department of Agriculture": "USDA", "Department of Commerce": "Commerce"
};
export const agencyShort = (name: string) => AGENCY[name] || name;

export function scopeLabel(scope: ContractScope, feed?: Feed | null) {
  if (scope.kind === "symbol") return `${scope.value} · parent recipients`;
  if (scope.kind === "place") return `Place of performance ${scope.value}`;
  if (scope.kind === "member") return feed?.scope?.member ? `${feed.scope.member.name} · ${feed.scope.place || ""}` : `Member ${scope.value}`;
  return "All agencies";
}

export function useContracts(scope: ContractScope, sort: ContractSort, days: number, query: string, selectedId: string | null, active: boolean, roster: Seat[]) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [dod, setDod] = useState<Dod | null>(null);
  const [empty, setEmpty] = useState("Loading contract actions…");

  useEffect(() => {
    if (!active) return;
    let live = true;
    setEmpty("Loading contract actions from USAspending… (can take up to a minute)");
    const q = new URLSearchParams({ sort, days: String(days) });
    if (scope.kind !== "all" && scope.value) q.set(scope.kind === "place" ? "place" : scope.kind, scope.value);
    api<Feed>(`/api/contracts/feed?${q}`)
      .then((res) => {
        if (!live) return;
        setFeed(res);
        setEmpty(res.ok ? res.note || "No contract actions in this window." : res.error || "Contract feed failed.");
      })
      .catch((err: Error) => live && setEmpty(`Contract feed failed: ${err.message}`));
    return () => { live = false; };
  }, [active, scope.kind, scope.value, sort, days]);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer = 0;
    const load = () => api<Board>("/api/contracts/board").then((res) => {
      if (!live) return;
      setBoard(res);
      if (res.building) timer = window.setTimeout(load, 3000);
      else if (res.error) timer = window.setTimeout(load, 30000);
    }).catch((err: Error) => {
      if (!live) return;
      setBoard((prev) => ({ ...(prev || { items: [] }), ok: false, building: false, error: `Contractor board request failed: ${err.message}. Retrying in 10 s.` }));
      timer = window.setTimeout(load, 10000);
    });
    load();
    api<Dod>("/api/contracts/dod")
      .then((res) => live && setDod(res))
      .catch((err: Error) => live && setDod({ ok: false, error: `War.gov list request failed: ${err.message}`, items: [] }));
    return () => { live = false; window.clearTimeout(timer); };
  }, [active]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (feed?.items || [])
      .filter((a) => !q || `${a.recipient} ${a.symbol || ""} ${a.agency} ${a.subAgency} ${a.description} ${a.district}`.toLowerCase().includes(q))
      .map((a) => ({
        id: a.id,
        title: `${usd(a.amount)} · ${a.recipient}`,
        meta: `${a.date} · ${agencyShort(a.agency)}${a.subAgency && a.subAgency !== a.agency ? ` / ${a.subAgency}` : ""} · ${a.place || "—"}`,
        tag: a.symbol || undefined,
        tone: a.amount < 0 ? "down" : ""
      }));
  }, [feed, query]);

  const selected = feed?.items.find((a) => a.id === selectedId) || null;
  const drawer: DrawerModel | null = selected ? awardModel(selected, roster) : null;

  const status: StatusLine = {
    source: feed?.source || "USAspending.gov",
    asOf: feed?.asOf ? when(feed.asOf) : "—",
    latency: feed?.latency || "DoD actions reach USAspending about 90 days after award."
  };

  return { items, empty, drawer, status, feed, board, dod, selected };
}

function awardModel(a: Award, roster: Seat[]): DrawerModel {
  const [state, num] = a.district.split("-");
  const rep = num ? roster.find((m) => m.chamber === "house" && m.state === state && String(Number(m.district) || 0) === String(Number(num))) : null;
  const senators = roster.filter((m) => m.chamber === "senate" && m.state === state);
  return {
    title: `${usd(a.amount)} · ${a.recipient}`,
    meta: `${a.date} · ${a.agency}${a.mod && a.mod !== "0" ? ` · modification ${a.mod}` : " · new award or base action"}`,
    rows: [
      { label: "Award", value: a.award },
      { label: "Recipient", value: `${a.recipient}${a.uei ? ` · UEI ${a.uei}` : ""}` },
      { label: "Ticker", value: a.symbol ? `${a.symbol} (USAspending parent joined in data/tickers.json)` : "Not joined to a listed company" },
      { label: "Action", value: `${usd(a.amount)} on ${a.date}` },
      { label: "Agency", value: `${a.agency}${a.subAgency && a.subAgency !== a.agency ? ` / ${a.subAgency}` : ""}` },
      { label: "Performed", value: a.place || "—" },
      { label: "Industry", value: a.naics || "—" }
    ],
    links: [
      ...(a.link ? [{ label: "Award", value: "USAspending ↗", href: a.link }] : []),
      ...(a.symbol ? [
        { label: "Company", value: `${a.symbol} dossier`, action: `ticker:${a.symbol}` },
        { label: "Contracts", value: `All ${a.symbol} actions`, action: `contracts:symbol:${a.symbol}` }
      ] : []),
      ...(a.district ? [{ label: "District", value: `All actions in ${a.district}`, action: `contracts:place:${a.district}` }] : []),
      ...(rep ? [{ label: "Representative", value: `${rep.name} · ${rep.party}`, action: `member:${rep.bioguide}` }] : []),
      ...senators.map((s) => ({ label: "Senator", value: `${s.name} · ${s.party}`, action: `member:${s.bioguide}` }))
    ],
    blocks: a.description ? [{ title: "Description", lines: [a.description] }] : [],
    source: "USAspending.gov"
  };
}
