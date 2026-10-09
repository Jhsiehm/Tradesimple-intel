import type { ReactNode } from "react";
import { chipTitle, splitRefs } from "../../shared/citations.mjs";
import type { FallbackTable, Step } from "./types";

const BOLD = /\*\*([^*]+)\*\*/g;

/** One ref as a chip. A ref with no step in this turn is marked unverified, never shown as a source. */
export function Chip({ id, steps, onChip }: { id: string; steps: Map<string, Step>; onChip: (s: Step) => void }) {
  const s = steps.get(id);
  if (!s) return <span className="cite bad" title="No tool call in this answer has this ref, so it is not a source">{id}?</span>;
  return <button type="button" className={s.state === "error" ? "cite fail" : "cite"} title={chipTitle(s)} onClick={() => onChip(s)}>{id}</button>;
}

/** Inline text: **bold** and [t3] refs as chips. */
function Inline({ text, steps, onChip }: { text: string; steps: Map<string, Step>; onChip: (s: Step) => void }) {
  const out: ReactNode[] = [];
  let k = 0;
  const bolded = (s: string) => {
    let last = 0;
    for (const m of s.matchAll(BOLD)) {
      out.push(s.slice(last, m.index));
      out.push(<b key={k++}>{m[1]}</b>);
      last = (m.index ?? 0) + m[0].length;
    }
    out.push(s.slice(last));
  };
  for (const part of splitRefs(text)) {
    if (part.ref) out.push(<Chip key={k++} id={part.ref} steps={steps} onChip={onChip} />);
    else bolded(part.text ?? "");
  }
  return <>{out}</>;
}

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** The small markdown the prompt asks for: paragraphs, bullet lists, and pipe tables. */
export function Answer({ text, steps, onChip }: { text: string; steps: Step[]; onChip: (s: Step) => void }) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={k++} className="ans-table"><table>
          <thead><tr>{head.map((c, j) => <th key={j}><Inline text={c} steps={byId} onChip={onChip} /></th>)}</tr></thead>
          <tbody>{body.map((r, n) => <tr key={n}>{r.map((c, j) => <td key={j}><Inline text={c} steps={byId} onChip={onChip} /></td>)}</tr>)}</tbody>
        </table></div>
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      blocks.push(<ul key={k++}>{items.map((t, n) => <li key={n}><Inline text={t} steps={byId} onChip={onChip} /></li>)}</ul>);
      continue;
    }
    if (line.trim()) {
      const h = line.match(/^#{1,4}\s+(.*)/);
      blocks.push(h ? <h4 key={k++}><Inline text={h[1]} steps={byId} onChip={onChip} /></h4> : <p key={k++}><Inline text={line} steps={byId} onChip={onChip} /></p>);
    }
    i++;
  }
  return <div className="ans" aria-live="polite">{blocks}</div>;
}

const FRACTION_COL = /excess|median|return|hit|drawdown|cagr|alpha|weight/i;
const cellText = (col: string, v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  if (!FRACTION_COL.test(col) || !Number.isFinite(n) || Math.abs(n) > 50) return String(v ?? "");
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(1)}%`;
};

const latencyOf = (steps: Step[], ref: string) => {
  const latency = steps.find((s) => s.id === ref)?.latency;
  return latency ? ` · ${latency}` : "";
};

/** When the answer carried no figures, the tool's own rows, labeled with where they came from. Return-like columns hold fractions. */
export function ToolTable({ table, steps, onChip }: { table: FallbackTable; steps: Step[]; onChip: (s: Step) => void }) {
  return (
    <section className="ans-fallback" aria-label="Tool rows">
      <h4>{table.label} <Chip id={table.ref} steps={new Map(steps.map((s) => [s.id, s]))} onChip={onChip} /></h4>
      <div className="ans-table"><table>
        <thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{cellText(table.columns[j], c)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="ans-src">{table.source || "no source reported"}{table.asOf ? ` · as of ${table.asOf}` : ""}{latencyOf(steps, table.ref)}{table.total > table.rows.length ? ` · ${table.rows.length} of ${table.total} rows` : ""}</p>
    </section>
  );
}
