import { useEffect, useMemo, useState } from "react";
import { api, recent, when } from "../lib/api";
import type { Chamber, DrawerModel, ListItem, StatusLine } from "../types";
import { STATE_NAME_TO_POSTAL } from "./states";

type Bill = {
  id: string;
  title: string;
  type: string;
  number: string;
  updated: string;
  latest: string;
  stage: string;
};

type VoteRow = {
  id: string;
  date: string;
  result: string;
  question: string;
  bill: string;
  congress: number;
  session: number;
  roll: number;
};

type Position = {
  name: string;
  state: string;
  district: string;
  vote: string;
  geoid: string | null;
};

export function useCongress(chamber: Chamber, mode: "bills" | "votes", query: string, selectedId: string | null) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [states, setStates] = useState<GeoJSON.FeatureCollection | null>(null);
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [drawer, setDrawer] = useState<DrawerModel | null>(null);
  const [status, setStatus] = useState<StatusLine>({ source: "Congress.gov", asOf: "" });
  const [empty, setEmpty] = useState("Loading Congress.gov…");

  useEffect(() => {
    api<{ ok: boolean; missing?: string; items: Bill[]; source: string; asOf: string }>("/api/congress/bills")
      .then((res) => {
        if (res.missing) setEmpty(`Set ${res.missing} in .env.local to load bills.`);
        setBills(res.items || []);
        setStatus({ source: res.source || "Congress.gov", asOf: when(res.asOf) });
      })
      .catch((err: Error) => setEmpty(err.message));
    api<GeoJSON.FeatureCollection>("/geo/states.geojson").then(setStates).catch(() => null);
    api<GeoJSON.FeatureCollection>("/geo/cd119.geojson").then(setDistricts).catch(() => null);
  }, []);

  useEffect(() => {
    api<{ ok: boolean; missing?: string; items: VoteRow[]; source: string; asOf: string }>(
      `/api/congress/votes?chamber=${chamber}`
    )
      .then((res) => {
        if (res.missing) setEmpty(`Set ${res.missing} in .env.local to load votes.`);
        setVotes(res.items || []);
      })
      .catch((err: Error) => setEmpty(err.message));
  }, [chamber]);

  useEffect(() => {
    if (!selectedId || mode !== "bills") return;
    api<{ ok: boolean; bill?: { title: string; latest: string; stage: string; updated: string; ladder: { stages: { name: string; reached: boolean }[]; actions: { date: string; text: string }[] } }; missing?: string }>(
      `/api/congress/bills/${selectedId}`
    ).then((res) => {
      if (!res.bill) return;
      setDrawer({
        title: res.bill.title,
        meta: res.bill.stage,
        stages: res.bill.ladder.stages,
        rows: [
          { label: "Updated", value: when(res.bill.updated) },
          { label: "Latest", value: res.bill.latest || "—" }
        ],
        blocks: [{
          title: "Actions",
          lines: [...res.bill.ladder.actions]
            .sort((a, b) => recent(b.date) - recent(a.date))
            .map((a) => `${a.date || ""} ${a.text}`.trim())
        }]
      });
    }).catch(() => null);
  }, [selectedId, mode]);

  useEffect(() => {
    if (!selectedId || mode !== "votes") {
      setPositions([]);
      return;
    }
    const vote = votes.find((v) => v.id === selectedId);
    if (!vote) return;
    api<{
      ok: boolean;
      vote?: { question: string; result: string; date: string; bill: string; totals: Record<string, number>; positions: Position[] };
    }>(`/api/congress/votes/${chamber}/${vote.congress}/${vote.session}/${vote.roll}`)
      .then((res) => {
        if (!res.vote) return;
        setPositions(res.vote.positions);
        setDrawer({
          title: res.vote.question || `Roll ${vote.roll}`,
          meta: res.vote.result,
          rows: [
            { label: "Date", value: when(res.vote.date) },
            { label: "Bill", value: res.vote.bill || "—" },
            { label: "Yea", value: String(res.vote.totals.Yea || 0) },
            { label: "Nay", value: String(res.vote.totals.Nay || 0) }
          ]
        });
        setStatus({
          source: "Congress.gov roll call",
          asOf: when(res.vote.date),
          latency: "Official roll call, not a live floor feed."
        });
      })
      .catch((err: Error) => setEmpty(err.message));
  }, [selectedId, mode, votes, chamber]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (mode === "bills") {
      return [...bills]
        .sort((a, b) => recent(b.updated) - recent(a.updated))
        .filter((b) => `${b.title} ${b.type} ${b.number}`.toLowerCase().includes(q))
        .map((b) => ({
          id: b.id,
          title: `${b.type} ${b.number}`,
          meta: `${when(b.updated)} · ${b.stage} · ${b.title}`
        }));
    }
    return [...votes]
      .sort((a, b) => recent(b.date) - recent(a.date))
      .filter((v) => `${v.question} ${v.bill} ${v.result}`.toLowerCase().includes(q))
      .map((v) => ({
        id: v.id,
        title: v.question || `Roll ${v.roll}`,
        meta: `${v.result} · ${v.date?.slice(0, 10) || ""} ${v.bill}`.trim(),
        tone: v.result.toLowerCase().includes("pass") ? "yea" : v.result.toLowerCase().includes("fail") ? "nay" : ""
      }));
  }, [bills, votes, mode, query]);

  const geojson = useMemo(() => {
    if (chamber === "senate") {
      if (!states) return undefined;
      const byState = new Map<string, string>();
      for (const p of positions) {
        const prev = byState.get(p.state);
        if (!prev) byState.set(p.state, p.vote);
        else if (prev !== p.vote) byState.set(p.state, "Split");
      }
      return {
        ...states,
        features: states.features.map((f) => {
          const postal = STATE_NAME_TO_POSTAL[String(f.properties?.name || "")] || "";
          return {
            ...f,
            properties: { ...f.properties, id: postal, vote: byState.get(postal) || "" }
          };
        })
      };
    }
    if (!districts) return undefined;
    const byGeoid = new Map(positions.filter((p) => p.geoid).map((p) => [p.geoid, p.vote]));
    return {
      ...districts,
      features: districts.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          id: f.properties?.GEOID,
          vote: byGeoid.get(String(f.properties?.GEOID || "")) || ""
        }
      }))
    };
  }, [chamber, states, districts, positions]);

  return { items, empty, drawer, setDrawer, status, geojson };
}
