import { useEffect } from "react";
import { putSymbols, useLive } from "./stream";

/** Keep the poller's list equal to the browser watchlist (order included), also after the API restarts. */
export function useLiveSync(symbols: string[]) {
  const live = useLive();
  const want = symbols.join(",");
  const have = live.symbols.join(",");
  useEffect(() => {
    if (live.link !== "open" || want === have) return;
    void putSymbols(want ? want.split(",") : []);
  }, [want, have, live.link]);
}
