// http-util.ts - Shared JSON body / response helpers for relay routes.
// Extracted from index.ts so feature modules (ytm, tagger) can reuse the
// exact same shapes without a circular import back into index.ts.

export const MAX_JSON_BODY_BYTES = 1_048_576; // 1 MB

export async function readJsonBody<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BODY_BYTES) {
    throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  return JSON.parse(text) as T;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // I2: no heuristic caching of lyrics/romaji/translate answers. A
      // heuristically cached error or stale translation must not survive
      // a relay restart; the relay's own server-side cache already
      // bounds staleness, so every GET revalidates. POSTs
      // (/api/translate-batch) are not cacheable by definition and are
      // unaffected by this header.
      'Cache-Control': 'private, no-cache',
    },
  });
}

export function errorResponse(status: number, error: string, message?: string): Response {
  return jsonResponse({ error, message: message || error }, status);
}
