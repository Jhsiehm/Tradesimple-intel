import { useState } from "react";
import { encodeSpec, type BacktestSpec } from "../../shared/backtestSpec.mjs";
import { replicateFiles, zipFiles, type ReplicateFile } from "../../shared/replicate.mjs";
import nodeScript from "../../shared/replicate/replicate.mjs.txt?raw";
import pyScript from "../../shared/replicate/replicate.py.txt?raw";

type State = { phase: "idle" } | { phase: "loading" } | { phase: "ready"; files: ReplicateFile[]; stamp: string } | { phase: "error"; error: string };

function download(name: string, data: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

async function fetchReplicate(spec: BacktestSpec) {
  for (let n = 0; n < 6; n++) {
    const res = await fetch(`/api/backtest/replicate?spec=${encodeSpec(spec)}`);
    const body = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (res.ok && body.ok) return body;
    if (res.status !== 429 && res.status !== 503) throw new Error(body.error || `HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 4_000));
  }
  throw new Error("The server is busy with other backtests. Try again in a minute.");
}

/** Everything needed to re-run one backtest outside the app: spec, trades, daily prices, scripts, methods. */
export function Replicate({ spec, compact = false }: { spec: BacktestSpec; compact?: boolean }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const load = async () => {
    setState({ phase: "loading" });
    try {
      const rep = await fetchReplicate(spec);
      const files = [
        ...replicateFiles(rep),
        { name: "replicate.mjs", mime: "text/javascript", text: nodeScript },
        { name: "replicate.py", mime: "text/x-python", text: pyScript }
      ];
      setState({ phase: "ready", files, stamp: String(rep.ranAt || new Date().toISOString()).slice(0, 10) });
    } catch (err) {
      setState({ phase: "error", error: err instanceof Error ? err.message : "Could not load the run's data." });
    }
  };
  const zip = (files: ReplicateFile[], stamp: string) => download(`backtest-${spec.source}-${stamp}.zip`, zipFiles(files.map((f) => ({ name: f.name, text: f.text }))) as BlobPart, "application/zip");

  return (
    <section className={compact ? "rep compact" : "rep"} aria-label="Replicate">
      {state.phase === "idle" ? <button className="panels-btn" onClick={load}>Replicate…</button> : null}
      {state.phase === "loading" ? <p className="rep-note">Collecting the run's trades and daily prices…</p> : null}
      {state.phase === "error" ? <p className="rep-note warn">{state.error} <button className="link" onClick={load}>Retry</button></p> : null}
      {state.phase === "ready" ? (
        <>
          <header>
            <b>Replicate this run</b>
            <button className="panels-btn" onClick={() => zip(state.files, state.stamp)}>Download all (.zip)</button>
          </header>
          <ul>
            {state.files.map((f) => (
              <li key={f.name}><button className="link" onClick={() => download(f.name, f.text, f.mime)}>{f.name}</button> <small>{(f.text.length / 1024).toFixed(1)} KB</small></li>
            ))}
          </ul>
          <p className="rep-note">Unzip, then <code>node replicate.mjs</code> (Node 18+, no packages) or <code>python3 replicate.py</code> (pandas optional). Both re-simulate from the CSVs and check the headline numbers against <code>spec.json</code>. METHODS.md lists every rule and caveat.</p>
        </>
      ) : null}
    </section>
  );
}
