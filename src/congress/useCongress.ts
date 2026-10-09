import { useEffect, useMemo, useState } from "react";
import { api, recent, when } from "../lib/api";
import type { Chamber, CongressMode, DrawerModel, ListItem, PartyFilter, StatusLine } from "../types";
import { houseVoteMap, senateVoteMap } from "./voteMap";
import { voteTitle } from "./voteTitle";

type Bill = {
  id: string;
  title: string;
  type: string;
  number: string;
  updated: string;
  latest: string;
  stage: string;
  votes?: number;
  lastVote?: string;
};

export type BillRoll = {
  id: string;
  chamber: Chamber;
  congress: number;
  session: number;
  roll: number;
  date: string;
  question: string;
  result: string;
  yea: number | null;
  nay: number | null;
  final: boolean;
};

type BillInfo = { title: string; latest: string; stage: string; updated: string; ladder: { stages: { name: string; reached: boolean }[]; actions: { date: string; text: string }[] } };

type VoteRow = {
  id: string;
  date: string;
  result: string;
  question: string;
  bill: string;
  congress: number;
  session: number;
  roll: number;
  yea?: number;
  nay?: number;
};

type Position = {
  name: string;
  state: string;
  district: string;
  vote: string;
  party?: string;
  bioguide?: string;
  geoid: string | null;
};

export type RosterMember = {
  bioguide: string;
  name: string;
  first: string;
  last: string;
  nickname?: string;
  party: string;
  state: string;
  district: string;
  chamber: Chamber;
  since: string;
  terms: number;
  url: string;
  phone: string;
  office: string;
};

type CommitteeRow = {
  id: string;
  name: string;
  chamber: string;
  url: string;
  size: number;
  majority: number;
  minority: number;
  subs: number;
  chair: { bioguide: string; name: string; party: string } | null;
  ranking: { bioguide: string; name: string; party: string } | null;
};

type CommitteeSeat = { bioguide: string; name: string; side: string; party: string; state: string; district: string; rank: number; title: string };

type CommitteeDetail = {
  id: string;
  name: string;
  chamber: string;
  url: string;
  minorityUrl: string;
  jurisdiction: string;
  address: string;
  phone: string;
  parent: { id: string; name: string } | null;
  members: CommitteeSeat[];
  subcommittees: { id: string; name: string; size: number }[];
  billCount: number | null;
  bills: { id: string; label: string; relation: string; date: string; title: string }[];
  meetings: { id: string; date: string; title: string; status: string; type: string; location: string; link: string }[];
  scheduled?: { id: string; label: string; meeting: string; date: string; upcoming: boolean; meetingId: string }[];
  votes?: {
    id: string;
    label: string;
    title: string;
    question: string;
    result: string;
    date: string;
    tally: Record<string, { D: number; R: number; I: number; total: number }>;
    members: { bioguide: string; name: string; party: string; vote: string; side: string }[];
  }[];
};

type VoteDetail = {
  id?: string;
  question: string;
  result: string;
  date: string;
  bill: string;
  totals: Record<string, number>;
  positions: Position[];
};

export function useCongress(chamber: Chamber, mode: CongressMode, query: string, selectedId: string | null, party: PartyFilter) {
  const [bills, setBills] = useState<Bill[]>([]);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [committees, setCommittees] = useState<CommitteeRow[]>([]);
  const [committeeFocus, setCommitteeFocus] = useState<{ label: string; ids: Set<string> } | null>(null);
  const [states, setStates] = useState<GeoJSON.FeatureCollection | null>(null);
  const [districts, setDistricts] = useState<GeoJSON.FeatureCollection | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [voteCaption, setVoteCaption] = useState("");
  const [voteSource, setVoteSource] = useState<{ source: string; asOf: string; label: string } | null>(null);
  const [billInfo, setBillInfo] = useState<BillInfo | null>(null);
  const [rolls, setRolls] = useState<BillRoll[] | null>(null);
  const [rollPick, setRollPick] = useState<string | null>(null);
  const [billVote, setBillVote] = useState<VoteDetail | null>(null);
  const [drawer, setDrawer] = useState<DrawerModel | null>(null);
  const [status, setStatus] = useState<StatusLine>({ source: "Congress.gov", asOf: "" });
  const [rosterStatus, setRosterStatus] = useState<StatusLine>({ source: "unitedstates/congress-legislators", asOf: "" });
  const [empty, setEmpty] = useState("Loading Congress.gov…");

  useEffect(() => {
    api<{ ok: boolean; missing?: string; items: Bill[]; source: string; asOf: string }>("/api/congress/bills")
      .then((res) => {
        if (res.missing) setEmpty(`Set ${res.missing} in .env.local to load bills.`);
        setBills(res.items || []);
        setStatus({ source: res.source || "Congress.gov", asOf: when(res.asOf) });
      })
      .catch((err: Error) => setEmpty(err.message));
    api<{ ok: boolean; items: RosterMember[]; source: string; asOf: string; latency: string }>("/api/congress/roster")
      .then((res) => {
        setRoster(res.items || []);
        setRosterStatus({ source: res.source, asOf: when(res.asOf), latency: res.latency });
      })
      .catch(() => null);
    api<GeoJSON.FeatureCollection>("/geo/states.geojson").then(setStates).catch(() => null);
    api<GeoJSON.FeatureCollection>("/geo/cd119.geojson").then(setDistricts).catch(() => null);
  }, []);

  useEffect(() => {
    if (mode !== "committees" || committees.length) return;
    api<{ ok: boolean; items: CommitteeRow[] }>("/api/congress/committees")
      .then((res) => setCommittees(res.items || []))
      .catch((err: Error) => setEmpty(err.message));
  }, [mode, committees.length]);

  useEffect(() => {
    api<{ ok: boolean; missing?: string; items: VoteRow[]; source: string; asOf: string }>(
      `/api/congress/votes?chamber=${chamber}`
    )
      .then((res) => {
        if (res.missing) setEmpty(`Set ${res.missing} in .env.local to load votes.`);
        else setEmpty("");
        setVotes(res.items || []);
        const newest = Math.max(0, ...(res.items || []).map((vote) => recent(vote.date)));
        const quiet = newest > 0 && Date.now() - newest > 2 * 24 * 60 * 60 * 1000;
        if (res.source) setStatus((s) => ({
          ...s,
          source: res.source,
          asOf: when(res.asOf),
          latency: quiet ? "No roll call in the last two days on this feed." : s.latency
        }));
      })
      .catch((err: Error) => setEmpty(err.message));
  }, [chamber]);

  useEffect(() => {
    setDrawer(null);
  }, [mode, chamber]);

  useEffect(() => {
    if (!selectedId) setDrawer(null);
  }, [selectedId]);

  const latestVote = useMemo(() => [...votes].sort((a, b) => b.roll - a.roll)[0] || null, [votes]);
  const pinnedVote = Boolean(selectedId) && (mode === "votes" || mode === "bills");

  useEffect(() => {
    if (pinnedVote || !latestVote) return;
    let cancel = false;
    api<{ ok: boolean; source?: string; vote?: VoteDetail }>(`/api/congress/votes/${chamber}/${latestVote.congress}/${latestVote.session}/${latestVote.roll}`)
      .then((res) => {
        if (cancel || !res.vote) return;
        setPositions(res.vote.positions);
        setVoteCaption(`Latest roll call · ${voteTitle(latestVote.roll, res.vote.bill || latestVote.bill, res.vote.question, latestVote.question)} · ${res.vote.result}`);
        setVoteSource({ source: res.source || "", asOf: res.vote.date, label: `Latest ${chamber} roll ${latestVote.roll}` });
      })
      .catch(() => null);
    return () => { cancel = true; };
  }, [pinnedVote, latestVote, chamber]);

  useEffect(() => {
    setBillInfo(null);
    setRolls(null);
    setRollPick(null);
    setBillVote(null);
    if (!selectedId || mode !== "bills") return;
    let cancel = false;
    api<{ ok: boolean; bill?: BillInfo }>(`/api/congress/bills/${selectedId}`)
      .then((res) => { if (!cancel && res.bill) setBillInfo(res.bill); })
      .catch(() => null);
    api<{ ok: boolean; items?: BillRoll[] }>(`/api/congress/bills/${selectedId}/votes`)
      .then((res) => { if (!cancel) setRolls(res.items || []); })
      .catch(() => { if (!cancel) setRolls([]); });
    return () => { cancel = true; };
  }, [selectedId, mode]);

  /** The roll call on the map: the user's pick in this chamber, else this chamber's final passage, else its latest. */
  const rollId = useMemo(() => {
    if (mode !== "bills" || !rolls) return null;
    const mine = rolls.filter((r) => r.chamber === chamber);
    if (rollPick && mine.some((r) => r.id === rollPick)) return rollPick;
    return (mine.find((r) => r.final) || mine[0])?.id || null;
  }, [mode, rolls, rollPick, chamber]);

  useEffect(() => {
    if (mode !== "bills" || !selectedId || !rolls) return;
    const roll = rolls.find((r) => r.id === rollId);
    if (!roll) {
      const other = rolls.filter((r) => r.chamber !== chamber).length;
      setBillVote(null);
      setPositions([]);
      setVoteSource(null);
      setVoteCaption(other ? `No ${chamber} roll call on this bill · ${other} in the ${chamber === "house" ? "Senate" : "House"}` : "No recorded roll call on this bill");
      setStatus({ source: "Congress.gov bill actions · House Clerk · Senate.gov LIS", asOf: "", latency: other ? `Pick a ${chamber === "house" ? "Senate" : "House"} roll call above the map.` : "Voice votes and unanimous consent leave no roll call to map." });
      return;
    }
    let cancel = false;
    api<{ ok: boolean; source?: string; vote?: VoteDetail }>(`/api/congress/votes/${roll.chamber}/${roll.congress}/${roll.session}/${roll.roll}`)
      .then((res) => {
        if (cancel || !res.vote) return;
        res.vote.question = voteTitle(roll.roll, res.vote.bill || "", res.vote.question, roll.question);
        setBillVote(res.vote);
        setPositions(res.vote.positions);
        setVoteCaption(`${res.vote.question} · ${res.vote.result || roll.result}`);
        setVoteSource({ source: res.source || "", asOf: res.vote.date || roll.date, label: `${roll.chamber === "house" ? "House" : "Senate"} roll ${roll.roll}${roll.final ? " · final passage" : ""}` });
        setStatus({
          source: res.source || "Congress.gov roll call",
          asOf: when(res.vote.date || roll.date),
          latency: `${res.vote.totals.Yea || 0} yea · ${res.vote.totals.Nay || 0} nay · official roll call, posted within hours of the vote · click a ${roll.chamber === "house" ? "district" : "state"} for its members`
        });
      })
      .catch(() => null);
    return () => { cancel = true; };
  }, [mode, selectedId, rolls, rollId, chamber]);

  useEffect(() => {
    if (mode !== "bills" || !selectedId || !billInfo) return;
    setDrawer(billModel(billInfo, rolls, rollId, billVote, party));
  }, [mode, selectedId, billInfo, rolls, rollId, billVote, party, chamber]);

  useEffect(() => {
    if (!selectedId || mode !== "votes") return;
    const vote = votes.find((v) => v.id === selectedId);
    if (!vote) return;
    api<{ ok: boolean; source?: string; vote?: VoteDetail }>(`/api/congress/votes/${chamber}/${vote.congress}/${vote.session}/${vote.roll}`)
      .then((res) => {
        if (!res.vote) return;
        const title = voteTitle(vote.roll, res.vote.bill || vote.bill, res.vote.question, vote.question);
        setPositions(res.vote.positions);
        setVoteCaption(`${title} · ${res.vote.result}`);
        setVoteSource({ source: res.source || "", asOf: res.vote.date, label: `${chamber === "house" ? "House" : "Senate"} roll ${vote.roll}` });
        setDrawer({
          title,
          meta: res.vote.result,
          rows: [
            { label: "Date", value: when(res.vote.date) },
            { label: "Yea", value: String(res.vote.totals.Yea || 0) },
            { label: "Nay", value: String(res.vote.totals.Nay || 0) },
            { label: "Present", value: String(res.vote.totals.Present || 0) },
            { label: "Not voting", value: String(res.vote.totals["Not voting"] || 0) }
          ],
          links: billLink(res.vote.bill, vote.congress),
          tables: [castTable(res.vote.positions, party)],
          blocks: [{ title: "How they voted", lines: partySplit(res.vote.positions) }]
        });
        setStatus({
          source: res.source || (chamber === "senate" ? "Senate.gov LIS" : "Congress.gov roll call"),
          asOf: when(res.vote.date),
          latency: "Official roll call · Map or Floor for the same vote."
        });
      })
      .catch((err: Error) => setEmpty(err.message));
  }, [selectedId, mode, votes, chamber, party]);

  useEffect(() => {
    if (!selectedId || mode !== "committees") {
      setCommitteeFocus(null);
      return;
    }
    let cancel = false;
    api<{ ok: boolean; error?: string; committee?: CommitteeDetail; source?: string; asOf?: string; latency?: string }>(`/api/congress/committees/${selectedId}`)
      .then((res) => {
        if (cancel) return;
        if (!res.committee) {
          setDrawer({ title: "Committee", rows: [{ label: "Error", value: res.error || "No record" }] });
          return;
        }
        setDrawer(committeeModel(res.committee, party));
        setCommitteeFocus({ label: res.committee.name, ids: new Set(res.committee.members.map((m) => m.bioguide)) });
        setStatus({ source: res.source || "Congress.gov", asOf: when(res.asOf), latency: res.latency });
      })
      .catch(() => null);
    return () => { cancel = true; };
  }, [selectedId, mode, party]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (mode === "members") {
      return roster
        .filter((m) => m.chamber === chamber)
        .filter((m) => party === "all" || m.party === party)
        .filter((m) => `${m.name} ${m.state} ${m.state}-${m.district}`.toLowerCase().includes(q))
        .map((m) => ({
          id: m.bioguide,
          title: m.name,
          meta: `${m.party || "—"} · ${m.state}${m.district && m.district !== "0" ? `-${m.district}` : m.chamber === "house" ? "-AL" : ""} · ${m.terms} terms · since ${m.since.slice(0, 4)}`,
          tone: partyTone(m.party)
        }));
    }
    if (mode === "committees") {
      return committees
        .filter((c) => c.chamber === chamber || c.chamber === "joint")
        .filter((c) => `${c.name} ${c.chair?.name || ""}`.toLowerCase().includes(q))
        .map((c) => ({
          id: c.id,
          title: c.name.replace(/^(House|Senate) Committee on /, "").replace(/^Joint Committee on /, "Joint · "),
          meta: `${c.size} seats · ${c.majority}–${c.minority} · chair ${c.chair?.name || "—"} · ${c.subs} subcommittees`
        }));
    }
    if (mode === "bills") {
      return [...bills]
        .sort((a, b) => recent(b.updated) - recent(a.updated))
        .filter((b) => `${b.title} ${b.type} ${b.number}`.toLowerCase().includes(q))
        .map((b) => ({
          id: b.id,
          title: `${b.type} ${b.number}`,
          meta: `${when(b.updated)} · ${b.votes ? `${b.votes} roll call${b.votes > 1 ? "s" : ""} · ` : ""}${b.stage} · ${b.title}`
        }));
    }
    return [...votes]
      .sort((a, b) => {
        const aClose = isClose(a);
        const bClose = isClose(b);
        if (aClose !== bClose) return aClose ? -1 : 1;
        if (aClose && bClose) return marginOf(a) - marginOf(b);
        return b.roll - a.roll;
      })
      .filter((v) => `${v.question} ${v.bill} ${v.result}`.toLowerCase().includes(q))
      .map((v) => ({
        id: v.id,
        title: voteTitle(v.roll, v.bill, v.question),
        meta: voteMeta(v),
        tone: isClose(v) ? "close" as const : v.result.toLowerCase().includes("pass") || v.result.toLowerCase().includes("agreed") ? "yea" as const : v.result.toLowerCase().includes("fail") || v.result.toLowerCase().includes("reject") ? "nay" as const : "" as const
      }));
  }, [bills, votes, roster, committees, mode, query, chamber, party]);

  const voteMap = useMemo(() => {
    if (chamber === "senate") return states ? senateVoteMap(states, positions, party) : null;
    return districts ? houseVoteMap(districts, positions, party) : null;
  }, [chamber, states, districts, positions, party]);

  const view = mode === "members" || mode === "committees"
    ? { ...rosterStatus, latency: mode === "committees" ? "Committee rosters are current assignments. Click a committee for members, bills, and meetings." : rosterStatus.latency }
    : status;

  return {
    items,
    empty,
    drawer,
    setDrawer,
    status: view,
    geojson: voteMap?.geojson,
    states,
    mapCounts: voteMap?.counts || {},
    positions,
    voteCaption,
    voteSource,
    rolls: rolls || [],
    rollId,
    pickRoll: setRollPick,
    roster,
    committeeFocus
  };
}

function billModel(bill: BillInfo, rolls: BillRoll[] | null, rollId: string | null, vote: VoteDetail | null, party: PartyFilter): DrawerModel {
  const roll = rolls?.find((r) => r.id === rollId) || null;
  const live = vote && roll && vote.id === roll.id ? vote : null;
  return {
    title: bill.title,
    meta: bill.stage,
    stages: bill.ladder.stages,
    rows: [
      { label: "Updated", value: when(bill.updated) },
      { label: "Latest", value: bill.latest || "—" },
      { label: "Roll call", value: roll ? `${roll.chamber === "house" ? "House" : "Senate"} roll ${roll.roll} · ${roll.date}${roll.final ? " · final passage" : ""}` : rolls ? "None recorded in this chamber" : "Loading…" },
      ...(live ? [
        { label: "Question", value: live.question || roll?.question || "—" },
        { label: "Result", value: live.result || "—" },
        { label: "Tally", value: `${live.totals.Yea || 0} yea · ${live.totals.Nay || 0} nay · ${live.totals.Present || 0} present · ${live.totals["Not voting"] || 0} not voting` }
      ] : [])
    ],
    tables: [
      ...(rolls?.length ? [{
        title: "Roll calls on this bill",
        note: "Click one to map it. Final passage is the default in each chamber.",
        cols: ["", "Chamber", "Date", "Question", "Result", "Yea–Nay"],
        rows: rolls.map((r) => ({
          cells: [r.id === rollId ? "▸" : r.final ? "final" : "", r.chamber === "house" ? "House" : "Senate", r.date, r.question, r.result || "—", r.yea == null ? "—" : `${r.yea}–${r.nay}`],
          action: `roll:${r.id}`,
          tone: r.id === rollId ? "up" as const : "" as const
        }))
      }] : []),
      ...(live?.positions.length ? [castTable(live.positions, party)] : [])
    ],
    blocks: [
      ...(live?.positions.length ? [{ title: "How they voted", lines: partySplit(live.positions) }] : []),
      {
        title: "Actions",
        lines: [...bill.ladder.actions].sort((a, b) => recent(b.date) - recent(a.date)).map((a) => `${a.date || ""} ${a.text}`.trim())
      }
    ]
  };
}

function partyTone(party: string) {
  return party === "D" ? "dem" as const : party === "R" ? "rep" as const : party ? "ind" as const : "" as const;
}

function castTable(positions: Position[], party: PartyFilter) {
  const rows = positions
    .filter((p) => party === "all" || (p.party || "I") === party)
    .sort((a, b) => a.vote.localeCompare(b.vote) || (a.party || "").localeCompare(b.party || "") || a.state.localeCompare(b.state));
  return {
    title: party === "all" ? "Member votes" : `Member votes · ${party} only`,
    cols: ["Vote", "Member", "Party", "Seat"],
    rows: rows.map((p) => ({
      cells: [p.vote, p.name, p.party || "—", `${p.state}${p.district ? `-${p.district}` : ""}`],
      action: /^[A-Z]\d{6}$/.test(p.bioguide || "") ? `member:${p.bioguide}` : undefined,
      tone: p.vote === "Yea" ? "up" as const : p.vote === "Nay" ? "down" as const : "" as const
    }))
  };
}

function committeeModel(c: CommitteeDetail, party: PartyFilter): DrawerModel {
  const members = c.members.filter((m) => party === "all" || m.party === party);
  return {
    title: c.name,
    meta: c.jurisdiction ? c.jurisdiction.slice(0, 280) : `${c.chamber} committee`,
    rows: [
      { label: "Chamber", value: c.chamber },
      { label: "Seats", value: `${c.members.length} · majority ${c.members.filter((m) => m.side === "majority").length} · minority ${c.members.filter((m) => m.side === "minority").length}` },
      { label: "Referred bills", value: c.billCount == null ? "—" : String(c.billCount) },
      { label: "Office", value: c.address || "—" },
      { label: "Phone", value: c.phone || "—" }
    ],
    links: [
      ...(c.url ? [{ label: "Website", value: c.url.replace(/^https?:\/\//, ""), href: c.url }] : []),
      ...(c.minorityUrl ? [{ label: "Minority", value: c.minorityUrl.replace(/^https?:\/\//, ""), href: c.minorityUrl }] : []),
      ...(c.parent ? [{ label: "Parent", value: c.parent.name, action: `committee:${c.parent.id}` }] : []),
      ...c.members.filter((m) => m.title).map((m) => ({ label: m.title, value: `${m.name} · ${m.party}`, action: `member:${m.bioguide}` }))
    ],
    tables: [
      {
        title: party === "all" ? "Members" : `Members · ${party} only`,
        cols: ["Rank", "Member", "Party", "Seat", "Side"],
        rows: members.map((m) => ({
          cells: [String(m.rank || "—"), m.name, m.party || "—", `${m.state}${m.district ? `-${m.district}` : ""}`, m.title || m.side],
          action: `member:${m.bioguide}`,
          tone: m.party === "D" ? "dem" as const : m.party === "R" ? "rep" as const : "" as const
        }))
      },
      ...(c.subcommittees.length ? [{
        title: "Subcommittees",
        cols: ["Subcommittee", "Seats"],
        rows: c.subcommittees.map((s) => ({ cells: [s.name, String(s.size)], action: `committee:${s.id}` }))
      }] : []),
      ...(c.scheduled?.length ? [{
        title: "Bills on the committee schedule",
        note: "From meeting agendas on Congress.gov. Upcoming first.",
        cols: ["Bill", "Meeting", "Date", ""],
        rows: [...c.scheduled].sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || String(b.date).localeCompare(String(a.date))).map((b) => ({
          cells: [b.label, b.meeting, when(b.date), b.upcoming ? "UPCOMING" : "held"],
          action: `bill:${b.id}`,
          tone: b.upcoming ? "up" as const : "" as const
        }))
      }] : []),
      ...(c.votes?.length ? [{
        title: "How committee members voted, per bill",
        note: "Recent floor roll calls on bills referred to this committee, plus the latest roll call on scheduled bills. Only this committee's members are counted.",
        cols: ["Bill", "Title · question", "Result", "Yea D/R", "Nay D/R", "Date"],
        rows: c.votes.map((v) => ({
          cells: [v.label, [v.title, v.question].filter(Boolean).join(" · ").slice(0, 140), v.result, `${v.tally.Yea?.D || 0}/${v.tally.Yea?.R || 0}`, `${v.tally.Nay?.D || 0}/${v.tally.Nay?.R || 0}`, (v.date || "").slice(0, 10)],
          action: `bill:${v.id}`
        }))
      }] : []),
      ...(c.votes || []).slice(0, 5).map((v) => ({
        title: `${v.label} · committee members`,
        cols: ["Member", "Party", "Side", "Vote"],
        rows: v.members
          .filter((m) => party === "all" || m.party === party)
          .sort((a, b) => a.vote.localeCompare(b.vote) || a.party.localeCompare(b.party))
          .map((m) => ({
            cells: [m.name, m.party || "—", m.side || "—", m.vote],
            action: `member:${m.bioguide}`,
            tone: m.vote === "Yea" ? "up" as const : m.vote === "Nay" ? "down" as const : "" as const
          }))
      })),
      {
        title: "Latest referrals",
        cols: ["Bill", "Title", "Date"],
        rows: c.bills.map((b) => ({ cells: [b.label, b.title || b.relation, (b.date || "").slice(0, 10)], action: `bill:${b.id}` }))
      },
      {
        title: "Meetings on the calendar feed",
        cols: ["Date", "Type", "Title"],
        rows: c.meetings.map((m) => ({ cells: [when(m.date), m.type || m.status, m.title], action: `meeting:${m.id}` }))
      }
    ]
  };
}

function marginOf(vote: { yea?: number; nay?: number }) {
  return Math.abs((vote.yea || 0) - (vote.nay || 0));
}

function isClose(vote: { yea?: number; nay?: number }) {
  if (!vote.yea && !vote.nay) return false;
  return marginOf(vote) < 10;
}

function voteMeta(vote: VoteRow) {
  const counts = vote.yea || vote.nay ? `yea ${vote.yea || 0} · nay ${vote.nay || 0} · margin ${marginOf(vote)}` : "";
  const head = isClose(vote) ? "close" : vote.result;
  return [head, counts, vote.date?.slice(0, 10) || "", vote.bill].filter(Boolean).join(" · ");
}

function partySplit(positions: Position[]) {
  const groups = new Map<string, Record<string, number>>();
  for (const position of positions) {
    const party = position.party || "Other";
    const counts = groups.get(party) || {};
    counts[position.vote] = (counts[position.vote] || 0) + 1;
    groups.set(party, counts);
  }
  return [...groups.entries()].map(([party, counts]) =>
    `${party}  Yea ${counts.Yea || 0} · Nay ${counts.Nay || 0} · Present ${counts.Present || 0} · Not voting ${counts["Not voting"] || 0}`
  );
}

function billLink(bill: string, congress: number) {
  const match = String(bill || "").trim().match(/^([A-Za-z.]+)\s*(\d+)$/);
  if (!match || !congress) return [];
  const type = match[1].toLowerCase().replace(/\./g, "");
  return [{ label: "Bill", value: bill, action: `bill:${type}-${congress}-${match[2]}` }];
}
