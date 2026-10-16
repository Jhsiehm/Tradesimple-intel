import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hashOf } from "./research-store.mjs";
import { IMPORT_LIMIT, ROW_LIMIT } from "./research-events.mjs";
export function sqliteConfigs(env = process.env) {
  let configs;
  try {
    configs = JSON.parse(env.RESEARCH_SQLITE_CONNECTORS || "{}");
  } catch {
    throw Error("Database connector configuration is not valid JSON.");
  }
  if (!configs || typeof configs !== "object" || Array.isArray(configs))
    throw Error("RESEARCH_SQLITE_CONNECTORS must be a JSON object.");
  return configs;
}
export async function readSqliteConnector(id, { env = process.env, timeoutMs = 15000 } = {}) {
  const configs = sqliteConfigs(env),
    config = Object.hasOwn(configs, id) ? configs[id] : null;
  if (
    !config ||
    typeof config.file !== "string" ||
    !path.isAbsolute(config.file) ||
    config.file.length > 4096 ||
    typeof config.query !== "string" ||
    config.query.length > 16000
  )
    throw Error("Database connector requires an absolute server file path and a fixed query up to 16,000 characters.");
  const query = config.query.trim().replace(/;\s*$/, "");
  if (!/^(SELECT|WITH)\b/i.test(query) || query.includes(";"))
    throw Error("Database connector requires one SELECT or WITH query without internal semicolons.");
  const retrievedAt = new Date().toISOString();
  const output = await new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--max-old-space-size=64", fileURLToPath(new URL("./sqlite-connector-worker.mjs", import.meta.url))],
      {
        env: {},
        timeout: Math.min(Math.max(timeoutMs, 1), 15000),
        killSignal: "SIGKILL",
        maxBuffer: IMPORT_LIMIT + 1024,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          reject(
            Error(
              "Database connector exceeded its time or output limit, or its query process failed. Narrow the configured query.",
            ),
          );
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (!result.ok) throw Error(result.error);
          resolve(result.items);
        } catch (error) {
          reject(
            Error(
              /^Database connector/.test(error.message)
                ? error.message
                : "Database connector returned an invalid response.",
            ),
          );
        }
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ file: config.file, query, rowLimit: ROW_LIMIT, byteLimit: IMPORT_LIMIT }));
  });
  const items = output;
  const evidence = {
    schemaVersion: 1,
    kind: "sqlite",
    connector: id,
    queryHash: hashOf(query),
    retrievedAt,
    completedAt: new Date().toISOString(),
    rows: items.length,
    rowsHash: hashOf(items),
    consistency: "single-read-transaction",
  };
  const content = JSON.stringify({ items, databaseEvidence: evidence });
  if (Buffer.byteLength(content) > IMPORT_LIMIT)
    throw Error("Database connector records and metadata exceed 2 MiB. Narrow the configured query.");
  return { content, format: "json", source: `SQLite connector: ${id}` };
}
