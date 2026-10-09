import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "../lib/api";
import type { BacktestSpec } from "../../shared/backtestSpec.mjs";
import type { BtFailure, BtOptions, BtRun } from "./types";
import { saveSpec } from "./seed";

export type BtState =
  | { phase: "idle" }
  | { phase: "running"; since: number; note: string }
  | { phase: "done"; run: BtRun }
  | { phase: "error"; error: string; missing?: string };

const RETRY_MS = 9_000;
const MAX_RETRIES = 6;

/** Form options once, and a runner that retries while prices are still loading on the server. */
export function useBacktest() {
  const [options, setOptions] = useState<BtOptions | null>(null);
  const [state, setState] = useState<BtState>({ phase: "idle" });
  const turn = useRef(0);
  const timer = useRef(0);

  useEffect(() => {
    let live = true;
    api<BtOptions>("/api/backtest").then((o) => { if (live && o.ok) setOptions(o); }).catch(() => null);
    return () => { live = false; window.clearTimeout(timer.current); };
  }, []);

  const run = useCallback((spec: BacktestSpec) => {
    const mine = ++turn.current;
    window.clearTimeout(timer.current);
    saveSpec(spec);
    const attempt = (n: number) => {
      setState({ phase: "running", since: Date.now(), note: n ? `Prices still loading on the server (try ${n + 1})…` : "Reading disclosures and loading prices…" });
      post<BtRun | BtFailure>("/api/backtest", { spec })
        .then((res) => {
          if (mine !== turn.current) return;
          if (res.ok && !res.building) { setState({ phase: "done", run: res }); return; }
          if (res.ok) {
            // Partial: some tickers were still loading. Show it, then ask again so the cache fills in.
            setState({ phase: "done", run: res });
            if (n < MAX_RETRIES) timer.current = window.setTimeout(() => { if (mine === turn.current) attempt(n + 1); }, RETRY_MS);
            return;
          }
          if (res.building && n < MAX_RETRIES) { timer.current = window.setTimeout(() => attempt(n + 1), RETRY_MS); return; }
          setState({ phase: "error", error: res.error, missing: res.missing });
        })
        .catch((err: Error) => { if (mine === turn.current) setState({ phase: "error", error: err.message }); });
    };
    attempt(0);
  }, []);

  const clear = useCallback(() => { turn.current += 1; window.clearTimeout(timer.current); setState({ phase: "idle" }); }, []);
  return { options, state, run, clear };
}
