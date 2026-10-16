import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
// The live controller imports Vite's API module for its build-time demo flag. Load the
// actual controller with that one import replaced, retaining all lifecycle behavior.
const source = fs
  .readFileSync(new URL("../src/live/stream.ts", import.meta.url), "utf8")
  .replace('import { DEMO } from "../lib/api";', "const DEMO = false;")
  .replace(
    'import { useSyncExternalStore } from "react";',
    "const useSyncExternalStore = (subscribe, getSnapshot) => ({subscribe, getSnapshot});",
  )
  .replace(
    'import type { LiveAlertRow, LiveStatus } from "../../shared/live.mjs";',
    "type LiveAlertRow = any; type LiveStatus = any;",
  );
const { stripTypeScriptTypes } = await import("node:module");
const moduleSource = stripTypeScriptTypes(source);
test("hidden tabs release their SSE connection and reconnect only while subscribed", async () => {
  const previous = { window: globalThis.window, document: globalThis.document, EventSource: globalThis.EventSource };
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const opened = [];
  class FakeSource extends EventTarget {
    static CLOSED = 2;
    closed = false;
    constructor(url) {
      super();
      this.url = url;
      opened.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.window = { setTimeout, clearTimeout };
  globalThis.document = doc;
  globalThis.EventSource = FakeSource;
  let release;
  try {
    const live = await import("data:text/javascript;base64," + Buffer.from(moduleSource).toString("base64"));
    const first = live.useLive(),
      again = live.useLive();
    assert.equal(first.subscribe, again.subscribe);
    assert.equal(first.getSnapshot, again.getSnapshot);
    release = first.subscribe(() => {});
    assert.equal(opened.length, 1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(opened[0].closed, true);
    assert.equal(first.getSnapshot().link, "paused");
    const second = live.onLivePush(() => {});
    assert.equal(opened.length, 1);
    second();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(opened.length, 2);
    release();
    release = null;
    assert.equal(opened[1].closed, true);
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(opened.length, 2);
  } finally {
    release?.();
    Object.assign(globalThis, previous);
  }
});
