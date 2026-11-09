import { ProviderError, type LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle } from '../scoring';
import { parseTtml } from '../normalize/ttml';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface UnisonResponse {
  success?: boolean;
  data?: {
    format?: string;
    lyrics?: string;
  };
}

export const unisonProvider: LyricsProvider = {
  id: 'unison',
  name: 'Unison',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const params = new URLSearchParams({
      song: cleaned,
      artist: query.artist || '',
    });
    if (query.album) params.set('album', query.album);
    if (query.duration) params.set('duration', String(Math.round(query.duration)));

    try {
      const res = await fetch(`https://unison.boidu.dev/lyrics?${params.toString()}`, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (!res.ok) {
        if (res.status === 404) return null;
        throw new ProviderError(`Unison fetch failed with HTTP ${res.status}`, res.status);
      }

      const data = (await res.json()) as UnisonResponse;
      if (!data?.success || !data?.data?.lyrics) return null;

      const lines = parseTtml(data.data.lyrics);
      if (lines.length > 0) {
        const hasWordSync = lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
        return applyInlineBackgroundSplit({
          lines,
          synced: true,
          source: 'unison',
          provider: 'Unison',
          hasWordSync,
        });
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError((err as Error).message);
    }

    return null;
  },
};
