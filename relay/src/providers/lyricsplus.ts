import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle } from '../scoring';
import { parseLyricsPlus } from '../normalize/lyricsplus';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

export const lyricsplusProvider: LyricsProvider = {
  id: 'lyricsplus',
  name: 'LyricsPlus',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const params = new URLSearchParams({
      title: cleaned,
      artist: query.artist || '',
      album: query.album || '',
      duration: query.duration ? String(Math.round(query.duration)) : '',
    });

    try {
      const res = await fetch(`https://lyricsplus.binimum.org/v2/lyrics/get?${params.toString()}`, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      // Handle 404 / errors gracefully as honest not-found
      if (!res.ok) return null;

      const data = await res.json();
      if (!data || typeof data !== 'object' || 'error' in data) return null;

      const lines = parseLyricsPlus(data);
      if (lines.length > 0) {
        const hasWordSync = (data as { type?: string }).type === 'Word' || lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
        return applyInlineBackgroundSplit({
          lines,
          synced: true,
          source: 'lyricsplus',
          provider: 'LyricsPlus',
          hasWordSync,
          // Upstream gives no match metadata; the query it matched is reported.
          match: { title: query.title, artist: query.artist },
        });
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
