import { useEffect, useMemo, useRef, useState } from "react";
import { api, DEMO } from "../lib/api";
import { money, when } from "../lib/format";
import type { ChartMark, DrawerModel, DrawerLink, DrawerTable, ListItem, MarketLayer, PartyFilter, StatusLine } from "../types";

type Row = Record<string, string | number | boolean | null>;

type Feed = {
  ok: boolean;
  missing?: string;
  error?: string;
  errors?: string[];
  source?: string;
  asOf?: string;
  latency?: string;
  detail?: string;
  items?: Row[];
};

export const CODE_LABEL: Record<string, string> = {
  P: "Open-market buy",
  S: "Open-market sale",
  A: "Grant",
  M: "Option exercise",
  F: "Tax withholding",
  G: "Gift",
  C: "Conversion",
  D: "Disposed to issuer",
  X: "Option exercise"
};

/** `enabled` is false outside the Markets section; a layer's feed (Congress trades is ~5 MB) loads the first time it is shown. */
export function useMarkets(layer: MarketLayer, query: string, selectedId: string | null, party: PartyFilter, enabled = true) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [empty, setEmpty] = useState("Loading filings…");
  const loaded = useRef<MarketLayer | null>(null);

  useEffect(() => {
    if (!enabled || loaded.current === layer) return;
    loaded.current = layer;
    let cancel = false;
    let done = false;
    setFeed(null);
    setEmpty(layer === "politicians"
      ? "Parsing House Clerk PDFs and Senate eFD reports. The first load takes about a minute."
      : "Loading filings…");
    api<Feed>(`/api/markets/${layer}`)
      .then((res) => {
        if (cancel) return;
        done = true;
        setFeed(res);
        if (res.missing) setEmpty(`Set ${res.missing} to load this feed. ${res.detail || ""}`.trim());
        else if (!res.items?.length) setEmpty(res.error || res.errors?.[0] || "No rows on this feed.");
        else setEmpty("");
      })
      .catch((err: Error) => {
        if (cancel) return;
        done = true;
        setEmpty(err.message);
        setFeed(null);
      });
    return () => { cancel = true; if (!done) loaded.current = null; };
  }, [layer, enabled]);

  const rows = useMemo(() => {
    const all = feed?.items || [];
    if (layer === "shorts") return all.filter((row) => row.latest);
    if (layer === "whales") return all.filter((row) => row.side !== "hold" || Number(row.shares) > 0);
    if (layer === "politicians" && party !== "all") return all.filter((row) => (row.party || "I") === party);
    return all;
  }, [feed, layer, party]);

  const items: ListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .map((row) => toItem(layer, row))
      .filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(q))
      .slice(0, 400);
  }, [rows, layer, query]);

  const selected = useMemo(() => rows.find((row) => String(row.id) === selectedId) || null, [rows, selectedId]);

  const drawer: DrawerModel | null = useMemo(() => {
    if (!selected) return null;
    return rowModel(layer, selected, feed?.latency);
  }, [selected, layer, feed]);

  const chartFocus = useMemo(() => {
    if (!selected) return null;
    const symbol = String(selected.symbol || "");
    if (!symbol || selected.inJoin === false) return null;
    const marks: ChartMark[] = [];
    const traded = Date.parse(String(selected.traded || ""));
    const filed = Date.parse(String(selected.filed || ""));
    const who = String(selected.person || "").split(" ").slice(-1)[0];
    if (Number.isFinite(traded) && layer !== "shorts") marks.push({ t: traded, label: `${who} ${selected.side || "trade"}`, tone: selected.side === "buy" ? "buy" : selected.side === "sell" ? "sell" : undefined });
    if (Number.isFinite(filed)) marks.push({ t: filed, label: layer === "shorts" ? "Settlement" : "Filed", tone: "file" });
    return { key: String(selected.id), symbol, marks };
  }, [selected, layer]);

  const status: StatusLine = {
    source: feed?.source || "Markets",
    asOf: when(feed?.asOf),
    latency: feed?.latency
  };

  return { items, empty, drawer, status, chartFocus };
}

function side(row: Row) {
  return String(row.side || "");
}

function toItem(layer: MarketLayer, row: Row): ListItem {
  if (layer === "politicians") {
    return {
      id: String(row.id),
      title: `${row.symbol} · ${row.person}${row.party ? ` (${row.party})` : ""}`,
      meta: `${row.type} ${row.amount} · traded ${row.traded || "—"} · filed ${row.filed} · ${row.lag ?? "—"}d lag · ${row.owner}`,
      tone: side(row) === "buy" ? "up" : side(row) === "sell" ? "down" : ""
    };
  }
  if (layer === "insiders") {
    return {
      id: String(row.id),
      title: `${row.symbol} · ${row.person}`,
      meta: `${CODE_LABEL[String(row.code)] || row.code} ${compact(Number(row.shares))} sh${row.price ? ` @ ${Number(row.price).toFixed(2)}` : ""} · traded ${row.traded} · filed ${row.filed} · ${row.lag ?? "—"}d`,
      tone: row.code === "P" ? "up" : row.code === "S" ? "down" : ""
    };
  }
  if (layer === "whales") {
    const delta = row.delta == null ? "" : ` ${Number(row.delta) >= 0 ? "+" : ""}${compact(Number(row.delta))} sh`;
    return {
      id: String(row.id),
      title: `${row.symbol} · ${row.person}`,
      meta: `${row.action}${delta} · holds ${compact(Number(row.shares))} · Q ${row.period} · filed ${row.filed}`,
      tone: side(row) === "buy" ? "up" : side(row) === "sell" ? "down" : ""
    };
  }
  const change = Number(row.change);
  return {
    id: String(row.id),
    title: String(row.symbol || ""),
    meta: `${compact(Number(row.shares))} short · ${Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"} · settled ${row.traded}`,
    tone: change > 0 ? "down" : change < 0 ? "up" : ""
  };
}

function rowModel(layer: MarketLayer, row: Row, latency?: string): DrawerModel {
  const symbol = String(row.symbol || "");
  const common = [
    ...(symbol ? [{ label: "Positions", value: `${symbol} · every filer`, action: `pos:${symbol}` }] : []),
    ...(symbol && row.inJoin !== false ? [{ label: "Chart", value: `${symbol} with this filing marked`, action: `chart:${symbol}` }] : []),
    ...(symbol && row.inJoin !== false ? [{ label: "HQ", value: `${symbol} headquarters district on the map`, action: `hq:${symbol}` }] : [])
  ];
  if (layer === "politicians") {
    return {
      title: `${symbol} · ${row.person}`,
      meta: latency,
      rows: [
        { label: "Side", value: String(row.type) },
        { label: "Amount", value: String(row.amount || "—") },
        { label: "Traded", value: String(row.traded || "—") },
        { label: "Filed", value: String(row.filed || "—") },
        ...(row.amended ? [{ label: "Amended", value: `${row.amended} · amendment ${row.amendment}` }] : []),
        { label: "Lag", value: row.lag == null ? "—" : `${row.lag} days` },
        { label: "Owner", value: String(row.owner || "—") },
        { label: "Asset", value: String(row.asset || "—") },
        { label: "Seat", value: `${row.chamber === "senate" ? "Senate" : "House"} · ${row.district || row.state || "—"} · ${row.party || "—"}` }
      ],
      links: [
        ...(row.bioguide ? [{ label: "Member", value: String(row.person), action: `member:${row.bioguide}` }] : []),
        ...common,
        { label: "Filing", value: row.chamber === "senate" ? "Senate eFD report" : "House Clerk PDF", href: String(row.link) }
      ]
    };
  }
  if (layer === "insiders") {
    return {
      title: `${symbol} · ${row.person}`,
      meta: latency,
      rows: [
        { label: "Role", value: String(row.title || "—") },
        { label: "Code", value: `${row.code} · ${CODE_LABEL[String(row.code)] || "Other"}` },
        { label: "Shares", value: Number(row.shares).toLocaleString() },
        { label: "Price", value: row.price ? Number(row.price).toFixed(2) : "—" },
        { label: "Value", value: row.value ? money(Number(row.value)) : "—" },
        { label: "Owned after", value: row.owned ? Number(row.owned).toLocaleString() : "—" },
        { label: "Traded", value: String(row.traded || "—") },
        { label: "Filed", value: String(row.filed || "—") },
        { label: "Lag", value: row.lag == null ? "—" : `${row.lag} days` }
      ],
      links: [...common, { label: "Filing", value: "SEC Form 4 index", href: String(row.link) }]
    };
  }
  if (layer === "whales") {
    return {
      title: `${symbol} · ${row.person}`,
      meta: latency,
      rows: [
        { label: "Change", value: String(row.action) },
        { label: "Shares", value: Number(row.shares).toLocaleString() },
        { label: "Prior", value: row.prior == null ? "—" : Number(row.prior).toLocaleString() },
        { label: "Delta", value: row.delta == null ? "—" : `${Number(row.delta) >= 0 ? "+" : ""}${Number(row.delta).toLocaleString()}` },
        { label: "Value", value: money(Number(row.value)) },
        { label: "Quarter", value: `${row.period}${row.priorPeriod ? ` vs ${row.priorPeriod}` : ""}` },
        { label: "Filed", value: String(row.filed) },
        { label: "Lag", value: row.lag == null ? "—" : `${row.lag} days after quarter end` },
        { label: "Issuer", value: String(row.issuer || "—") }
      ],
      links: [...common, { label: "Filing", value: "SEC 13F-HR index", href: String(row.link) }]
    };
  }
  return {
    title: `${symbol} short interest`,
    meta: latency,
    rows: [
      { label: "Short shares", value: Number(row.shares).toLocaleString() },
      { label: "Prior", value: row.prior == null ? "—" : Number(row.prior).toLocaleString() },
      { label: "Change", value: `${row.change || "—"}%` },
      { label: "Settlement", value: String(row.traded) }
    ],
    links: [...common, { label: "Source", value: "FINRA short interest", href: String(row.link) }]
  };
}

type Positions = {
  ok: boolean;
  symbol: string;
  name: string;
  inJoin: boolean;
  congress: Row[];
  insiders: Row[];
  whales: Row[];
  shorts: Row[];
  pacs?: Row[];
  pacNote?: string;
  coverage?: Record<"insiders" | "shorts", Coverage>;
};

type Coverage = { scanned: boolean; note: string };

/** Note to show instead of an empty list when the scan never covered this symbol. Missing coverage (older API) counts as unknown. */
function notScanned(res: Pick<Positions, "coverage">, feed: "insiders" | "shorts") {
  const c = res.coverage?.[feed];
  if (!c) return "Coverage unknown for this feed; an empty list may mean it was not scanned.";
  return c.scanned ? "" : c.note;
}

function avgLag(rows: Row[]) {
  const lags = rows.map((r) => Number(r.lag)).filter((v) => validLag(v));
  return lags.length ? `${Math.round(lags.reduce((a, b) => a + b, 0) / lags.length)}d` : "—";
}
function validLag(v: number) { return Number.isFinite(v) && v >= 0; }
function latest(rows: Row[], key: string) {
  return rows.map((r) => String(r[key] || "")).filter(Boolean).sort().pop() || "—";
}

function newestFiling(rows: Row[]) {
  const top = [...rows].sort((a, b) => String(b.filed || "").localeCompare(String(a.filed || "")))[0];
  return top?.link ? String(top.link) : undefined;
}

function byPerson(rows: Row[], isBuy: (r: Row) => boolean, isSell: (r: Row) => boolean) {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = String(r.bioguide || r.person);
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.values()]
    .map((list) => ({ list, buys: list.filter(isBuy), sells: list.filter(isSell) }))
    .sort((a, b) => latest(b.list, "filed").localeCompare(latest(a.list, "filed")));
}

export async function loadPositions(symbol: string): Promise<{ model: DrawerModel; marks: ChartMark[] } | null> {
  const res = await api<Positions>(`/api/markets/positions/${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const buys = res.congress.filter((r) => r.side === "buy");
  const sells = res.congress.filter((r) => r.side === "sell");
  const lags = res.congress.map((r) => Number(r.lag)).filter(Number.isFinite);
  const members = new Set(res.congress.map((r) => r.bioguide || r.person));
  const people = byPerson(res.congress, (r) => r.side === "buy", (r) => r.side === "sell");
  const insiders = byPerson(res.insiders, (r) => r.code === "P", (r) => r.code === "S");
  const insiderGap = notScanned(res, "insiders");
  const pacs = res.pacs || [];
  const tables: DrawerTable[] = [
    {
      title: "Congress · by member",
      note: "Who acted, how often, and how late they told the public.",
      cols: ["Member", "P", "Buys", "Sells", "Last buy", "Last sell", "Last filed", "Avg lag"],
      rows: people.map(({ list, buys, sells }) => ({
        cells: [String(list[0].person), String(list[0].party || "—"), String(buys.length), String(sells.length), latest(buys, "traded"), latest(sells, "traded"), latest(list, "filed"), avgLag(list)],
        action: list[0].bioguide ? `member:${list[0].bioguide}` : undefined,
        filing: newestFiling(list),
        tone: buys.length > sells.length ? "up" as const : sells.length > buys.length ? "down" as const : "" as const
      }))
    },
    ...(pacs.length || res.congress.length ? [{
      title: "PAC money to these members",
      note: res.pacNote,
      cols: ["Member", "PAC", "Amount", "Given", "Filed", "Lag"],
      rows: pacs.slice(0, 60).map((r) => ({
        cells: [String(r.member || r.candidate), `${String(r.pacName)}${r.own ? " · own PAC" : ""}`, `$${Number(r.amount).toLocaleString()}`, String(r.date), String(r.filed || "—"), r.lag == null ? "—" : `${r.lag}d`],
        action: r.bioguide ? `member:${r.bioguide}` : undefined,
        tone: r.party === "D" ? "dem" as const : r.party === "R" ? "rep" as const : "" as const
      }))
    }] : []),
    {
      title: "Congress · every trade",
      note: "Trade date against filed date. Amounts are the disclosed range.",
      cols: ["Member", "P", "Side", "Amount", "Traded", "Filed", "Lag"],
      rows: res.congress.map((r) => ({
        cells: [String(r.person), String(r.party || "—"), String(r.type), String(r.amount), String(r.traded || "—"), r.amended ? `${r.filed} (am. ${r.amended})` : String(r.filed), r.lag == null ? "—" : `${r.lag}d`],
        action: r.bioguide ? `member:${r.bioguide}` : undefined,
        filing: r.link ? String(r.link) : undefined,
        tone: r.side === "buy" ? "up" as const : r.side === "sell" ? "down" as const : "" as const
      }))
    },
    {
      title: "Insiders · by person",
      empty: insiderGap || undefined,
      cols: ["Insider", "Buys", "Sales", "Last buy", "Last sale", "Last filed", "Avg lag"],
      rows: insiders.map(({ list, buys, sells }) => ({
        cells: [String(list[0].person), String(buys.length), String(sells.length), latest(buys, "traded"), latest(sells, "traded"), latest(list, "filed"), avgLag(list)],
        href: String(list[0].link),
        tone: buys.length > sells.length ? "up" as const : sells.length > buys.length ? "down" as const : "" as const
      }))
    },
    {
      title: "Insiders (Form 4)",
      empty: insiderGap || undefined,
      cols: ["Insider", "Code", "Shares", "Price", "Traded", "Filed", "Lag"],
      rows: res.insiders.map((r) => ({
        cells: [String(r.person), String(r.code), compact(Number(r.shares)), r.price ? Number(r.price).toFixed(2) : "—", String(r.traded), String(r.filed), r.lag == null ? "—" : `${r.lag}d`],
        href: String(r.link),
        tone: r.code === "P" ? "up" as const : r.code === "S" ? "down" as const : "" as const
      }))
    },
    {
      title: "Whales (13F)",
      note: "Lag is filed date minus quarter end (13F due in 45 days).",
      cols: ["Fund", "Change", "Shares", "Delta", "Quarter", "Filed", "Lag"],
      rows: res.whales.map((r) => ({
        cells: [String(r.person), String(r.action), compact(Number(r.shares)), r.delta == null ? "—" : `${Number(r.delta) >= 0 ? "+" : ""}${compact(Number(r.delta))}`, String(r.period), String(r.filed), r.lag == null ? "—" : `${r.lag}d`],
        href: String(r.link),
        tone: r.side === "buy" ? "up" as const : r.side === "sell" ? "down" as const : "" as const
      }))
    },
    {
      title: "Short interest (FINRA)",
      note: "Settlement-date snapshots; FINRA publishes about seven business days after settlement.",
      empty: notScanned(res, "shorts") || undefined,
      cols: ["Settlement", "Short shares", "Change"],
      rows: res.shorts.map((r) => ({
        cells: [String(r.traded), compact(Number(r.shares)), `${r.change || "—"}%`],
        href: String(r.link)
      }))
    }
  ];
  const marks: ChartMark[] = [
    ...res.congress.slice(0, 10).map((r) => ({
      t: Date.parse(String(r.traded)),
      label: `${String(r.person).split(" ").slice(-1)[0]} ${r.side}`,
      tone: r.side === "buy" ? "buy" as const : r.side === "sell" ? "sell" as const : undefined
    })),
    ...res.insiders.filter((r) => r.code === "P" || r.code === "S").slice(0, 6).map((r) => ({
      t: Date.parse(String(r.traded)),
      label: `F4 ${String(r.person).split(" ")[0]} ${r.code}`,
      tone: r.code === "P" ? "buy" as const : "sell" as const
    }))
  ].filter((m) => Number.isFinite(m.t));
  const newest = <T extends { traded?: string; filed?: string }>(rows: T[]) => [...rows].sort((a, b) => String(b.traded || "").localeCompare(String(a.traded || "")) || String(b.filed || "").localeCompare(String(a.filed || "")))[0];
  const lastBuyer = newest(buys);
  const lastInsider = newest(res.insiders.filter((r) => r.code === "P"));
  return {
    marks,
    model: {
      title: `${res.symbol} positions${res.name ? ` · ${res.name}` : ""}`,
      watch: res.inJoin ? res.symbol : undefined,
      source: "House Clerk PTRs · Senate eFD · SEC Form 4 · SEC 13F · FINRA short interest · FEC bulk PAC file",
      meta: "Every filer on this symbol across Congress, insiders, 13F funds, and FINRA. Click a row for the member or the filing.",
      rows: [
        { label: "Congress", value: `${members.size} members · ${buys.length} buys · ${sells.length} sales` },
        { label: "Last buy", value: `${latest(buys, "traded")} traded · last sale ${latest(sells, "traded")}` },
        { label: "PAC gifts", value: pacs.length ? `${pacs.length} to these members in 2 years · $${pacs.reduce((a, r) => a + Number(r.amount || 0), 0).toLocaleString()}` : "None from joined PACs" },
        { label: "Avg lag", value: lags.length ? `${Math.round(lags.reduce((a, b) => a + b, 0) / lags.length)} days` : "—" },
        { label: "Last filed", value: String(res.congress[0]?.filed || "—") },
        { label: "Insiders", value: insiderGap ? `Not scanned · ${insiderGap}` : `${res.insiders.filter((r) => r.code === "P").length} buys · ${res.insiders.filter((r) => r.code === "S").length} sales · ${res.insiders.length} lines` },
        { label: "Funds", value: `${res.whales.filter((r) => Number(r.shares) > 0).length} holders · ${res.whales.filter((r) => r.side === "buy").length} added · ${res.whales.filter((r) => r.side === "sell").length} cut` }
      ],
      links: ([
        ...(lastBuyer ? [{ label: "Last buyer · Congress", value: `${lastBuyer.person}${lastBuyer.party ? ` (${lastBuyer.party})` : ""} · ${lastBuyer.amount || ""} · traded ${lastBuyer.traded || "—"}, filed ${lastBuyer.filed || "—"}`, action: lastBuyer.bioguide ? `member:${lastBuyer.bioguide}` : undefined }] : []),
        ...(lastInsider ? [{ label: "Last buyer · Insider", value: `${lastInsider.person} · traded ${lastInsider.traded || "—"}, filed ${lastInsider.filed || "—"}`, href: lastInsider.link ? String(lastInsider.link) : undefined }] : []),
        ...(res.inJoin ? [{ label: "Chart", value: `${res.symbol} with trades marked`, action: `chart:${res.symbol}` }] : [{ label: "Chart", value: "Not in data/tickers.json, so no chart join" }]),
        { label: "Supply chain", value: `${res.symbol} suppliers and customers`, action: `supply:${res.symbol}` }
      ] as DrawerLink[]),
      tables
    }
  };
}

const LOBBY_TITLE = "Lobbying (LDA)";
type Lobby = { missing?: string; error?: string; deferred?: boolean; client?: string; filings?: { registrant: string; income: number | null; expenses: number | null; posted: string }[] };

function lobbyLines(lobby: Lobby | undefined) {
  if (lobby?.missing) return [`Set ${lobby.missing}`];
  if (lobby?.deferred) return ["Loading LDA.gov filings… LDA.gov takes 10–30 s on a cold client query."];
  if (lobby?.error) return [`LDA.gov ${lobby.error}`];
  const filings = lobby?.filings || [];
  return filings.length ? filings.slice(0, 4).map((f) => `${f.registrant} · income ${money(f.income)} · expenses ${money(f.expenses)}`) : ["No LDA filings this year for this client."];
}

/** Instant dossier for `symbol` while `/api/tickers/:symbol` loads: header, case file, and the links that need only the symbol. */
export function tickerShell(symbol: string, name = ""): DrawerModel {
  const loading = ["Loading…"];
  return {
    title: `${symbol}${name ? ` ${name}` : ""}`,
    meta: "Loading quote, positions, and joins…",
    watch: symbol,
    caseKey: `ticker:${symbol}`,
    rows: [],
    links: [
      { label: "Positions", value: `${symbol} · every filer`, action: `pos:${symbol}` },
      { label: "Supply chain", value: `${symbol} · suppliers, customers, co-movement`, action: `supply:${symbol}` },
      { label: "Contracts", value: `${symbol} · federal contract actions`, action: `contracts:symbol:${symbol}` },
      { label: "Map", value: `${symbol} · trades, contracts, PAC arcs on the Congress map`, action: `scope:symbol:${symbol}` }
    ],
    blocks: [LOBBY_TITLE, "PAC receipts (FEC)", "Federal contracts, last 180 days (USAspending)"].map((title) => ({ title, lines: loading }))
  };
}

/** LDA.gov lines for a dossier whose ticker response deferred lobbying. */
export async function loadLobby(client: string): Promise<string[]> {
  try {
    return lobbyLines(await api<Lobby>(`/api/lobby?client=${encodeURIComponent(client)}`));
  } catch (err) {
    return [`LDA.gov did not answer: ${(err as Error).message}`];
  }
}

export function withLobby(model: DrawerModel, lines: string[]): DrawerModel {
  return { ...model, blocks: model.blocks?.map((b) => (b.title === LOBBY_TITLE ? { ...b, lines } : b)) };
}

/** `lobbyClient` is set when lobbying was deferred; pass it to `loadLobby`. */
export async function loadDossier(symbol: string): Promise<(DrawerModel & { lobbyClient?: string }) | null> {
  const res = await api<{
    ok: boolean;
    ticker?: { symbol: string; name: string; districts: string[]; ldaClients?: string[]; pacs?: string[]; recipients?: string[]; joinBasis?: JoinBasis | null; core?: boolean };
    lobby?: Lobby;
    fec?: {
      missing?: string;
      error?: string;
      note?: string;
      committees?: { name: string; receipts: number | null; disbursements?: number | null; coverageEnd?: string | null }[];
    };
    contracts?: { note?: string; error?: string; awards?: { recipient: string; amount: number; agency: string; description: string; date?: string; start?: string }[] };
    quote?: { last: number | null; change: number | null; changePct: number | null; asOf: string } | null;
    positions?: Positions | null;
    seats?: { code: string; members: { bioguide: string; name: string; party: string; district: string }[] }[];
    hq?: { city: string; state: string; district: string | null; foreign: boolean; country?: string; note: string } | null;
  }>(DEMO ? `/api/tickers/${symbol}` : `/api/tickers/${symbol}?lobby=0`);
  if (!res.ok || !res.ticker) return null;
  const last = res.quote?.last;
  const change = res.quote?.change;
  const seats = res.seats || [];
  const pos = res.positions;
  const hq = res.hq;
  const hqPlace = hq ? (hq.foreign ? `${hq.city}, ${hq.country || hq.state} · outside the US` : `${hq.city}, ${hq.state}${hq.district ? ` · ${hq.district}` : ""}`) : "";
  return {
    lobbyClient: res.lobby?.deferred ? res.lobby.client : undefined,
    title: `${res.ticker.symbol} ${res.ticker.name}`,
    meta: res.ticker.districts.join(", "),
    watch: res.ticker.symbol,
    caseKey: `ticker:${res.ticker.symbol}`,
    source: "Nasdaq quote · House Clerk / Senate eFD · SEC Form 4 · LDA.gov · FEC · USAspending · SEC EDGAR business address · join table data/tickers.json",
    rows: [
      {
        label: "Last",
        value: last == null ? "—" : `${last.toFixed(2)}${change == null ? "" : `  ${change >= 0 ? "+" : ""}${change.toFixed(2)}`}`
      },
      { label: "As of", value: when(res.quote?.asOf) },
      { label: "Congress", value: pos ? `${new Set(pos.congress.map((r) => r.bioguide || r.person)).size} members · ${pos.congress.length} lines` : "—" },
      { label: "Insiders", value: !pos ? "—" : notScanned(pos, "insiders") ? `Not scanned · ${notScanned(pos, "insiders")}` : `${pos.insiders.length} Form 4 lines` },
      ...(hq ? [{ label: "HQ", value: hq.district || hq.foreign ? hqPlace : `${hqPlace} · ${hq.note}` }] : [])
    ],
    links: [
      ...(hq && !hq.foreign ? [{ label: "HQ", value: hq.district ? `${hq.district} · district, representative, senators on the map` : `${hq.state} · senators`, action: `hq:${res.ticker.symbol}` }] : []),
      { label: "Positions", value: `${res.ticker.symbol} · every filer`, action: `pos:${res.ticker.symbol}` },
      { label: "Supply chain", value: `${res.ticker.symbol} · suppliers, customers, co-movement`, action: `supply:${res.ticker.symbol}` },
      { label: "Contracts", value: `${res.ticker.symbol} · federal contract actions`, action: `contracts:symbol:${res.ticker.symbol}` },
      { label: "Map", value: `${res.ticker.symbol} · trades, contracts, PAC arcs on the Congress map`, action: `scope:symbol:${res.ticker.symbol}` },
      ...seats.flatMap((seat) => seat.members.length
        ? seat.members.map((member) => ({
            label: seat.code,
            value: `${member.name}${member.party ? ` · ${member.party}` : ""}`,
            action: `member:${member.bioguide}`
          }))
        : [{ label: seat.code, value: "No current House member on the 119th list" }])
    ],
    blocks: [
      { title: LOBBY_TITLE, lines: lobbyLines(res.lobby) },
      {
        title: "PAC receipts (FEC)",
        lines: res.fec?.missing
          ? [`Set ${res.fec.missing}. This is separate from lobbying spend.`]
          : res.fec?.committees?.length
            ? [
                ...res.fec.committees.slice(0, 4).map((c) => `${c.name} · raised ${money(c.receipts)} · spent ${money(c.disbursements)}${c.coverageEnd ? ` · through ${c.coverageEnd}` : ""}`),
                res.fec.note || ""
              ].filter(Boolean)
            : [res.fec?.note || res.fec?.error || "No FEC data."]
      },
      {
        title: "Federal contracts, last 180 days (USAspending)",
        lines: res.contracts?.awards?.length
          ? [
              ...res.contracts.awards.slice(0, 4).map((a) => `${a.date || a.start || ""} · ${money(a.amount)} · ${a.agency} · ${a.description || a.recipient}`),
              "DoD actions reach USAspending about 90 days after award."
            ]
          : [res.contracts?.note || res.contracts?.error || "No contract actions in the window."]
      },
      {
        title: "How this ticker is joined",
        lines: joinLines(res.ticker)
      }
    ]
  };
}

type JoinBasis = { auto?: boolean; derived?: string; secName?: string; district?: string; lda?: string; pacs?: string; recipients?: string };

function joinLines(ticker: { ldaClients?: string[]; pacs?: string[]; recipients?: string[]; joinBasis?: JoinBasis | null; core?: boolean }) {
  const basis = ticker.joinBasis;
  const names = `LDA clients: ${ticker.ldaClients?.join(", ") || "none"} · PACs: ${ticker.pacs?.join(", ") || "none"} · contract names: ${ticker.recipients?.join(", ") || "none"}`;
  if (!basis) return [ticker.core === false ? "Quotes only. No lobbying, PAC, contract, or district join yet." : "Hand-curated in data/tickers.json.", names];
  return [
    `Derived ${basis.derived || ""} by scripts/joins.mjs from SEC filer "${basis.secName || ""}"`,
    `District: ${basis.district || "—"}`,
    `Lobbying: ${basis.lda || "—"}`,
    `PACs: ${basis.pacs || "—"}`,
    names
  ];
}

export function compact(value: number) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs}`;
}
