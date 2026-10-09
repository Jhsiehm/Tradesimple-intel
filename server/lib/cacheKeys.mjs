/**
 * Every SQLite cache key the server writes. Bump a key's version when its stored shape changes;
 * renaming one orphans the old rows and forces a refetch.
 */
export const KEY = {
  // Congress.gov, Senate and House clerks
  congress: (path) => `congress:${path}`,
  senateVoteMenu: (session) => `senate:vote-menu-119-${session}`,
  senateVote: (congress, session, roll) => `senate:vote:${congress}:${session}:${roll}`,
  roster: "roster:v4",
  committees: "committees:v1",
  tlMeeting: (chamber, eventId) => `tl:meet:${chamber}:${eventId}`,
  tlHouseVote: (session, roll) => `tl:vote:house:${session}:${roll}`,
  tlSenateVote: (session, roll) => `tl:vote:senate:${session}:${roll}`,
  tlSenateMenu: (congress, session) => `tl:senmenu:${congress}:${session}`,

  // Disclosures and positions
  ptr: "ptr:v1",
  posCongress: "pos:congress:v4",
  clerkIndex: (year) => `clerk:index:${year}`,
  ptrDoc: (docId) => `ptr:doc:v2:${docId}`,
  efdPtr: (href) => `efd:ptr:${href}`,
  posInsiders: (core) => `pos:insiders:v3:${core}`,
  secSubs: (cik) => `sec:subs:${cik}`,
  secForm4: (accession) => `sec:f4:v2:${accession}`,
  posWhales: "pos:whales:v3",
  sec13f: (accession, digest) => `sec:13f:v2:${accession}:${digest}`,
  posShorts: (core) => `pos:shorts:v2:${core}`,
  finra: (symbol) => `finra:${symbol}`,
  edgarJoined: (form) => `edgar:${form}:joined`,

  // Corporate: earnings, lobbying, PACs, contracts
  earningsDay: (date) => `earn:day:v1:${date}`,
  secSubsV1: (cik) => `sec:subs:v1:${cik}`,
  ldaYear: (client, year) => `lda:v2:${client.toLowerCase()}:${year}`,
  ldaBoard: "lda:board:v2",
  fecPac: "fec:pac:v3",
  usaHistory: (symbol) => `usa:hist:v2:${symbol}`,
  secRevenue: (cik) => `sec:rev:v1:${cik}`,
  lda: (client) => `lda:${client.toLowerCase()}`,
  fec: (name) => `fec:${name.toLowerCase()}`,
  fecCommittees: (cycle, ids) => `fec:cmte:v1:${cycle}:${ids.join(",")}`,
  usaFeed: (parts) => `usa:feed:v1:${JSON.stringify(parts)}`,
  usaBoard: "usa:board:v2",
  dodContracts: "dod:contracts:v1",

  // Prices and boards
  chart: (symbol, span) => `chart:v3:${symbol}:${span}`,
  screener: "board:screener:v1",
  closes: (symbol) => `closes:v1:${symbol}`,
  fxBoard: "board:fx:v1",
  cryptoBoard: "board:crypto:v1",
  geckoMarkets: "gecko:markets:v1",
  geckoGlobal: "gecko:global:v1",
  globals: "globals:v1",
  supply: (symbol) => `supply:v1:${symbol}`,

  // Macro
  fomc: "macro:fomc:v1",
  fred: (id) => `fred:${id}:v1`,
  macroStrip: "macro:strip:v2",
  econDay: (page) => `econ:day:v2:${page}`,
  econDayPrefix: "econ:day:v2:",

  // News, air, earth, strait
  newsWire: "news:wire:v3",
  newsX: "news:x:v1",
  newsXTrends: "news:xtrends:v1",
  newsSocial: "news:social:v1",
  airMil: "air:mil:v1",
  airTheater: (theaterId) => `air:pt:v1:${theaterId}`,
  airRoute: (callsign) => `air:route:v1:${callsign}`,
  earthImagery: "earth:imagery:v2",
  earthLive: "earth:live:v1",
  earthLanes: "earth:lanes:v1",
  gdeltStrait: "gdelt-strait:v1",

  hq: (symbol) => `hq:v2:${symbol}`
};
