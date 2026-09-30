import { useEffect, useState } from "react";
import { api, when } from "../lib/api";
import { toggleMember, toggleSymbol, useWatch } from "../lib/useWatch";
import { signed, tone } from "../markets/format";

export type PanelKind = "watch" | "x" | "lastbuy" | "wire" | "globals" | "supply";

export const PANEL_TITLE: Record<PanelKind, string> = {
  watch: "Watchlist",
  x: "X pulse",
  lastbuy: "Last buyers",
  wire: "Headlines",
  globals: "Global markets",
  supply: "Supply chain"
};

function Source({ source, asOf, note }: { source?: string; asOf?: string | null; note?: string }) {
  return (
    <p className="panel-src">
      <em>SOURCE</em> {source || "—"}{asOf ? <> · <em>AS OF</em> {when(asOf)} UTC</> : null}
      {note ? <><br /><em>NOTE</em> {note}</> : null}
    </p>
  );
}

function usePoll<T>(path: string | null, every: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!path) return;
    let cancel = false;
    const load = () => api<T>(path)
      .then((res) => { if (!cancel) { setData(res); setError(""); } })
      .catch((err: Error) => { if (!cancel) setError(err.message); });
    void load();
    const timer = window.setInterval(load, every);
    return () => { cancel = true; window.clearInterval(timer); };
  }, [path, every]);
  return { data, error };
}

type BoardQuote = { symbol: string; name: string; last: number | null; changePct: number | null; asOf: string };
type Trade = { id: string; symbol: string; side: string; type: string; amount: string; traded: string; filed: string; lag: number | null };

export function WatchPanel({ onFollow }: { onFollow: (action: string) => void }) {
  const { watch } = useWatch();
  const board = usePoll<{ source: string; asOf: string; latency: string; items: BoardQuote[] }>(watch.symbols.length ? "/api/markets/board" : null, 60000);
  const [extra, setExtra] = useState<Record<string, { last: number | null; previousClose: number | null; asOf: string; source: string }>>({});
  const [trades, setTrades] = useState<Record<string, Trade | null>>({});

  const quoted = new Map((board.data?.items || []).map((q) => [q.symbol, q]));
  const missing = watch.symbols.filter((s) => !quoted.has(s));
  const missingKey = board.data ? missing.join(",") : "";

  useEffect(() => {
    if (!missingKey) return;
    let cancel = false;
    for (const s of missingKey.split(",")) {
      api<{ ok: boolean; last: number; previousClose: number; asOf: string; source: string }>(`/api/markets/chart?symbol=${encodeURIComponent(s)}&span=1d`)
        .then((r) => { if (!cancel && r.ok) setExtra((cur) => ({ ...cur, [s]: { last: r.last, previousClose: r.previousClose, asOf: r.asOf, source: r.source } })); })
        .catch(() => null);
    }
    return () => { cancel = true; };
  }, [missingKey]);

  const memberKey = watch.members.map((m) => m.bioguide).join(",");
  useEffect(() => {
    let cancel = false;
    for (const id of memberKey.split(",").filter(Boolean)) {
      api<{ items: Trade[] }>(`/api/congress/member/${id}/trades`)
        .then((r) => { if (!cancel) setTrades((cur) => ({ ...cur, [id]: r.items?.[0] || null })); })
        .catch(() => { if (!cancel) setTrades((cur) => ({ ...cur, [id]: null })); });
    }
    return () => { cancel = true; };
  }, [memberKey]);

  if (!watch.symbols.length && !watch.members.length) {
    return <p className="note">Nothing on the watchlist yet. Use ☆ on a ticker dossier, the equities board, or a member card to add it.</p>;
  }

  return (
    <div className="panel">
      {watch.symbols.length ? (
        <>
          <h3 className="member-h">Tickers <small>{watch.symbols.length}</small></h3>
          <table className="dt">
            <thead><tr><th>Sym</th><th>Last</th><th>Chg%</th><th>As of</th><th /></tr></thead>
            <tbody>
              {watch.symbols.map((s) => {
                const q = quoted.get(s);
                const x = extra[s];
                const last = q?.last ?? x?.last ?? null;
                const pct = q?.changePct ?? (x?.last != null && x.previousClose ? ((x.last - x.previousClose) / x.previousClose) * 100 : null);
                return (
                  <tr key={s} className="live" onClick={() => onFollow(`ticker:${s}`)}>
                    <td>{s}<small className="tag"> {q?.name || ""}</small></td>
                    <td>{last == null ? "…" : last.toFixed(2)}</td>
                    <td className={tone(pct)}>{signed(pct, 2, "%")}</td>
                    <td>{when(q?.asOf || x?.asOf).slice(11)}</td>
                    <td className="row-acts">
                      <button className="ghost" title="Positions" onClick={(e) => { e.stopPropagation(); onFollow(`pos:${s}`); }}>Pos</button>
                      <button className="ghost" title="Remove" onClick={(e) => { e.stopPropagation(); toggleSymbol(s); }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Source source={board.data?.source ? `${board.data.source}${missing.length ? " · Yahoo Finance chart for non-US lines" : ""}` : "Nasdaq screener"} asOf={board.data?.asOf} note={board.data?.latency} />
        </>
      ) : null}
      {watch.members.length ? (
        <>
          <h3 className="member-h">Members <small>{watch.members.length}</small></h3>
          <table className="dt">
            <thead><tr><th>Member</th><th>Latest trade</th><th>Traded</th><th>Lag</th><th /></tr></thead>
            <tbody>
              {watch.members.map((m) => {
                const t = trades[m.bioguide];
                return (
                  <tr key={m.bioguide} className="live" onClick={() => onFollow(`member:${m.bioguide}`)}>
                    <td>{m.name}</td>
                    <td className={t?.side === "buy" ? "up" : t?.side === "sell" ? "down" : ""}>{t === undefined ? "…" : t ? `${t.symbol} ${t.type} ${t.amount}` : "none parsed"}</td>
                    <td>{t?.traded || "—"}</td>
                    <td>{t?.lag == null ? "—" : `${t.lag}d`}</td>
                    <td className="row-acts"><button className="ghost" onClick={(e) => { e.stopPropagation(); toggleMember(m); }}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Source source="House Clerk PTRs · Senate eFD" note="Periodic transaction reports: members have up to 45 days to file, so the latest trade can be weeks old." />
        </>
      ) : null}
    </div>
  );
}

type Trend = { name: string; url: string; rank: number; fresh: boolean; symbol: string };
type Pulse = {
  ok: boolean;
  source: string;
  asOf: string;
  latency: string;
  trends: { us: { asOf: string | null; items: Trend[] }; world: { asOf: string | null; items: Trend[] } };
  accounts: { group: string; why: string; handles: [string, string][] }[];
  posts: { ok: boolean; missing?: string; detail?: string; error?: string; source?: string; items: { id: string; source: string; title: string; post: string; published: string; symbols: string[] }[] };
};

export function XPanel({ onFollow }: { onFollow: (action: string) => void }) {
  const { data, error } = usePoll<Pulse>("/api/news/xpulse", 10 * 60 * 1000);
  const [tab, setTab] = useState<"us" | "world" | "accounts" | "posts">("us");
  if (!data) return <p className="note">{error || "Loading X pulse…"}</p>;
  const trends = tab === "us" || tab === "world" ? data.trends[tab] : null;
  return (
    <div className="panel">
      <span className="seg panel-tabs">
        <button aria-pressed={tab === "us"} onClick={() => setTab("us")}>Trending US</button>
        <button aria-pressed={tab === "world"} onClick={() => setTab("world")}>Worldwide</button>
        <button aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>Market movers</button>
        <button aria-pressed={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
      </span>
      {trends ? (
        <>
          <ol className="trends">
            {trends.items.map((t) => (
              <li key={t.name}>
                <b>{t.rank}</b>
                <a href={t.url} target="_blank" rel="noreferrer">{t.name}</a>
                {t.fresh ? <span className="fresh">new</span> : null}
                {t.symbol ? <button className="chip" onClick={() => onFollow(`pos:${t.symbol}`)}>{t.symbol}</button> : null}
              </li>
            ))}
          </ol>
          <Source source="trends24.in hourly X trending snapshot" asOf={trends.asOf} note={data.latency} />
        </>
      ) : null}
      {tab === "accounts" ? (
        <>
          {data.accounts.map((g) => (
            <section key={g.group} className="x-group">
              <h3 className="member-h">{g.group} <small>{g.why}</small></h3>
              <p>
                {g.handles.map(([h, name]) => (
                  <a key={h} className="chip" href={`https://x.com/${h}`} target="_blank" rel="noreferrer" title={name}>@{h}</a>
                ))}
              </p>
            </section>
          ))}
          <Source source="Curated list (data/xaccounts.json)" note="Links open the account on x.com. Their posts stream into the Posts tab once an X API token is set." />
        </>
      ) : null}
      {tab === "posts" ? (
        data.posts.ok ? (
          <>
            {data.posts.items.slice(0, 40).map((p) => (
              <a key={p.id} className="x-post" href={p.post} target="_blank" rel="noreferrer">
                <b>{p.source}</b> <small>{when(p.published)}</small>
                <span>{p.title}</span>
              </a>
            ))}
            <Source source={data.posts.source} />
          </>
        ) : (
          <p className="note">
            {data.posts.missing ? `Posts need ${data.posts.missing} in .env.local (X API v2, Basic tier or higher). Public mirrors (Nitter, embed timelines) are blocked or rate-limited, so trending topics above are the live signal until a token is added.` : data.posts.error}
          </p>
        )
      ) : null}
    </div>
  );
}

type Buyer = { person: string; bioguide: string; party: string; role: string; amount: string; traded: string; filed: string; lag: number | null; link: string };
type PosRow = { symbol: string; name: string; congress: { lastBuyer: Buyer | null }; insiders: { lastBuyer: Buyer | null } };

export function LastBuysPanel({ onFollow }: { onFollow: (action: string) => void }) {
  const { data, error } = usePoll<{ source: string; asOf: string; latency: string; items: PosRow[] }>("/api/markets/positions", 5 * 60 * 1000);
  const [who, setWho] = useState<"congress" | "insiders">("congress");
  if (!data) return <p className="note">{error || "Loading positions…"}</p>;
  const rows = data.items
    .map((r) => ({ symbol: r.symbol, name: r.name, b: r[who].lastBuyer }))
    .filter((r): r is { symbol: string; name: string; b: Buyer } => Boolean(r.b))
    .sort((a, b) => String(b.b.traded).localeCompare(String(a.b.traded)))
    .slice(0, 60);
  return (
    <div className="panel">
      <span className="seg panel-tabs">
        <button aria-pressed={who === "congress"} onClick={() => setWho("congress")}>Congress</button>
        <button aria-pressed={who === "insiders"} onClick={() => setWho("insiders")}>Insiders</button>
      </span>
      <table className="dt">
        <thead><tr><th>Sym</th><th>Last buyer</th><th>Amount</th><th>Traded</th><th>Filed</th><th>Lag</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="live" onClick={() => onFollow(r.b.bioguide ? `member:${r.b.bioguide}` : `pos:${r.symbol}`)}>
              <td>{r.symbol}</td>
              <td>{r.b.person}{r.b.party ? ` (${r.b.party})` : ""}{r.b.role ? <small className="tag"> {r.b.role}</small> : null}</td>
              <td>{r.b.amount || "—"}</td>
              <td>{r.b.traded || "—"}</td>
              <td>{r.b.filed || "—"}</td>
              <td>{r.b.lag == null ? "—" : `${r.b.lag}d`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Source source={who === "congress" ? "House Clerk PTRs · Senate eFD" : "SEC Form 4 (curated join tickers)"} asOf={data.asOf} note={who === "congress" ? "Traded date is when the member traded; filed date is when it became public (up to 45 days later)." : "Form 4 is due within 2 business days of the trade."} />
    </div>
  );
}

type WireItem = { id: string; title: string; link: string; source: string; published: string; desk: string; symbols?: string[] };

export function WirePanel({ onFollow }: { onFollow: (action: string) => void }) {
  const { data, error } = usePoll<{ source: string; asOf: string; latency: string; items: WireItem[] }>("/api/news", 5 * 60 * 1000);
  const [desk, setDesk] = useState<"markets" | "world">("markets");
  if (!data) return <p className="note">{error || "Loading wires…"}</p>;
  const items = data.items.filter((i) => i.desk === desk).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 40);
  return (
    <div className="panel">
      <span className="seg panel-tabs">
        <button aria-pressed={desk === "markets"} onClick={() => setDesk("markets")}>Markets</button>
        <button aria-pressed={desk === "world"} onClick={() => setDesk("world")}>World</button>
      </span>
      {items.map((i) => (
        <a key={i.id} className="x-post" href={i.link} target="_blank" rel="noreferrer">
          <b>{i.source}</b> <small>{when(i.published)}</small>
          <span>{i.title}</span>
          {i.symbols?.length ? <span className="chips">{i.symbols.map((s) => <button key={s} className="chip" onClick={(e) => { e.preventDefault(); onFollow(`pos:${s}`); }}>{s}</button>)}</span> : null}
        </a>
      ))}
      <Source source={data.source} asOf={data.asOf} note={data.latency} />
    </div>
  );
}
