/**
 * Publishes one message to an ntfy server (JSON publish to the server root). The topic and token come from the
 * caller (NTFY_TOPIC / NTFY_TOKEN in .env.local) and are never logged; errors name the status only.
 */
export async function postNtfy({ server, topic, token = "", message, timeoutMs = 10_000 }) {
  const body = { topic, title: message.title, message: message.message, priority: message.priority, tags: message.tags };
  if (message.click) body.click = message.click;
  if (message.actions?.length) body.actions = message.actions;
  const res = await fetch(`${server}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const err = new Error(`ntfy answered HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  let id = "";
  try {
    id = JSON.parse(text)?.id || "";
  } catch {}
  return { status: res.status, id };
}
