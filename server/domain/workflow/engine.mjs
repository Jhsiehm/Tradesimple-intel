import { readdirSync, readFileSync } from "node:fs";
import { hashOf } from "../research-store.mjs";
import { sourceResolverText } from "./sources.mjs";

export function workflowEngine() {
  const root = new URL("../../../shared/", import.meta.url);
  const files = Object.fromEntries(
    readdirSync(root)
      .filter((name) => /^workflow[A-Za-z]*\.mjs$/.test(name))
      .sort()
      .map((name) => [name, readFileSync(new URL(name, root), "utf8")]),
  );
  files["observationSources.mjs"] = sourceResolverText();
  if (!files["workflow.mjs"] || Buffer.byteLength(JSON.stringify(files)) > 1024 * 1024)
    throw Error("Workflow engine is missing or exceeds its 1 MiB budget.");
  return { hash: hashOf(files), files };
}
