import { congressTrades } from "./congress.mjs";
import { insiderTrades } from "./insiders.mjs";
import { whaleHoldings } from "./whales.mjs";
import { shortBoard } from "./shorts.mjs";

export { congressTrades, memberTrades } from "./congress.mjs";
export { insiderHistory, insiderTrades } from "./insiders.mjs";
export { whaleHoldings } from "./whales.mjs";
export { shortBoard } from "./shorts.mjs";
export { coverage, positionsBoard, positionsFor } from "./board.mjs";

/** One pass over the four position feeds, in order, so their scans never overlap. */
export async function refreshPositions(db) {
  await congressTrades(db).catch(() => null);
  await insiderTrades(db).catch(() => null);
  await whaleHoldings(db).catch(() => null);
  await shortBoard(db).catch(() => null);
}
