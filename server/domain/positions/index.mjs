import { HOUR } from "../../lib/time.mjs";
import { congressTrades } from "./congress.mjs";
import { insiderTrades } from "./insiders.mjs";
import { whaleHoldings } from "./whales.mjs";
import { shortBoard } from "./shorts.mjs";

export { congressTrades, memberTrades } from "./congress.mjs";
export { insiderTrades } from "./insiders.mjs";
export { whaleHoldings } from "./whales.mjs";
export { shortBoard } from "./shorts.mjs";
export { coverage, positionsBoard, positionsFor } from "./board.mjs";

export function warmPositions(db) {
  const run = async () => {
    await congressTrades(db).catch(() => null);
    await insiderTrades(db).catch(() => null);
    await whaleHoldings(db).catch(() => null);
    await shortBoard(db).catch(() => null);
  };
  setTimeout(() => { void run(); }, 1500);
  setInterval(() => { void run(); }, 2 * HOUR).unref();
}
