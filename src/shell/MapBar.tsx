import { REGIONS } from "../news/newsGlobe";
import type { Chamber, CongressMode, EarthBase, EarthSettings, EarthView, MarketLayer, NewsDesk, PartyFilter } from "../types";
import { BASE_TITLE, type MarketView } from "./sections";

export function PartyButtons({ party, onParty }: { party: PartyFilter; onParty: (p: PartyFilter) => void }) {
  return (
    <span className="seg">
      {(["all", "D", "R", "I"] as PartyFilter[]).map((p) => (
        <button key={p} className={p === "D" ? "p-dem" : p === "R" ? "p-rep" : undefined} aria-pressed={party === p} onClick={() => onParty(p)}>
          {p === "all" ? "All" : p}
        </button>
      ))}
    </span>
  );
}

export function CongressBar(props: {
  chamber: Chamber;
  onChamber: (c: Chamber) => void;
  mode: CongressMode;
  onMode: (m: CongressMode) => void;
  voteView: "map" | "floor";
  onVoteView: (v: "map" | "floor") => void;
  party: PartyFilter;
  onParty: (p: PartyFilter) => void;
  caption: string;
}) {
  return (
    <>
      <span className="seg">
        <button aria-pressed={props.chamber === "house"} onClick={() => props.onChamber("house")}>House</button>
        <button aria-pressed={props.chamber === "senate"} onClick={() => props.onChamber("senate")}>Senate</button>
      </span>
      <span className="seg">
        {(["votes", "bills", "members", "committees"] as CongressMode[]).map((m) => (
          <button key={m} aria-pressed={props.mode === m} onClick={() => props.onMode(m)}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </span>
      <span className="seg center-only">
        <button aria-pressed={props.voteView === "floor"} onClick={() => props.onVoteView("floor")}>Floor</button>
        <button aria-pressed={props.voteView === "map"} onClick={() => props.onVoteView("map")}>Map</button>
      </span>
      <PartyButtons party={props.party} onParty={props.onParty} />
      {props.voteView === "map" ? <span className="bar-note" title={props.caption}>{props.caption}</span> : null}
    </>
  );
}

const MARKET_VIEWS: [MarketView, string][] = [
  ["board", "Equities"],
  ["globals", "Global"],
  ["fx", "FX"],
  ["crypto", "Crypto"],
  ["positions", "Positions"],
  ["supply", "Supply"],
  ["chart", "Chart"]
];

export function MarketsBar(props: {
  view: MarketView;
  onView: (v: MarketView) => void;
  layer: MarketLayer;
  onLayer: (l: MarketLayer) => void;
  party: PartyFilter;
  onParty: (p: PartyFilter) => void;
}) {
  return (
    <>
      <span className="seg center-only">
        {MARKET_VIEWS.map(([v, label]) => (
          <button key={v} aria-pressed={props.view === v} onClick={() => props.onView(v)}>{label}</button>
        ))}
      </span>
      <span className="seg" title="Trade list in the right panel">
        {(["politicians", "insiders", "whales", "shorts"] as MarketLayer[]).map((item) => (
          <button key={item} aria-pressed={props.layer === item} onClick={() => props.onLayer(item)}>
            {item === "politicians" ? "Congress" : item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </span>
      {props.layer === "politicians" ? <PartyButtons party={props.party} onParty={props.onParty} /> : null}
    </>
  );
}

export function NewsBar(props: {
  view: "board" | "globe";
  onView: (v: "board" | "globe") => void;
  desk: NewsDesk;
  onDesk: (d: NewsDesk) => void;
  region: string;
  onRegion: (r: string) => void;
}) {
  return (
    <>
      <span className="seg center-only">
        <button aria-pressed={props.view === "board"} onClick={() => props.onView("board")}>Board</button>
        <button aria-pressed={props.view === "globe"} onClick={() => props.onView("globe")}>Globe</button>
      </span>
      <span className="seg">
        {(["all", "world", "markets", "x"] as NewsDesk[]).map((desk) => (
          <button key={desk} aria-pressed={props.desk === desk} onClick={() => props.onDesk(desk)}>
            {desk === "x" ? "X" : desk[0].toUpperCase() + desk.slice(1)}
          </button>
        ))}
      </span>
      <label className="theater">
        <select value={props.region} onChange={(e) => props.onRegion(e.target.value)} aria-label="Region">
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
    </>
  );
}

export type StraitFeed = "ships" | "news" | "air";

export function StraitBar(props: { feed: StraitFeed; onFeed: (f: StraitFeed) => void; mil: boolean; onMil: (m: boolean) => void }) {
  return (
    <>
      <span className="seg">
        <button aria-pressed={props.feed === "ships"} onClick={() => props.onFeed("ships")}>Ships</button>
        <button aria-pressed={props.feed === "news"} onClick={() => props.onFeed("news")}>News</button>
        <button aria-pressed={props.feed === "air"} onClick={() => props.onFeed("air")}>Air</button>
      </span>
      {props.feed === "air" ? (
        <span className="seg" title="Aircraft filter">
          <button aria-pressed={!props.mil} onClick={() => props.onMil(false)}>All traffic</button>
          <button aria-pressed={props.mil} onClick={() => props.onMil(true)}>Military</button>
        </span>
      ) : null}
    </>
  );
}

export function EarthBar({ settings, update, onBase }: { settings: EarthSettings; update: (next: Partial<EarthSettings>) => void; onBase: () => void }) {
  return (
    <>
      <span className="seg" title="Projection">
        {(["2d", "globe", "3d"] as EarthView[]).map((v) => (
          <button key={v} aria-pressed={settings.view === v} onClick={() => update({ view: v })}>
            {v === "2d" ? "2D" : v === "globe" ? "Globe" : "3D"}
          </button>
        ))}
      </span>
      <span className="seg" title="Imagery">
        {([["dark", "Map"], ["sat", "Mosaic"], ["live", "Live"], ["daily", "Daily"], ["night", "Night"]] as [EarthBase, string][]).map(([b, label]) => (
          <button key={b} aria-pressed={settings.base === b} onClick={() => { update({ base: b }); onBase(); }} title={BASE_TITLE[b]}>{label}</button>
        ))}
      </span>
      <span className="seg">
        <button aria-pressed={settings.labels} onClick={() => update({ labels: !settings.labels })}>Labels</button>
        <button aria-pressed={settings.lanes} onClick={() => update({ lanes: !settings.lanes })}>Lanes</button>
      </span>
    </>
  );
}
