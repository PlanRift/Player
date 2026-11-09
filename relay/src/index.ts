import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// @ts-ignore
import Kuroshiro from 'kuroshiro';
// @ts-ignore
import KuromojiAnalyzer from 'kuroshiro-analyzer-kuromoji';
import { ALL_PROVIDERS, PROVIDERS_BY_ID } from './providers';
import { ProviderError, type LyricsProvider } from './providers/base';
import { lyricsCache } from './cache';
import { selectAutoWinner, stripCreditLines } from './scoring';
import type { LyricsQuery, UnifiedLyrics } from './types';
import { translateLyricsWithGemini, romanizeLyricsWithGemini, isGeminiConfigured } from './translation/gemini';
import { applyInlineBackgroundSplit } from './normalize/split-bg';

const PORT = parseInt(process.env.PORT || '3005', 10);
// Every provider call has a 10s timeout per spec
const PROVIDER_TIMEOUT_MS = 10000;

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

const ALLOWED_ORIGINS = [
  'https://plenrip.planrift.me',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3005',
  'http://127.0.0.1:3005',
];

function corsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get('origin');
  let allowOrigin = 'https://plenrip.planrift.me';

  if (origin) {
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith('.planrift.me') ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      allowOrigin = origin;
    }
  } else {
    allowOrigin = '*';
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, X-API-Key',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function errorResponse(status: number, error: string, message?: string): Response {
  return jsonResponse({ error, message: message || error }, status);
}

type ProviderResult =
  | { status: 'found'; lyrics: UnifiedLyrics; provider: LyricsProvider }
  | { status: 'not_found'; provider: LyricsProvider }
  | { status: 'error'; message: string; provider: LyricsProvider };

async function fetchProviderWithTimeout(
  provider: LyricsProvider,
  query: LyricsQuery,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<ProviderResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await provider.fetch(query, controller.signal);
    clearTimeout(timer);
    if (result && Array.isArray(result.lines) && result.lines.length > 0) {
      const split = applyInlineBackgroundSplit(result);
      return { status: 'found', lyrics: split, provider };
    }
    return { status: 'not_found', provider };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isAbort = (err as Error).name === 'AbortError';
    const message = isAbort ? `timeout after ${timeoutMs}ms` : (err as Error).message;
    console.warn(`[Relay] Provider ${provider.id} error:`, message);
    return { status: 'error', message, provider };
  }
}

async function handleLyricsRequest(url: URL): Promise<Response> {
  const title = url.searchParams.get('title') || url.searchParams.get('track') || '';
  const artist = url.searchParams.get('artist') || '';
  const album = url.searchParams.get('album') || '';
  const albumArtist = url.searchParams.get('albumArtist') || '';
  const durationRaw = url.searchParams.get('duration');
  const duration = durationRaw ? parseFloat(durationRaw) : undefined;
  const providerParam = url.searchParams.get('provider')?.toLowerCase();

  if (!title.trim()) {
    return errorResponse(400, 'missing_title', 'Missing required parameter: title');
  }

  const query: LyricsQuery = {
    title: title.trim(),
    artist: artist.trim(),
    album: album.trim() || undefined,
    duration: typeof duration === 'number' && !isNaN(duration) ? duration : undefined,
  };

  // 1. Specific Provider Mode (used by picker probes)
  if (providerParam && providerParam !== 'auto') {
    const provider = PROVIDERS_BY_ID[providerParam];
    if (!provider) {
      return errorResponse(400, 'unknown_provider', `Provider "${providerParam}" is not supported`);
    }

    // Check cache
    const cached = lyricsCache.get(query.title, query.artist, query.duration, providerParam);
    if (cached !== undefined) {
      if (cached === null) {
        return jsonResponse({ error: 'not_found' }, 404);
      }
      return jsonResponse(cached);
    }

    let outcome = await fetchProviderWithTimeout(provider, query);

    // Retry with albumArtist if provided and different
    if (outcome.status === 'not_found' && albumArtist && albumArtist.toLowerCase() !== query.artist.toLowerCase()) {
      outcome = await fetchProviderWithTimeout(provider, { ...query, artist: albumArtist.trim() });
    }

    if (outcome.status === 'found') {
      const cleaned = stripCreditLines(outcome.lyrics, query);
      if (cleaned) {
        lyricsCache.setSuccess(query.title, query.artist, query.duration, providerParam, cleaned);
        return jsonResponse(cleaned);
      }
      // If stripping credits emptied it, honest miss
      lyricsCache.setMiss(query.title, query.artist, query.duration, providerParam);
      return jsonResponse({ error: 'not_found' }, 404);
    }

    if (outcome.status === 'error') {
      return jsonResponse({ error: 'provider_error', provider: provider.id, message: outcome.message }, 502);
    }

    // Honest miss: cache briefly
    lyricsCache.setMiss(query.title, query.artist, query.duration, providerParam);
    return jsonResponse({ error: 'not_found' }, 404);
  }

  // 2. Auto Mode: parallel fetch across all providers
  const cachedAuto = lyricsCache.get(query.title, query.artist, query.duration, 'auto');
  if (cachedAuto !== undefined) {
    if (cachedAuto === null) {
      return jsonResponse({ error: 'not_found' }, 404);
    }
    return jsonResponse(cachedAuto);
  }

  // Launch all providers in parallel
  const outcomes = await Promise.all(
    ALL_PROVIDERS.map(async (p) => {
      let res = await fetchProviderWithTimeout(p, query);
      if (res.status === 'not_found' && albumArtist && albumArtist.toLowerCase() !== query.artist.toLowerCase()) {
        res = await fetchProviderWithTimeout(p, { ...query, artist: albumArtist.trim() });
      }
      return res;
    })
  );

  const foundHits = outcomes.filter(
    (o): o is { status: 'found'; lyrics: UnifiedLyrics; provider: LyricsProvider } => o.status === 'found'
  );

  if (foundHits.length > 0) {
    const hits: UnifiedLyrics[] = [];
    for (const h of foundHits) {
      const cleaned = stripCreditLines(h.lyrics, query);
      if (cleaned) hits.push(cleaned);
    }

    if (hits.length > 0) {
      const winner = selectAutoWinner(hits, query);
      if (winner) {
        lyricsCache.setSuccess(query.title, query.artist, query.duration, 'auto', winner);
        return jsonResponse(winner);
      }
    }
  }

  // No lyrics could be selected / found.
  // Check if any provider had an error:
  const errors = outcomes.filter(
    (o): o is { status: 'error'; message: string; provider: LyricsProvider } => o.status === 'error'
  );

  if (errors.length > 0) {
    const firstErr = errors[0];
    return jsonResponse({ error: 'provider_error', provider: firstErr.provider.id, message: firstErr.message }, 502);
  }

  // Every tried provider answered not_found
  lyricsCache.setMiss(query.title, query.artist, query.duration, 'auto');
  return jsonResponse({ error: 'not_found' }, 404);
}

const CACHE_DIR = join(import.meta.dir, '..', '.cache');
const DERIVATION_CACHE_FILE = join(CACHE_DIR, 'lyrics-derivations.json');
const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

interface DerivationEntry {
  english?: string;
  romaji?: string;
  lines?: string[];
  source?: string;
}

const derivationCache = new Map<string, DerivationEntry>();

// Load persisted derivations on startup
try {
  if (existsSync(DERIVATION_CACHE_FILE)) {
    const raw = JSON.parse(readFileSync(DERIVATION_CACHE_FILE, 'utf-8')) as Record<string, DerivationEntry>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        derivationCache.set(k, v);
      }
    }
  }
} catch (err: unknown) {
  console.warn('[Relay] Discarding corrupt cache file:', (err as Error).message);
}

let saveDerivationTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveDerivationCache(): void {
  if (saveDerivationTimer) return;
  saveDerivationTimer = setTimeout(() => {
    saveDerivationTimer = null;
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      const obj: Record<string, DerivationEntry> = {};
      for (const [k, v] of derivationCache.entries()) {
        obj[k] = v;
      }
      writeFileSync(DERIVATION_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }, 500);
}

function resolveKuromojiDictPath(): string {
  if (process.env.KUROMOJI_DICT_PATH) {
    return process.env.KUROMOJI_DICT_PATH;
  }
  const baseDir = import.meta.dir;
  const candidates: string[] = [];

  try {
    const AnalyzerClass = KuromojiAnalyzer.default || KuromojiAnalyzer;
    const test = new AnalyzerClass();
    if (test._dictPath) candidates.push(test._dictPath);
  } catch {}

  candidates.push(
    join(baseDir, '..', 'node_modules', 'kuromoji', 'dict'),
    join(baseDir, '..', '..', 'node_modules', 'kuromoji', 'dict'),
    join(baseDir, '..', 'node_modules', 'kuroshiro-analyzer-kuromoji', 'node_modules', 'kuromoji', 'dict'),
    join(baseDir, '..', '..', 'node_modules', 'kuroshiro-analyzer-kuromoji', 'node_modules', 'kuromoji', 'dict')
  );

  const bunDirs = [
    join(baseDir, '..', 'node_modules', '.bun'),
    join(baseDir, '..', '..', 'node_modules', '.bun'),
  ];
  for (const bDir of bunDirs) {
    if (existsSync(bDir)) {
      try {
        const entries = readdirSync(bDir);
        for (const entry of entries) {
          if (entry.startsWith('kuromoji@') || entry.startsWith('kuroshiro-analyzer-kuromoji@')) {
            candidates.push(join(bDir, entry, 'node_modules', 'kuromoji', 'dict'));
          }
        }
      } catch {}
    }
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return candidates[0] || join(baseDir, '..', 'node_modules', 'kuromoji', 'dict');
}

let kuroshiroInstance: any = null;
let kuroshiroInitPromise: Promise<any> | null = null;
// Last init failure, surfaced in the 503 body so a failing relay can be diagnosed
let kuroshiroLastError: string | null = null;

async function getKuroshiro(): Promise<any> {
  if (kuroshiroInstance) return kuroshiroInstance;
  if (!kuroshiroInitPromise) {
    kuroshiroInitPromise = (async () => {
      let triedDictPath: string | null = null;
      try {
        const KuroClass = Kuroshiro.default || Kuroshiro;
        const AnalyzerClass = KuromojiAnalyzer.default || KuromojiAnalyzer;
        triedDictPath = resolveKuromojiDictPath();

        if (!triedDictPath || !existsSync(triedDictPath)) {
          const err = new Error(`Kuromoji dict path not found or does not exist: ${triedDictPath}`);
          kuroshiroLastError = `dictPath: ${triedDictPath} - ${err.message}`;
          console.error('[Relay] Failed to initialize Kuroshiro:', kuroshiroLastError);
          kuroshiroInitPromise = null;
          return null;
        }

        const analyzer = new AnalyzerClass({ dictPath: triedDictPath });
        const kuro = new KuroClass();
        await kuro.init(analyzer);
        kuroshiroInstance = kuro;
        kuroshiroLastError = null;
        console.log(`[Relay] Kuroshiro + Kuromoji analyzer initialized successfully (dictPath: ${triedDictPath})`);
        return kuro;
      } catch (err: unknown) {
        const errStr = err instanceof Error ? `${err.message}${err.stack ? ` at ${err.stack.replace(/\n/g, ' ')}` : ''}` : String(err);
        kuroshiroLastError = `dictPath: ${triedDictPath} - ${errStr}`;
        console.error('[Relay] Failed to initialize Kuroshiro:', kuroshiroLastError);
        kuroshiroInitPromise = null;
        return null;
      }
    })();
  }
  return kuroshiroInitPromise;
}

// Warm up Kuroshiro in background
void getKuroshiro();

async function handleRomajiRequest(req: Request, url: URL): Promise<Response> {
  if (req.method === 'POST') {
    try {
      const body = (await req.json()) as { lines?: string[]; songId?: string };
      const lines = Array.isArray(body?.lines) ? body.lines : [];
      if (lines.length === 0) {
        return jsonResponse({ lines: [], failedLines: 0, totalLines: 0, source: 'empty' });
      }

      const songId = typeof body?.songId === 'string' ? body.songId.trim() : '';
      const contentHash = sha256(lines.join('\n'));
      const hashKey = `romaji:${contentHash}`;
      const songKey = songId ? `romaji:${songId}|${contentHash}` : null;

      if (songKey) {
        const cachedBySong = derivationCache.get(songKey);
        if (cachedBySong) {
          if (
            cachedBySong.lines &&
            cachedBySong.lines.length === lines.length &&
            !cachedBySong.lines.some((l) => /[\u4e00-\u9faf]/.test(l))
          ) {
            return jsonResponse({
              lines: cachedBySong.lines,
              source: 'cache',
              failedLines: 0,
              totalLines: lines.length,
            });
          }
          derivationCache.delete(songKey);
        }
      }

      const cachedByHash = derivationCache.get(hashKey);
      if (cachedByHash) {
        if (
          cachedByHash.lines &&
          cachedByHash.lines.length === lines.length &&
          !cachedByHash.lines.some((l) => /[\u4e00-\u9faf]/.test(l))
        ) {
          return jsonResponse({
            lines: cachedByHash.lines,
            source: 'cache',
            failedLines: 0,
            totalLines: lines.length,
          });
        }
        derivationCache.delete(hashKey);
      }

      const kuro = await getKuroshiro();
      const kuroWasNull = kuro === null;
      let failedLines = 0;
      let convertedKanjiLines = 0;
      let japaneseLinesCount = 0;
      let convertedJapaneseLinesCount = 0;
      let convertedLines: string[] | null = null;
      let source: 'kuroshiro' | 'gemini' = 'kuroshiro';

      if (kuro) {
        const results: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !JAPANESE_CHAR_REGEX.test(trimmed)) {
            results.push(trimmed);
            continue;
          }
          japaneseLinesCount++;
          const lineKey = `romaji:line:${sha256(trimmed)}`;
          const cachedLine = derivationCache.get(lineKey);
          if (cachedLine?.romaji && !/[\u4e00-\u9faf]/.test(cachedLine.romaji)) {
            results.push(cachedLine.romaji);
            convertedJapaneseLinesCount++;
            continue;
          }

          try {
            const res = await kuro.convert(trimmed, {
              to: 'romaji',
              mode: 'spaced',
              romajiSystem: 'hepburn',
            });
            if (res && typeof res === 'string') {
              const cleaned = res.trim();
              if (!/[\u4e00-\u9faf]/.test(cleaned)) {
                derivationCache.set(lineKey, { romaji: cleaned });
                results.push(cleaned);
                convertedJapaneseLinesCount++;
                continue;
              }
            }
            failedLines++;
            console.error(
              '[Relay] per-line conversion failed for:',
              JSON.stringify(trimmed.slice(0, 80)),
              'conversion incomplete or contains kanji'
            );
            results.push(trimmed);
          } catch (err: unknown) {
            failedLines++;
            console.error(
              '[Relay] per-line conversion failed for:',
              JSON.stringify(trimmed.slice(0, 80)),
              (err as Error).message
            );
            results.push(trimmed);
          }
        }

        convertedKanjiLines = results.filter((l) => /[\u4e00-\u9faf]/.test(l)).length;

        // Batch succeeds if at least one Japanese line converted to romaji (or if 0 Japanese lines existed)
        if (japaneseLinesCount === 0 || convertedJapaneseLinesCount > 0) {
          convertedLines = results;
          source = 'kuroshiro';
        }
      }

      // If Kuroshiro produced 0 usable Japanese conversions, try optional Gemini fallback
      if (!convertedLines && isGeminiConfigured()) {
        try {
          const geminiResult = await romanizeLyricsWithGemini(lines);
          if (
            geminiResult &&
            geminiResult.length === lines.length &&
            !geminiResult.some((l) => /[\u4e00-\u9faf]/.test(l))
          ) {
            convertedLines = geminiResult;
            source = 'gemini';
            failedLines = 0;
            convertedKanjiLines = 0;
          }
        } catch (err: unknown) {
          console.error('[Relay] Gemini romaji fallback failed:', (err as Error).message);
        }
      }

      if (convertedLines) {
        if (failedLines === 0) {
          const entry: DerivationEntry = { lines: convertedLines, source };
          if (songKey) derivationCache.set(songKey, entry);
          derivationCache.set(hashKey, entry);
          scheduleSaveDerivationCache();
        }
        return jsonResponse({
          lines: convertedLines,
          source,
          failedLines,
          totalLines: lines.length,
        });
      }

      // Both Kuroshiro and optional Gemini failed or were unavailable
      return jsonResponse(
        {
          error: 'romaji_unavailable',
          reason: 'kuroshiro_not_initialized',
          detail: kuroshiroLastError,
          kuroWasNull,
          convertedKanjiLines,
          totalLines: lines.length,
          geminiConfigured: isGeminiConfigured(),
        },
        503
      );
    } catch (err: unknown) {
      return errorResponse(400, 'invalid_batch_request', (err as Error).message);
    }
  }

  const text = url.searchParams.get('text')?.trim();
  if (!text) {
    return errorResponse(400, 'missing_text', 'Missing required parameter: text');
  }

  const cached = derivationCache.get(text);
  if (cached && (cached.romaji || cached.english)) {
    return jsonResponse({
      english: cached.english || '',
      romaji: cached.romaji || '',
    });
  }

  // Work 2: Relay-side Kuroshiro first for Japanese text
  let romajiResult = '';
  if (JAPANESE_CHAR_REGEX.test(text)) {
    try {
      const kuro = await getKuroshiro();
      if (kuro) {
        const converted = await kuro.convert(text, {
          to: 'romaji',
          mode: 'spaced',
          romajiSystem: 'hepburn',
        });
        if (converted && typeof converted === 'string') {
          romajiResult = converted.trim();
        }
      }
    } catch (err) {
      console.warn('[Relay] Kuroshiro conversion error:', err);
    }
  }

  if (romajiResult) {
    const entry: DerivationEntry = {
      english: cached?.english || '',
      romaji: romajiResult,
    };
    derivationCache.set(text, entry);
    scheduleSaveDerivationCache();
    return jsonResponse(entry);
  }

  // Google Translate fallback as last resort
  try {
    const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(gUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return errorResponse(502, 'translation_error', `Google Translate responded with ${res.status}`);
    }

    const data = await res.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return errorResponse(502, 'invalid_response', 'Malformed translation response');
    }

    const enSegments: string[] = [];
    let googleRomaji: string | null = null;

    for (const item of data[0]) {
      if (Array.isArray(item)) {
        if (item[0]) enSegments.push(item[0]);
        if (item.length > 3 && item[3]) googleRomaji = item[3];
      }
    }

    const entry: DerivationEntry = {
      english: enSegments.join('').trim(),
      romaji: (googleRomaji || '').trim(),
    };

    derivationCache.set(text, entry);
    scheduleSaveDerivationCache();
    return jsonResponse(entry);
  } catch (err: unknown) {
    return errorResponse(500, 'romaji_fetch_failed', (err as Error).message);
  }
}

async function handleTranslateEnRequest(req: Request, url: URL): Promise<Response> {
  if (req.method === 'POST') {
    try {
      const body = (await req.json()) as { lines?: string[]; songId?: string };
      const lines = Array.isArray(body?.lines) ? body.lines : [];
      if (lines.length === 0) {
        return jsonResponse({ lines: [], source: 'empty' });
      }

      const songId = typeof body?.songId === 'string' ? body.songId.trim() : '';
      const contentHash = sha256(lines.join('\n'));
      const hashKey = `translate:${contentHash}`;
      const songKey = songId ? `translate:${songId}|${contentHash}` : null;

      // 1. Check disk cache
      if (songKey) {
        const cachedBySong = derivationCache.get(songKey);
        if (cachedBySong) {
          if (cachedBySong.lines && cachedBySong.lines.length === lines.length) {
            return jsonResponse({ lines: cachedBySong.lines, source: cachedBySong.source || 'cache' });
          }
          derivationCache.delete(songKey);
        }
      }
      const cachedByHash = derivationCache.get(hashKey);
      if (cachedByHash) {
        if (cachedByHash.lines && cachedByHash.lines.length === lines.length) {
          return jsonResponse({ lines: cachedByHash.lines, source: cachedByHash.source || 'cache' });
        }
        derivationCache.delete(hashKey);
      }

      // 2. Try Gemini Flash-Lite first if configured
      if (isGeminiConfigured()) {
        const geminiLines = await translateLyricsWithGemini(lines);
        if (geminiLines && geminiLines.length === lines.length) {
          const entry: DerivationEntry = { lines: geminiLines, source: 'gemini' };
          if (songKey) derivationCache.set(songKey, entry);
          derivationCache.set(hashKey, entry);
          scheduleSaveDerivationCache();
          return jsonResponse({ lines: geminiLines, source: 'gemini' });
        }
      }

      // 3. Fallback to Google Translate
      const googleLines: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !JAPANESE_CHAR_REGEX.test(trimmed)) {
          googleLines.push(trimmed);
          continue;
        }

        const cachedLine = derivationCache.get(trimmed);
        if (cachedLine?.english) {
          googleLines.push(cachedLine.english);
          continue;
        }

        const gRes = await fetchGoogleTranslate(trimmed);
        if (gRes.english) {
          googleLines.push(gRes.english);
          derivationCache.set(trimmed, { english: gRes.english });
        } else {
          return errorResponse(502, 'translation_unavailable', 'Google Translate failed or rate limited');
        }
      }

      if (googleLines.length === lines.length) {
        const entry: DerivationEntry = { lines: googleLines, source: 'google' };
        if (songKey) derivationCache.set(songKey, entry);
        derivationCache.set(hashKey, entry);
        scheduleSaveDerivationCache();
        return jsonResponse({ lines: googleLines, source: 'google' });
      }

      return errorResponse(502, 'translation_unavailable', 'Translation could not be completed');
    } catch (err: unknown) {
      return errorResponse(400, 'invalid_batch_request', (err as Error).message);
    }
  }

  // Legacy GET /api/translate-en?text=...
  const text = url.searchParams.get('text')?.trim();
  if (!text) {
    return errorResponse(400, 'missing_text', 'Missing required parameter: text');
  }

  const cached = derivationCache.get(text);
  if (cached?.english) {
    return jsonResponse({ english: cached.english });
  }

  const gRes = await fetchGoogleTranslate(text);
  if (gRes.english) {
    const entry = derivationCache.get(text) || {};
    entry.english = gRes.english;
    derivationCache.set(text, entry);
    scheduleSaveDerivationCache();
    return jsonResponse({ english: gRes.english });
  }

  return errorResponse(502, 'translation_error', 'Google Translate unavailable');
}

interface TitleTranslationEntry {
  originalTitle: string;
  translatedTitle: string | null;
  romaji?: string | null;
  english?: string | null;
  source?: string;
}

const TRANSLATION_CACHE_FILE = join(CACHE_DIR, 'title-translations.json');
const titleTranslationCache = new Map<string, TitleTranslationEntry>();
const inFlightTranslations = new Map<string, Promise<TitleTranslationEntry>>();

// Load persisted translations on startup
try {
  if (existsSync(TRANSLATION_CACHE_FILE)) {
    const raw = JSON.parse(readFileSync(TRANSLATION_CACHE_FILE, 'utf-8')) as Record<string, TitleTranslationEntry>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v === 'object') {
        titleTranslationCache.set(k, v);
      }
    }
  }
} catch {
  // Ignore corrupt cache file
}

let saveCacheTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSaveTranslationCache(): void {
  if (saveCacheTimer) return;
  saveCacheTimer = setTimeout(() => {
    saveCacheTimer = null;
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      const obj: Record<string, TitleTranslationEntry> = {};
      for (const [k, v] of titleTranslationCache.entries()) {
        obj[k] = v;
      }
      writeFileSync(TRANSLATION_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }, 500);
}

function normalizeRomajiForCompare(str: string): string {
  return str
    .toLowerCase()
    .replace(/tsu/g, 'tu')
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/fu/g, 'hu')
    .replace(/ou/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, '');
}

function doesArtistMatch(targetArtist: string, targetArtistRomaji: string | null, candidateArtist: string): boolean {
  if (!targetArtist) return true;
  if (!candidateArtist) return false;
  const candNorm = normalizeRomajiForCompare(candidateArtist);
  const targNorm = normalizeRomajiForCompare(targetArtist);
  if (candNorm && targNorm && (candNorm.includes(targNorm) || targNorm.includes(candNorm))) {
    return true;
  }
  if (targetArtistRomaji) {
    const romNorm = normalizeRomajiForCompare(targetArtistRomaji);
    if (candNorm && romNorm && (candNorm.includes(romNorm) || romNorm.includes(candNorm))) {
      return true;
    }
  }
  return false;
}

async function fetchGoogleTranslate(text: string): Promise<{ romaji: string | null; english: string | null }> {
  try {
    const urls = [
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`,
      `https://translate.google.com/translate_a/single?client=at&sl=ja&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`,
    ];
    let gRes: Response | null = null;
    for (const gUrl of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      gRes = await fetch(gUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (gRes.ok) break;
    }

    if (gRes?.ok) {
      const gData = await gRes.json();
      if (Array.isArray(gData) && Array.isArray(gData[0])) {
        let romaji: string | null = null;
        const enParts: string[] = [];

        for (const item of gData[0]) {
          if (Array.isArray(item)) {
            if (item[0]) enParts.push(String(item[0]));
            if (item.length > 3 && item[3]) romaji = String(item[3]);
          }
        }

        const english = enParts.join('').trim() || null;
        return {
          romaji: romaji ? romaji.trim() : null,
          english,
        };
      }
    }
  } catch {
    // Ignore error
  }
  return { romaji: null, english: null };
}

async function fetchDeezerCandidate(
  baseTitle: string,
  artist: string,
  artistRomaji: string | null
): Promise<string | null> {
  if (!artist) return null;
  try {
    const deezerQuery = `${artist} ${baseTitle}`.trim();
    const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(deezerQuery)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const dRes = await fetch(deezerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (dRes.ok) {
      const dData = await dRes.json();
      if (Array.isArray(dData?.data) && dData.data.length > 0) {
        const artistMatched = dData.data.filter((item: Record<string, any>) =>
          doesArtistMatch(artist, artistRomaji, String(item.artist?.name || ''))
        );
        if (artistMatched.length === 0) return null;

        // If Deezer returned multiple distinct songs by this artist, check if it matched an album tracklist
        if (artistMatched.length > 2) {
          const t0 = String(artistMatched[0].title_short || artistMatched[0].title || '').toLowerCase();
          const t1 = String(artistMatched[1].title_short || artistMatched[1].title || '').toLowerCase();
          if (t0 !== t1) {
            if (artistMatched.length <= 20 && artistMatched.length >= 3) {
              const alb1 = String(artistMatched[1].album?.title || '').trim();
              const alb2 = String(artistMatched[2].album?.title || '').trim();
              if (alb1 && alb1.toLowerCase() === alb2.toLowerCase() && !JAPANESE_CHAR_REGEX.test(alb1)) {
                return alb1;
              }
            }
            return null;
          }
        }

        for (const item of artistMatched) {
          const candidateTitle = String(item.title_short || item.title || '').trim();
          if (
            candidateTitle &&
            candidateTitle.toLowerCase() !== baseTitle.toLowerCase() &&
            !JAPANESE_CHAR_REGEX.test(candidateTitle)
          ) {
            return candidateTitle;
          }
        }
      }
    }
  } catch {
    // Ignore error
  }
  return null;
}

async function fetchItunesCandidate(
  baseTitle: string,
  artist: string,
  artistRomaji: string | null
): Promise<string | null> {
  try {
    // If artist is empty, we may be translating an artist name itself (e.g. ツユ -> TUYU)
    if (!artist) {
      const artistUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(baseTitle)}&entity=musicArtist&country=US&limit=3`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(artistUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        for (const r of results) {
          const name = String(r.artistName || '').trim();
          if (name && !JAPANESE_CHAR_REGEX.test(name) && doesArtistMatch(baseTitle, artistRomaji, name)) {
            return name;
          }
        }
      }
      return null;
    }

    const query = `${artist} ${baseTitle}`.trim();
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=US&limit=5`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(itunesUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const matched = results.filter((r: Record<string, unknown>) =>
      doesArtistMatch(artist, artistRomaji, String(r.artistName || ''))
    );

    if (matched.length === 0) return null;

    // Detect if the query matched an album collection rather than a specific track:
    // Multiple tracks from the same collection with different trackNames, where trackName !== collectionName
    if (matched.length >= 2) {
      const col0 = String(matched[0].collectionName || '').replace(/\s*-\s*(Single|EP)$/i, '').trim();
      const col1 = String(matched[1].collectionName || '').replace(/\s*-\s*(Single|EP)$/i, '').trim();
      const trk0 = String(matched[0].trackName || '').trim();
      const trk1 = String(matched[1].trackName || '').trim();

      const baseTrk0 = trk0.replace(/\s*\([^)]*remix[^)]*\)/i, '').trim().toLowerCase();
      const baseTrk1 = trk1.replace(/\s*\([^)]*remix[^)]*\)/i, '').trim().toLowerCase();

      if (
        col0 &&
        col0.toLowerCase() === col1.toLowerCase() &&
        baseTrk0 !== baseTrk1 &&
        trk0.toLowerCase() !== col0.toLowerCase() &&
        !JAPANESE_CHAR_REGEX.test(col0)
      ) {
        return col0;
      }
    }

    const wantsRemix = /remix|リミックス/i.test(baseTitle);
    // Prefer non-remix track when original title does not ask for a remix
    const sorted = [...matched].sort((a, b) => {
      const aRemix = /remix/i.test(String(a.trackName || ''));
      const bRemix = /remix/i.test(String(b.trackName || ''));
      if (!wantsRemix && aRemix !== bRemix) {
        return aRemix ? 1 : -1;
      }
      return 0;
    });

    for (const item of sorted) {
      const candidate = String(item.trackName || item.collectionName || '').trim();
      if (
        candidate &&
        candidate.toLowerCase() !== baseTitle.toLowerCase() &&
        !JAPANESE_CHAR_REGEX.test(candidate)
      ) {
        return candidate;
      }
    }
  } catch {
    // Ignore error
  }
  return null;
}

async function resolveTitleTranslation(title: string, artist: string): Promise<TitleTranslationEntry> {
  const cleanTitle = title.trim();
  const cleanArtist = artist.trim();

  if (!cleanTitle || !JAPANESE_CHAR_REGEX.test(cleanTitle)) {
    return {
      originalTitle: cleanTitle,
      translatedTitle: null,
    };
  }

  const cacheKey = `${cleanArtist.toLowerCase()}:${cleanTitle.toLowerCase()}`;
  const cached = titleTranslationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // If artist is empty, check if we already resolved this exact title under a known artist
  if (!cleanArtist) {
    const suffixKey = `:${cleanTitle.toLowerCase()}`;
    for (const [k, v] of titleTranslationCache.entries()) {
      if (k.endsWith(suffixKey) && v.translatedTitle && (v.source === 'deezer' || v.source === 'itunes')) {
        return v;
      }
    }
  }

  const existingInFlight = inFlightTranslations.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = (async (): Promise<TitleTranslationEntry> => {
    try {
      // Extract trailing instrumental/off-vocal suffix so catalog lookup hits the main track
      const instMatch = cleanTitle.match(
        /^(.+?)\s*([-(](?:instrumental|off\s*vocal)[)-]|\((?:instrumental|off\s*vocal)[^)]*\))$/i
      );
      const baseTitle = instMatch ? instMatch[1].trim() : cleanTitle;
      const suffix = instMatch ? ` ${instMatch[2].trim()}` : '';
      const effectiveArtist =
        cleanArtist.toLowerCase() === baseTitle.toLowerCase() ? '' : cleanArtist;

      // Get Google Translate romaji + english for baseTitle (and artist if Japanese)
      const [googleTitle, googleArtist] = await Promise.all([
        fetchGoogleTranslate(baseTitle),
        effectiveArtist && JAPANESE_CHAR_REGEX.test(effectiveArtist)
          ? fetchGoogleTranslate(effectiveArtist)
          : Promise.resolve({ romaji: null, english: null }),
      ]);

      const artistRomaji = googleArtist.romaji || googleArtist.english;

      // 1. Query Deezer first (no rate limits, fast)
      const deezerHit = await fetchDeezerCandidate(baseTitle, effectiveArtist, artistRomaji);

      const formatWithSuffix = (cand: string) => {
        if (!suffix) return cand;
        if (cand.toLowerCase().includes('instrumental') || cand.toLowerCase().includes('off vocal')) {
          return cand;
        }
        return `${cand}${suffix}`;
      };

      if (deezerHit) {
        const result: TitleTranslationEntry = {
          originalTitle: cleanTitle,
          translatedTitle: formatWithSuffix(deezerHit),
          romaji: googleTitle.romaji,
          english: googleTitle.english,
          source: 'deezer',
        };
        titleTranslationCache.set(cacheKey, result);
        scheduleSaveTranslationCache();
        return result;
      }

      // 2. Query iTunes US only when Deezer did not match
      const itunesHit = await fetchItunesCandidate(baseTitle, effectiveArtist, artistRomaji);

      if (itunesHit) {
        const result: TitleTranslationEntry = {
          originalTitle: cleanTitle,
          translatedTitle: formatWithSuffix(itunesHit),
          romaji: googleTitle.romaji,
          english: googleTitle.english,
          source: 'itunes',
        };
        titleTranslationCache.set(cacheKey, result);
        scheduleSaveTranslationCache();
        return result;
      }

      // 3. Fallback to Google Translate (if romaji has Chinese pinyin tone marks, prefer English)
      const hasPinyinTones = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(googleTitle.romaji || '');
      const fallbackCandidate = (
        (hasPinyinTones ? googleTitle.english || googleTitle.romaji : googleTitle.romaji || googleTitle.english) || ''
      ).trim();
      if (
        fallbackCandidate &&
        fallbackCandidate.toLowerCase() !== baseTitle.toLowerCase() &&
        !JAPANESE_CHAR_REGEX.test(fallbackCandidate)
      ) {
        const result: TitleTranslationEntry = {
          originalTitle: cleanTitle,
          translatedTitle: formatWithSuffix(fallbackCandidate),
          romaji: googleTitle.romaji,
          english: googleTitle.english,
          source: 'google',
        };
        titleTranslationCache.set(cacheKey, result);
        scheduleSaveTranslationCache();
        return result;
      }

      const noResult: TitleTranslationEntry = {
        originalTitle: cleanTitle,
        translatedTitle: null,
      };
      titleTranslationCache.set(cacheKey, noResult);
      scheduleSaveTranslationCache();
      return noResult;
    } finally {
      inFlightTranslations.delete(cacheKey);
    }
  })();

  inFlightTranslations.set(cacheKey, promise);
  return promise;
}

async function handleTranslateTitleRequest(url: URL): Promise<Response> {
  const title = url.searchParams.get('title')?.trim() || '';
  const artist = url.searchParams.get('artist')?.trim() || '';

  if (!title) {
    return errorResponse(400, 'missing_title', 'Missing required parameter: title');
  }

  const result = await resolveTitleTranslation(title, artist);
  return jsonResponse(result);
}

async function handleTranslateBatchRequest(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { items?: Array<{ title?: string; artist?: string }> };
    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) {
      return jsonResponse({ results: {} });
    }

    // Deduplicate items by cacheKey
    const uniqueMap = new Map<string, { title: string; artist: string }>();
    for (const item of rawItems.slice(0, 300)) {
      const title = String(item?.title || '').trim();
      const artist = String(item?.artist || '').trim();
      if (!title) continue;
      const key = `${artist.toLowerCase()}:${title.toLowerCase()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, { title, artist });
      }
    }

    const entries = Array.from(uniqueMap.entries());
    const results: Record<string, TitleTranslationEntry> = {};

    // Sort so items WITH an artist are resolved first (allowing empty-artist lookups to reuse them)
    entries.sort((a, b) => (b[1].artist ? 1 : 0) - (a[1].artist ? 1 : 0));

    // Process with concurrency of 2 to respect iTunes Search API rate limits
    const CONCURRENCY = 2;
    let index = 0;
    async function worker() {
      while (index < entries.length) {
        const current = index++;
        const [key, { title, artist }] = entries[current];
        results[key] = await resolveTitleTranslation(title, artist);
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker())
    );

    return jsonResponse({ results });
  } catch (err: unknown) {
    return errorResponse(400, 'invalid_batch_request', (err as Error).message);
  }
}

function getPidHoldingPort(port: number): string | null {
  try {
    const fuser = Bun.spawnSync(['fuser', `${port}/tcp`]);
    const fuserOut = (fuser.stdout.toString() || fuser.stderr.toString()).trim();
    const pids = fuserOut.split(/\s+/).filter(Boolean);
    if (pids.length > 0) return pids[0];
  } catch {}
  try {
    const ss = Bun.spawnSync(['ss', '-tlpn']);
    const text = ss.stdout.toString();
    const match = text.match(new RegExp(`:${port}\\s+.*users:\\(\\([^)]*pid=(\\d+)`));
    if (match?.[1]) return match[1];
  } catch {}
  return null;
}

const existingPid = getPidHoldingPort(PORT);
if (existingPid && existingPid !== String(process.pid)) {
  console.error(`[Relay] Port ${PORT} already in use by PID ${existingPid} - exiting`);
  process.exit(1);
}

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port: PORT,
    async fetch(req) {
      try {
        const url = new URL(req.url);

        if (req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: corsHeaders(req) });
        }

        let res: Response;
        if (url.pathname === '/api/lyrics') {
          res = await handleLyricsRequest(url);
        } else if (url.pathname === '/api/romaji') {
          res = await handleRomajiRequest(req, url);
        } else if (url.pathname === '/api/translate-en') {
          res = await handleTranslateEnRequest(req, url);
        } else if (url.pathname === '/api/translate-title') {
          res = await handleTranslateTitleRequest(url);
        } else if (url.pathname === '/api/translate-batch' && req.method === 'POST') {
          res = await handleTranslateBatchRequest(req);
        } else if (url.pathname === '/api/translate-cache') {
          const obj: Record<string, TitleTranslationEntry> = {};
          for (const [k, v] of titleTranslationCache.entries()) {
            obj[k] = v;
          }
          res = jsonResponse({ translations: obj });
        } else if (url.pathname === '/api/health') {
          res = jsonResponse({
            status: 'ok',
            service: 'plenrip-lyrics-relay',
            pid: process.pid,
            providers: Object.keys(PROVIDERS_BY_ID),
            features: ['lyrics', 'romaji', 'translate-title', 'translate-batch', 'translate-cache'],
          });
        } else {
          res = errorResponse(404, 'not_found', `Route not found: ${url.pathname}`);
        }

        const headers = corsHeaders(req);
        for (const [k, v] of Object.entries(headers)) {
          res.headers.set(k, v);
        }
        return res;
      } catch (err: unknown) {
        console.error('[Relay] Uncaught request error:', err);
        const res = errorResponse(500, 'internal_error', (err as Error).message);
        const headers = corsHeaders(req);
        for (const [k, v] of Object.entries(headers)) {
          res.headers.set(k, v);
        }
        return res;
      }
    },
  });
} catch (err: unknown) {
  const pid = getPidHoldingPort(PORT) || 'unknown';
  console.error(`[Relay] Port ${PORT} already in use by PID ${pid} - exiting`);
  process.exit(1);
}

console.log(`[Relay] PID ${process.pid} active on http://127.0.0.1:${server.port}`);
