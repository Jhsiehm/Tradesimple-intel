import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { billKey, markFinal, passageRank } from "../server/votemap.mjs";
import { districtAt, districtCode, districtNear, geocodeStreets } from "../server/hq.mjs";
import { houseCategory, senateCategory } from "../shared/voteCategory.mjs";

test("billKey joins Congress.gov labels to index bill strings", () => {
  assert.equal(billKey("H.R. 2400"), "HR2400");
  assert.equal(billKey("hr2400"), "HR2400");
  assert.equal(billKey("S.J.Res. 197"), "SJRES197");
  assert.equal(billKey(null), "");
});

test("passageRank puts concurrence above passage and procedure at zero", () => {
  assert.equal(passageRank("On motion that the House agree to the Senate amendments"), 4);
  assert.equal(passageRank("On Concurring in Senate Amendment"), 4);
  assert.equal(passageRank("On Passage of the Bill"), 3);
  assert.equal(passageRank("On Motion to Suspend the Rules and Pass, as Amended"), 3);
  assert.equal(passageRank("On Agreeing to the Resolution"), 3);
  assert.equal(passageRank("On the Cloture Motion"), 0);
  assert.equal(passageRank("On the Amendment S.Amdt. 6715"), 0);
  assert.equal(passageRank("On Motion to Recommit"), 0);
  assert.equal(passageRank("On Overriding the Veto"), 5);
  assert.equal(passageRank("Roll call"), 1);
});

test("markFinal flags one roll per chamber: best rank, then latest", () => {
  const rolls = markFinal([
    { chamber: "house", roll: 190, date: "2025-07-03", question: "On motion that the House agree to the Senate amendment", final: false },
    { chamber: "house", roll: 145, date: "2025-05-22", question: "On Passage", final: false },
    { chamber: "senate", roll: 372, date: "2025-07-01", question: "On Passage of the Bill", final: false },
    { chamber: "senate", roll: 371, date: "2025-07-01", question: "On the Amendment S.Amdt. 2360", final: false },
    { chamber: "senate", roll: 300, date: "2025-06-28", question: "On the Motion to Proceed", final: false }
  ]);
  assert.deepEqual(rolls.filter((r) => r.final).map((r) => `${r.chamber}-${r.roll}`), ["house-190", "senate-372"]);
});

test("geocodeStreets spells number words, drops suites and PO boxes, numbered lines first", () => {
  assert.deepEqual(geocodeStreets("ONE APPLE PARK WAY", ""), ["1 APPLE PARK WAY"]);
  assert.deepEqual(geocodeStreets("2788 SAN TOMAS EXPRESSWAY", "SUITE 400"), ["2788 SAN TOMAS EXPRESSWAY"]);
  assert.deepEqual(geocodeStreets("P.O. BOX 8999", ""), []);
  assert.deepEqual(geocodeStreets("PRUDENTIAL TOWER", "800 BOYLSTON ST., 34TH FLOOR"), ["800 BOYLSTON ST", "PRUDENTIAL TOWER"]);
});

test("districtCode formats GEOIDs and at-large seats", () => {
  assert.equal(districtCode("0617"), "CA-17");
  assert.equal(districtCode("0200"), "AK-AL");
  assert.equal(districtCode("1198"), "DC-AL");
  assert.equal(districtCode("9917"), null);
});

test("districtAt finds 119th districts by point-in-polygon, including wrapped Alaska", () => {
  assert.equal(districtAt(-122.0091, 37.3349), "0617");
  assert.equal(districtAt(-149.9, 61.2), "0200");
  assert.equal(districtAt(-40, 30), null);
  assert.equal(districtNear(-40, 30).geoid, null);
});

test("Alaska at-large uses the same west-of-antimeridian convention as the state file", () => {
  const geo = JSON.parse(fs.readFileSync(new URL("../data/geo/cd119.geojson", import.meta.url), "utf8"));
  const ak = geo.features.find((f) => String(f.properties.GEOID) === "0200");
  const xs = ak.geometry.coordinates.flat(3).filter((_, i) => i % 2 === 0);
  assert.ok(xs.every((x) => x < 0), "no positive longitudes left to draw a band across Canada");
});

test("houseCategory: delegate, vacant, party filter, best cast", () => {
  assert.equal(houseCategory("1198", []), "Delegate");
  assert.equal(houseCategory("0617", []), "Vacant");
  assert.equal(houseCategory("0617", [{ party: "D", vote: "Nay" }]), "Nay");
  assert.equal(houseCategory("0617", [{ party: "D", vote: "Nay" }], "R"), "");
  assert.equal(houseCategory("0617", [{ party: "R", vote: "Not voting" }, { party: "R", vote: "Yea" }]), "Yea");
});

test("senateCategory: both, split, half, absent, filtered", () => {
  assert.equal(senateCategory(["Yea", "Yea"]), "Yea");
  assert.equal(senateCategory(["Nay", "Nay"]), "Nay");
  assert.equal(senateCategory(["Yea", "Nay"]), "Split");
  assert.equal(senateCategory(["Yea", "Not voting"]), "Half yea");
  assert.equal(senateCategory(["Nay", "Not voting"]), "Half nay");
  assert.equal(senateCategory(["Not voting", "Not voting"]), "Not voting");
  assert.equal(senateCategory(["Present", "Present"]), "Present");
  assert.equal(senateCategory([]), "Vacant");
  assert.equal(senateCategory([], true), "");
  assert.equal(senateCategory(["Yea"], true), "Yea");
});
