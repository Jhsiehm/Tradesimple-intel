import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/sites.json");
let memo = { mtimeMs: -1, items: [] };

/** Curated district registry from data/sites.json, re-read only when the file changes. */
export function siteRegistry() {
  const { mtimeMs } = fs.statSync(FILE);
  if (mtimeMs !== memo.mtimeMs) memo = { mtimeMs, items: JSON.parse(fs.readFileSync(FILE, "utf8")) };
  return memo.items;
}
