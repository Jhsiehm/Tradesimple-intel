import { test } from "node:test";
import assert from "node:assert/strict";
import * as constants from "../shared/constants.mjs";
import * as intel from "../shared/intel.mjs";
import * as card from "../shared/card.mjs";
import * as botlib from "../scripts/botlib.mjs";

test("shared constants agree with the modules that still define their own copies", () => {
  assert.equal(constants.NEAR_DAYS, intel.NEAR_DAYS);
  assert.equal(constants.DAY_MS, intel.DAY_MS);
  assert.equal(card.LATE_DAYS, constants.LATE_DAYS);
  assert.equal(botlib.LATE_DAYS, constants.LATE_DAYS);
  assert.equal(botlib.NEAR_DAYS, constants.NEAR_DAYS);
});
