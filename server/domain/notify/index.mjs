import { postNtfy } from "../../feeds/ntfy.mjs";
import { ageAlert } from "../../../shared/tradeAge.mjs";
import { buildMessage, envSettings, mergeSettings, publicSettings, shouldNotify, underLimit } from "../../../shared/notify.mjs";

/**
 * Phone notifications through ntfy for live alerts. State in the server's cache database:
 *   notify_sent      every alert id ever claimed for a phone push (sent, failed or held), so none is sent twice
 *   notify_settings  the user's choices from the Alerts menu (on/off, minimum severity, kinds, quiet hours)
 * The topic, server and token stay in env (.env.local); the browser only ever sees publicSettings().
 */
const ready = new WeakSet();

function ensure(db) {
  if (ready.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS notify_sent (id TEXT PRIMARY KEY, at INTEGER NOT NULL, status TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS notify_sent_at ON notify_sent (at);
    CREATE TABLE IF NOT EXISTS notify_settings (k TEXT PRIMARY KEY, body TEXT NOT NULL);
  `);
  ready.add(db);
}

const SENT = new Set(["sent", "test"]);
/** Test messages: at most one per this interval. */
export const TEST_GAP_MS = 10_000;

export function loadSaved(db) {
  ensure(db);
  const row = db.prepare("SELECT body FROM notify_settings WHERE k = 'settings'").get();
  try {
    return row ? JSON.parse(row.body) : {};
  } catch {
    return {};
  }
}

function claim(db, row, now, status) {
  const out = db.prepare("INSERT OR IGNORE INTO notify_sent (id, at, status, severity, title) VALUES (?, ?, ?, ?, ?)").run(row.id, now, status, String(row.severity || ""), String(row.title || "").slice(0, 200));
  return out.changes > 0;
}

const mark = (db, id, status, error = "") => db.prepare("UPDATE notify_sent SET status = ?, error = ? WHERE id = ?").run(status, error.slice(0, 200), id);

/**
 * The notifier for one database. `env` is read on every call (so .env.local edits apply after a restart only, as
 * everywhere else). `post` and `now` are injectable for tests.
 */
export function createNotifier(db, { env = process.env, post = postNtfy, now = () => Date.now(), log = (m) => console.log(m) } = {}) {
  ensure(db);
  let sentTimes = db.prepare("SELECT at FROM notify_sent WHERE at >= ? AND status IN ('sent','test')").all(now() - 3_600_000).map((r) => r.at);
  let held = 0;
  let lastTest = 0;
  let chain = Promise.resolve();

  const settings = () => mergeSettings(envSettings(env), loadSaved(db));

  const deliver = (s, message) => post({ server: s.server, topic: s.topic, token: String(env.NTFY_TOKEN || "").trim(), message });

  function view() {
    const s = settings();
    const recent = db.prepare("SELECT id, at, status, severity, title, error FROM notify_sent ORDER BY at DESC LIMIT 8").all();
    const lim = underLimit(sentTimes, s.maxPerHour, now());
    return { ok: true, asOf: new Date(now()).toISOString(), settings: publicSettings(s), sentLastHour: lim.recent.length, held, recent };
  }

  function save(input = {}) {
    const prev = loadSaved(db);
    const next = { ...prev };
    if (typeof input.enabled === "boolean") next.enabled = input.enabled;
    if (typeof input.minSeverity === "string") next.minSeverity = input.minSeverity;
    if (Array.isArray(input.kinds)) next.kinds = input.kinds.map(String).slice(0, 20);
    if (typeof input.quiet === "string") next.quiet = input.quiet.slice(0, 20);
    if (typeof input.quietHigh === "boolean") next.quietHigh = input.quietHigh;
    db.prepare("INSERT INTO notify_settings (k, body) VALUES ('settings', ?) ON CONFLICT(k) DO UPDATE SET body = excluded.body").run(JSON.stringify(next));
    return view();
  }

  /** Sends one alert row if it qualifies and was never claimed before. Resolves with `{ sent, why }`. */
  async function handle(input) {
    const t = now();
    const row = ageAlert(input, t);
    const s = settings();
    const verdict = shouldNotify(row, s, t);
    if (!verdict.send) return { sent: false, why: verdict.why };
    const lim = underLimit(sentTimes, s.maxPerHour, t);
    sentTimes = lim.recent;
    if (!lim.ok) {
      if (claim(db, row, t, "held")) held += 1;
      return { sent: false, why: "hourly limit" };
    }
    if (!claim(db, row, t, "sending")) return { sent: false, why: "already sent" };
    const message = buildMessage(row, { clickUrl: s.clickUrl, now: t, suppressed: held });
    try {
      await deliver(s, message);
      mark(db, row.id, "sent");
      sentTimes.push(t);
      held = 0;
      return { sent: true, why: "" };
    } catch (err) {
      mark(db, row.id, "failed", String(err?.message || err));
      log(`ntfy: ${row.id} not delivered (${err?.message || err})`);
      return { sent: false, why: String(err?.message || err) };
    }
  }

  /** Queues sends one after another so two alerts in the same tick cannot both pass the limiter. */
  function enqueue(row) {
    const job = chain.then(() => handle(row));
    chain = job.catch(() => {});
    return job;
  }

  /** A labelled test message, server-side. Works while notifications are switched off; needs a topic. */
  async function test() {
    const s = settings();
    if (!s.topic) return { ok: false, error: "NTFY_TOPIC is not set in .env.local.", status: 409 };
    const t = now();
    if (t - lastTest < TEST_GAP_MS) return { ok: false, error: "One test every 10 seconds.", status: 429 };
    lastTest = t;
    const id = `test:${t}`;
    claim(db, { id, title: "Test notification", severity: "routine" }, t, "sending");
    const message = {
      title: "TradeSimple Intel · test",
      message: `Phone notifications work. Alerts at ${s.minSeverity.toUpperCase()} and above will arrive here${s.quiet ? `; quiet hours ${publicSettings(s).quiet} ET` : ""}.\nResearch terminal only; nothing here places orders.`,
      priority: 3,
      tags: ["white_check_mark"],
      click: s.clickUrl ? `${s.clickUrl}/` : "",
      actions: []
    };
    try {
      const res = await deliver(s, message);
      mark(db, id, "test");
      sentTimes.push(t);
      return { ok: true, id: res.id, ...view() };
    } catch (err) {
      mark(db, id, "failed", String(err?.message || err));
      return { ok: false, error: String(err?.message || err), status: 502 };
    }
  }

  const sentIds = () => new Set(db.prepare("SELECT id, status FROM notify_sent").all().filter((r) => SENT.has(r.status)).map((r) => r.id));

  return { settings, view, save, handle: enqueue, test, sentIds };
}

const notifiers = new WeakMap();

export function notifierFor(db, opts) {
  if (!notifiers.has(db)) notifiers.set(db, createNotifier(db, opts));
  return notifiers.get(db);
}

/** Subscribes the notifier to a live bus's `alert` events. Returns an unsubscribe function. */
export function startNotify(db, bus, opts) {
  const n = notifierFor(db, opts);
  const onAlert = (row) => void n.handle(row).catch(() => {});
  bus.on("alert", onAlert);
  const s = n.settings();
  (opts?.log || console.log)(`phone notifications: ${s.topic ? `${s.enabled ? "on" : "off"} · ntfy ${new URL(s.server).host} · ${s.minSeverity}+` : "off (NTFY_TOPIC not set)"}`);
  return () => bus.off("alert", onAlert);
}
