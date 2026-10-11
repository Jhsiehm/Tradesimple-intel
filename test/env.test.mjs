import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "../server/lib/env.mjs";
import { serverEnv } from "./fixtures/serverEnv.mjs";

test("offline tests never load local credentials; normal startup still loads unset values", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "intel-env-"));
  const key = "INTEL_ENV_TEST_SENTINEL";
  const before = { test: process.env.INTEL_TEST, value: process.env[key] };
  try {
    writeFileSync(path.join(root, ".env.local"), `${key}=local-only\n`);
    delete process.env[key];
    process.env.INTEL_TEST = "1";
    loadEnv(root);
    assert.equal(process.env[key], undefined);
    delete process.env.INTEL_TEST;
    loadEnv(root);
    assert.equal(process.env[key], "local-only");
    process.env[key] = "explicit";
    loadEnv(root);
    assert.equal(process.env[key], "explicit");
    assert.equal(serverEnv()[key], undefined, "test server environments pass only OS essentials");
  } finally {
    for (const [name, value] of [["INTEL_TEST", before.test], [key, before.value]]) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
