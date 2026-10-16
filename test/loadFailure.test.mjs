import { test } from "node:test";
import assert from "node:assert/strict";
import { needsPageReload } from "../src/ui/loadFailure.ts";

test("failed lazy assets need a fresh page instead of retrying React's cached rejection", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: http://localhost/assets/MapFrame-old.js",
    "error loading dynamically imported module: https://example.com/assets/Board.js",
    "Importing a module script failed.",
    "Failed to load module script: Expected a JavaScript module script",
    "Unable to preload CSS for /assets/Board-old.css",
    "Loading chunk 12 failed.",
  ])
    assert.equal(needsPageReload(new Error(message)), true, message);
});

test("ordinary map, API and rendering errors keep the local retry", () => {
  for (const message of [
    "Failed to fetch",
    "WebGL context lost",
    "Cannot read properties of undefined",
    "",
    "Network request timed out",
  ]) {
    assert.equal(needsPageReload(new Error(message)), false, message);
  }
});
