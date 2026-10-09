import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueEconIds } from "../server/macro.mjs";

test("uniqueEconIds keeps case-only name variants as separate rows and drops exact repeats", () => {
  const id = "econ:2026-09-30:united-states:pce-price-index:0830";
  const t = 1790771400000;
  const mom = { id, t, country: "United States", event: "PCE price index", actual: "0.3%" };
  const yoy = { id, t, country: "United States", event: "PCE Price index", actual: "3.4%" };
  const out = uniqueEconIds([mom, yoy, { ...mom }]);
  assert.deepEqual(out.map((e) => [e.id, e.actual]), [[id, "0.3%"], [`${id}:2`, "3.4%"]]);
});
