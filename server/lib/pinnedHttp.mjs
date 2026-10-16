import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable, pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/** The socket uses only the addresses already checked by the caller, never a second DNS lookup. */
export function pinnedLookup(addresses) {
  const approved = addresses.map(({ address }) => ({ address, family: net.isIP(address) }));
  if (!approved.length || approved.some((a) => !a.family)) throw new Error("No valid pinned addresses.");
  return (_host, options, callback) => {
    const family = typeof options === "number" ? options : options?.family;
    const candidates = approved.filter((a) => !family || a.family === family);
    queueMicrotask(() => {
      if (!candidates.length) return callback(new Error("No pinned address for this family."));
      if (options?.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    });
  };
}

/**
 * Manual-redirect GET preserving the URL's Host header and TLS hostname verification. No shared socket pool or
 * proxy may resolve the hostname again. The caller validates addresses and consumes/cancels the bounded body.
 */
export function fetchPinnedResponse(
  url,
  {
    addresses,
    headers,
    signal = AbortSignal.timeout(12_000),
    request = url.protocol === "https:" ? https.request : http.request,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: { ...headers, "Accept-Encoding": "gzip, deflate, br" },
        agent: false,
        lookup: pinnedLookup(addresses),
        signal,
        maxHeaderSize: 16 * 1024,
      },
      (res) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          for (const item of Array.isArray(value) ? value : [value])
            if (item != null) responseHeaders.append(name, item);
        }
        const status = res.statusCode;
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new Error(`Invalid page status: ${status}.`));
          return;
        }
        if ([204, 205, 304].includes(status)) {
          res.resume();
          resolve(new Response(null, { status, headers: responseHeaders }));
          return;
        }
        const encoding = String(res.headers["content-encoding"] || "identity")
          .trim()
          .toLowerCase();
        const decoder = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }[encoding];
        if (encoding !== "identity" && !decoder) {
          res.destroy();
          reject(new Error(`Unsupported page encoding: ${encoding}.`));
          return;
        }
        // pipeline propagates errors and cancellation in both directions, including a decompression bomb's abort.
        const body = decoder ? pipeline(res, decoder(), () => {}) : res;
        // Count queued bytes, not chunks, so the stream adapter cannot buffer an unbounded download.
        const stream = Readable.toWeb(body, {
          strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
        });
        resolve(new Response(stream, { status, headers: responseHeaders }));
      },
    );
    req.once("error", reject);
    req.once("upgrade", (_res, socket) => {
      socket.destroy();
      reject(new Error("Page protocol upgrades are not supported."));
    });
    req.end();
  });
}
