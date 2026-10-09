import { REGIONS } from "../news/newsGlobe";
import type { Chamber, CongressMode, EarthBase, EarthSettings, EarthView, MarketLayer, NewsDesk, PartyFilter } from "../types";
import { BASE_TITLE, type MarketView } from "./sections";
import type { ContractScope, ContractSort } from "../contracts/useContracts";
import type { BillRoll } from "../congress/useCongress";
import type { DistrictLayer } from "../districts/useDistricts";
import { IconLabel, type IconName } from "../ui/icons/Icon";

export function DistrictsBar({ layer, onLayer }: { layer: DistrictLayer; onLayer: (l: DistrictLayer) => void }) {
  return (
    <span className="seg" title="What the list and map show">
      <button aria-pressed={layer === "sites"} onClick={() => onLayer("sites")}><IconLabel icon="sites">Sites</IconLabel></button>
      <button aria-pressed={layer === "hq"} onClick={() => onLayer("hq")}><IconLabel icon="hq">S&amp;P 500 HQ</IconLabel></button>
    </span>
  );
}

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
  rolls?: BillRoll[];
  rollId?: string | null;
  onRoll?: (id: string) => void;
  mapLayer: "votes" | "filings";
  onMapLayer: (l: "votes" | "filings") => void;
}) {
  const rolls = props.mode === "bills" ? props.rolls || [] : [];
  const map = props.voteView === "map";
  return (
    <>
      <span className="seg">
        <button aria-pressed={props.chamber === "house"} onClick={() => props.onChamber("house")}><IconLabel icon="house">House</IconLabel></button>
        <button aria-pressed={props.chamber === "senate"} onClick={() => props.onChamber("senate")}><IconLabel icon="senate">Senate</IconLabel></button>
      </span>
      <span className="seg">
        {(["votes", "bills", "members", "committees"] as CongressMode[]).map((m) => (
          <button key={m} aria-pressed={props.mode === m} onClick={() => props.onMode(m)}>
            <IconLabel icon={m}>{m[0].toUpperCase() + m.slice(1)}</IconLabel>
          </button>
        ))}
      </span>
      <span className="seg center-only">
        <button aria-pressed={props.voteView === "floor"} onClick={() => props.onVoteView("floor")}><IconLabel icon="floor">Floor</IconLabel></button>
        <button aria-pressed={props.voteView === "map"} onClick={() => props.onVoteView("map")}><IconLabel icon="map">Map</IconLabel></button>
      </span>
      {map ? (
        <span className="seg center-only" title="Map layer: roll-call coloring, or this week's trade filings by state">
          <button aria-pressed={props.mapLayer === "votes"} onClick={() => props.onMapLayer("votes")}><IconLabel icon="votes">Votes</IconLabel></button>
          <button aria-pressed={props.mapLayer === "filings"} onClick={() => props.onMapLayer("filings")}><IconLabel icon="filings">Filings</IconLabel></button>
        </span>
      ) : null}
      <PartyButtons party={props.party} onParty={props.onParty} />
      {rolls.length ? (
        <label className="theater roll-pick" title="Roll calls on this bill. Final passage is the default in each chamber.">
          <select value={props.rollId || ""} onChange={(e) => props.onRoll?.(e.target.value)} aria-label="Roll call">
            {props.rollId ? null : <option value="">No {props.chamber} roll call · pick one</option>}
            {rolls.map((r) => (
              <option key={r.id} value={r.id}>
                {r.chamber === "house" ? "House" : "Senate"} {r.date} · {r.question.slice(0, 60)}{r.result ? ` · ${r.result}` : ""}{r.final ? " · FINAL" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {map && props.mapLayer === "votes" ? <span className="bar-note" title={props.caption}>{props.caption}</span> : null}
    </>
  );
}

const MARKET_VIEWS: [MarketView, string, IconName][] = [
  ["board", "Equities", "board"],
  ["globals", "Global", "globe"],
  ["fx", "FX", "fx"],
  ["crypto", "Crypto", "crypto"],
  ["positions", "Positions", "positions"],
  ["supply", "Supply", "supply"],
  ["chart", "Chart", "chart"]
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
        {MARKET_VIEWS.map(([v, label, icon]) => (
          <button key={v} aria-pressed={props.view === v} onClick={() => props.onView(v)} title={label}><IconLabel icon={icon} hide>{label}</IconLabel></button>
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
        <button aria-pressed={props.view === "board"} onClick={() => props.onView("board")}><IconLabel icon="news">Board</IconLabel></button>
        <button aria-pressed={props.view === "globe"} onClick={() => props.onView("globe")}><IconLabel icon="globe">Globe</IconLabel></button>
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

const SCOPE_HINT: Record<ContractScope["kind"], string> = { all: "", symbol: "LMT", place: "TX-12 or TX", member: "G000583" };

export function ContractsBar(props: {
  scope: ContractScope;
  onScope: (s: ContractScope) => void;
  sort: ContractSort;
  onSort: (s: ContractSort) => void;
  days: number;
  onDays: (d: number) => void;
}) {
  const { scope } = props;
  return (
    <>
      <span className="seg" title="Scope">
        {(["all", "symbol", "place", "member"] as ContractScope["kind"][]).map((k) => (
          <button key={k} aria-pressed={scope.kind === k} onClick={() => props.onScope({ kind: k, value: k === scope.kind ? scope.value : "" })}>
            {k === "all" ? "All agencies" : k === "symbol" ? "Ticker" : k === "place" ? "District" : "Member"}
          </button>
        ))}
      </span>
      {scope.kind !== "all" ? (
        <form
          className="ct-scope"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("v") || "").trim().toUpperCase();
            props.onScope({ kind: scope.kind, value: v });
          }}
        >
          <input key={`${scope.kind}:${scope.value}`} name="v" defaultValue={scope.value} placeholder={SCOPE_HINT[scope.kind]} aria-label="Scope value" spellCheck={false} />
        </form>
      ) : null}
      <span className="seg" title="Order">
        <button aria-pressed={props.sort === "recent"} onClick={() => props.onSort("recent")}>Recent</button>
        <button aria-pressed={props.sort === "largest"} onClick={() => props.onSort("largest")}>Largest</button>
      </span>
      <span className="seg" title="Window">
        {[30, 90, 365].map((d) => (
          <button key={d} aria-pressed={props.days === d} onClick={() => props.onDays(d)}>{d === 365 ? "1Y" : `${d}D`}</button>
        ))}
      </span>
    </>
  );
}

export function StraitBar(props: { feed: StraitFeed; onFeed: (f: StraitFeed) => void; mil: boolean; onMil: (m: boolean) => void }) {
  return (
    <>
      <span className="seg">
        <button aria-pressed={props.feed === "ships"} onClick={() => props.onFeed("ships")}><IconLabel icon="strait">Ships</IconLabel></button>
        <button aria-pressed={props.feed === "news"} onClick={() => props.onFeed("news")}><IconLabel icon="news">News</IconLabel></button>
        <button aria-pressed={props.feed === "air"} onClick={() => props.onFeed("air")}><IconLabel icon="air">Air</IconLabel></button>
      </span>
      {props.feed === "air" ? (
        <span className="seg" title="Aircraft filter">
          <button aria-pressed={!props.mil} onClick={() => props.onMil(false)}><IconLabel icon="air">All traffic</IconLabel></button>
          <button aria-pressed={props.mil} onClick={() => props.onMil(true)}><IconLabel icon="military">Military</IconLabel></button>
        </span>
      ) : null}
    </>
  );
}

const BASE_ICON: Record<EarthBase, IconName> = { dark: "map", sat: "satellite", live: "live", daily: "daily", night: "night" };

/** `lanes` is false on views that never draw shipping lanes, so the toggle is not offered there. */
export function EarthBar({ settings, update, onBase, lanes = true }: { settings: EarthSettings; update: (next: Partial<EarthSettings>) => void; onBase: () => void; lanes?: boolean }) {
  return (
    <>
      <span className="seg" title="Projection">
        {(["2d", "globe", "3d"] as EarthView[]).map((v) => (
          <button key={v} aria-pressed={settings.view === v} title={v === "3d" ? "Pitch the camera. Zoom into a city for the building skyline." : undefined} onClick={() => update({ view: v })}>
            <IconLabel icon={v === "2d" ? "view2d" : v === "globe" ? "globe" : "cube"}>{v === "2d" ? "2D" : v === "globe" ? "Globe" : "3D"}</IconLabel>
          </button>
        ))}
      </span>
      <span className="seg" title="Imagery">
        {([["dark", "Map"], ["sat", "Mosaic"], ["live", "Live"], ["daily", "Daily"], ["night", "Night"]] as [EarthBase, string][]).map(([b, label]) => (
          <button key={b} aria-pressed={settings.base === b} onClick={() => { update({ base: b }); onBase(); }} title={BASE_TITLE[b]}><IconLabel icon={BASE_ICON[b]} hide>{label}</IconLabel></button>
        ))}
      </span>
      <span className="seg">
        <button aria-pressed={settings.labels} onClick={() => update({ labels: !settings.labels })} title="Place and border labels"><IconLabel icon="labels" hide>Labels</IconLabel></button>
        {lanes ? <button aria-pressed={settings.lanes} onClick={() => update({ lanes: !settings.lanes })} title="Shipping lanes"><IconLabel icon="lanes" hide>Lanes</IconLabel></button> : null}
      </span>
    </>
  );
}
