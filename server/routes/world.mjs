import { newsWire, xPulse, xWire } from "../news.mjs";
import { airspace, flightRoute, metroAir } from "../air.mjs";
import { THEATERS, aisSnapshot, straitNews } from "../strait.mjs";
import { imagery, liveImagery, shippingLanes } from "../earth.mjs";
import { alertsFor } from "../alerts.mjs";
import { caseFile, intelScope } from "../intel.mjs";

export const handlers = {
  news: ({ db }) => newsWire(db),
  "news.xpulse": ({ db }) => xPulse(db),
  "news.x": ({ db }) => xWire(db),
  air: ({ db, query }) => airspace(db, THEATERS.find((t) => t.id === query.params.get("theater")) || THEATERS[0]),
  "air.near": ({ db, query }) => metroAir(db, Number(query.str("lat")), Number(query.str("lon"))),
  "air.route": ({ db, params }) => flightRoute(db, params.callsign),
  "strait.news": ({ db }) => straitNews(db),
  "strait.ais": () => aisSnapshot(),
  "strait.theaters": () => ({ ok: true, items: THEATERS }),
  "earth.imagery": ({ db }) => imagery(db),
  "earth.live": ({ db }) => liveImagery(db),
  "earth.lanes": ({ db }) => shippingLanes(db),
  alerts: ({ db, query }) => alertsFor(db, query.params),
  "intel.scope": ({ db, query }) => intelScope(db, query.params),
  "intel.case": ({ db, params }) => caseFile(db, params.kind, decodeURIComponent(params.id))
};
