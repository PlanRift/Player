import { getBridgeApiKey } from './bridgeClient';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function relayFetch(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new Error(`Relay request timed out after ${timeoutMs}ms.`);
    throw new Error(
      'Could not reach the relay. Start it with bun run relay and try again.',
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function readJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error || body.message || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || `${label} failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

export function bridgeKeyHeaders(): Record<string, string> {
  const key = getBridgeApiKey();
  return key ? { 'x-bridge-key': key } : {};
}
