/**
 * Every HTTP route, in match order (first match wins). Pure data so scripts can read it without loading the server.
 *   samples   concrete URLs for scripts; defaults to [path] for routes without params
 *   warm      "discover" (fetched first, bodies reused) or "board" (fetched as is) by scripts/warm.mjs;
 *             templated routes are filled by the script from discovery bodies via fillRoute()
 *   snapshot  part of the fixed list scripts/snapshot.mjs freezes before enumerating entities
 */
export const MANIFEST = [
  { id: "geo", path: "/geo/:name(.*)", samples: ["/geo/states.geojson", "/geo/cd119.geojson"], warm: "board" },
  { id: "health", path: "/api/health", snapshot: true },
  { id: "tickers", path: "/api/tickers", warm: "discover", snapshot: true },
  { id: "hq", path: "/api/hq" },
  { id: "hq.symbol", path: "/api/hq/:symbol([A-Za-z.\\-]+)" },
  { id: "sites", path: "/api/sites", warm: "board", snapshot: true },
  { id: "congress.bills", path: "/api/congress/bills", warm: "board", snapshot: true },
  { id: "congress.billRolls", path: "/api/congress/bills/:id/votes" },
  { id: "congress.billVote", path: "/api/congress/bills/:id/vote" },
  { id: "congress.bill", path: "/api/congress/bills/:rest(.*)" },
  { id: "congress.calendar", path: "/api/congress/calendar", warm: "board", snapshot: true },
  { id: "congress.votes", path: "/api/congress/votes", samples: ["/api/congress/votes?chamber=house", "/api/congress/votes?chamber=senate"], warm: "discover", snapshot: true },
  { id: "congress.vote", path: "/api/congress/votes/:chamber(house|senate)/:congress(\\d+)/:session(\\d+)/:roll(\\d+)" },
  { id: "congress.members", path: "/api/congress/members" },
  { id: "congress.compare", path: "/api/congress/compare" },
  { id: "congress.roster", path: "/api/congress/roster", warm: "board", snapshot: true },
  { id: "congress.committees", path: "/api/congress/committees", warm: "discover", snapshot: true },
  { id: "congress.committee", path: "/api/congress/committees/:id([A-Za-z0-9]+)" },
  { id: "congress.memberTrades", path: "/api/congress/member/:id([A-Za-z]\\d{6})/trades" },
  { id: "congress.memberTimeline", path: "/api/congress/member/:id([A-Za-z]\\d{6})/timeline" },
  { id: "congress.member", path: "/api/congress/member/:id([A-Za-z]\\d{6})" },
  { id: "lobby", path: "/api/lobby" },
  { id: "fec", path: "/api/fec" },
  { id: "contracts", path: "/api/contracts" },
  { id: "contracts.feed", path: "/api/contracts/feed", samples: ["/api/contracts/feed?sort=largest&days=30", "/api/contracts/feed?sort=recent&days=30"], warm: "board" },
  { id: "contracts.board", path: "/api/contracts/board", warm: "board" },
  { id: "contracts.dod", path: "/api/contracts/dod", warm: "board" },
  { id: "ticker", path: "/api/tickers/:symbol([A-Za-z.\\-]+)" },
  { id: "congress.leaders", path: "/api/congress/leaders", warm: "board", snapshot: true },
  { id: "congress.feed", path: "/api/congress/feed", warm: "board", snapshot: true },
  { id: "markets.politicians", path: "/api/markets/politicians", warm: "discover", snapshot: true },
  { id: "markets.insiders", path: "/api/markets/insiders", warm: "board", snapshot: true },
  { id: "markets.whales", path: "/api/markets/whales", warm: "board", snapshot: true },
  { id: "markets.shorts", path: "/api/markets/shorts", warm: "board", snapshot: true },
  { id: "markets.positions", path: "/api/markets/positions", warm: "board", snapshot: true },
  { id: "markets.position", path: "/api/markets/positions/:symbol([A-Za-z.\\-]+)" },
  { id: "news", path: "/api/news", warm: "board", snapshot: true },
  { id: "news.xpulse", path: "/api/news/xpulse", warm: "board", snapshot: true },
  { id: "markets.globals", path: "/api/markets/globals", warm: "board", snapshot: true },
  { id: "markets.supply", path: "/api/markets/supply", warm: "discover", snapshot: true },
  { id: "markets.supplyChain", path: "/api/markets/supply/:symbol([A-Za-z.\\-]+)" },
  { id: "air", path: "/api/air" },
  { id: "air.near", path: "/api/air/near" },
  { id: "air.route", path: "/api/air/route/:callsign([A-Za-z0-9]+)" },
  { id: "news.x", path: "/api/news/x", warm: "board", snapshot: true },
  { id: "markets.board", path: "/api/markets/board", warm: "board", snapshot: true },
  { id: "markets.chart", path: "/api/markets/chart", samples: ["/api/markets/chart?symbol=SPY&span=1d"], warm: "board" },
  { id: "fx.board", path: "/api/fx/board", warm: "board", snapshot: true },
  { id: "crypto.board", path: "/api/crypto/board", warm: "board", snapshot: true },
  { id: "macro.strip", path: "/api/macro/strip", warm: "board", snapshot: true },
  { id: "macro.fomc", path: "/api/macro/fomc", warm: "board" },
  { id: "calendar.macro", path: "/api/calendar/macro", samples: ["/api/calendar/macro?back=0&ahead=14", "/api/calendar/macro?back=10&ahead=35"], warm: "board", snapshot: true },
  { id: "calendar.earnings", path: "/api/calendar/earnings", warm: "board", snapshot: true },
  { id: "alerts", path: "/api/alerts", samples: ["/api/alerts?late=all"], warm: "board", snapshot: true },
  { id: "intel.scope", path: "/api/intel/scope" },
  { id: "intel.case", path: "/api/intel/case/:kind(member|ticker|district)/:id([A-Za-z0-9.\\-]+)" },
  { id: "relations.node", path: "/api/relations/node" },
  { id: "relations.expand", path: "/api/relations/expand" },
  { id: "calendar.lobbying", path: "/api/calendar/lobbying", warm: "board", snapshot: true },
  { id: "calendar.pacs", path: "/api/calendar/pacs", warm: "board", snapshot: true },
  { id: "markets.events", path: "/api/markets/events", samples: ["/api/markets/events?symbol=SPY"], warm: "board" },
  { id: "corporate", path: "/api/corporate/:kind(lobbying|pac|contracts|earnings)/:symbol([A-Za-z.\\-]+)" },
  { id: "strait.news", path: "/api/strait/news", warm: "board", snapshot: true },
  { id: "strait.ais", path: "/api/strait/ais", warm: "board", snapshot: true },
  { id: "earth.imagery", path: "/api/earth/imagery", warm: "board", snapshot: true },
  { id: "earth.live", path: "/api/earth/live", warm: "board", snapshot: true },
  { id: "earth.lanes", path: "/api/earth/lanes", warm: "board", snapshot: true },
  { id: "strait.theaters", path: "/api/strait/theaters", warm: "discover", snapshot: true },
  { id: "search", path: "/api/search" }
];

const byId = new Map(MANIFEST.map((r) => [r.id, r]));

export const samplesOf = (r) => r.samples || (r.path.includes(":") ? [] : [r.path]);

/** URLs for routes tagged `warm` with this phase, in manifest order. */
export const warmSamples = (phase) => MANIFEST.filter((r) => r.warm === phase).flatMap(samplesOf);

/** URLs for routes tagged `snapshot`. */
export const snapshotSamples = () => MANIFEST.filter((r) => r.snapshot).flatMap(samplesOf);

/** A concrete URL for route `id`: `:params` are replaced (encoded) from `params`, then `query` is appended. */
export function fillRoute(id, params = {}, query = "") {
  const route = byId.get(id);
  if (!route) throw new Error(`unknown route ${id}`);
  const path = route.path.replace(/:(\w+)(\((?:[^()]|\([^()]*\))*\))?/g, (_, name) => {
    if (params[name] == null) throw new Error(`route ${id} needs :${name}`);
    return encodeURIComponent(params[name]);
  });
  return query ? `${path}?${query}` : path;
}
