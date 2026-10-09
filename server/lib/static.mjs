/**
 * Serves the built app (dist/) in production. Hashed files under /assets/ are immutable for a year; index.html and
 * everything else revalidate on every load (ETag). Paths without a file extension fall back to index.html so a
 * reload on a deep link still opens the app. Text files go out brotli/gzip encoded, kept in memory per mtime.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { encode, pickEncoding } from "./compress.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm"
};
const TEXT = /^(text\/|application\/(json|geo\+json)|image\/svg)/;
const HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY" };

export function staticSite(dir) {
  const root = path.resolve(dir);
  const memo = new Map();

  async function load(file) {
    const st = await fs.stat(file).catch(() => null);
    if (!st?.isFile()) return null;
    const hit = memo.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
    const entry = { mtimeMs: st.mtimeMs, size: st.size, body: await fs.readFile(file), etag: `"${st.size.toString(36)}-${Math.trunc(st.mtimeMs).toString(36)}"` };
    if (memo.size > 500) memo.clear();
    memo.set(file, entry);
    return entry;
  }

  /** Resolves a URL path inside `root`, or null for traversal attempts and odd encodings. */
  function resolve(pathname) {
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (rel.includes("\0")) return null;
    const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
    return file === root || file.startsWith(root + path.sep) ? file : null;
  }

  return async function serve(req, res, url) {
    let file = resolve(url.pathname);
    if (!file) return send(res, 400, "Bad path.");
    let entry = url.pathname.endsWith("/") ? null : await load(file);
    if (!entry) {
      if (path.extname(url.pathname) && !url.pathname.endsWith("/")) return send(res, 404, "Not found.");
      file = path.join(root, "index.html");
      entry = await load(file);
      if (!entry) return send(res, 503, "The app is not built yet. Run `npm run build` on the server.");
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const immutable = /^\/assets\/.+-[\w-]{8,}\.\w+$/.test(url.pathname);
    const headers = {
      ...HEADERS,
      "Content-Type": type,
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: entry.etag,
      Vary: "Accept-Encoding"
    };
    if (req.headers["if-none-match"] === entry.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    let body = entry.body;
    const encoding = TEXT.test(type) && body.length >= 1024 ? pickEncoding(req.headers["accept-encoding"]) : "";
    if (encoding) {
      entry[encoding] ||= encode(body, encoding);
      body = entry[encoding];
      headers["Content-Encoding"] = encoding;
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  };
}

function send(res, status, text) {
  res.writeHead(status, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}
