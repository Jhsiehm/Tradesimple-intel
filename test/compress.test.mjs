import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { encode, pickEncoding, sendEncoded } from "../server/lib/compress.mjs";

test("pickEncoding prefers brotli, then gzip, and honors q=0", () => {
  assert.equal(pickEncoding("gzip, deflate, br, zstd"), "br");
  assert.equal(pickEncoding("gzip"), "gzip");
  assert.equal(pickEncoding("br;q=0, gzip;q=0.8"), "gzip");
  assert.equal(pickEncoding("identity"), "");
  assert.equal(pickEncoding(""), "");
  assert.equal(pickEncoding(undefined), "");
  assert.equal(pickEncoding("*"), "br");
});

function fakeRes() {
  const out = { status: 0, headers: {}, body: null };
  return { out, writeHead: (s, h) => { out.status = s; out.headers = h; }, end: (b) => { out.body = b; } };
}

test("sendEncoded compresses large bodies, leaves small ones, and reuses the encoding for the same object", () => {
  const owner = { items: Array.from({ length: 500 }, (_, i) => ({ i, label: `row ${i}` })) };
  const text = JSON.stringify(owner);
  const req = { headers: { "accept-encoding": "gzip, br" } };
  const a = fakeRes();
  sendEncoded(req, a, 200, { "Content-Type": "application/json" }, text, owner);
  assert.equal(a.out.headers["Content-Encoding"], "br");
  assert.equal(zlib.brotliDecompressSync(a.out.body).toString(), text);
  const b = fakeRes();
  sendEncoded(req, b, 200, {}, text, owner);
  assert.equal(b.out.body, a.out.body, "same object and text reuse the encoded buffer");
  owner.items.push({ i: -1 });
  const c = fakeRes();
  sendEncoded(req, c, 200, {}, JSON.stringify(owner), owner);
  assert.notEqual(c.out.body, a.out.body, "a mutated result is encoded again");
  const small = fakeRes();
  sendEncoded(req, small, 200, {}, '{"ok":true}', null);
  assert.equal(small.out.headers["Content-Encoding"], undefined);
  assert.equal(small.out.body, '{"ok":true}');
  assert.equal(zlib.gunzipSync(encode(Buffer.from(text), "gzip")).toString(), text);
});
