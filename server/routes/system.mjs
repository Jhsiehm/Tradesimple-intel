import fs from "node:fs";
import path from "node:path";
import { listTickers } from "../lib/db.mjs";
import { hqAll, hqFor } from "../hq.mjs";
import { siteRegistry } from "../domain/sites.mjs";
import { search } from "../domain/search.mjs";
import { tickerDossier } from "../domain/dossier.mjs";
import { reply } from "../router.mjs";
import { staticFile } from "../lib/compress.mjs";

const GEO = { "states.geojson": "states.geojson", "cd119.geojson": "cd119.geojson" };
const geoFiles = new Map();

export const handlers = {
  geo: ({ root, params, req, res }) => {
    const name = Object.hasOwn(GEO, params.name) ? GEO[params.name] : null;
    if (!name) return reply(404, { ok: false, error: "Unknown geometry" });
    if (!geoFiles.has(name)) geoFiles.set(name, staticFile(() => fs.readFileSync(path.join(root, "data", "geo", name))));
    geoFiles.get(name)(req, res, { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=86400" });
  },
  health: () => ({ ok: true }),
  tickers: ({ db }) => ({ ok: true, items: listTickers(db) }),
  ticker: ({ db, params, query }) => tickerDossier(db, params.symbol.toUpperCase(), query.params.get("lobby") !== "0"),
  hq: ({ db }) => hqAll(db),
  "hq.symbol": ({ db, params }) => hqFor(db, params.symbol.toUpperCase()),
  sites: () => ({ ok: true, source: "Curated district registry", asOf: null, items: siteRegistry() }),
  search: ({ db, query }) => search(db, query.str("q"))
};
