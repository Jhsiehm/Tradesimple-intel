/** Fixed allowlisted methods only. Researcher data is never evaluated as code. */
import { parentPort, workerData } from "node:worker_threads";
import { assessPolicyReadiness, evaluatePolicyStudy } from "../../../shared/policyStudy.mjs";

try {
  const { operation, protocol, evidence, asOf } = workerData;
  const method =
    operation === "readiness" ? assessPolicyReadiness : operation === "evaluate" ? evaluatePolicyStudy : null;
  if (!method) throw Error("Unknown policy analysis operation.");
  parentPort.postMessage({ kind: "policy-analysis-result", ok: true, result: method(protocol, evidence, { asOf }) });
} catch (error) {
  parentPort.postMessage({
    kind: "policy-analysis-result",
    ok: false,
    error: error instanceof Error ? error.message : "Policy analysis failed.",
  });
}
