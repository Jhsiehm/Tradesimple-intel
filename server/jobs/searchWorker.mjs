/** Worker thread for the signal search: ranks the variants off the API's event loop and posts progress. */
import { parentPort, workerData } from "node:worker_threads";
import { evaluateVariants } from "../../shared/signalSearch.mjs";

let last = 0;
try {
  const outcome = evaluateVariants({
    ...workerData,
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - last < 200 && done < total) return;
      last = now;
      parentPort.postMessage({ type: "progress", done, total });
    }
  });
  parentPort.postMessage({ type: "done", outcome });
} catch (err) {
  parentPort.postMessage({ type: "error", error: err.message });
}
