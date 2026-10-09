import { HOUR } from "../lib/time.mjs";
import { warmEnabled } from "../lib/env.mjs";
import { refreshPositions } from "../domain/positions/index.mjs";
import { refreshTimeline } from "../timeline.mjs";
import { refreshReturns } from "../returns.mjs";
import { warmContracts } from "../contracts.mjs";
import { warmCorporate } from "../domain/corporate/index.mjs";
import { warmMacro } from "../macro.mjs";

function corporateThenMacro(db) {
  return warmCorporate(db)
    .then(() => warmMacro(db))
    .then((n) => console.log(`macro warm: ${n} days fetched`))
    .catch((err) => console.error("warm", err.message));
}

/** Background refreshes: first run `delay` ms after listen, then every `every` ms (null = once). */
export const SCHEDULE = [
  { name: "positions", delay: 1500, every: 2 * HOUR, run: refreshPositions },
  { name: "contracts", delay: 3000, every: HOUR, run: warmContracts },
  { name: "corporate+macro", delay: 5000, every: null, run: corporateThenMacro },
  { name: "timeline", delay: 8000, every: 6 * HOUR, run: refreshTimeline },
  { name: "returns", delay: 20000, every: 12 * HOUR, run: refreshReturns }
];

export function startWarm(db) {
  if (!warmEnabled()) return false;
  for (const job of SCHEDULE) {
    setTimeout(() => { void job.run(db); }, job.delay);
    if (job.every) setInterval(() => { void job.run(db); }, job.every).unref();
  }
  return true;
}
