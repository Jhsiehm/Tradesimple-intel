/** Read `data: {json}` blocks from a fetch body and hand each parsed event to `on`. */
export async function readEvents(body: ReadableStream<Uint8Array>, on: (event: Record<string, unknown>) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (final: boolean) => {
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0 || (final && buf.trim())) {
      const block = i >= 0 ? buf.slice(0, i) : buf;
      buf = i >= 0 ? buf.slice(i + 2) : "";
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data) continue;
      try { on(JSON.parse(data)); } catch { /* a partial or foreign block */ }
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    flush(false);
  }
  buf += decoder.decode();
  flush(true);
}
