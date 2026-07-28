/** Shared transport: timeouts, and mapping HTTP reality onto FailureKind. */
import { ProviderError, type FailureKind, type ProviderId } from "./types.ts";

export async function postJson(
  provider: ProviderId,
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  return request(provider, url, timeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function getJson(
  provider: ProviderId,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  return request(provider, url, timeoutMs, { method: "GET", headers });
}

async function request(
  provider: ProviderId,
  url: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new ProviderError(
      provider,
      aborted ? "timeout" : "network",
      aborted
        ? `no response within ${Math.round(timeoutMs / 1000)}s`
        : `network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Read the body for the real reason — providers put it there, and
    // "429" alone is useless when debugging a failover chain.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(provider, classify(res.status), detail || res.statusText, res.status);
  }

  try {
    return await res.json();
  } catch {
    throw new ProviderError(provider, "bad-output", "response was not JSON");
  }
}

function classify(status: number): FailureKind {
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 402) return "no-free-model";
  if (status >= 500) return "server-error";
  // 400/404 usually means the model is gone or rejected the request shape.
  return "no-model";
}
