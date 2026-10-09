import { useEffect, useState } from "react";
import { NOTIFY_KINDS, NOTIFY_LEVELS, topicFrom, type PublicNotifySettings, type SavedNotifySettings } from "../../shared/notify.mjs";
import { DEMO, when } from "../lib/api";
import "./phone.css";

type Sent = { id: string; at: number; status: string; severity: string; title: string; error: string };
type View = { ok: boolean; error?: string; asOf?: string; settings: PublicNotifySettings; sentLastHour: number; held: number; recent: Sent[] };

async function call(method: "GET" | "PUT" | "POST", path: string, body?: unknown): Promise<View> {
  const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const data = (await res.json().catch(() => null)) as View | null;
  if (!data) throw new Error(`HTTP ${res.status}`);
  return data;
}

/** Phone notifications through ntfy: on/off, minimum severity, kinds, quiet hours, a server-side test. The topic stays on the server; only a masked form is shown. */
export function PhoneNotify() {
  const [view, setView] = useState<View | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [quiet, setQuiet] = useState("");
  const [suggest, setSuggest] = useState("");

  useEffect(() => {
    if (DEMO) return;
    call("GET", "/api/notify").then((v) => { setView(v); setQuiet(v.settings?.quiet || ""); }).catch(() => setNote("Phone settings unavailable."));
  }, []);

  if (DEMO) return null;
  const s = view?.settings;

  const save = async (patch: SavedNotifySettings) => {
    setBusy(true);
    try {
      const v = await call("PUT", "/api/notify", patch);
      if (v.ok) { setView(v); setQuiet(v.settings.quiet); setNote("Saved."); } else setNote(v.error || "Not saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setNote("Sending…");
    try {
      const v = await call("POST", "/api/notify/test", {});
      if (v.ok) { setView(v); setNote("Test sent. It should arrive on your phone within a few seconds."); } else setNote(v.error || "Test failed.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleKind = (key: string) => {
    if (!s) return;
    void save({ kinds: s.kinds.includes(key) ? s.kinds.filter((k) => k !== key) : [...s.kinds, key] });
  };

  return (
    <details className="alerts-phone">
      <summary>
        Phone (ntfy){s ? ` · ${s.configured ? (s.enabled ? `on · ${s.minSeverity} and up` : "off") : "not set up"}` : ""}
      </summary>
      {!s ? <p className="note">{note || "Loading…"}</p> : !s.configured ? (
        <div className="alerts-phone-setup">
          <p className="note">
            Push alerts to your phone with the free ntfy app. Add <code>NTFY_TOPIC=…</code> to <code>.env.local</code> and restart the API, then subscribe to the same topic in the app.
            Anyone who knows the topic can read it, so use a long random one.
          </p>
          <button onClick={() => setSuggest(topicFrom(crypto.getRandomValues(new Uint8Array(24))))}>Suggest a topic</button>
          {suggest ? <code className="alerts-phone-topic">{suggest}</code> : null}
        </div>
      ) : (
        <div className="alerts-phone-body">
          <p className="note">
            Topic <code>{s.topic}</code> on {s.server.replace(/^https?:\/\//, "")}{s.token ? " · access token set" : ""} · {view.sentLastHour}/{s.maxPerHour} sent in the last hour{view.held ? ` · ${view.held} held by the limit` : ""}
            {s.clickUrl ? " · tapping opens the hosted terminal" : " · no click link (set PUBLIC_ORIGIN for one)"}
          </p>
          <div className="alerts-opts">
            <label><input type="checkbox" checked={s.enabled} disabled={busy} onChange={() => void save({ enabled: !s.enabled })} /> Send to phone</label>
            <label>
              Minimum{" "}
              <select value={s.minSeverity} disabled={busy} onChange={(e) => void save({ minSeverity: e.target.value })}>
                {NOTIFY_LEVELS.map((lv) => <option key={lv} value={lv}>{lv.toUpperCase()}</option>)}
              </select>
            </label>
          </div>
          <div className="alerts-opts" role="group" aria-label="Alert kinds sent to the phone">
            {NOTIFY_KINDS.map((g) => (
              <label key={g.key}><input type="checkbox" checked={s.kinds.includes(g.key)} disabled={busy} onChange={() => toggleKind(g.key)} /> {g.label}</label>
            ))}
          </div>
          <form className="alerts-opts" onSubmit={(e) => { e.preventDefault(); void save({ quiet: quiet.trim() }); }}>
            <label>
              Quiet hours (ET){" "}
              <input className="alerts-phone-quiet" value={quiet} placeholder="22:00-07:00" pattern="^$|^\d{1,2}:\d{2}-\d{1,2}:\d{2}$" onChange={(e) => setQuiet(e.target.value)} />
            </label>
            <button type="submit" disabled={busy || quiet === s.quiet}>Save</button>
            <label><input type="checkbox" checked={s.quietHigh} disabled={busy} onChange={() => void save({ quietHigh: !s.quietHigh })} /> HIGH still sends</label>
          </form>
          <div className="alerts-opts">
            <button onClick={() => void test()} disabled={busy}>Send test notification</button>
          </div>
          {view.recent.length ? (
            <ul className="alerts-phone-recent">
              {view.recent.slice(0, 4).map((r) => (
                <li key={r.id} title={r.error || r.id}><b>{r.status}</b> {when(new Date(r.at).toISOString())} · {r.title}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {note && s ? <p className="note alerts-phone-note" role="status">{note}</p> : null}
    </details>
  );
}
