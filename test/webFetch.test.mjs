import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { webPage } from "../server/feeds/web.mjs";
import { fetchPinnedResponse } from "../server/lib/pinnedHttp.mjs";

const lookup = async () => [{ address: "93.184.216.34", family: 4 }];
const headers = { "content-type": "text/html" };

test("the socket lookup uses the validated DNS snapshot and preserves the TLS hostname", async () => {
  let resolutions = 0;
  let connected = false;
  const result = await webPage("https://rebind.example/page", {
    lookup: async () => [{ address: ++resolutions === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }],
    fetcher: (url, options) =>
      fetchPinnedResponse(url, {
        ...options,
        request: (target, opts, callback) => {
          assert.equal(target.hostname, "rebind.example", "Host and TLS verification still use the original name");
          assert.equal(opts.agent, false, "no pooled socket may bypass this lookup");
          const req = new EventEmitter();
          req.end = () =>
            opts.lookup(target.hostname, { all: true }, (err, addresses) => {
              assert.ifError(err);
              assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
              connected = true;
              const res = new PassThrough();
              res.statusCode = 200;
              res.headers = headers;
              callback(res);
              res.end("<title>Pinned</title>Public page");
            });
          return req;
        },
      }),
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(connected, true);
  assert.equal(resolutions, 1, "a second lookup would have returned loopback");
});

test("mixed public/private DNS answers are refused before connecting", async () => {
  let fetched = false;
  const result = await webPage("https://mixed.example/", {
    lookup: async () => [{ address: "93.184.216.34" }, { address: "::1" }],
    fetcher: async () => {
      fetched = true;
    },
  });
  assert.equal(fetched, false);
  assert.match(result.error, /Private/);
});

test("chunked responses stop at the byte limit and cancel the download", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(1_000_000));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const result = await webPage("https://large.example/", {
    lookup,
    fetcher: async () => new Response(body, { headers }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /2 MB/);
  assert.equal(reads, 3, "stops on the first chunk exceeding the cap");
  assert.equal(cancelled, true);
});

test("oversized Content-Length is rejected without reading the body", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream(
    {
      pull() {
        reads++;
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const result = await webPage("https://large.example/", {
    lookup,
    fetcher: async () => new Response(body, { headers: { ...headers, "content-length": "2000001" } }),
  });
  assert.match(result.error, /2 MB/);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
});

test("redirect bodies are cancelled and every destination is revalidated", async () => {
  let cancelled = false;
  const hosts = [];
  const result = await webPage("https://public.example/", {
    lookup: async (host) => {
      hosts.push(host);
      return [{ address: host === "public.example" ? "93.184.216.34" : "10.0.0.1" }];
    },
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 302, headers: { location: "https://private.example/" } },
      ),
  });
  assert.match(result.error, /Private/);
  assert.deepEqual(hosts, ["public.example", "private.example"]);
  assert.equal(cancelled, true);
});

test("DNS and stalled bodies are covered by the deadline", async () => {
  const dns = await webPage("https://slow.example/", { timeoutMs: 20, lookup: () => new Promise(() => {}) });
  assert.match(dns.error, /timed out/);
  let cancelled = false;
  const body = await webPage("https://slow.example/", {
    timeoutMs: 20,
    lookup,
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers },
      ),
  });
  assert.match(body.error, /timed out/);
  assert.equal(cancelled, true);
});

test("a body read failure returns a tool error instead of rejecting webPage", async () => {
  const result = await webPage("https://broken.example/", {
    lookup,
    fetcher: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("connection lost"));
          },
        }),
        { headers },
      ),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /connection lost/);
});

test("native pinned HTTP preserves Host, decodes gzip and bounds decompressed bytes", async (t) => {
  const server = http.createServer((req, res) => {
    assert.match(req.headers.host, /^pinned\.invalid:/);
    if (req.url === "/invalid") {
      res.writeHead(700);
      res.end();
      return;
    }
    if (req.url === "/slow-headers") return;
    if (req.url === "/slow-body") {
      res.writeHead(200, headers);
      res.flushHeaders();
      return;
    }
    const data = gzipSync(req.url === "/large" ? "x".repeat(3_000_000) : "<title>Compressed</title>Readable text");
    res.writeHead(200, { ...headers, "content-encoding": "gzip", "content-length": String(data.length) });
    res.end(data);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  // The transport itself accepts prevalidated addresses; only this fixture supplies loopback.
  const fetcher = (url, options) =>
    fetchPinnedResponse(new URL(`http://pinned.invalid:${server.address().port}${url.pathname}`), {
      ...options,
      addresses: [{ address: "127.0.0.1" }],
    });
  const good = await webPage("http://public.example/", { lookup, fetcher });
  assert.equal(good.ok, true, good.error);
  assert.equal(good.title, "Compressed");
  const large = await webPage("http://public.example/large", { lookup, fetcher });
  assert.equal(large.ok, false);
  assert.match(large.error, /2 MB/);
  const invalid = await webPage("http://public.example/invalid", { lookup, fetcher });
  assert.match(invalid.error, /Invalid page status/);
  for (const path of ["slow-headers", "slow-body"]) {
    const slow = await webPage(`http://public.example/${path}`, { lookup, fetcher, timeoutMs: 30 });
    assert.match(slow.error, /timed out/, path);
  }
});
