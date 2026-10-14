import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_REGIONS } from "../shared/navRegions.mjs";
import { bboxOf, inBox } from "../server/air.mjs";

const box = (id) => bboxOf(NAV_REGIONS.find((region) => region.id === id));

test("wide continent presets keep aircraft scoped instead of becoming a worldwide feed", () => {
  assert.equal(box("world").global, true);
  assert.equal(box("asia").global, false);
  assert.equal(box("antarctica").global, false);
  assert.equal(inBox({ lat: -77, lon: 166 }, box("antarctica")), true);
  assert.equal(inBox({ lat: 40, lon: -74 }, box("antarctica")), false);
  assert.equal(inBox({ lat: 35, lon: 139 }, box("asia")), true);
  assert.equal(inBox({ lat: 40, lon: -74 }, box("asia")), false);
});

test("Oceania spans both sides of the date line without including the Atlantic", () => {
  assert.equal(inBox({ lat: -18, lon: 178 }, box("oceania")), true);
  assert.equal(inBox({ lat: -14, lon: -172 }, box("oceania")), true);
  assert.equal(inBox({ lat: -33, lon: 151 }, box("oceania")), true);
  assert.equal(inBox({ lat: -20, lon: -20 }, box("oceania")), false);
  assert.equal(inBox({ lat: 40, lon: 150 }, box("oceania")), false);
});
