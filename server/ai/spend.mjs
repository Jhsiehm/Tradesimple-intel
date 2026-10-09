import { budgetLevel, budgetNote, budgetSettings, callCost, monthKey } from "../../shared/spend.mjs";

/**
 * The Ask spend ledger, in the server's cache database (`ask_spend`). One row per model call, from Ask questions
 * ("ask") and scheduled prompt tasks ("task"). Cost is OpenRouter's reported figure when the stream carries it, else
 * tokens × the price table in shared/spend.mjs (and an estimate of the tokens when the provider reported none).
 * A `db` without `prepare` (tests) turns the ledger off.
 */
const ready = new WeakSet();
const usable = (db) => typeof db?.prepare === "function";

function ensure(db) {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      month TEXT NOT NULL,
      kind TEXT NOT NULL,
      ask_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input INTEGER NOT NULL,
      output INTEGER NOT NULL,
      usd REAL NOT NULL,
      priced TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ask_spend_month ON ask_spend (month);
  `);
  ready.add(db);
}

/** Writes one call. `{ model, input, output, cost?, estimated? }` → the row's `{ usd, priced }`. */
export function recordSpend(db, { at, kind = "ask", askId = "", model, input = 0, output = 0, cost = null, estimated = false }) {
  const priced = callCost({ model, input, output, cost });
  if (!usable(db)) return priced;
  ensure(db);
  db.prepare("INSERT INTO ask_spend (at, month, kind, ask_id, model, input, output, usd, priced) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(at, monthKey(at), kind, askId, String(model || ""), Math.round(input), Math.round(output), priced.usd, estimated && priced.priced !== "reported" ? `${priced.priced}-estimated` : priced.priced);
  return priced;
}

/** `{ spent, calls, tasks, estimated }` for one month ("YYYY-MM"). */
export function monthSpend(db, month) {
  if (!usable(db)) return { spent: 0, calls: 0, tasks: 0, estimated: 0 };
  ensure(db);
  const row = db.prepare(`SELECT COALESCE(SUM(usd), 0) AS spent, COUNT(*) AS calls,
    COALESCE(SUM(CASE WHEN kind = 'task' THEN usd ELSE 0 END), 0) AS tasks,
    COALESCE(SUM(CASE WHEN priced = 'reported' THEN 0 ELSE usd END), 0) AS estimated
    FROM ask_spend WHERE month = ?`).get(month);
  return { spent: row.spent, calls: row.calls, tasks: row.tasks, estimated: row.estimated };
}

/** This month against the budget (see shared/spend.mjs `Spend`). Null when there is no ledger. */
export function spendState(db, env = process.env, now = Date.now(), provider = "") {
  if (!usable(db)) return null;
  const month = monthKey(now);
  const { budget, hardStop, cheap } = budgetSettings(env, provider);
  const m = monthSpend(db, month);
  const { level, pct } = budgetLevel({ spent: m.spent, budget, hardStop });
  const round = (v) => Math.round(v * 10_000) / 10_000;
  return { month, spent: round(m.spent), budget, pct: Math.round(pct * 1000) / 1000, level, calls: m.calls, tasks: round(m.tasks), estimated: round(m.estimated), cheap, hardStop, note: budgetNote({ level, spent: m.spent, budget, cheap, month }) };
}

const chars = (v) => { try { return JSON.stringify(v ?? "").length; } catch { return 0; } };

/**
 * A provider whose every `chat` call lands in the ledger once it ends. Usage the stream reports wins; a call that
 * streamed something but reported no usage is estimated (characters / 4). A call that failed before any event is free.
 */
export function metered(provider, { db, kind = "ask", askId = "", now = Date.now, onCall = () => {} }) {
  return {
    ...provider,
    async *chat(messages, tools, opts) {
      let usage = null;
      let out = 0;
      let got = false;
      try {
        for await (const ev of provider.chat(messages, tools, opts)) {
          got = true;
          if (ev.type === "usage") usage = ev;
          else if (ev.type === "text") out += String(ev.delta || "").length;
          else if (ev.type === "tool_call") out += chars(ev.args) + String(ev.name || "").length;
          yield ev;
        }
      } finally {
        if (got || usage) {
          const call = usage
            ? { input: usage.input || 0, output: usage.output || 0, cost: usage.cost ?? null, estimated: false }
            : { input: Math.ceil((chars(messages) + chars(tools)) / 4), output: Math.ceil(out / 4), cost: null, estimated: true };
          try {
            const priced = recordSpend(db, { at: now(), kind, askId, model: provider.model, ...call });
            onCall({ model: provider.model, ...call, ...priced });
          } catch { /* the ledger never breaks an answer */ }
        }
      }
    }
  };
}
