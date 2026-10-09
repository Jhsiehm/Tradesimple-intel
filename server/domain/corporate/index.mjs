import { lobbyingBoard } from "./lobbying.mjs";
import { pacData } from "./pacs.mjs";

export { earningsCalendar, earningsHistory } from "./earnings.mjs";
export { lobbyingBoard, lobbyingFor } from "./lobbying.mjs";
export { memberPacs, pacData, pacFor } from "./pacs.mjs";
export { contractsFor } from "./contracts.mjs";
export { equityEvents } from "./events.mjs";
export { fecBulk } from "../../feeds/fec.mjs";

export async function warmCorporate(db) {
  await pacData(db).catch((err) => console.error("pac warm", err.message));
  await lobbyingBoard(db).catch((err) => console.error("lda warm", err.message));
}
