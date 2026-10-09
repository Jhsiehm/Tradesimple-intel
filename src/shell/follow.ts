/** Dossier and card links carry actions like `bill:hr1-119`, `member:A000001`, `supply:TSM`, `district:CA-11`. */
export type ActionKind = "bill" | "vote" | "roll" | "member" | "news" | "committee" | "meeting" | "ticker" | "inst" | "chart" | "pos" | "supply" | "timeline" | "contracts" | "hq" | "scope" | "district" | "site";

/** Pure view changes (bill, vote, committee, hq, site, district, contracts, scope) go through `viewFor` first. */
export type Routes = Partial<Record<ActionKind, (value: string) => void>>;

export function route(action: string, routes: Routes) {
  const [kind, ...rest] = action.split(":");
  const handler = routes[kind as ActionKind];
  if (handler) handler(rest.join(":"));
}
