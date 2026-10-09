import zlib from "node:zlib";

/** Bodies under this many bytes go out as-is; compressing them saves less than the headers cost. */
const MIN_BYTES = 1024;
const BROTLI = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };

/** "br", "gzip", or "" from an Accept-Encoding header; q=0 excludes a coding. */
export function pickEncoding(header) {
  const offered = new Map();
  for (const part of String(header || "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
    if (name) offered.set(name.trim(), q == null ? 1 : Number(q));
  }
  const ok = (name) => (offered.get(name) ?? (offered.has("*") ? offered.get("*") : 0)) > 0;
  return ok("br") ? "br" : ok("gzip") ? "gzip" : "";
}

export function encode(buf, encoding) {
  return encoding === "br" ? zlib.brotliCompressSync(buf, BROTLI) : zlib.gzipSync(buf, { level: 6 });
}

/**
 * Last encoded body per handler result object. Handlers return the same memoized object on cache hits; the
 * JSON text is compared before reuse, so a result mutated after it was sent is encoded again.
 */
const memo = new WeakMap();

/** Writes `text` with `headers`, compressed when the client accepts it and the body is large enough. */
export function sendEncoded(req, res, status, headers, text, owner = null) {
  const encoding = text.length >= MIN_BYTES ? pickEncoding(req?.headers?.["accept-encoding"]) : "";
  if (!encoding) {
    res.writeHead(status, { ...headers, Vary: "Accept-Encoding" });
    res.end(text);
    return;
  }
  const slot = owner && typeof owner === "object" ? memo.get(owner) : null;
  let body = slot && slot.text === text ? slot[encoding] : null;
  if (!body) {
    body = encode(Buffer.from(text), encoding);
    if (owner && typeof owner === "object") memo.set(owner, slot && slot.text === text ? { ...slot, [encoding]: body } : { text, [encoding]: body });
  }
  res.writeHead(status, { ...headers, "Content-Encoding": encoding, "Content-Length": body.length, Vary: "Accept-Encoding" });
  res.end(body);
}

/** Static file served from memory, encoded once per coding. */
export function staticFile(read) {
  let raw = null;
  const encoded = {};
  return (req, res, headers) => {
    raw ||= read();
    const encoding = raw.length >= MIN_BYTES ? pickEncoding(req?.headers?.["accept-encoding"]) : "";
    const body = encoding ? (encoded[encoding] ||= encode(raw, encoding)) : raw;
    res.writeHead(200, { ...headers, ...(encoding ? { "Content-Encoding": encoding } : {}), "Content-Length": body.length, Vary: "Accept-Encoding" });
    res.end(body);
  };
}
