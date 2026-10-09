import { test } from "node:test";
import assert from "node:assert/strict";
import { applyView, START_VIEW, trailLabel, viewFor, viewOnly } from "../src/shell/viewFor.ts";

const off = { intelOn: false };
const on = { intelOn: true };

test("section picks close the stage, clear selection and dossier, reset the scrubber, drop unpinned cards", () => {
  assert.deepEqual(viewFor("section:districts", off), { stage: true, section: "districts", dossier: null, selectedId: null, scope: "all", dropCards: true });
});

test("Congress, Markets sub-tabs land in their section with the mode or view set", () => {
  assert.equal(viewFor("mode:bills", off).section, "congress");
  assert.equal(viewFor("mode:bills", off).mode, "bills");
  assert.equal(viewFor("view:crypto", off).section, "markets");
  assert.equal(viewFor("view:crypto", off).marketView, "crypto");
  assert.equal(viewFor("layer:insiders", off).layer, "insiders");
  assert.equal(viewFor("layer:insiders", off).scope, "all");
});

test("bill links open the vote map like a bill row click; roll-call links keep the chamber", () => {
  assert.deepEqual(viewFor("bill:hr1-119", off), { stage: true, section: "congress", dossier: null, mode: "bills", voteView: "map", mapLayer: "votes", selectedId: "hr1-119" });
  const vote = viewFor("vote:senate-119-1-42", off);
  assert.equal(vote.chamber, "senate");
  assert.equal(vote.mode, "votes");
  assert.equal(vote.mapLayer, "votes");
  assert.equal(viewFor("vote:house-119-1-7", off).chamber, "house");
});

test("committee links pick the chamber from the code prefix", () => {
  assert.equal(viewFor("committee:HSAG", off).chamber, "house");
  assert.equal(viewFor("committee:SSFI", off).chamber, "senate");
  assert.equal("chamber" in viewFor("committee:JSEC", off), false);
});

test("HQ switches Districts to the S&P 500 HQ layer and selects the company; bare HQ shows the layer", () => {
  assert.deepEqual(viewFor("hq:lmt", off), { stage: true, section: "districts", dossier: null, districtLayer: "hq", selectedId: "hq:LMT", rail: true });
  assert.equal(viewFor("hq:", off).selectedId, null);
});

test("site search hits switch Districts back to the site layer", () => {
  const p = viewFor("site:boeing-everett", off);
  assert.equal(p.districtLayer, "sites");
  assert.equal(p.selectedId, "boeing-everett");
  assert.equal(viewFor("site:", off), null);
});

test("district links select the cd119 GEOID; junk is not a navigation", () => {
  assert.equal(viewFor("district:CA-11", off).selectedId, "0611");
  assert.equal(viewFor("district:AK-AL", off).selectedId, "0200");
  assert.equal(viewFor("district:ZZ-99", off), null);
});

test("contracts scope parses ticker, district, member, and falls back to all agencies", () => {
  assert.deepEqual(viewFor("contracts:symbol:lmt", off).contracts, { kind: "symbol", value: "LMT" });
  assert.deepEqual(viewFor("contracts:place:tx-12", off).contracts, { kind: "place", value: "TX-12" });
  assert.deepEqual(viewFor("contracts:member:G000583", off).contracts, { kind: "member", value: "G000583" });
  assert.deepEqual(viewFor("contracts:all", off).contracts, { kind: "all", value: "" });
  assert.equal(viewFor("contracts:all", off).section, "contracts");
});

test("scope stays put when the scrubber is on screen, else opens the Congress map", () => {
  assert.deepEqual(viewFor("scope:member:P000197", on), { scope: "member:P000197" });
  assert.deepEqual(viewFor("scope:member:P000197", off), { stage: true, section: "congress", dossier: null, voteView: "map", selectedId: null, scope: "member:P000197" });
});

test("side-effect actions are left to App", () => {
  for (const a of ["member:P000197", "ticker:LMT", "chart:LMT", "pos:LMT", "supply:TSM", "timeline:P000197", "roll:house-1", "news:x", "meeting:1", "today:week", "calendar:", "alerts:", "map:city"]) {
    assert.equal(viewFor(a, off), null, a);
  }
});

test("applyView only sets view fields; viewOnly strips everything else", () => {
  const next = applyView(START_VIEW, viewFor("hq:LMT", off));
  assert.equal(next.section, "districts");
  assert.equal(next.districtLayer, "hq");
  assert.equal(next.mode, START_VIEW.mode);
  assert.equal("rail" in next, false);
  assert.deepEqual(viewOnly({ ...next, extra: 1 }), next);
  const back = applyView(next, { ...START_VIEW, mapLayer: "votes" });
  assert.deepEqual(back, { ...START_VIEW, mapLayer: "votes" });
});

test("trail labels name members and kinds", () => {
  const who = (id) => (id === "P000197" ? "Nancy Pelosi" : id);
  assert.equal(trailLabel("member:P000197", who), "Nancy Pelosi · card");
  assert.equal(trailLabel("scope:member:P000197", who), "Map scope · Nancy Pelosi");
  assert.equal(trailLabel("contracts:member:P000197", who), "Contracts · Nancy Pelosi district");
  assert.equal(trailLabel("section:districts", who), "Districts");
  assert.equal(trailLabel("hq:LMT", who), "LMT headquarters");
  assert.equal(trailLabel("today:leaders", who), "Leaderboards");
});
