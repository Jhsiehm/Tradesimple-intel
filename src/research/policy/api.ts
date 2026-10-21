type ApiResponse = { ok: boolean; error?: string };
export async function policyRequest<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/research/policy${path}`, {
    signal,
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (response.status === 401) {
    throw new Error("Your session expired. Sign in again, then reopen this study. Your unsaved draft is still here.");
  }
  let data: T & ApiResponse;
  try {
    data = await response.json();
  } catch {
    throw new Error("The research server did not return a readable response. Retry after the server is available.");
  }
  signal.throwIfAborted();
  if (!response.ok || !data || typeof data !== "object" || !data.ok)
    throw new Error(data?.error || `Research request failed (${response.status}). Retry or inspect the saved study.`);
  return data;
}
