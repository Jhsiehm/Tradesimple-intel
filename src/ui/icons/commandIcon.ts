import type { IconName } from "./names";

const CODE_ICON: Record<string, IconName> = {
  WEEK: "today", LEAD: "leaders", CONG: "congress", VOTE: "votes", BILL: "bills", MEMB: "members", CMTE: "committees",
  MKTS: "markets", WEI: "globe", FXIP: "fx", CRYP: "crypto", POSN: "positions", PTRS: "trade", FRM4: "form4",
  NEWS: "news", DIST: "districts", STRT: "strait", MAP: "map", CITY: "city", CAL: "calendar", ALRT: "bell",
  BACK: "back", RCNT: "recent", BT: "backtest", ASK: "ask",
  DES: "dossier", GP: "chart", POS: "positions", CTR: "contracts", SPLC: "supply", HQ: "hq", TL: "timeline", REP: "members"
};

const ACTION_ICON: Record<string, IconName> = {
  member: "members", timeline: "timeline", pos: "positions", chart: "chart", ticker: "dossier", hq: "hq", contracts: "contracts",
  supply: "supply", scope: "arc", vote: "votes", bill: "bills", committee: "committees", district: "districts", inst: "chart",
  section: "chevron-right", today: "today", calendar: "calendar", alerts: "bell", bt: "backtest", ask: "ask"
};

/** Dossier drill-link icon from its `go()` action (`pos:LMT` → positions); outside links open a source. */
export function actionIcon(action?: string, href?: string): IconName {
  if (href) return "external";
  return ACTION_ICON[(action || "").split(":")[0]] || "chevron-right";
}

/** ⌘K row icon: the function code (last word, `LMT CTR` → CTR) or the static mnemonic. */
export function commandIcon(code: string): IconName {
  const words = code.trim().split(/\s+/);
  return CODE_ICON[words[words.length - 1]] || CODE_ICON[words[0]] || "command";
}
