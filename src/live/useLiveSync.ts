import { useEffect, useRef } from "react";
import { putSymbols, useLive } from "./stream";

/**
 * Keep the poller's list equal to the browser watchlist (order included), also after the API restarts.
 * Sends only when this browser's list changes or its stream (re)opens: another tab or device with a
 * different watchlist also writes the one server list, and answering its push would loop forever.
 * A (re)open never sends an empty list, so opening a fresh browser does not stop the phone alerts.
 */
export function useLiveSync(symbols: string[]) {
  const live = useLive();
  const want = symbols.join(",");
  const have = useRef("");
  const sent = useRef<string | null>(null);
  have.current = live.symbols.join(",");
  useEffect(() => {
    if (live.link !== "open") { sent.current = null; return; }
    const changed = sent.current !== null && sent.current !== want;
    if (want === have.current || (!changed && !want)) { sent.current = want; return; }
    sent.current = want;
    void putSymbols(want ? want.split(",") : []);
  }, [want, live.link]);
}
