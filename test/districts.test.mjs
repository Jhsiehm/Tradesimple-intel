import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { STATES, districtFromGeoid, districtGeoid, districtName, memberPlace, parseDistrict } from "../shared/districts.mjs";

test("parseDistrict reads the usual ways people type a seat", () => {
  for (const text of ["CA-11", "CA 11", "ca11", "ca-11", "California 11", "california-11", "California's 11th", "CA 11th district", "CA-CD 11"]) {
    assert.equal(parseDistrict(text), "CA-11", text);
  }
  assert.equal(parseDistrict("NJ-5"), "NJ-05");
  assert.equal(parseDistrict("New York 12"), "NY-12");
  assert.equal(parseDistrict("TX-12"), "TX-12");
});

test("parseDistrict folds at-large and delegate seats to -AL", () => {
  for (const text of ["AK-AL", "ak al", "AK 1", "AK-00", "Alaska at-large", "Alaska", "WY at large"]) {
    assert.equal(parseDistrict(text), text.toUpperCase().includes("WY") ? "WY-AL" : "AK-AL", text);
  }
  assert.equal(parseDistrict("DC-AL"), "DC-AL");
  assert.equal(parseDistrict("DC delegate"), "DC-AL");
  assert.equal(parseDistrict("District of Columbia"), "DC-AL");
  assert.equal(parseDistrict("Guam"), "GU-AL");
  assert.equal(parseDistrict("PR-AL"), "PR-AL");
  assert.equal(parseDistrict("Virgin Islands"), "VI-AL");
  assert.equal(parseDistrict("American Samoa"), "AS-AL");
  assert.equal(parseDistrict("MP-AL"), "MP-AL");
});

test("parseDistrict rejects tickers, bare states, and seats that do not exist", () => {
  for (const text of ["NVDA", "DE", "VT", "DEAL", "DAL", "COAL", "CA", "California", "CA-53", "CA-0", "CA-AL", "AK-2", "ZZ-01", "", null]) {
    assert.equal(parseDistrict(text), null, String(text));
  }
});

test("districtGeoid and districtFromGeoid round-trip every seat in the 119th boundary file", () => {
  const geo = JSON.parse(fs.readFileSync(new URL("../data/geo/cd119.geojson", import.meta.url), "utf8"));
  const ids = geo.features.map((f) => String(f.properties.GEOID)).filter((id) => !id.endsWith("ZZ"));
  assert.equal(ids.length, 441);
  for (const id of ids) {
    const code = districtFromGeoid(id);
    assert.ok(code, id);
    assert.equal(districtGeoid(code), id, code);
    assert.equal(parseDistrict(code), code, code);
  }
  assert.equal(Object.values(STATES).reduce((n, s) => n + (s.seats || 1), 0), 441);
  assert.equal(districtFromGeoid("33ZZ"), null);
  assert.equal(districtGeoid("CA-99"), "");
});

test("districtName says at-large or delegate", () => {
  assert.equal(districtName("CA-11"), "California · district 11");
  assert.equal(districtName("AK-AL"), "Alaska · at-large");
  assert.equal(districtName("DC-AL"), "District of Columbia · delegate");
});

test("memberPlace scopes House members to their seat and everyone else to the state", () => {
  assert.equal(memberPlace({ chamber: "house", state: "NJ", district: "5" }), "NJ-05");
  assert.equal(memberPlace({ chamber: "house", state: "CA", district: 11 }), "CA-11");
  assert.equal(memberPlace({ chamber: "house", state: "AK", district: "0" }), "AK");
  assert.equal(memberPlace({ chamber: "house", state: "DC", district: "" }), "DC");
  assert.equal(memberPlace({ chamber: "house", state: "WY", district: null }), "WY");
  assert.equal(memberPlace({ chamber: "senate", state: "TX", district: "" }), "TX");
  assert.equal(memberPlace({ chamber: "house", state: "CA", district: "99" }), "CA", "a seat that does not exist falls back to the state");
});
