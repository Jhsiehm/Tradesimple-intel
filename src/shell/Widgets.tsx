import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, when } from "../lib/api";
import type { Chamber, DrawerModel } from "../types";
import { Drawer } from "./Drawer";
import { LastBuysPanel, WatchPanel, WirePanel, XPanel, type PanelKind } from "./Panels";
import { GlobalBoard } from "../markets/GlobalBoard";
import { SupplyBoard } from "../markets/SupplyBoard";
import { toggleMember, useWatch } from "../lib/useWatch";

export type WidgetCard = {
  id: string;
  title: string;
  pinned: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  model?: DrawerModel;
  memberId?: string;
  chamber?: Chamber;
  kind?: PanelKind;
  symbol?: string;
  min?: boolean;
};

type MemberView = {
  ok: boolean;
  error?: string;
  missing?: string;
  source?: string;
  asOf?: string;
  latency?: string;
  member?: {
    bioguide: string;
    name: string;
    party: string;
    state: string;
    district: string;
    chamber: string;
    photo: string;
    url: string;
    served: string;
    leadership?: { title: string; since: string }[];
    since?: string;
    termEnds?: string;
    stateRank?: string;
    senateClass?: number | null;
    birthday?: string;
    phone?: string;
    office?: string;
    contact?: string;
  };
  pacs?: MemberPacs;
  pattern?: Record<string, number>;
  votes?: { id: string; question: string; result: string; date: string; bill: string; vote: string }[];
  committees?: { id: string; name: string; title: string; side: string }[];
};

type PacGift = { pac: string; pacName: string; orgType: string; symbol: string; amount: number; date: string; filed: string; lag: number | null; link: string };
type MemberPacs = {
  loading?: boolean;
  cycle?: number;
  total?: number;
  count?: number;
  pacs?: number;
  latency?: string;
  top?: { pac: string; pacName: string; orgType: string; symbol: string; total: number; count: number; last: string }[];
  recent?: PacGift[];
};

type Trade = { id: string; symbol: string; side: string; type: string; amount: string; traded: string; filed: string; lag: number | null; link: string };

export function WidgetLayer({
  cards,
  onChange,
  onClose,
  onFollow
}: {
  cards: WidgetCard[];
  onChange: (id: string, next: Partial<WidgetCard>) => void;
  onClose: (id: string) => void;
  onFollow: (action: string) => void;
}) {
  return (
    <div className="widgets">
      {cards.map((card) => (
        <Widget key={card.id} card={card} onChange={onChange} onClose={onClose} onFollow={onFollow} />
      ))}
    </div>
  );
}

function Widget({
  card,
  onChange,
  onClose,
  onFollow
}: {
  card: WidgetCard;
  onChange: (id: string, next: Partial<WidgetCard>) => void;
  onClose: (id: string) => void;
  onFollow: (action: string) => void;
}) {
  function drag(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: card.x, y: card.y };
    const move = (ev: PointerEvent) => {
      onChange(card.id, clampCard({ ...card, x: origin.x + ev.clientX - startX, y: origin.y + ev.clientY - startY }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function resize(event: ReactPointerEvent, edge: "se" | "e" | "s" | "w" = "se") {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: card.x, w: card.w, h: card.h };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (edge === "w") {
        const w = Math.max(280, origin.w - dx);
        onChange(card.id, clampCard({ ...card, x: origin.x + origin.w - w, w }));
        return;
      }
      onChange(card.id, clampCard({ ...card, w: edge === "s" ? origin.w : origin.w + dx, h: edge === "e" ? origin.h : origin.h + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <article
      className={`widget${card.pinned ? " pinned" : ""}${card.min ? " min" : ""}`}
      style={{ left: card.x, top: card.y, width: card.w, height: card.min ? undefined : card.h }}
    >
      <header className="widget-bar" onPointerDown={drag} onDoubleClick={() => onChange(card.id, { min: !card.min })}>
        <span>{card.pinned ? "PINNED" : "CARD"}</span>
        <strong>{card.title}</strong>
        <button className="ghost" title={card.min ? "Expand" : "Collapse to title bar"} onClick={() => onChange(card.id, { min: !card.min })}>{card.min ? "▢" : "–"}</button>
        <button className="ghost" onClick={() => onChange(card.id, { pinned: !card.pinned })}>{card.pinned ? "Unpin" : "Pin"}</button>
        <button className="ghost" onClick={() => onClose(card.id)}>Close</button>
      </header>
      {card.min ? null : (
        <>
          <div className="widget-body">
            {card.memberId ? <MemberCard bioguide={card.memberId} chamber={card.chamber || "house"} onFollow={onFollow} /> : null}
            {card.model ? <Drawer model={card.model} onClose={() => onClose(card.id)} onFollow={onFollow} embedded /> : null}
            {card.kind === "watch" ? <WatchPanel onFollow={onFollow} /> : null}
            {card.kind === "x" ? <XPanel onFollow={onFollow} /> : null}
            {card.kind === "lastbuy" ? <LastBuysPanel onFollow={onFollow} /> : null}
            {card.kind === "wire" ? <WirePanel onFollow={onFollow} /> : null}
            {card.kind === "globals" ? <GlobalBoard compact onOpen={(s) => onFollow(`inst:${s}`)} /> : null}
            {card.kind === "supply" ? <SupplyBoard compact symbol={card.symbol || "AAPL"} onSymbol={(s) => onChange(card.id, { symbol: s, title: `Supply chain · ${s}` })} onOpen={onFollow} /> : null}
          </div>
          <span className="widget-edge e" onPointerDown={(e) => resize(e, "e")} />
          <span className="widget-edge w" onPointerDown={(e) => resize(e, "w")} />
          <span className="widget-edge s" onPointerDown={(e) => resize(e, "s")} />
          <button className="widget-resize" aria-label="Resize card" onPointerDown={(e) => resize(e)} />
        </>
      )}
    </article>
  );
}

function MemberCard({ bioguide, chamber, onFollow }: { bioguide: string; chamber: Chamber; onFollow: (action: string) => void }) {
  const [profile, setProfile] = useState<MemberView | null>(null);
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [broken, setBroken] = useState(false);
  const { hasMember } = useWatch();

  useEffect(() => {
    let cancel = false;
    setBroken(false);
    api<MemberView>(`/api/congress/member/${bioguide}?chamber=${chamber}`)
      .then((res) => { if (!cancel) setProfile(res); })
      .catch((err: Error) => { if (!cancel) setProfile({ ok: false, error: err.message }); });
    api<{ ok: boolean; items: Trade[] }>(`/api/congress/member/${bioguide}/trades`)
      .then((res) => { if (!cancel) setTrades(res.items || []); })
      .catch(() => { if (!cancel) setTrades([]); });
    return () => { cancel = true; };
  }, [bioguide, chamber]);

  if (!profile) return <p className="note">Loading member record…</p>;
  if (!profile.ok || !profile.member) return <p className="note">{profile.missing ? `Set ${profile.missing}` : profile.error || "No member record."}</p>;
  const member = profile.member;
  const pattern = profile.pattern || {};

  return (
    <div className="member">
      <div className="member-top">
        {broken ? <div className="member-photo missing">{member.party || "?"}</div> : (
          <img className="member-photo" src={member.photo} alt="" onError={() => setBroken(true)} />
        )}
        <div>
          <h2>
            {member.name}
            <button className={hasMember(bioguide) ? "star on" : "star"} title={hasMember(bioguide) ? "Remove from watchlist" : "Add to watchlist"} onClick={() => toggleMember({ bioguide, name: member.name, chamber })}>{hasMember(bioguide) ? "★" : "☆"}</button>
          </h2>
          <p>{member.party || "—"} · {member.state}{member.district ? `-${member.district}` : ""} · {member.chamber || chamber}</p>
          {member.leadership?.length ? (
            <p className="member-roles">{member.leadership.map((r) => <span key={r.title}>{r.title}</span>)}</p>
          ) : null}
          <p>{member.served}{member.since ? ` · since ${member.since.slice(0, 4)}` : ""}{member.termEnds ? ` · term ends ${member.termEnds}` : ""}</p>
          {member.stateRank || member.senateClass ? <p>{member.stateRank ? `${member.stateRank[0].toUpperCase()}${member.stateRank.slice(1)} senator` : ""}{member.senateClass ? ` · class ${member.senateClass}` : ""}</p> : null}
          <p className="member-links">
            <button className="member-timeline" onClick={() => onFollow(`timeline:${bioguide}`)}>Timeline ▸</button>
            <a href={member.url} target="_blank" rel="noreferrer">Official site</a>
            <a href={`https://bioguide.congress.gov/search/bio/${member.bioguide}`} target="_blank" rel="noreferrer">Bioguide</a>
            {member.contact ? <a href={member.contact} target="_blank" rel="noreferrer">Contact</a> : null}
            {member.phone ? <span>{member.phone}</span> : null}
          </p>
        </div>
      </div>
      <p className="member-pattern">
        Yea {pattern.Yea || 0} · Nay {pattern.Nay || 0} · Present {pattern.Present || 0} · Not voting {pattern["Not voting"] || 0}
      </p>
      <p className="note">{profile.latency}</p>
      <p className="note">Source {profile.source} · {when(profile.asOf)}</p>
      <h3 className="member-h">Recent roll calls</h3>
      {(profile.votes || []).map((vote) => (
        <button key={vote.id} className="member-vote" onClick={() => onFollow(`vote:${vote.id}`)}>
          <b className={vote.vote === "Yea" ? "up" : vote.vote === "Nay" ? "down" : ""}>{vote.vote}</b>
          <span>{(vote.question || vote.bill || "Roll call").replace(/<[^>]+>/g, "")}</span>
          <small>{vote.result} · {(vote.date || "").slice(0, 10)}</small>
        </button>
      ))}
      <h3 className="member-h">Committees <small>{profile.committees?.length || 0}</small></h3>
      {(profile.committees || []).length ? (profile.committees || []).map((c) => (
        <button key={c.id} className="member-vote" onClick={() => onFollow(`committee:${c.id}`)}>
          <b>{c.title || c.side}</b>
          <span>{c.name}</span>
        </button>
      )) : <p className="note">No assignments on the current list.</p>}
      <h3 className="member-h">PAC money <small>{profile.pacs?.cycle ? `${profile.pacs.cycle} cycle` : ""}</small></h3>
      {profile.pacs?.loading ? <p className="note">FEC bulk file still parsing. Reopen the card in a minute.</p> : profile.pacs?.count ? (
        <>
          <p className="member-pattern">{usdShort(profile.pacs.total || 0)} from {profile.pacs.pacs} PACs · {profile.pacs.count} contributions</p>
          <table className="dt">
            <thead><tr><th>PAC</th><th>Type</th><th>Total</th><th>Gifts</th><th>Last</th></tr></thead>
            <tbody>
              {(profile.pacs.top || []).map((p) => (
                <tr key={p.pac} className="live" onClick={() => (p.symbol ? onFollow(`pos:${p.symbol}`) : window.open(`https://www.fec.gov/data/committee/${p.pac}/`, "_blank"))}>
                  <td>{p.pacName}{p.symbol ? <small className="tag"> {p.symbol}</small> : null}</td><td>{p.orgType || "—"}</td><td>{usdShort(p.total)}</td><td>{p.count}</td><td>{p.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="member-h">Latest PAC gifts <small>given · filed · lag</small></h3>
          <table className="dt">
            <thead><tr><th>PAC</th><th>Amount</th><th>Given</th><th>Filed</th><th>Lag</th></tr></thead>
            <tbody>
              {(profile.pacs.recent || []).slice(0, 12).map((g, i) => (
                <tr key={`${g.pac}-${g.date}-${i}`} className="live" onClick={() => g.link && window.open(g.link, "_blank")}>
                  <td>{g.pacName}</td><td>{usdShort(g.amount)}</td><td>{g.date}</td><td>{g.filed || "—"}</td><td>{g.lag == null ? "—" : `${g.lag}d`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">{profile.pacs.latency}</p>
        </>
      ) : <p className="note">No PAC contributions matched to this member in the current FEC cycle file.</p>}
      <h3 className="member-h">Disclosed trades <small>{trades ? trades.length : "…"}</small></h3>
      {trades === null ? <p className="note">Loading parsed periodic transaction reports…</p> : trades.length ? (
        <table className="dt">
          <thead>
            <tr><th>Sym</th><th>Side</th><th>Amount</th><th>Traded</th><th>Filed</th><th>Lag</th><th>Filing</th></tr>
          </thead>
          <tbody>
            {trades.slice(0, 40).map((t) => (
              <tr key={t.id} className={`live tone-${t.side === "buy" ? "up" : t.side === "sell" ? "down" : ""}`} onClick={() => onFollow(`pos:${t.symbol}`)}>
                <td>{t.symbol}</td><td>{t.type}</td><td>{t.amount}</td><td>{t.traded}</td><td>{t.filed}</td><td>{t.lag == null ? "—" : `${t.lag}d`}</td>
                <td>{t.link ? <a className="dt-filing" href={t.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the original disclosure">View ↗</a> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="note">No parsed trade lines in the recent House Clerk and Senate eFD window.</p>}
    </div>
  );
}

export function clampCard(card: WidgetCard): Partial<WidgetCard> {
  const margin = 12;
  const top = 64;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(280, card.w), Math.max(280, vw - margin * 2));
  const h = Math.min(Math.max(200, card.h), Math.max(200, vh - top - margin));
  const x = Math.min(Math.max(margin, card.x), Math.max(margin, vw - w - margin));
  const y = Math.min(Math.max(top, card.y), Math.max(top, vh - h - margin));
  return { x, y, w, h };
}

function usdShort(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
