/** Server-sent events from a fetch body: yields `{ event, data }` for each blank-line-terminated block. */
export async function* sseEvents(body) {
  if (!body) return;
  const reader = typeof body.getReader === "function" ? body.getReader() : null;
  const decoder = new TextDecoder();
  let buf = "";
  const take = function* (final) {
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const ev = parseBlock(block);
      if (ev) yield ev;
    }
    if (final && buf.trim()) {
      const ev = parseBlock(buf);
      buf = "";
      if (ev) yield ev;
    }
  };
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      yield* take(false);
    }
    buf += decoder.decode();
  } else {
    for await (const chunk of body) {
      buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      yield* take(false);
    }
  }
  yield* take(true);
}

function parseBlock(block) {
  let event = "";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return null;
  return { event, data: data.join("\n") };
}
