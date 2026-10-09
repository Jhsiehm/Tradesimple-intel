import type { IconName } from "./names";

const CODE_ICON: Record<string, IconName> = {
  WEEK: "today", LEAD: "leaders", CONG: "congress", VOTE: "votes", BILL: "bills", MEMB: "members", CMTE: "committees",
  MKTS: "markets", WEI: "globe", FXIP: "fx", CRYP: "crypto", POSN: "positions", PTRS: "trade", FRM4: "form4",
  NEWS: "news", DIST: "districts", STRT: "strait", MAP: "map", CITY: "city", CAL: "calendar", ALRT: "bell",
  BACK: "back", RCNT: "recent",
  DES: "dossier", GP: "chart", POS: "positions", CTR: "contracts", SPLC: "supply", HQ: "hq", TL: "timeline", REP: "members"
};

/** ⌘K row icon: the function code (last word, `LMT CTR` → CTR) or the static mnemonic. */
export function commandIcon(code: string): IconName {
  const words = code.trim().split(/\s+/);
  return CODE_ICON[words[words.length - 1]] || CODE_ICON[words[0]] || "command";
}
