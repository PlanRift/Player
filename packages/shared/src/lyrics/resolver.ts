import {
  LyricsProvider,
  LyricsRequest,
  LyricsResult,
  PROVIDERS_BY_ID,
} from './providers';

// In-memory cache per trackId / provider combination
const lyricsCache = new Map<string, LyricsResult | null>();
const inMemoryOverrides = new Map<string, string>();

export const DEFAULT_PROVIDER_PRIORITY = [
  'lrclib',
  'netease',
  'qq',
  'kugou',
  'lyricsplus',
  'unison',
];

export function getProviderPriority(): string[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem('planrift.lyrics.priority');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to default
    }
  }
  return DEFAULT_PROVIDER_PRIORITY;
}

export function setProviderPriority(order: string[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  localStorage.setItem('planrift.lyrics.priority', JSON.stringify(order));
}

export function getTrackProviderOverride(trackId: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return localStorage.getItem(`planrift.lyrics.provider.${trackId}`);
  }
  return inMemoryOverrides.get(trackId) ?? null;
}

export function setTrackProviderOverride(trackId: string, providerId: string | null): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    if (!providerId || providerId === 'auto') {
      localStorage.removeItem(`planrift.lyrics.provider.${trackId}`);
    } else {
      localStorage.setItem(`planrift.lyrics.provider.${trackId}`, providerId);
    }
  }
  if (!providerId || providerId === 'auto') {
    inMemoryOverrides.delete(trackId);
  } else {
    inMemoryOverrides.set(trackId, providerId);
  }
}

export function cacheTrackLyrics(
  trackKey: string,
  providerId: string,
  result: LyricsResult | null
): void {
  lyricsCache.set(`${trackKey}:${providerId}`, result);
  lyricsCache.set(`${trackKey}:auto`, result);
}

export function getCachedTrackLyrics(
  trackKey: string,
  providerId = 'auto'
): LyricsResult | null | undefined {
  return lyricsCache.get(`${trackKey}:${providerId}`);
}

export function clearLyricsCache(): void {
  lyricsCache.clear();
}

export interface ProviderProbeResult {
  providerId: string;
  name: string;
  status: 'found' | 'not_found' | 'unreachable';
  error?: string;
  result?: LyricsResult;
}

/**
 * Probe a single provider for lyrics without throwing (safe for UI status badges).
 */
export async function probeProvider(
  provider: LyricsProvider,
  req: LyricsRequest,
  signal?: AbortSignal
): Promise<ProviderProbeResult> {
  try {
    const res = await provider.fetch(req, signal);
    if (res && (res.syncedLyrics || res.plainLyrics)) {
      return {
        providerId: provider.id,
        name: provider.name,
        status: 'found',
        result: res,
      };
    }
    return {
      providerId: provider.id,
      name: provider.name,
      status: 'not_found',
    };
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    return {
      providerId: provider.id,
      name: provider.name,
      status: 'unreachable',
      error: (err as Error).message || 'Unreachable',
    };
  }
}

/**
 * Resolves lyrics according to configuration:
 * 1. Per-track override if set and not "auto"
 * 2. Explicit provider if requested
 * 3. Priority fallback ("Otomatis") through ALL_LYRICS_PROVIDERS
 */
export async function resolveLyrics(
  req: LyricsRequest,
  trackId?: string,
  explicitProviderId?: string,
  signal?: AbortSignal
): Promise<LyricsResult | null> {
  const chosenProvider =
    explicitProviderId ||
    (trackId ? getTrackProviderOverride(trackId) : null) ||
    'auto';

  const cacheKey = `${trackId || `${req.artist}:${req.track}`}:${chosenProvider}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!;
  }

  // Explicit provider specified
  if (chosenProvider !== 'auto') {
    const provider = PROVIDERS_BY_ID[chosenProvider];
    if (!provider) {
      return null;
    }
    try {
      const res = await provider.fetch(req, signal);
      lyricsCache.set(cacheKey, res);
      return res;
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
      return null;
    }
  }

  // "Otomatis" priority resolution
  const priority = getProviderPriority();
  for (const pid of priority) {
    const provider = PROVIDERS_BY_ID[pid];
    if (!provider) continue;

    try {
      const res = await provider.fetch(req, signal);
      if (res && (res.syncedLyrics || res.plainLyrics)) {
        lyricsCache.set(cacheKey, res);
        lyricsCache.set(`${trackId || `${req.artist}:${req.track}`}:${pid}`, res);
        return res;
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
      // Continue to next provider on failure/unreachable
    }
  }

  lyricsCache.set(cacheKey, null);
  return null;
}

/**
 * Manual LRCLIB search helper for custom user queries.
 */
export async function searchLrclibManual(
  track: string,
  artist = '',
  signal?: AbortSignal
): Promise<
  Array<{
    id: number;
    trackName: string;
    artistName: string;
    albumName?: string;
    duration?: number;
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
  }>
> {
  const query = `${track} ${artist}`.trim();
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (!res.ok) {
    throw new Error(`LRCLIB search failed (${res.status}): ${res.statusText}`);
  }
  return await res.json();
}
