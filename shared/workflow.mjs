/** Composable descriptive analyses over frozen, externally resolved observation inputs. */
import { cleanWorkflowProtocol, WORKFLOW_LIMITS, plainObject } from "./workflowProtocol.mjs";
import { boundedJson, sourceRows } from "./workflowRows.mjs";
import { filterRows, joinRows, differenceRows, summarizeRows } from "./workflowOperations.mjs";
export { cleanWorkflowProtocol, WORKFLOW_LIMITS } from "./workflowProtocol.mjs";
export const WORKFLOW_VERSION = 1;
const LIMITATIONS = [
  "Descriptive transformations of explicitly pinned observations only. No causal, predictive, strategy, significance or investability validity is established.",
  "Revision selection is supplied by the domain resolver and frozen with its provenance and decisions. Missing history, inaccurate availability assertions and incomplete source coverage cannot be detected from these rows alone.",
  "Source eligibility uses eventAt within the requested dates and availableAt at or before knownAt. Date-only availability is known at the end of its UTC day; event and publication times are never substituted.",
  "The knownAt cutoff restricts supplied observation availability; it does not establish that a researcher, annotation, current identity mapping or retrieved snapshot existed at that historical time.",
  "Joined rows retain original left availableAt and prefixed right fields. derivedAvailableAt is the latest availability bound of all required operands, including in differences and summaries; original source timestamps must not be mistaken for derived feature availability.",
  "Joins require exact typed keys and one-to-one non-null key values on both inputs. Missing/null keys do not match; time strings with different precision or representation are not equated.",
  "Differences preserve ordered operand metric and observation semantics. Matching units does not establish economic comparability; subtraction is the protocol author’s explicit descriptive choice.",
  "Summaries report observed numeric n, mean, min and max, excluding missing values. They do not estimate sampling uncertainty, validate independent observations, or turn missing records into zero.",
];
const blocked = (gaps, steps = []) => ({
  version: WORKFLOW_VERSION,
  status: "blocked",
  executed: false,
  claimScope: "descriptive",
  gaps,
  outputs: {},
  steps,
  limitations: [...LIMITATIONS],
});
export function evaluateWorkflow(input, sources) {
  let protocol;
  try {
    protocol = cleanWorkflowProtocol(input);
  } catch (error) {
    return blocked([`Invalid protocol: ${error.message}`]);
  }
  const gaps = [...protocol.unresolved.map((item) => `Unresolved design requirement: ${item}`)];
  if (protocol.family !== "descriptive")
    gaps.unshift(
      `Research family ${protocol.family} is saved as a design only; this engine supports descriptive calculations.`,
    );
  for (const field of ["from", "to", "knownAt"])
    if (protocol[field] === null) gaps.push(`Unresolved design requirement: ${field} has not been specified.`);
  if (gaps.length) return blocked(gaps);
  const tables = new Map(),
    steps = [];
  let current = "inputs",
    aggregateRows = 0,
    aggregateBytes = 0;
  try {
    plainObject(sources, "Workflow sources");
    boundedJson(sources, WORKFLOW_LIMITS.inputBytes, "Workflow inputs");
    const expected = new Set(protocol.nodes.filter((node) => node.op === "source").map((node) => node.id));
    if (Object.keys(sources).some((key) => !expected.has(key)))
      throw Error("Workflow inputs include undeclared sources.");
    for (const node of protocol.nodes) {
      current = node.id;
      let table;
      if (node.op === "source") {
        if (!Object.hasOwn(sources, node.id)) throw Error(`Pinned source ${node.id} is missing.`);
        table = sourceRows(node, sources[node.id], protocol);
      } else if (node.op === "filter") table = filterRows(node, tables.get(node.input));
      else if (node.op === "join") table = joinRows(node, tables.get(node.left), tables.get(node.right));
      else if (node.op === "difference") table = differenceRows(node, tables.get(node.input));
      else table = summarizeRows(node, tables.get(node.input));
      aggregateRows += table.rows.length;
      if (table.rows.length > WORKFLOW_LIMITS.rows || aggregateRows > WORKFLOW_LIMITS.aggregateRows)
        throw Error("Workflow exceeds its table or aggregate row budget.");
      if (table.rows.some((row) => Object.keys(row).length > WORKFLOW_LIMITS.fields))
        throw Error("Workflow exceeds its table field budget.");
      aggregateBytes += boundedJson(table, WORKFLOW_LIMITS.outputBytes, `Node ${node.id} table`);
      if (aggregateBytes > WORKFLOW_LIMITS.aggregateBytes)
        throw Error("Workflow exceeds its aggregate intermediate byte budget.");
      tables.set(node.id, table);
      steps.push({
        id: node.id,
        op: node.op,
        status: table.rows.length ? "completed" : "empty",
        ledger: table.ledger,
        ...(table.source ? { source: table.source } : {}),
      });
    }
    const outputs = Object.fromEntries(
      protocol.outputs.map((id) => [id, { rows: tables.get(id).rows, count: tables.get(id).rows.length }]),
    );
    const result = {
      version: WORKFLOW_VERSION,
      status: Object.values(outputs).some((output) => output.count) ? "completed" : "empty",
      executed: true,
      claimScope: "descriptive",
      gaps: [],
      outputs,
      steps,
      limitations: [...LIMITATIONS],
    };
    boundedJson(result, WORKFLOW_LIMITS.outputBytes, "Workflow result");
    return result;
  } catch (error) {
    return blocked([`Node ${current}: ${error.message}`], steps);
  }
}
