/** Dossier and card links carry actions like `bill:hr1-119`, `member:A000001`, `supply:TSM`. */
export type ActionKind = "bill" | "vote" | "roll" | "member" | "news" | "committee" | "meeting" | "ticker" | "inst" | "chart" | "pos" | "supply" | "timeline" | "contracts" | "hq" | "scope";

export type Routes = Record<ActionKind, (value: string) => void>;

export function route(action: string, routes: Routes) {
  const [kind, ...rest] = action.split(":");
  const handler = routes[kind as ActionKind];
  if (handler) handler(rest.join(":"));
}
