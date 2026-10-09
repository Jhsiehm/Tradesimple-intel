import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, when } from "../lib/api";
import { fitCard, rememberSpot, useStageBox, type Box, type Rect } from "./cardBounds";
import { startDrag } from "./useDrag";
import { usePhone } from "./usePhone";
import "./widgets.css";
import type { Chamber, DrawerModel } from "../types";
import { Drawer } from "./Drawer";
import { LastBuysPanel, WatchPanel, WirePanel, XPanel, type PanelKind } from "./Panels";
import { GlobalBoard } from "../markets/GlobalBoard";
import { SupplyBoard } from "../markets/SupplyBoard";
import { toggleMember, useWatch } from "../lib/useWatch";
import { CaseHeader } from "../intel/CaseHeader";
import { CaseSection } from "../intel/CaseSection";
import { Icon, IconLabel } from "../ui/icons/Icon";

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
  z?: number;
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
  const box = useStageBox();
  const phone = usePhone();
  const top = Math.max(0, ...cards.map((c) => c.z || 0));
  const raise = (card: WidgetCard) => { if ((card.z || 0) < top) onChange(card.id, { z: top + 1 }); };

  if (phone) {
    const open = cards.filter((c) => !c.min).sort((a, b) => (b.z || 0) - (a.z || 0))[0];
    return (
      <div className="widgets phone">
        {open ? <div className="widget-scrim" onClick={() => onChange(open.id, { min: true })} /> : null}
        <div className="widget-dock">
          {cards.length > (open ? 1 : 0) ? (
            <div className="widget-tray" role="toolbar" aria-label="Pinned cards">
              {cards.filter((c) => c !== open).map((c) => (
                <span key={c.id} className="widget-chip">
                  <button className="widget-chip-open" aria-label={`Open ${c.title}`} onClick={() => onChange(c.id, { min: false })}>{c.title}</button>
                  <button className="widget-btn" aria-label={`Close ${c.title}`} onClick={() => onClose(c.id)}><Icon name="close" /></button>
                </span>
              ))}
            </div>
          ) : null}
          {open ? <Widget key={open.id} card={open} box={box} sheet onChange={onChange} onClose={onClose} onFollow={onFollow} onRaise={() => raise(open)} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="widgets">
      {cards.map((card) => (
        <Widget key={card.id} card={card} box={box} onChange={onChange} onClose={onClose} onFollow={onFollow} onRaise={() => raise(card)} />
      ))}
    </div>
  );
}

function Widget({
  card,
  box,
  sheet,
  onChange,
  onClose,
  onFollow,
  onRaise
}: {
  card: WidgetCard;
  box: Box;
  sheet?: boolean;
  onChange: (id: string, next: Partial<WidgetCard>) => void;
  onClose: (id: string) => void;
  onFollow: (action: string) => void;
  onRaise: () => void;
}) {
  const [live, setLive] = useState<Rect | null>(null);
  const r = live || fitCard(card, box, card.min);
  const toggle = () => onChange(card.id, { min: !card.min });

  function move(event: ReactPointerEvent) {
    if (sheet || (event.target as HTMLElement).closest("button, a, input, select")) return;
    const from = fitCard(card, box, card.min);
    let last = from;
    startDrag(event, (dx, dy) => {
      last = fitCard({ ...from, x: from.x + dx, y: from.y + dy }, box, card.min);
      setLive(last);
    }, (moved) => {
      setLive(null);
      if (moved) {
        onChange(card.id, { x: last.x, y: last.y });
        rememberSpot(card.id, last);
      } else if (card.min) toggle();
    });
  }

  function resize(event: ReactPointerEvent, edge: "se" | "e" | "s" | "w" = "se") {
    event.stopPropagation();
    event.preventDefault();
    const from = fitCard(card, box);
    let last = from;
    startDrag(event, (dx, dy) => {
      if (edge === "w") {
        const w = Math.max(260, Math.min(from.w - dx, from.x + from.w - box.left));
        last = fitCard({ ...from, x: from.x + from.w - w, w }, box);
      } else {
        last = fitCard({
          ...from,
          w: edge === "s" ? from.w : Math.min(from.w + dx, box.right - from.x),
          h: edge === "e" ? from.h : Math.min(from.h + dy, box.bottom - from.y)
        }, box);
      }
      setLive(last);
    }, (moved) => {
      setLive(null);
      if (!moved) return;
      onChange(card.id, last);
      rememberSpot(card.id, last);
    });
  }

  return (
    <article
      className={`widget${card.pinned ? " pinned" : ""}${card.min ? " min" : ""}${sheet ? " sheet" : ""}${live ? " moving" : ""}`}
      style={sheet ? undefined : { left: r.x, top: r.y, width: card.min ? undefined : r.w, height: card.min ? undefined : r.h, zIndex: (card.min ? 1000 : 0) + (card.z || 0) }}
      tabIndex={-1}
      aria-label={card.title}
      onPointerDownCapture={onRaise}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose(card.id);
      }}
    >
      <header
        className="widget-bar"
        onPointerDown={move}
        onDoubleClick={card.min || sheet ? undefined : toggle}
        title={sheet ? undefined : card.min ? "Click to open · drag to move" : "Drag to move · double-click to collapse"}
      >
        {sheet ? null : <span className="widget-grip" aria-hidden="true"><Icon name="grip" /></span>}
        <strong>{card.title}</strong>
        <button className="widget-btn" aria-label={card.min ? `Expand ${card.title}` : `Collapse ${card.title}`} title={card.min ? "Expand" : "Collapse to a chip"} onClick={toggle}><Icon name={card.min ? "expand" : "collapse"} /></button>
        {card.min || sheet ? null : (
          <button className="widget-btn pin" aria-pressed={card.pinned} aria-label={card.pinned ? "Unpin: drop this card when the view changes" : "Pin: keep this card across views"} title={card.pinned ? "Pinned: kept across views and reloads" : "Not pinned: closes when the view changes"} onClick={() => onChange(card.id, { pinned: !card.pinned })}><IconLabel icon="pin" hide>{card.pinned ? "Pinned" : "Pin"}</IconLabel></button>
        )}
        <button className="widget-btn close" aria-label={`Close ${card.title}`} title="Close (Esc)" onClick={() => onClose(card.id)}><Icon name="close" /></button>
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
          {sheet ? null : (
            <>
              <span className="widget-edge e" onPointerDown={(e) => resize(e, "e")} />
              <span className="widget-edge w" onPointerDown={(e) => resize(e, "w")} />
              <span className="widget-edge s" onPointerDown={(e) => resize(e, "s")} />
              <button className="widget-resize" aria-label={`Resize ${card.title}`} title="Drag to resize" onPointerDown={(e) => resize(e)} />
            </>
          )}
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
      <CaseHeader caseKey={`member:${bioguide}`} />
      <div className="member-top">
        {broken ? <div className="member-photo missing">{member.party || "?"}</div> : (
          <img className="member-photo" src={member.photo} alt="" onError={() => setBroken(true)} />
        )}
        <div>
          <h2>
            {member.name}
            <button className={hasMember(bioguide) ? "star on" : "star"} title={hasMember(bioguide) ? "Remove from watchlist" : "Add to watchlist"} onClick={() => toggleMember({ bioguide, name: member.name, chamber })} aria-label={hasMember(bioguide) ? "Remove from watchlist" : "Add to watchlist"}><Icon name={hasMember(bioguide) ? "star-on" : "star"} /></button>
          </h2>
          <p>{member.party || "—"} · {member.state}{member.district ? `-${member.district}` : ""} · {member.chamber || chamber}</p>
          {member.leadership?.length ? (
            <p className="member-roles">{member.leadership.map((r) => <span key={r.title}>{r.title}</span>)}</p>
          ) : null}
          <p>{member.served}{member.since ? ` · since ${member.since.slice(0, 4)}` : ""}{member.termEnds ? ` · term ends ${member.termEnds}` : ""}</p>
          {member.stateRank || member.senateClass ? <p>{member.stateRank ? `${member.stateRank[0].toUpperCase()}${member.stateRank.slice(1)} senator` : ""}{member.senateClass ? ` · class ${member.senateClass}` : ""}</p> : null}
          <p className="member-links">
            <button className="member-timeline" onClick={() => onFollow(`timeline:${bioguide}`)}><IconLabel icon="timeline">Timeline</IconLabel></button>
            <button className="member-timeline" onClick={() => onFollow(`bt:member:${bioguide}`)} title="Replay their disclosed buys: entry the day after each filing, against the S&P 500"><IconLabel icon="backtest">Backtest</IconLabel></button>
            <button className="member-timeline" onClick={() => onFollow(`scope:member:${bioguide}`)} title="Scope the map's time scrubber and arcs to this member"><IconLabel icon="arc">Map</IconLabel></button>
            <button className="member-timeline" onClick={() => onFollow(`contracts:member:${bioguide}`)} title="Federal contract actions performed in this member's district (state for senators)"><IconLabel icon="contracts">Contracts</IconLabel></button>
            <a href={member.url} target="_blank" rel="noreferrer">Official site</a>
            <a href={`https://bioguide.congress.gov/search/bio/${member.bioguide}`} target="_blank" rel="noreferrer">Bioguide</a>
            {member.contact ? <a href={member.contact} target="_blank" rel="noreferrer">Contact</a> : null}
            {member.phone ? <span>{member.phone}</span> : null}
          </p>
        </div>
      </div>
      <p className="note">{profile.latency}</p>
      <p className="note">Source {profile.source} · {when(profile.asOf)}</p>
      <CaseSection kind="member" title="Trades" count={tradeCount(trades)}>
        {trades === null ? <p className="note">Loading parsed periodic transaction reports…</p> : trades.length ? (
          <table className="dt">
            <thead>
              <tr><th>Sym</th><th>Side</th><th>Amount</th><th>Traded</th><th>Filed</th><th>Lag</th><th>Filing</th></tr>
            </thead>
            <tbody>
              {trades.slice(0, 40).map((t) => (
                <tr key={t.id} className={`live tone-${t.side === "buy" ? "up" : t.side === "sell" ? "down" : ""}`} onClick={() => onFollow(`pos:${t.symbol}`)}>
                  <td>{t.symbol}</td><td>{t.type}</td><td>{t.amount}</td><td>{t.traded}</td><td>{t.filed}</td><td>{t.lag == null ? "—" : `${t.lag}d`}</td>
                  <td>{t.link ? <a className="dt-filing" href={t.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the original disclosure"><IconLabel icon="external">View</IconLabel></a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="note">No parsed trade lines in the recent House Clerk and Senate eFD window.</p>}
      </CaseSection>
      <CaseSection kind="member" title="Votes" count={profile.votes?.length || 0}>
        <p className="member-pattern">
          Yea {pattern.Yea || 0} · Nay {pattern.Nay || 0} · Present {pattern.Present || 0} · Not voting {pattern["Not voting"] || 0}
        </p>
        {(profile.votes || []).map((vote) => (
          <button key={vote.id} className="member-vote" onClick={() => onFollow(`vote:${vote.id}`)}>
            <b className={vote.vote === "Yea" ? "up" : vote.vote === "Nay" ? "down" : ""}>{vote.vote}</b>
            <span>{(vote.question || vote.bill || "Roll call").replace(/<[^>]+>/g, "")}</span>
            <small>{vote.result} · {(vote.date || "").slice(0, 10)}</small>
          </button>
        ))}
      </CaseSection>
      <CaseSection kind="member" title="Committees" count={profile.committees?.length || 0}>
        {(profile.committees || []).length ? (profile.committees || []).map((c) => (
          <button key={c.id} className="member-vote" onClick={() => onFollow(`committee:${c.id}`)}>
            <b>{c.title || c.side}</b>
            <span>{c.name}</span>
          </button>
        )) : <p className="note">No assignments on the current list.</p>}
      </CaseSection>
      <CaseSection kind="member" title="PAC money" count={profile.pacs?.cycle ? `${profile.pacs.cycle} cycle` : ""}>
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
      </CaseSection>
    </div>
  );
}

/** The case header counts trades since the intel window opened (2025-01-03); say so when the card lists older ones. */
function tradeCount(trades: Trade[] | null) {
  if (!trades) return "…";
  const recent = trades.filter((t) => t.traded >= "2025-01-03").length;
  return recent === trades.length ? String(recent) : `${recent} since Jan 2025 · ${trades.length} on file`;
}

function usdShort(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}
