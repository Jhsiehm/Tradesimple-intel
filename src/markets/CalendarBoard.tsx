import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { usd, when } from "../lib/format";
import type { DrawerModel } from "../types";
import { CCY_CHART, COUNTRY_CCY, MacroStrip, useStrip, type EconEvent } from "./FxBoard";

export type CalendarTab = "sessions" | "earnings" | "macro" | "lobbying" | "pacs";

export type Meeting = {
  id: string;
  date: string;
  chamber: string;
  title: string;
  location?: string;
  status?: string;
  type?: string;
  committees?: { name: string; system: string }[];
  bills?: { id: string; label: string }[];
  nominations?: number;
  documents?: { name: string; url: string }[];
  videos?: { name: string; url: string }[];
  link?: string;
};

type Feed<T> = { ok: boolean; missing?: string; error?: string; source?: string; asOf?: string; latency?: string; items: T[] };

type Earning = {
  id: string;
  date: string;
  symbol: string;
  name: string;
  time: "pre" | "post" | "tbd";
  marketCap: number | null;
  quarter: string;
  epsForecast: string;
  estimates: number | null;
  lastYearDate: string;
  lastYearEps: string;
  inJoin: boolean;
};

type Filing = {
  id: string;
  symbol: string;
  year: number;
  period: string;
  typeLabel: string;
  posted: string;
  periodEnd?: string;
  lag?: number | null;
  amount: number;
  inHouse: boolean;
  registrant: string;
  client: string;
  issues: string[];
  detail: string;
  entities: string[];
  lobbyists: string[];
  link: string;
};

type LobbyTotals = { symbol: string; name: string; current: number; prior: number; filings: number; firms: number };

type Gift = {
  id: string;
  symbol: string;
  pac: string;
  pacName: string;
  date: string;
  amount: number;
  kind: string;
  recipient: string;
  candidate: string;
  candidateId: string;
  party: string;
  office: string;
  state: string;
  district: string;
  bioguide: string;
  member: string;
  cycle: number;
  filed?: string;
  lag?: number | null;
  link: string;
};

type Group = { id: string; name: string; org: string; orgType: string; total: number; count: number; dem: number; rep: number; recipients: number; symbol: string };

type PacFeed = { ok: boolean; source?: string; asOf?: string; latency?: string; cycle?: number; rows: Gift[]; groups: Group[] };

const TABS: { id: CalendarTab; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "earnings", label: "Earnings" },
  { id: "macro", label: "Macro · Fed · CPI" },
  { id: "lobbying", label: "Lobbying" },
  { id: "pacs", label: "PACs" }
];

const CCYS = ["All", "USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF"];
const OFFICE: Record<string, string> = { H: "House", S: "Senate", P: "President" };

export function CalendarBoard({
  tab,
  onTab,
  meetings,
  meetingNote,
  onMeeting,
  onDossier,
  onClose
}: {
  tab: CalendarTab;
  onTab: (tab: CalendarTab) => void;
  meetings: Meeting[];
  meetingNote: string;
  onMeeting: (meeting: Meeting) => void;
  onDossier: (model: DrawerModel) => void;
  onClose: () => void;
}) {
  const earnings = useFeed<Feed<Earning>>(tab === "earnings" ? "/api/calendar/earnings" : null);
  const macro = useFeed<Feed<EconEvent>>(tab === "macro" ? "/api/calendar/macro?back=10&ahead=35" : null);
  const lobbying = useFeed<Feed<Filing> & { totals: LobbyTotals[] }>(tab === "lobbying" ? "/api/calendar/lobbying" : null);
  const pacs = useFeed<PacFeed>(tab === "pacs" ? "/api/calendar/pacs" : null);
  const strip = useStrip();

  const status = tab === "earnings" ? earnings.data
    : tab === "macro" ? macro.data
    : tab === "lobbying" ? lobbying.data
    : tab === "pacs" ? pacs.data
    : { source: "Congress.gov committee meetings", asOf: "", latency: "Scheduled House and Senate committee meetings." };
  const error = tab === "earnings" ? earnings.error : tab === "macro" ? macro.error : tab === "lobbying" ? lobbying.error : tab === "pacs" ? pacs.error : "";

  return (
    <div className="board calendar">
      <header className="board-head">
        <div className="board-title">
          <strong>CALENDAR</strong>
          <span className="seg toggle">
            {TABS.map((t) => (
              <button key={t.id} aria-pressed={tab === t.id} onClick={() => onTab(t.id)}>{t.label}</button>
            ))}
          </span>
          <button className="ghost scope-close" onClick={onClose}>Close</button>
        </div>
        <p>
          <em>SOURCE</em> {status?.source || "—"}
          <em>AS OF</em> {status?.asOf ? when(status.asOf) : "—"}
          <em>NOTE</em> {status?.latency || "—"}
        </p>
      </header>
      {tab === "macro" ? <MacroStrip strip={strip} /> : null}
      {error ? <p className="tape-empty">{error}</p> : null}
      {tab === "sessions" ? <Sessions meetings={meetings} note={meetingNote} onMeeting={onMeeting} /> : null}
      {tab === "earnings" ? <Earnings items={earnings.data?.items} onDossier={onDossier} /> : null}
      {tab === "macro" ? <Macro items={macro.data?.items} onDossier={onDossier} /> : null}
      {tab === "lobbying" ? <Lobbying items={lobbying.data?.items} totals={lobbying.data?.totals} onDossier={onDossier} /> : null}
      {tab === "pacs" ? <Pacs feed={pacs.data} onDossier={onDossier} /> : null}
    </div>
  );
}

const REFRESH = 5 * 60 * 1000;

function useFeed<T>(path: string | null) {
  const [cache, setCache] = useState<Record<string, T>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    if (!path || cache[path]) return;
    let cancel = false;
    setError("");
    api<T & { ok: boolean; error?: string; missing?: string }>(path)
      .then((res) => {
        if (cancel) return;
        if (!res.ok) setError(res.missing ? `Set ${res.missing} in .env.local to load this feed.` : res.error || "Feed did not load");
        else setCache((current) => ({ ...current, [path]: res }));
      })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    return () => { cancel = true; };
  }, [path, cache]);
  useEffect(() => {
    if (!path) return;
    const timer = window.setInterval(() => {
      api<T & { ok: boolean }>(path)
        .then((res) => { if (res.ok) setCache((current) => ({ ...current, [path]: res })); })
        .catch(() => null);
    }, REFRESH);
    return () => window.clearInterval(timer);
  }, [path]);
  return { data: path ? cache[path] : undefined, error };
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  return (
    <span className="seg toggle">
      {options.map(([id, label]) => (
        <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>
      ))}
    </span>
  );
}

function Filters({ children, count }: { children: ReactNode; count: string }) {
  return (
    <div className="cal-filters">
      {children}
      <span className="count-note">{count}</span>
    </div>
  );
}

function Loading({ show }: { show: boolean }) {
  return show ? <p className="note pad">Loading…</p> : null;
}

function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()} ${date}`;
}

/* ---------- Sessions ---------- */

function Sessions({ meetings, note, onMeeting }: { meetings: Meeting[]; note: string; onMeeting: (m: Meeting) => void }) {
  return (
    <div className="board-scroll">
      {note ? <p className="note pad">{note}</p> : null}
      <table>
        <thead>
          <tr><th>When (UTC)</th><th>Meeting</th><th>Chamber</th><th>Committee</th><th>Status</th></tr>
        </thead>
        <tbody>
          {meetings.map((m) => (
            <tr key={m.id} onClick={() => onMeeting(m)}>
              <td>{when(m.date)}</td>
              <td className="board-name wrap">{m.title}</td>
              <td>{m.chamber}</td>
              <td className="wrap dim">{m.committees?.map((c) => c.name).join(", ") || "—"}</td>
              <td>{[m.status, m.type].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Loading show={!meetings.length && !note} />
    </div>
  );
}

/* ---------- Earnings ---------- */

function Earnings({ items, onDossier }: { items?: Earning[]; onDossier: (m: DrawerModel) => void }) {
  const [scope, setScope] = useState<"join" | "major">("major");
  const [range, setRange] = useState<"upcoming" | "past">("upcoming");
  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => {
    const list = (items || []).filter((r) => (scope === "join" ? r.inJoin : true) && (range === "upcoming" ? r.date >= today : r.date < today));
    return range === "past" ? list.reverse() : list;
  }, [items, scope, range, today]);
  const days = groupBy(rows, (r) => r.date);

  function open(r: Earning) {
    onDossier({
      title: `${r.symbol} · ${r.name}`,
      meta: `Earnings ${r.date} · ${r.time === "pre" ? "before the open" : r.time === "post" ? "after the close" : "time not confirmed"}`,
      rows: [
        { label: "Date", value: r.date },
        { label: "Session", value: r.time === "pre" ? "Pre-market" : r.time === "post" ? "After hours" : "TBD" },
        { label: "Fiscal quarter", value: r.quarter || "—" },
        { label: "Consensus EPS", value: r.epsForecast || "—" },
        { label: "Estimates", value: r.estimates ? String(r.estimates) : "—" },
        { label: "Year-ago EPS", value: r.lastYearEps ? `${r.lastYearEps}${r.lastYearDate ? ` (${r.lastYearDate})` : ""}` : "—" },
        { label: "Market cap", value: usd(r.marketCap) },
        { label: "Join table", value: r.inJoin ? "Yes · chart, filings, lobbying, PAC overlays" : "No · not in data/tickers.json" }
      ],
      links: r.inJoin
        ? [
            { label: "Chart", value: `${r.symbol} with earnings, lobbying, PAC, and contract marks`, action: `chart:${r.symbol}` },
            { label: "Positions", value: `${r.symbol} holders and trades`, action: `pos:${r.symbol}` }
          ]
        : [{ label: "Nasdaq", value: `${r.symbol} earnings page`, href: `https://www.nasdaq.com/market-activity/stocks/${r.symbol.toLowerCase()}/earnings` }]
    });
  }

  return (
    <>
      <Filters count={`${rows.length} reports`}>
        <Seg value={range} options={[["upcoming", "Upcoming"], ["past", "Reported"]]} onChange={setRange} />
        <Seg value={scope} options={[["major", "Majors ≥ $50B + join"], ["join", "Join table"]]} onChange={setScope} />
      </Filters>
      <div className="board-scroll">
        <table>
          <thead>
            <tr><th>Symbol</th><th>Company</th><th>Session</th><th>Quarter</th><th>EPS est</th><th>Ests</th><th>Yr-ago EPS</th><th>Mkt cap</th></tr>
          </thead>
          <tbody>
            {days.map(([date, list]) => (
              <Fragment key={date}>
                <tr className="group-row"><td colSpan={8}>{dayLabel(date)} <small>{list.length} report{list.length === 1 ? "" : "s"}</small></td></tr>
                {list.map((r) => (
                  <tr key={r.id} onClick={() => open(r)} className={r.inJoin ? "joined" : ""}>
                    <td>{r.symbol}{r.inJoin ? <small className="tag"> JOIN</small> : null}</td>
                    <td className="board-name">{r.name}</td>
                    <td>{r.time === "pre" ? "BMO" : r.time === "post" ? "AMC" : "—"}</td>
                    <td>{r.quarter || "—"}</td>
                    <td>{r.epsForecast || "—"}</td>
                    <td>{r.estimates ?? "—"}</td>
                    <td>{r.lastYearEps || "—"}</td>
                    <td>{usd(r.marketCap)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <Loading show={!items} />
      </div>
    </>
  );
}

/* ---------- Macro ---------- */

function Macro({ items, onDossier }: { items?: EconEvent[]; onDossier: (m: DrawerModel) => void }) {
  const [tier, setTier] = useState<"high" | "all">("high");
  const [ccy, setCcy] = useState("All");
  const [kind, setKind] = useState<"all" | "fed" | "inflation" | "jobs">("all");
  const rows = useMemo(() => (items || []).filter((e) => {
    if (tier === "high" && e.tier !== "high") return false;
    if (ccy !== "All" && COUNTRY_CCY[e.country] !== ccy) return false;
    if (kind === "fed" && !/rate decision|fomc|fed |monetary policy|deposit|refinancing|cash rate/i.test(e.event)) return false;
    if (kind === "inflation" && !/cpi|pce|ppi|hicp|inflation|price index/i.test(e.event)) return false;
    if (kind === "jobs" && !/payroll|unemployment|employment|jobless|claims|jolts|adp/i.test(e.event)) return false;
    return true;
  }), [items, tier, ccy, kind]);
  const days = groupBy(rows, (r) => r.date);
  const today = new Date().toISOString().slice(0, 10);

  const open = (e: EconEvent) => onDossier(econModel(e));

  return (
    <>
      <Filters count={`${rows.length} prints · times ET`}>
        <Seg value={tier} options={[["high", "High impact"], ["all", "All tracked"]]} onChange={setTier} />
        <Seg value={kind} options={[["all", "All"], ["fed", "Central banks"], ["inflation", "Inflation"], ["jobs", "Jobs"]]} onChange={setKind} />
        <Seg value={ccy} options={CCYS.map((c) => [c, c] as [string, string])} onChange={setCcy} />
      </Filters>
      <div className="board-scroll">
        <table>
          <thead>
            <tr><th>Time</th><th>Event</th><th>Ccy</th><th>Actual</th><th>Consensus</th><th>Previous</th><th>vs cons</th></tr>
          </thead>
          <tbody>
            {days.map(([date, list]) => (
              <Fragment key={date}>
                <tr className={`group-row${date === today ? " today" : ""}`}><td colSpan={7}>{dayLabel(date)}{date === today ? " · TODAY" : ""} <small>{list.length} print{list.length === 1 ? "" : "s"}</small></td></tr>
                {list.map((e) => (
                  <tr key={e.id} onClick={() => open(e)} className={date < today ? "past" : ""}>
                    <td>{e.time || "—"}</td>
                    <td className="board-name">
                      {e.tier === "high" ? <i className="imp" title="High impact" /> : null}
                      {e.event} <small className="dim">{e.country}</small>
                    </td>
                    <td>{COUNTRY_CCY[e.country] || "—"}</td>
                    <td className={e.surprise === "above" ? "up" : e.surprise === "below" ? "down" : ""}>{e.actual || "—"}</td>
                    <td>{e.consensus || "—"}</td>
                    <td className="dim">{e.previous || "—"}</td>
                    <td className={e.surprise === "above" ? "up" : e.surprise === "below" ? "down" : "dim"}>{e.surprise === "above" ? "▲ beat" : e.surprise === "below" ? "▼ miss" : e.surprise === "inline" ? "= inline" : ""}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <Loading show={!items} />
      </div>
    </>
  );
}

/* ---------- Lobbying ---------- */

function Lobbying({ items, totals, onDossier }: { items?: Filing[]; totals?: LobbyTotals[]; onDossier: (m: DrawerModel) => void }) {
  const [view, setView] = useState<"filings" | "totals">("filings");
  const [symbol, setSymbol] = useState("All");
  const symbols = useMemo(() => ["All", ...[...new Set((items || []).map((f) => f.symbol))].sort()], [items]);
  const rows = (items || []).filter((f) => symbol === "All" || f.symbol === symbol);
  const max = Math.max(1, ...(totals || []).map((t) => t.current + t.prior));
  const year = new Date().getUTCFullYear();

  function open(f: Filing) {
    onDossier({
      title: `${f.client} · ${f.registrant}`,
      meta: `${f.typeLabel || "LD-2"} · ${f.period} ${f.year} · posted ${f.posted}`,
      rows: [
        { label: "Ticker", value: f.symbol },
        { label: "Filing lag", value: f.lag != null ? `${f.lag} days · period ended ${f.periodEnd}, posted ${f.posted}${f.lag > 20 ? " · past the 20-day deadline" : ""}` : "No reporting period (registration or amendment)" },
        { label: "Amount", value: f.amount ? usd(f.amount) : /registration/i.test(f.typeLabel) ? "None · registrations carry no amount" : "Under $5,000 or not reported" },
        { label: "Basis", value: f.inHouse ? "In-house expenses" : "Outside firm fee income" },
        { label: "Issues", value: f.issues.join(", ") || "—" },
        { label: "Entities lobbied", value: f.entities.join(", ") || "—" },
        { label: "Lobbyists", value: f.lobbyists.join(", ") || "—" }
      ],
      blocks: f.detail ? [{ title: "Specific issues", lines: [f.detail] }] : undefined,
      links: [
        ...(f.link ? [{ label: "LDA.gov", value: "Filing document", href: f.link }] : []),
        { label: "Chart", value: `${f.symbol} with lobbying and PAC marks`, action: `chart:${f.symbol}` }
      ]
    });
  }

  return (
    <>
      <Filters count={view === "filings" ? `${rows.length} filings` : `${totals?.length || 0} clients`}>
        <Seg value={view} options={[["filings", "Filings"], ["totals", "Spend by client"]]} onChange={setView} />
        {view === "filings" ? (
          <select className="cal-select" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Ticker">
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : null}
      </Filters>
      <div className="board-scroll">
        {view === "filings" ? (
          <table>
            <thead>
              <tr><th>Posted</th><th>Lag</th><th>Client</th><th>Ticker</th><th>Registrant</th><th>Period</th><th>Amount</th><th>Issues</th></tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} onClick={() => open(f)}>
                  <td>{f.posted}</td>
                  <td><Lag days={f.lag} due={20} /></td>
                  <td className="board-name">{f.client}</td>
                  <td>{f.symbol}</td>
                  <td className="board-name">{f.registrant}</td>
                  <td className="dim">{f.year} {shortPeriod(f.period)}</td>
                  <td>{f.amount ? usd(f.amount) : <span className="dim">{/registration/i.test(f.typeLabel) ? "reg." : "<$5K"}</span>}</td>
                  <td className="board-name wrap dim">{f.issues.slice(0, 3).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>Ticker</th><th>Client</th><th>{year} YTD</th><th>{year - 1}</th><th>Filings</th><th>Firms</th><th>Spend</th></tr>
            </thead>
            <tbody>
              {(totals || []).map((t) => (
                <tr key={t.symbol} onClick={() => { setView("filings"); setSymbol(t.symbol); }}>
                  <td>{t.symbol}</td>
                  <td className="board-name">{t.name}</td>
                  <td>{usd(t.current)}</td>
                  <td>{usd(t.prior)}</td>
                  <td>{t.filings}</td>
                  <td>{t.firms}</td>
                  <td><span className="bar"><i style={{ width: `${((t.current + t.prior) / max) * 100}%` }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Loading show={!items} />
      </div>
    </>
  );
}

export function Lag({ days, due }: { days?: number | null; due: number }) {
  if (days == null) return <span className="dim">—</span>;
  const tone = days > due * 2 ? "lag-late" : days > due ? "lag-slow" : "lag-ok";
  return <span className={`lag ${tone}`} title={`${days} days from event to public filing`}>{days}d</span>;
}

function shortPeriod(period: string) {
  const m = period.match(/^(\d)(st|nd|rd|th) Quarter/);
  if (m) return `Q${m[1]}`;
  if (/mid-year/i.test(period)) return "H1";
  if (/year-end/i.test(period)) return "H2";
  return period.split(" ")[0] || "";
}

/* ---------- PACs ---------- */

function Pacs({ feed, onDossier }: { feed?: PacFeed; onDossier: (m: DrawerModel) => void }) {
  const [view, setView] = useState<"gifts" | "groups">("gifts");
  const [symbol, setSymbol] = useState("All");
  const [party, setParty] = useState<"all" | "D" | "R">("all");
  const gifts = feed?.rows || [];
  const symbols = useMemo(() => ["All", ...[...new Set(gifts.map((g) => g.symbol))].sort()], [gifts]);
  const rows = gifts.filter((g) => (symbol === "All" || g.symbol === symbol) && (party === "all" || g.party === party));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const dem = rows.filter((r) => r.party === "D").reduce((s, r) => s + r.amount, 0);
  const rep = rows.filter((r) => r.party === "R").reduce((s, r) => s + r.amount, 0);

  function open(g: Gift) {
    onDossier({
      title: `${g.pacName}`,
      meta: `${g.kind} · ${g.date} · cycle ${g.cycle}`,
      rows: [
        { label: "Ticker", value: g.symbol },
        { label: "Filed", value: g.filed ? `${g.filed} · ${g.lag ?? "?"} days after the gift` : "Paper filing, no image date" },
        { label: "Amount", value: `${usd(g.amount)}${g.amount < 0 ? " (refund or reversal)" : ""}` },
        { label: "Recipient", value: g.recipient || "—" },
        { label: "Candidate", value: g.candidate ? `${g.candidate} (${g.party || "?"})` : "—" },
        { label: "Office", value: `${OFFICE[g.office] || g.office || "—"}${g.state ? ` · ${g.state}` : ""}${g.office === "H" && g.district ? `-${g.district}` : ""}` },
        { label: "Sitting member", value: g.member || "Not matched to the current roster" },
        { label: "PAC ID", value: g.pac }
      ],
      links: [
        ...(g.bioguide ? [{ label: "Member", value: `${g.member} · votes, trades, committees`, action: `member:${g.bioguide}` }] : []),
        ...(g.link ? [{ label: "FEC", value: "Filing image", href: g.link }] : []),
        { label: "Chart", value: `${g.symbol} with PAC and lobbying marks`, action: `chart:${g.symbol}` },
        { label: "FEC", value: "Committee page", href: `https://www.fec.gov/data/committee/${g.pac}/` }
      ]
    });
  }

  function openGroup(g: Group) {
    const share = g.dem + g.rep ? g.rep / (g.dem + g.rep) : 0;
    onDossier({
      title: g.name,
      meta: `${g.orgType} PAC · ${feed?.cycle || ""} cycle`,
      rows: [
        { label: "Connected org", value: g.org || "—" },
        { label: "To candidates", value: usd(g.total) },
        { label: "Contributions", value: String(g.count) },
        { label: "Recipients", value: String(g.recipients) },
        { label: "Split", value: `D ${usd(g.dem)} · R ${usd(g.rep)} · ${Math.round(share * 100)}% R` },
        { label: "Ticker join", value: g.symbol || "None in data/tickers.json" }
      ],
      links: [
        { label: "FEC", value: "Committee page", href: `https://www.fec.gov/data/committee/${g.id}/` },
        ...(g.symbol ? [{ label: "Chart", value: `${g.symbol} with PAC marks`, action: `chart:${g.symbol}` }] : [])
      ]
    });
  }

  return (
    <>
      <Filters count={view === "gifts" ? `${rows.length} gifts · ${usd(total)} · D ${usd(dem)} / R ${usd(rep)}` : `Top ${feed?.groups.length || 0} interest-group PACs · ${feed?.cycle || ""} cycle`}>
        <Seg value={view} options={[["gifts", "Corporate PAC gifts"], ["groups", "Interest groups"]]} onChange={setView} />
        {view === "gifts" ? (
          <>
            <select className="cal-select" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Ticker">
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Seg value={party} options={[["all", "All"], ["D", "D"], ["R", "R"]]} onChange={setParty} />
          </>
        ) : null}
      </Filters>
      <div className="board-scroll">
        {view === "gifts" ? (
          <table>
            <thead>
              <tr><th>Date</th><th>Filed</th><th>Lag</th><th>Candidate</th><th>Ticker</th><th>Party</th><th>Seat</th><th>Amount</th><th>PAC</th></tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} onClick={() => open(g)}>
                  <td>{g.date}</td>
                  <td className="dim">{g.filed || "—"}</td>
                  <td><Lag days={g.lag} due={45} /></td>
                  <td className="board-name">{g.member || g.candidate || g.recipient}{g.bioguide ? <small className="tag"> MEMBER</small> : null}</td>
                  <td>{g.symbol}</td>
                  <td className={g.party === "D" ? "p-dem" : g.party === "R" ? "p-rep" : ""}>{g.party || "—"}</td>
                  <td>{g.office ? `${g.office === "H" ? `${g.state}-${g.district}` : `${g.state} ${OFFICE[g.office] || g.office}`}` : g.state || "—"}</td>
                  <td className={g.amount < 0 ? "down" : ""}>{usd(g.amount)}</td>
                  <td className="board-name dim">{g.pacName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>Committee</th><th>Type</th><th>To candidates</th><th>D</th><th>R</th><th>D / R</th><th>Recipients</th><th>Join</th></tr>
            </thead>
            <tbody>
              {(feed?.groups || []).map((g) => {
                const both = g.dem + g.rep || 1;
                return (
                  <tr key={g.id} onClick={() => openGroup(g)}>
                    <td className="board-name">{g.name}</td>
                    <td className="dim">{g.orgType}</td>
                    <td>{usd(g.total)}</td>
                    <td className="p-dem">{usd(g.dem)}</td>
                    <td className="p-rep">{usd(g.rep)}</td>
                    <td><span className="split-bar"><i style={{ width: `${(g.dem / both) * 100}%` }} /><b style={{ width: `${(g.rep / both) * 100}%` }} /></span></td>
                    <td>{g.recipients}</td>
                    <td>{g.symbol || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <Loading show={!feed} />
      </div>
    </>
  );
}

export function econModel(e: EconEvent): DrawerModel {
  const code = COUNTRY_CCY[e.country];
  const pair = code ? CCY_CHART[code] : "";
  return {
    title: `${e.country} · ${e.event}`,
    meta: `${e.date} ${e.time} ET · ${e.tier === "high" ? "High impact" : "Medium impact"} · Nasdaq economic calendar`,
    rows: [
      { label: "Actual", value: e.actual || "Not released" },
      { label: "Consensus", value: e.consensus || "—" },
      { label: "Previous", value: e.previous || "—" },
      { label: "Surprise", value: e.surprise ? `${e.surprise} consensus` : "—" },
      { label: "Currency", value: code || "—" }
    ],
    blocks: e.description ? [{ title: "What it measures", lines: [e.description] }] : undefined,
    links: [
      ...(pair ? [{ label: "Chart", value: `${code === "USD" ? "US Dollar Index" : pair.replace("=X", "")} with Fed, CPI, and macro marks`, action: `inst:${pair}` }] : []),
      ...(code && code !== "USD" ? [{ label: "Chart", value: "US Dollar Index (DXY)", action: "inst:DX-Y.NYB" }] : []),
      ...(code === "USD" ? [
        { label: "Chart", value: "EUR/USD", action: "inst:EURUSD=X" },
        { label: "Chart", value: "USD/JPY", action: "inst:USDJPY=X" },
        { label: "Chart", value: "Bitcoin", action: "inst:BTC-USD" }
      ] : [])
    ]
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const out: [string, T[]][] = [];
  for (const row of rows) {
    const k = key(row);
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1].push(row);
    else out.push([k, [row]]);
  }
  return out;
}
