import { useEffect, useState } from "react";
import { checkHealth, durationLabel, type LiveStatus as Check } from "../../shared/live.mjs";
import { when } from "../lib/api";
import { markLiveSeen, useLive } from "./stream";
import "./live.css";

const LINK: Record<string, string> = { off: "demo · no live feed", connecting: "connecting…", open: "live", retrying: "reconnecting…" };

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

function tip(c: Check, now: number) {
  const next = c.nextAt ? Date.parse(c.nextAt) - now : NaN;
  return [
    `${c.label} · ${c.source}`,
    `Checks every ${durationLabel(c.everyMs)}. ${c.publishes}`,
    c.lastChecked ? `Last check ${when(c.lastChecked)}${c.ms != null ? ` (${durationLabel(c.ms)})` : ""}` : "Not checked yet",
    c.running ? "Checking now" : Number.isFinite(next) ? `Next check in ${durationLabel(Math.max(0, next))}` : "",
    c.failures ? `${c.failures} failure${c.failures === 1 ? "" : "s"} in a row: ${c.lastError}` : "",
    c.off || c.note
  ].filter(Boolean).join("\n");
}

/** One line per poller check: when it last ran, when it runs next, failures, and checks switched off (no key). */
export function LiveStatus() {
  const live = useLive();
  const now = useNow(5000);
  const failing = live.checks.filter((c) => c.failures > 0).length;
  return (
    <span className={`live-status link-${live.link}`} aria-label="Live poller status">
      <span className="live-link" title={live.poller === "off" ? "The API runs with the poller off (LIVE_POLLER=off or a test run)." : "Server-sent events from the local API; reconnects after restarts."}>
        <i /> {live.poller === "off" ? "poller off" : LINK[live.link]}{failing ? ` · ${failing} failing` : ""}
      </span>
      {live.checks.map((c) => {
        const h = checkHealth(c, now);
        const next = c.nextAt ? Date.parse(c.nextAt) - now : NaN;
        return (
          <span key={c.id} className={`live-check h-${h}`} title={tip(c, now)}>
            {c.label}
            <small>
              {h === "off" ? (c.off.includes("KEY") ? "key not set" : "off")
                : c.running ? "checking"
                : h === "failing" ? `failed ×${c.failures}`
                : Number.isFinite(next) ? `next ${durationLabel(Math.max(0, next))}` : "waiting"}
            </small>
          </span>
        );
      })}
    </span>
  );
}

/** "+3 new" for one ticker: pushed detections since the user last opened it. Clicking resets it and opens the row. */
export function LiveFresh({ symbol, onOpen }: { symbol: string; onOpen?: () => void }) {
  const { fresh } = useLive();
  const counts = fresh[symbol] || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ");
  return <button className="live-fresh" onClick={() => { void markLiveSeen(symbol); onOpen?.(); }} title={`New since you last looked at ${symbol}: ${parts}. Click to mark seen.`}>+{total} new</button>;
}
