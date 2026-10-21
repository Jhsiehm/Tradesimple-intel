import { Worker } from 'node:worker_threads';

let running = 0;
const MAX_WORKERS = 2;

/** Heavy data checks/calculations cannot monopolize the API event loop. */
export function runPolicyMethod(operation, protocol, evidence, { asOf = new Date().toISOString(), signal, timeoutMs = 15000 } = {}) {
  if (!['readiness', 'evaluate'].includes(operation)) return Promise.reject(Error('Unknown policy analysis operation.'));
  if (signal?.aborted) return Promise.reject(Error('Policy analysis cancelled.'));
  if (running >= MAX_WORKERS) return Promise.reject(Error('Other policy calculations are running. Try again shortly.'));
  running++;
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    try {
      worker = new Worker(new URL('./analysisWorker.mjs', import.meta.url), {
        workerData: { operation, protocol, evidence, asOf }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 192 }
      });
    } catch (error) { running--; reject(error); return; }
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      running--;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => finish(Error('Policy analysis cancelled.'));
    const timer = setTimeout(() => finish(Error('Policy analysis exceeded its time budget. Narrow the study or evidence sample.')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    worker.on('message', message => {
      if (message?.kind !== 'policy-analysis-result') return;
      finish(message.ok ? null : Error(message.error || 'Policy analysis failed.'), message.result);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(Error(`Policy analysis stopped before producing a result (${code}).`)); });
  });
}
