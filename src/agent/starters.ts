import { EXAMPLES } from "../../shared/agent.mjs";
import type { AgentContext } from "./context";

/**
 * Starter questions that fit what is on screen, and the context an "Ask about this" button attaches.
 * Pure: App and the cards hand in plain facts; nothing here reads the DOM or storage.
 */

export type StarterFacts = {
  /** What the next question would carry (the attached item, or the screen selection). */
  ctx: AgentContext;
  /** False when the user removed the attachment: starters then stop naming "this". */
  attached: boolean;
  today: boolean;
  section: string;
  /** A picked map/news region label, e.g. "Asia-Pacific". */
  region?: string | null;
};

/** The parts of a dossier model the Ask button reads. */
export type AskModel = { title: string; caseKey?: string; askKey?: string; watch?: string };

const MAX = 4;
const MEMBER = /^[A-Z]\d{6}$/;
const KINDS = ["member", "ticker", "bill", "vote", "committee", "district", "edge", "rel", "item"] as const;
export type ItemKind = (typeof KINDS)[number];

const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const clean = (s: string, n = 120) => s.replace(/\s+/g, " ").trim().slice(0, n);

export function itemKind(node: string | null | undefined): ItemKind | null {
  const kind = (node || "").split(":")[0];
  return (KINDS as readonly string[]).includes(kind) ? (kind as ItemKind) : null;
}

/** The node behind a list selection whose dossier has no case key (bills, roll calls, committees, map links). */
export function selectionKey(section: string, mode: string, selectedId: string | null): string | null {
  if (!selectedId) return null;
  if (section === "congress" && mode === "bills") return `bill:${selectedId}`;
  if (section === "congress" && mode === "votes") return `vote:${selectedId}`;
  if (section === "congress" && mode === "committees") return `committee:${selectedId}`;
  if (section === "congress" && mode === "members" && MEMBER.test(selectedId)) return `member:${selectedId}`;
  if (section === "map") {
    if (selectedId.startsWith("theory:")) return null;
    if (selectedId.startsWith("edge:") || /^(member|ticker):/.test(selectedId)) return selectedId;
    return `rel:${selectedId}`;
  }
  return `item:${selectedId}`;
}

/** The context a card's Ask button attaches: its case key, watched symbol, or selection key, named by its title. */
export function aboutContext(model: AskModel, section: string): AgentContext {
  const label = clean(model.title);
  const key = model.caseKey && itemKind(model.caseKey) ? model.caseKey : model.askKey || (model.watch ? `ticker:${model.watch}` : "");
  const node = key && itemKind(key) ? key : `item:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) || "card"}`;
  return { section, node, theory: null, label };
}

/** The follow action a card's Ask button sends: App attaches the item and opens the sheet with its first starter. */
export function askAction(model: AskModel): string {
  const { title, caseKey, askKey, watch } = model;
  return `ask:about:${encodeURIComponent(JSON.stringify({ title: clean(title), caseKey, askKey, watch }))}`;
}

export function parseAskAction(action: string): AskModel | null {
  if (!action.startsWith("ask:about:")) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(action.slice(10)));
    if (!raw || typeof raw.title !== "string") return null;
    const opt = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 160) : undefined);
    return { title: clean(raw.title), caseKey: opt(raw.caseKey), askKey: opt(raw.askKey), watch: opt(raw.watch) };
  } catch {
    return null;
  }
}

const symbolOf = (ctx: AgentContext) => (ctx.node || "").split(":").slice(1).join(":").toUpperCase();
/** A name short enough to read inside a question; longer titles become "this" (the item is attached anyway). */
const nameOf = (ctx: AgentContext) => {
  const name = clean(ctx.label || "") || symbolOf(ctx);
  return name.length > 48 ? "" : name;
};

/** Questions about one attached item, the best first: it is the prefill when a card's Ask button opens the sheet. */
export function itemStarters(ctx: AgentContext): string[] {
  if (ctx.theory) return ["Is there data behind this theory?", "What filings link both sides of this theory?"];
  const kind = itemKind(ctx.node);
  const name = nameOf(ctx);
  switch (kind) {
    case "member": {
      const who = name && !MEMBER.test(name) ? name : "this member";
      return [`How have ${possessive(who)} buys done after filing?`, "Which committees and trades overlap?", `What did ${who} file most recently?`, `Backtest ${possessive(who)} disclosed buys vs SPY`];
    }
    case "ticker": {
      const t = symbolOf(ctx);
      return [`Who in Congress traded ${t} in the last 90 days?`, `Insider buys in ${t} since 2025 — backtest`, `Largest federal contract actions for ${t} in the last 90 days`];
    }
    case "bill":
      return ["Who traded related stocks around this vote?", "Which sectors does this bill touch, and who in Congress traded them?"];
    case "vote":
      return ["Who traded related stocks around this vote?", "How did members who traded affected stocks vote?"];
    case "committee":
      return ["Which members of this committee traded stocks it oversees?", "Which committees and trades overlap?"];
    case "district":
      return [`What federal contracts and Congress trades tie to ${name || "this district"}?`];
    case "edge":
      return [`Explain this link and its timing: ${name || "this relationship"}`, "Was anything traded around the dates on this link?"];
    case "rel":
      return [`What links ${name || "this"} to Congress trades, lobbying, and contracts?`];
    case "item":
      return [name ? `Tell me more about ${name}` : "Tell me more about this"];
    default:
      return [];
  }
}

const TODAY = ["How are the markets today?", "Backtest the last 30 days from all data sources", "Top disclosed buys vs SPY in the last 30 days"];
const SECTION: Record<string, string[]> = {
  markets: ["How are the markets today?", "Which sectors moved most today?", "Top disclosed buys vs SPY in the last 30 days"],
  congress: ["What did Congress file this week?", "Top disclosed buys vs SPY in the last 30 days", "Backtest the last 30 days from all data sources"],
  contracts: ["Largest federal contract actions in the last 30 days", "Which contractors did members of Congress trade?"],
  news: ["How are the markets today?", "Which headlines name stocks Congress traded?"],
  map: ["Which members trade most in companies that lobby them?", "Top disclosed buys vs SPY in the last 30 days"],
  calendar: ["Which earnings this week are in stocks Congress traded?", "How are the markets today?"]
};

/** Up to four example questions for the empty sheet and the greeting reply, picked from the screen. */
export function starters(f: StarterFacts): string[] {
  const out: string[] = [];
  const add = (list: readonly string[]) => { for (const q of list) if (q && !out.includes(q)) out.push(q); };
  if (f.attached) add(itemStarters(f.ctx));
  if (f.region && f.region.toLowerCase() !== "all") add([`Tell me about the ${f.region} market today`]);
  if (f.today) add(TODAY);
  add(SECTION[f.ctx.section] || SECTION[f.section] || []);
  add(EXAMPLES);
  return out.slice(0, MAX);
}
