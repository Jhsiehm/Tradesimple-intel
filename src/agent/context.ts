import type { Theory } from "../../shared/relations.mjs";

/** What the next question may name. Nulls stay null: Ask does not invent a selection. */
export type AgentContext = {
  section: string;
  node: string | null;
  theory: Theory | null;
};

export type ScreenFacts = {
  section: string;
  mode: string;
  marketView: string;
  selectedId: string | null;
  timelineId: string | null;
  today: boolean;
  calendar: boolean;
  chartSymbol: string;
  supplySymbol: string;
  /** Symbol on the selected markets row, when that row is the list selection. */
  rowSymbol: string | null;
  /** `ticker:SYM` or `member:ID` on the open dossier. */
  caseKey: string | null;
  /** Symbol on the open dossier when it has no case key. */
  watch: string | null;
  /** Set only while the theory editor is open. */
  theory: Theory | null;
};

const MEMBER = /^[A-Z]\d{6}$/;

/**
 * The section, plus a member or ticker when that selection is the thing on screen,
 * or the theory while its editor is open.
 */
export function screenContext(s: ScreenFacts): AgentContext {
  if (s.theory) return { section: s.section, node: null, theory: s.theory };
  if (s.timelineId && MEMBER.test(s.timelineId)) return { section: "congress", node: `member:${s.timelineId}`, theory: null };
  if (s.caseKey?.startsWith("member:") || s.caseKey?.startsWith("ticker:")) return { section: s.section, node: s.caseKey, theory: null };
  if (s.watch) return { section: s.section, node: `ticker:${s.watch}`, theory: null };
  if (s.today) return { section: "today", node: null, theory: null };
  if (s.calendar) return { section: "calendar", node: null, theory: null };
  if (s.section === "map" && s.selectedId && (s.selectedId.startsWith("member:") || s.selectedId.startsWith("ticker:"))) {
    return { section: s.section, node: s.selectedId, theory: null };
  }
  if (s.section === "congress" && s.mode === "members" && s.selectedId && MEMBER.test(s.selectedId)) {
    return { section: s.section, node: `member:${s.selectedId}`, theory: null };
  }
  if (s.section === "markets" && s.marketView === "chart" && s.chartSymbol) return { section: s.section, node: `ticker:${s.chartSymbol}`, theory: null };
  if (s.section === "markets" && s.marketView === "supply" && s.supplySymbol) return { section: s.section, node: `ticker:${s.supplySymbol}`, theory: null };
  if (s.section === "markets" && s.rowSymbol) return { section: s.section, node: `ticker:${s.rowSymbol}`, theory: null };
  return { section: s.section, node: null, theory: null };
}

/** One line for the sheet header and the ASK button. */
export function contextLine(ctx: AgentContext): string {
  const section = ctx.section.toUpperCase();
  if (ctx.theory) return `${section} · your theory · ${ctx.theory.a.label} ↔ ${ctx.theory.b.label}`;
  if (ctx.node?.startsWith("member:")) return `${section} · member ${ctx.node.slice(7)}`;
  if (ctx.node?.startsWith("ticker:")) return `${section} · ${ctx.node.slice(7)}`;
  return `${section} · nothing selected`;
}
