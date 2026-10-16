/** Read `data: {json}` blocks from a fetch body and hand each parsed event to `on`. */
export async function readEvents(body: ReadableStream<Uint8Array>, on: (event: Record<string, unknown>) => void, { idleMs = 90_000 } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let terminal = false;
  const flush = (final: boolean) => {
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0 || (final && buf.trim())) {
      const block = i >= 0 ? buf.slice(0, i) : buf;
      buf = i >= 0 ? buf.slice(i + 2) : "";
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { continue; }
      on(event);
      if (event.type === "done" || event.type === "error") terminal = true;
    }
  };
  try {
    while (!terminal) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The research connection went silent for 90 seconds. Your partial answer is preserved; retry when the connection is available.")), idleMs);
      });
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await Promise.race([reader.read(), timeout]); }
      finally { clearTimeout(timer); }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      flush(false);
    }
    buf += decoder.decode();
    flush(true);
  } finally {
    // A terminal event is sufficient; do not wait forever for a proxy to close TCP.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
