import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle, findBestCandidate, scoreCandidate } from '../scoring';
import { parseTtml } from '../normalize/ttml';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface AmllItem {
  id: number;
  musicNames?: string[];
  artistNames?: string[];
  albumNames?: string[];
}

interface AmllSearchResponse {
  status?: number;
  data?: {
    items?: AmllItem[];
    pagination?: unknown;
  };
}

interface AmllGetResponse {
  status?: number;
  data?: {
    lyrics?: string;
  };
}

/**
 * AMLL TTML DB (api.amll.dev): Apple TTML with per-word timings, no key,
 * CORS-open. Search returns several items per song (aliases in musicNames);
 * the best title per item is picked by score, then the best item by the
 * shared score gate. The get endpoint answers JSON with the TTML embedded
 * as an escaped string in data.lyrics (not raw TTML).
 */
export const amllProvider: LyricsProvider = {
  id: 'amll',
  name: 'AMLL',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const q = `${cleaned} ${query.artist || ''}`.trim();

    try {
      const searchRes = await fetch(`https://api.amll.dev/v1/lyrics/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (!searchRes.ok) return null;

      const data = (await searchRes.json()) as AmllSearchResponse;
      const items = data?.data?.items;
      if (!Array.isArray(items) || items.length === 0) return null;

      // One candidate per item: the musicNames entry that scores best
      // against the query (items carry alias lists, e.g. a romaji title
      // next to the Japanese one). AMLL items carry no duration, so the
      // match scores on title + artist only (max 90, passes SOFT_MIN).
      const candidates = items
        .filter((item) => Array.isArray(item.musicNames) && item.musicNames.length > 0)
        .map((item) => {
          const artist = (item.artistNames && item.artistNames[0]) || '';
          let bestTitle = item.musicNames![0];
          let bestScore = -Infinity;
          for (const name of item.musicNames!) {
            const s = scoreCandidate({ title: name, artist }, query);
            if (s > bestScore) {
              bestScore = s;
              bestTitle = name;
            }
          }
          return {
            id: item.id,
            title: bestTitle,
            artist,
            album: item.albumNames?.[0],
            duration: undefined as number | undefined,
          };
        });

      const best = findBestCandidate(candidates, query);
      if (!best?.id) return null;

      const getRes = await fetch(`https://api.amll.dev/v1/lyrics/get?id=${best.id}&format=ttml`, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (!getRes.ok) return null;

      const getData = (await getRes.json()) as AmllGetResponse;
      const ttml = getData?.data?.lyrics;
      if (!ttml) return null;

      const lines = parseTtml(ttml);
      if (lines.length > 0) {
        const hasWordSync = lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
        return applyInlineBackgroundSplit({
          lines,
          synced: true,
          source: 'amll',
          provider: 'AMLL',
          hasWordSync,
          match: {
            title: best.title,
            artist: best.artist,
            album: best.album,
            duration: best.duration,
          },
        });
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
