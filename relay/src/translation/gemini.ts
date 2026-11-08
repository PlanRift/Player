/**
 * Gemini Flash-Lite client for batch Japanese to English song lyrics translation.
 * Strictly server-side: reads GEMINI_API_KEY from environment only.
 */

let rateLimitUntil = 0;
let backoffDelayMs = 10000;

export interface GeminiTranslationResult {
  lines: string[];
  source: 'gemini';
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function translateLyricsWithGemini(
  lines: string[]
): Promise<string[] | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  // Respect active rate limit backoff window
  const now = Date.now();
  if (now < rateLimitUntil) {
    console.warn(`[Gemini] Backing off on 429 until ${new Date(rateLimitUntil).toISOString()}`);
    return null;
  }

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const candidateModels = configuredModel
    ? [configuredModel, 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']
    : ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
  // Deduplicate candidate models
  const uniqueModels = Array.from(new Set(candidateModels));

  const prompt = `You are an expert Japanese to English song lyrics translator.
Translate each line of the following song lyrics from Japanese into natural, expressive English suitable for subtitles.

Strict rules:
1. Maintain exact 1:1 line alignment with the input. Exactly one translated string for each input line.
2. If a line is already in English, romaji, or consists only of punctuation/vocalizations (e.g. "Ah", "La la la"), keep it as is or lightly adapt it.
3. Output must be a valid JSON array of strings: ["line 1 translation", "line 2 translation", ...]
4. The returned array MUST contain exactly ${lines.length} elements.
5. Do NOT combine lines. Do NOT split lines. Do NOT skip lines. Do NOT add markdown fences or extra commentary.

Input lines (${lines.length} total):
${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  for (const model of uniqueModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429) {
        rateLimitUntil = Date.now() + backoffDelayMs;
        backoffDelayMs = Math.min(backoffDelayMs * 2, 60000);
        console.warn(`[Gemini] HTTP 429 received on ${model}. Backing off for ${backoffDelayMs / 1000}s`);
        return null;
      }

      if (!res.ok) {
        console.warn(`[Gemini] Model ${model} failed with status ${res.status}. Trying next candidate if available.`);
        continue;
      }

      // Reset backoff upon successful request
      backoffDelayMs = 10000;

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      const textPart =
        (Array.isArray(parts) ? parts.find((p: any) => typeof p?.text === 'string' && !p?.thought) : null)?.text ||
        parts?.[0]?.text;

      if (!textPart || typeof textPart !== 'string') {
        console.warn(`[Gemini] Missing text part in response from ${model}`);
        continue;
      }

      let cleanJson = textPart.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleanJson);
      } catch (parseErr) {
        console.warn(`[Gemini] Failed to parse JSON response from ${model}:`, parseErr);
        continue;
      }

      if (!Array.isArray(parsed)) {
        console.warn(`[Gemini] Response from ${model} is not an array`);
        continue;
      }

      if (parsed.length !== lines.length) {
        console.warn(
          `[Gemini] Line count mismatch on ${model}: expected ${lines.length}, got ${parsed.length}.`
        );
        continue;
      }

      const cleanedLines = parsed.map((item, idx) => {
        let str = typeof item === 'string' ? item.trim() : String(item ?? '').trim();
        // Strip accidental leading numbering like "1. " or "01: " if model emitted it inside strings
        str = str.replace(new RegExp(`^${idx + 1}[.:]\\s*`), '');
        return str;
      });

      return cleanedLines;
    } catch (err: unknown) {
      console.warn(`[Gemini] Network or execution error on ${model}:`, (err as Error).message);
    }
  }

  return null;
}
