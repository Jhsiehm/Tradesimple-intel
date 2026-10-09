/** Read a request body as text, refusing more than `limit` bytes. Rejects with `Error("Body too large")`. */
export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", (err) => { if (!failed) reject(err); });
  });
}

/** `{ ok: true, value }` or `{ ok: false, status, error }`. An empty body is `{}`. */
export async function readJson(req, limit) {
  try {
    const text = await readBody(req, limit);
    return { ok: true, value: text ? JSON.parse(text) : {} };
  } catch (err) {
    const big = err.message === "Body too large";
    return { ok: false, status: big ? 413 : 400, error: big ? "Body too large." : "JSON body required." };
  }
}
