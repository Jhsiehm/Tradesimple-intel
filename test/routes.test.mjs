// One smoke request per API route against the real server with outbound fetch stubbed to fail, so every
// route answers from cache-less error paths without network. Pins status, JSON-ness, and top-level keys.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MANIFEST } from "../server/routes/manifest.mjs";
import { compile } from "../server/router.mjs";

const port = 20000 + Math.floor(Math.random() * 2000);
const cache = path.join(os.tmpdir(), `intel-routes-${process.pid}.sqlite`);
const base = `http://127.0.0.1:${port}`;
let server;

before(async () => {
  server = spawn(process.execPath, ["--import", "./test/fixtures/offline.mjs", "server/index.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), INTEL_CACHE: cache, INTEL_NO_WARM: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API did not start")), 10000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("intel api")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on("exit", (code) => reject(new Error(`API exited with ${code}`)));
  });
});

after(() => {
  server?.kill();
  for (const f of [cache, `${cache}-wal`, `${cache}-shm`]) fs.rmSync(f, { force: true });
});

/** [sample url, status, keys] — keys are the sorted top-level JSON keys, or a content type for non-JSON. */
export const SMOKE = [
  ["/geo/states.geojson", 200, "application/geo+json"],
  ["/geo/nope.geojson", 404, "error,ok"],
  ["/api/health", 200, "ok"],
  ["/api/tickers", 200, "items,ok"],
  ["/api/hq", 200, "asOf,items,latency,ok,source"],
  ["/api/hq/AAPL", 200, "asOf,item,latency,ok,source"],
  ["/api/sites", 200, "asOf,items,ok,source"],
  ["/api/congress/bills", 500, "error,ok"],
  ["/api/congress/bills/hr1-119/votes", 200, "error,items,ok"],
  ["/api/congress/bills/hr1-119/vote?chamber=senate", 200, "error,ok"],
  ["/api/congress/bills/hr1-119", 200, "error,ok"],
  ["/api/congress/calendar", 500, "error,ok"],
  ["/api/congress/votes?chamber=house", 500, "error,ok"],
  ["/api/congress/votes/house/119/1/1", 500, "error,ok"],
  ["/api/congress/members?q=pelosi", 500, "error,ok"],
  ["/api/congress/compare?a=P000197&b=S000148&chamber=house", 500, "error,ok"],
  ["/api/congress/roster", 500, "error,ok"],
  ["/api/congress/committees", 500, "error,ok"],
  ["/api/congress/committees/HSAS", 500, "error,ok"],
  ["/api/congress/member/P000197/trades", 200, "items,ok"],
  ["/api/congress/member/P000197/timeline", 200, "asOf,building,committees,coverage,member,nearDays,ok,proximity,range,returns,sources,trades,votes"],
  ["/api/congress/member/P000197?chamber=house", 500, "error,ok"],
  ["/api/congress/member/bogus", 404, "error,ok"],
  ["/api/lobby?client=Boeing", 200, "error,filings,ok,retryAt,source,unavailable"],
  ["/api/fec?name=Boeing", 500, "error,ok"],
  ["/api/contracts?symbol=LMT", 200, "asOf,error,items,latency,ok,scope,source"],
  ["/api/contracts/feed?sort=recent&days=30", 200, "asOf,error,items,latency,ok,scope,source"],
  ["/api/contracts/board", 200, "asOf,building,items,latency,ok,progress,source"],
  ["/api/contracts/dod", 200, "asOf,error,items,latency,ok,source"],
  ["/api/tickers/AAPL", 200, "contracts,fec,hq,lobby,ok,positions,quote,seats,ticker"],
  ["/api/tickers/ZZ-Q", 200, "error,ok"],
  ["/api/congress/leaders", 200, "active,asOf,basis,building,excessBottom,excessTop,late,latency,longest,minBuys,ok,progress,scoredMembers,source,tickers,tradesSource"],
  ["/api/congress/feed", 200, "asOf,biggest,building,counts,late,latency,latest,ok,source,tickers,window"],
  ["/api/markets/politicians", 200, "asOf,building,errors,from,items,latency,ok,progress,source"],
  ["/api/markets/insiders", 200, "asOf,errors,items,latency,ok,scanned,source"],
  ["/api/markets/whales", 200, "asOf,errors,items,latency,ok,source"],
  ["/api/markets/shorts", 200, "asOf,items,latency,ok,scanned,source"],
  ["/api/markets/shorts?symbol=AAPL", 500, "error,ok"],
  ["/api/markets/positions", 200, "asOf,feeds,items,latency,ok,source"],
  ["/api/markets/positions/AAPL", 200, "asOf,congress,coverage,inJoin,insiders,name,ok,pacNote,pacs,shorts,symbol,whales"],
  ["/api/news", 200, "asOf,errors,feeds,items,latency,ok,source"],
  ["/api/news/xpulse", 200, "accounts,asOf,latency,ok,posts,source,trends"],
  ["/api/markets/globals", 200, "adrs,arbNote,asOf,etfs,fx,indices,latency,ok,ratioNote,source"],
  ["/api/markets/supply", 200, "items,ok"],
  ["/api/markets/supply/AAPL", 200, "asOf,focus,indices,latency,name,nodes,ok,segments,series,source,symbol"],
  ["/api/air?theater=hormuz", 200, "asOf,box,items,latency,milWorld,ok,source,theater"],
  ["/api/air/route/UAL1", 200, "callsign,error,ok,source"],
  ["/api/news/x", 200, "asOf,feeds,items,latency,mode,ok,source,tokenMissing,trends,trendsAsOf"],
  ["/api/markets/board", 500, "error,ok"],
  ["/api/markets/chart?symbol=AAPL&span=1d", 500, "error,ok"],
  ["/api/fx/board", 200, "asOf,items,latency,matrix,ok,source"],
  ["/api/crypto/board", 200, "asOf,global,items,latency,ok,source"],
  ["/api/macro/strip", 200, "asOf,items,latency,ok,source"],
  ["/api/macro/fomc", 500, "error,ok"],
  ["/api/calendar/macro?back=3&ahead=21", 200, "asOf,items,latency,ok,source"],
  ["/api/calendar/earnings", 200, "asOf,items,latency,ok,source"],
  ["/api/alerts?late=all", 200, "asOf,items,ok,sources"],
  ["/api/intel/scope", 200, "arcs,asOf,days,events,from,kinds,len,ms,ok,partial,scope,to"],
  ["/api/intel/case/ticker/AAPL", 200, "asOf,headline,kind,latency,ok,signal,sources,stats,sub,subject"],
  ["/api/relations/node?id=ticker:NVDA", 200, "categories,node,ok"],
  ["/api/relations/expand?node=ticker:NVDA&category=supply", 200, "asOf,category,edges,label,latency,limit,more,node,nodes,offset,ok,source,total"],
  ["/api/relations/expand?node=member:bogus&category=trade", 400, "error,ok"],
  ["/api/calendar/lobbying", 200, "asOf,items,latency,ok,source,totals"],
  ["/api/calendar/pacs", 200, "asOf,cycle,groups,latency,members,ok,rows,source"],
  ["/api/markets/events?symbol=AAPL", 200, "asOf,feeds,latency,marks,ok,source,symbol"],
  ["/api/corporate/lobbying/AAPL", 200, "asOf,byYear,filings,latency,ok,source,unavailable"],
  ["/api/corporate/pac/AAPL", 200, "asOf,cycle,dem,latency,ok,recipients,rep,rows,source,total"],
  ["/api/corporate/contracts/AAPL", 200, "asOf,awards,byYear,note,ok,parents,source"],
  ["/api/corporate/earnings/AAPL", 500, "error,ok"],
  ["/api/corporate/pac/ZZ-Q", 404, "error,ok"],
  ["/api/strait/news", 500, "error,ok"],
  ["/api/strait/ais", 200, "asOf,items,latency,ok,source"],
  ["/api/earth/imagery", 200, "asOf,layers,ok"],
  ["/api/earth/live", 500, "error,ok"],
  ["/api/earth/lanes", 500, "error,ok"],
  ["/api/strait/theaters", 200, "items,ok"],
  ["/api/search?q=AM", 200, "members,ok,sites,tickers"],
  ["/api/nope", 404, "error,ok"]
];

test("every manifest route has a smoke case", () => {
  const table = MANIFEST.map((r) => ({ id: r.id, match: compile(r.path) }));
  const hit = new Set();
  for (const [route] of SMOKE) {
    const found = table.find((r) => r.match(new URL(route, base).pathname));
    if (found) hit.add(found.id);
  }
  assert.deepEqual(MANIFEST.map((r) => r.id).filter((id) => !hit.has(id)), []);
});

async function probe(route) {
  const res = await fetch(base + route, { signal: AbortSignal.timeout(90_000) });
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!type.includes("application/json")) return { status: res.status, keys: type };
  return { status: res.status, keys: Object.keys(JSON.parse(text)).sort().join(",") };
}

for (const [route, status, keys] of SMOKE) {
  test(`smoke ${route}`, { timeout: 120_000 }, async () => {
    const got = await probe(route);
    if (process.env.ROUTES_RECORD) console.log(`RECORD ${JSON.stringify([route, got.status, got.keys])}`);
    assert.equal(got.status, status, `${route} status`);
    assert.equal(got.keys, keys, `${route} keys`);
  });
}
