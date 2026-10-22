/** Bounded, declarative study plans. No user text is executable. */
export const WORKFLOW_LIMITS = Object.freeze({
  nodes: 16,
  sources: 4,
  rows: 5000,
  outputs: 8,
  aggregateRows: 50000,
  fields: 80,
  inputBytes: 8 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  aggregateBytes: 32 * 1024 * 1024,
});
const unsafe = new Set(["__proto__", "prototype", "constructor"]);
export function fieldName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) && !unsafe.has(value);
}
export function plainObject(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw Error(`${label} must be a plain object.`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (unsafe.has(key) || descriptor.get || descriptor.set || !descriptor.enumerable)
      throw Error(`${label} contains an unsafe property.`);
  }
  return value;
}
export function plainArray(value, label) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length
  )
    throw Error(`${label} must be a plain array.`);
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== value.length + 1) throw Error(`${label} must be a dense array without extra properties.`);
  for (const key of keys) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!/^(0|[1-9][0-9]*)$/.test(key) || descriptor.get || descriptor.set || !descriptor.enumerable)
      throw Error(`${label} contains an unsafe array property.`);
  }
  return value;
}
function exact(value, keys, label) {
  plainObject(value, label);
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length) throw Error(`${label} has unknown fields: ${unexpected.join(", ")}.`);
}
function text(value, label, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error(`${label} requires 1–${max} characters.`);
  return value.trim();
}
function names(value, label, max, allowEmpty = false) {
  plainArray(value, label);
  if (
    value.length > max ||
    (!allowEmpty && !value.length) ||
    value.some((item) => !fieldName(item)) ||
    new Set(value).size !== value.length
  )
    throw Error(`${label} requires distinct safe field names (maximum ${max}).`);
  return [...value];
}
export function workflowTime(value) {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const millis = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value
      ? { value, start: millis, end: millis + 86400000 - 1, precision: "day" }
      : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return { value, start: millis, end: millis, precision: "instant" };
}
export function scalar(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
function cleanNode(node, index, prior) {
  plainObject(node, `Node ${index + 1}`);
  if (!fieldName(node.id) || prior.has(node.id)) throw Error("Node IDs must be unique safe field names.");
  const shapes = {
    source: ["snapshotId", "mode"],
    filter: ["input", "field", "operator", "value"],
    join: ["left", "right", "keys", "how"],
    difference: ["input", "left", "right", "output"],
    summarize: ["input", "value", "groupBy"],
  };
  if (!Object.hasOwn(shapes, node.op)) throw Error(`Unknown workflow operation ${String(node.op)}.`);
  exact(node, ["id", "op", ...shapes[node.op]], `Node ${node.id}`);
  for (const key of shapes[node.op]) if (!Object.hasOwn(node, key)) throw Error(`Node ${node.id} requires ${key}.`);
  const result = { ...node };
  const references = node.op === "source" ? [] : node.op === "join" ? [node.left, node.right] : [node.input];
  for (const reference of references)
    if (!prior.has(reference)) throw Error(`Node ${node.id} must reference an earlier node: ${String(reference)}.`);
  if (node.op === "source") {
    result.snapshotId = text(node.snapshotId, "Snapshot ID", 200);
    if (!["first-publication", "latest-known"].includes(node.mode))
      throw Error(`Source ${node.id} requires an explicit revision mode.`);
  } else if (node.op === "filter") {
    if (
      !fieldName(node.field) ||
      !["eq", "ne", "gt", "gte", "lt", "lte"].includes(node.operator) ||
      !scalar(node.value)
    )
      throw Error(`Filter ${node.id} requires a safe field, explicit comparison and scalar literal.`);
    if (["gt", "gte", "lt", "lte"].includes(node.operator) && typeof node.value !== "number")
      throw Error(`Ordered filter ${node.id} requires a finite numeric literal.`);
  } else if (node.op === "join") {
    plainArray(node.keys, `Join ${node.id} keys`);
    if (node.left === node.right || !["inner", "left"].includes(node.how) || !node.keys.length || node.keys.length > 4)
      throw Error(`Join ${node.id} requires different inputs, explicit inner/left mode and 1–4 exact keys.`);
    result.keys = node.keys.map((key) => {
      exact(key, ["left", "right"], `Join ${node.id} key`);
      if (!fieldName(key.left) || !fieldName(key.right)) throw Error(`Join ${node.id} has an unsafe key.`);
      return { left: key.left, right: key.right };
    });
    if (
      new Set(node.keys.map((key) => key.left)).size !== node.keys.length ||
      new Set(node.keys.map((key) => key.right)).size !== node.keys.length
    )
      throw Error(`Join ${node.id} repeats a key field.`);
  } else if (node.op === "difference") {
    if (
      ![node.left, node.right, node.output].every(fieldName) ||
      node.output.length > 48 ||
      ["id", "lineage", "metric", "unit", "entityId", "eventAt", "availableAt", "derivedAvailableAt"].includes(
        node.output,
      )
    )
      throw Error(`Difference ${node.id} requires safe operand and new output fields.`);
  } else result.groupBy = names(node.groupBy, `Summary ${node.id} groups`, 4, true);
  if (node.op === "summarize" && !fieldName(node.value))
    throw Error(`Summary ${node.id} requires a safe numeric value field.`);
  return result;
}
export function cleanWorkflowProtocol(input) {
  const keys = [
    "title",
    "question",
    "hypothesis",
    "family",
    "population",
    "unitOfAnalysis",
    "outcome",
    "comparison",
    "from",
    "to",
    "knownAt",
    "assumptions",
    "unresolved",
    "nodes",
    "outputs",
  ];
  exact(input, keys, "Workflow protocol");
  for (const key of keys) if (!Object.hasOwn(input, key)) throw Error(`Workflow protocol requires ${key}.`);
  const protocol = {};
  for (const key of ["title", "question", "hypothesis", "population", "unitOfAnalysis", "outcome", "comparison"])
    protocol[key] = text(input[key], key, key === "title" ? 200 : 4000);
  if (!["descriptive", "predictive", "causal", "strategy", "document"].includes(input.family))
    throw Error("Choose a supported research family.");
  protocol.family = input.family;
  for (const key of ["assumptions", "unresolved"]) {
    plainArray(input[key], key);
    if (input[key].length > 20) throw Error(`${key} requires an array of at most 20 statements.`);
    protocol[key] = input[key].map((value) => text(value, key, 1000));
  }
  const blockedDesign = protocol.family !== "descriptive" || protocol.unresolved.length > 0;
  const from = workflowTime(input.from),
    to = workflowTime(input.to),
    knownAt = workflowTime(input.knownAt);
  for (const [key, parsed] of [
    ["from", from],
    ["to", to],
    ["knownAt", knownAt],
  ]) {
    if (input[key] === null && blockedDesign) {
      protocol[key] = null;
      continue;
    }
    if (!parsed || (key !== "knownAt" && parsed.precision !== "day"))
      throw Error(
        "Use valid from/to dates in order and an explicit UTC knownAt cutoff; only blocked designs may leave them null.",
      );
    protocol[key] = parsed.value;
  }
  if (from && to && from.start > to.start) throw Error("Use valid from/to dates in order.");
  plainArray(input.nodes, "Workflow nodes");
  if ((!blockedDesign && !input.nodes.length) || input.nodes.length > WORKFLOW_LIMITS.nodes)
    throw Error("Use 1–16 workflow nodes for an executable descriptive plan.");
  const prior = new Set();
  protocol.nodes = input.nodes.map((node, index) => {
    const cleaned = cleanNode(node, index, prior);
    prior.add(cleaned.id);
    return cleaned;
  });
  const sources = protocol.nodes.filter((node) => node.op === "source");
  if ((!blockedDesign && !sources.length) || sources.length > WORKFLOW_LIMITS.sources)
    throw Error("Use 1–4 source nodes for an executable descriptive plan.");
  protocol.outputs = names(input.outputs, "Outputs", WORKFLOW_LIMITS.outputs, blockedDesign);
  if (protocol.outputs.some((id) => !prior.has(id))) throw Error("Outputs must name existing nodes.");
  return protocol;
}
