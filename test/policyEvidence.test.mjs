import test from "node:test";
import assert from "node:assert/strict";
import { collectLegislation } from "../server/domain/policy/legislation.mjs";
import { normalizePolicyAction, parsePolicyBillId } from "../server/domain/policy/legislationActions.mjs";
import { evidenceHash, evidenceRequest, safeUrl } from "../server/domain/policy/evidenceHttp.mjs";

const now = "2026-10-20T16:00:00.000Z";
const protocol = {
  billIds: ["hr-119-1968"],
  from: "2026-09-01",
  to: "2026-10-20",
  eventTypes: ["vote", "markup", "introduced", "passed", "enacted"],
};
const bill = parsePolicyBillId(protocol.billIds[0]);
const introduced = {
  actionDate: "2026-09-02",
  actionCode: "1000",
  type: "IntroReferral",
  text: "Introduced in House.",
};
const passed = {
  actionDate: "2026-10-01",
  actionCode: "H3830",
  type: "Floor",
  actionTime: "15:30:00",
  text: "Passed House by the Yeas and Nays.",
  sourceSystem: { code: 2 },
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test("actions pagination uses locally generated offsets, filters action date, and freezes sanitized sources", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(new URL(url));
    return calls.length === 1
      ? json({
          actions: [introduced, passed],
          pagination: { count: 5, next: "https://evil.example/exfiltrate?api_key=secret" },
          request: { api_key: "secret", url: "https://api.congress.gov/v3/bill?api_key=secret&format=json" },
        })
      : json({
          actions: [
            introduced,
            { ...introduced, actionDate: "2024-01-01" },
            { actionDate: "2026-10-05", actionCode: "H11100", type: "IntroReferral", text: "Referred to a committee." },
          ],
          pagination: { count: 5 },
        });
  };
  const result = await collectLegislation(protocol, { apiKey: "secret", now, fetchImpl, pageSize: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].origin, "https://api.congress.gov");
  assert.equal(calls[1].searchParams.get("offset"), "2");
  assert.equal(calls[0].searchParams.has("fromDateTime"), false, "do not confuse update dates with action dates");
  assert.equal(result.events.length, 2);
  assert.equal(result.manifest[0].enumerationComplete, true);
  assert.equal(result.manifest[0].duplicates, 1);
  assert.deepEqual(result.manifest[0].excluded, { outsidePeriod: 1, eventType: 1, invalidDate: 0 });
  assert.doesNotMatch(JSON.stringify(result), /secret|evil\.example.*api_key/);
  assert.equal(result.sources[0].contentHash, evidenceHash(result.sources[0].payload));
  assert.equal(result.events[0].publicAt, null);
  assert.equal(result.events[0].firstSeenAt, now);
});

test("action and update timestamps never become historical publication timestamps", () => {
  const local = normalizePolicyAction({ ...passed, updateDate: "2026-10-01T15:30:01Z" }, bill, now);
  assert.equal(local.eventAt, "2026-10-01");
  assert.equal(local.eventPrecision, "day");
  assert.equal(local.sourceEventTime, "15:30:00");
  assert.equal(local.publicAt, null);
  assert.equal(local.publicPrecision, null);
  assert.equal(local.availabilityBasis, "collector-first-seen");
  const vote = normalizePolicyAction(
    {
      ...passed,
      recordedVotes: [
        { chamber: "House", congress: 119, sessionNumber: 2, rollNumber: 123, date: "2026-10-01T19:30:00Z" },
      ],
    },
    bill,
    now,
  );
  assert.equal(vote.eventAt, "2026-10-01T19:30:00.000Z");
  assert.equal(vote.eventPrecision, "instant");
  assert.equal(vote.publicAt, null, "a precise vote time is still not a precise release time");
});

test("same version preserves earliest valid observation and corrections get distinct version IDs", () => {
  const original = normalizePolicyAction(passed, bill, now);
  const earlier = { ...original, firstSeenAt: "2026-10-10T12:00:00Z" };
  const future = { ...original, firstSeenAt: "2030-01-01T00:00:00Z" };
  assert.equal(normalizePolicyAction(passed, bill, now, [future, earlier]).firstSeenAt, earlier.firstSeenAt);
  assert.equal(normalizePolicyAction(passed, bill, now, [future]).firstSeenAt, now);
  const corrected = normalizePolicyAction({ ...passed, text: "Passed House after correcting the result." }, bill, now, [
    earlier,
  ]);
  assert.equal(corrected.sourceRecordId, original.sourceRecordId);
  assert.notEqual(corrected.id, original.id);
  assert.notEqual(corrected.sourceHash, original.sourceHash);
  assert.equal(corrected.firstSeenAt, now);
});

test("invalid dates and unrecognized actions cannot silently become introduction events", async () => {
  const result = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () =>
      json({
        actions: [
          null,
          { ...introduced, actionDate: "2026-02-30" },
          { actionDate: "2026-10-01", type: "IntroReferral", text: "Referred to committee." },
        ],
        pagination: { count: 3 },
      }),
  });
  assert.equal(result.events.length, 0);
  assert.equal(result.manifest[0].excluded.invalidDate, 2);
  assert.equal(result.manifest[0].excluded.eventType, 1);
});

test("missing provider configuration differs from successful zero events and rate limiting", async () => {
  const missing = await collectLegislation(protocol, {
    apiKey: "",
    now,
    fetchImpl: () => assert.fail("must not fetch"),
  });
  assert.equal(missing.manifest[0].status, "not-configured");
  const zero = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () => json({ actions: [], pagination: { count: 0 } }),
  });
  assert.equal(zero.manifest[0].status, "complete");
  assert.equal(zero.manifest[0].enumerationComplete, true);
  const limited = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () => json({}, 429, { "retry-after": "60" }),
  });
  assert.equal(limited.manifest[0].status, "rate-limited");
  assert.equal(limited.manifest[0].pages[0].retryAfter, "60");
  assert.equal(limited.manifest[0].enumerationComplete, false);
});

test("bounded pagination and missing pagination are recorded as incomplete", async () => {
  const capped = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    maxPages: 1,
    fetchImpl: async () => json({ actions: [introduced], pagination: { count: 500, next: "anything" } }),
  });
  assert.equal(capped.manifest[0].status, "capped");
  assert.equal(capped.manifest[0].enumerationComplete, false);
  const unknown = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () => json({ actions: [introduced] }),
  });
  assert.equal(unknown.manifest[0].status, "incomplete-pagination");
  const malformed = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () => json({ error: "not actions" }),
  });
  assert.equal(malformed.manifest[0].status, "invalid-response");
});

test("same-anchor conflicting versions remain preserved and explicitly flagged", async () => {
  const result = await collectLegislation(protocol, {
    apiKey: "x",
    now,
    fetchImpl: async () =>
      json({
        actions: [passed, { ...passed, text: "Passed House, corrected description." }],
        pagination: { count: 2 },
      }),
  });
  assert.equal(result.events.length, 2);
  assert.equal(result.manifest[0].ambiguousAnchors, 1);
  assert.ok(result.gaps.some((gap) => gap.code === "ambiguous-action-version"));
});

test("fetch timeout and cancellation work even with an injected transport that ignores abort", async () => {
  const never = () => new Promise(() => {});
  const timeout = await evidenceRequest("https://example.com", "fixture", { now, timeoutMs: 15, fetchImpl: never });
  assert.equal(timeout.status, "timeout");
  const controller = new AbortController();
  const pending = evidenceRequest("https://example.com", "fixture", {
    now,
    signal: controller.signal,
    fetchImpl: never,
  });
  controller.abort();
  assert.equal((await pending).status, "cancelled");
});

test("network errors never echo a credential and non-JSON/oversize responses are explicit failures", async () => {
  const error = await evidenceRequest("https://example.com?api_key=secret", "fixture", {
    now,
    fetchImpl: async () => {
      throw new Error("https://example.com?api_key=secret");
    },
  });
  assert.equal(error.status, "network-error");
  assert.doesNotMatch(JSON.stringify(error), /secret/);
  const html = await evidenceRequest("https://example.com", "fixture", {
    now,
    fetchImpl: async () => new Response("<html>unavailable</html>"),
  });
  assert.equal(html.status, "invalid-response");
  const large = await evidenceRequest("https://example.com", "fixture", {
    now,
    fetchImpl: async () => new Response("{}", { headers: { "content-length": "2000001" } }),
  });
  assert.equal(large.status, "response-too-large");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(
    safeUrl("https://user:secret@example.com/?api_key=secret&format=json"),
    "https://example.com/?format=json",
  );
});

test("HTTP retry receipts accept seconds or HTTP-date without persisting arbitrary header text", async () => {
  for (const value of ["https://provider.example/retry?api_key=secret", "secret", "Tue, 20 Oct 2026 16:00:00 GMT"]) {
    const result = await evidenceRequest("https://api.congress.gov/v3/bill?api_key=secret", "Congress.gov", {
      now,
      apiKey: "secret",
      fetchImpl: async () => json({}, 429, { "retry-after": value }),
    });
    assert.equal(result.retryAfter, value.endsWith("GMT") ? value : null);
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
});
