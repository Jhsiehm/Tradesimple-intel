import { Worker } from "node:worker_threads";
let active = 0;

/** Bounded calculation worker; no database or network calls are performed by the pure engine. */
export function runWorkflowEvaluation(inputs, engineHash, { signal, timeoutMs = 15000 } = {}) {
  if (signal?.aborted) return Promise.reject(Error("Workflow evaluation was cancelled."));
  if (active >= 2)
    return Promise.reject(Error("Two workflow evaluations are already running. Retry after they finish."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./workerEntry.mjs", import.meta.url), {
      workerData: { inputs, engineHash },
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 192, stackSizeMb: 4 },
    });
    active++;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      active--;
      void worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(Error("Workflow evaluation was cancelled."));
    const timer = setTimeout(
      () => finish(Error("Workflow evaluation exceeded its 15-second runtime budget.")),
      Math.min(15000, Math.max(1, timeoutMs)),
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (message) => {
      if (message?.type === "workflow-result") finish(null, message.result);
      else if (message?.type === "workflow-error") finish(Error(message.error));
    });
    worker.on("error", () => finish(Error("Workflow calculation worker failed or exceeded its memory budget.")));
    worker.on("exit", () => finish(Error("Workflow calculation worker exited without a frozen result.")));
  });
}
