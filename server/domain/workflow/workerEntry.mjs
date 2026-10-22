import { parentPort, workerData } from "node:worker_threads";
import { evaluateWorkflow } from "../../../shared/workflow.mjs";
import { workflowEngine } from "./engine.mjs";

try {
  if (workflowEngine().hash !== workerData.engineHash)
    throw Error("The workflow engine changed before evaluation. Retry with the current version.");
  const result = evaluateWorkflow(workerData.inputs.protocol, workerData.inputs.sources);
  parentPort.postMessage({ type: "workflow-result", result });
} catch (error) {
  parentPort.postMessage({ type: "workflow-error", error: error.message || "Workflow evaluation failed." });
}
