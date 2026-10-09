import { DEFAULT_FILTERS, DEFAULT_RULES, cleanSpec, decodeSpec, encodeSpec, type BacktestSpec } from "../../shared/backtestSpec.mjs";

const LAST_KEY = "intel:bt:last:v1";
const RECENT_KEY = "intel:bt:recent:v1";

export const defaultSpec = (): BacktestSpec => ({ source: "congress", filters: { ...DEFAULT_FILTERS }, rules: { ...DEFAULT_RULES } });

/** The board's starting spec for an action value: `member:ID`, `ticker:SYM`, `token:XYZ`, or empty for the last one used. */
export function seedSpec(value: string): BacktestSpec {
  const [kind, ...rest] = value.split(":");
  const v = rest.join(":");
  const base = defaultSpec();
  if (kind === "member" && /^[A-Z]\d{6}$/.test(v)) return { ...base, filters: { ...base.filters, member: v } };
  if (kind === "ticker" && v) return { ...base, filters: { ...base.filters, tickers: [v.toUpperCase()] } };
  if (kind === "form4" && v) return { ...base, source: "form4", filters: { ...base.filters, tickers: [v.toUpperCase()] } };
  if (kind === "token") return decodeSpec(v) || base;
  if (kind === "spec") {
    try {
      const out = cleanSpec(JSON.parse(v));
      if (out.ok) return out.spec;
    } catch { /* fall through */ }
  }
  return lastSpec() || base;
}

export function lastSpec(): BacktestSpec | null {
  try {
    const out = cleanSpec(JSON.parse(localStorage.getItem(LAST_KEY) || "null"));
    return out.ok ? out.spec : null;
  } catch {
    return null;
  }
}

export function saveSpec(spec: BacktestSpec) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(spec));
    const recent: BacktestSpec[] = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const token = encodeSpec(spec);
    const next = [spec, ...recent.filter((s) => encodeSpec(s) !== token)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

export function recentSpecs(): BacktestSpec[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as unknown[]).map((s) => cleanSpec(s)).flatMap((o) => (o.ok ? [o.spec] : []));
  } catch {
    return [];
  }
}

/** `#bt=token` for a spec; `#bt` alone for the last one. */
export const btHash = (spec?: BacktestSpec) => (spec ? `#bt=${encodeSpec(spec)}` : "#bt");

/** The token in the page's own hash, if the page was opened from a share link. */
export const hashToken = () => location.hash.match(/^#bt=([A-Za-z0-9_-]+)/)?.[1] || "";
