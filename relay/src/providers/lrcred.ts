import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle, findBestCandidate } from '../scoring';
import { parseTtml } from '../normalize/ttml';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface LrcRedHit {
  isrc: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

interface LrcRedSearchResponse {
  hits?: LrcRedHit[];
}

export const lrcredProvider: LyricsProvider = {
  id: 'lrcred',
  name: 'lrc.red',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const searchUrl = `https://lrc.red/search.json?q=${encodeURIComponent(`${cleaned} ${query.artist || ''}`.trim())}`;

    try {
      const searchRes = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (searchRes.ok) {
        const data = (await searchRes.json()) as LrcRedSearchResponse;
        const hits = data?.hits;
        if (Array.isArray(hits) && hits.length > 0) {
          const candidates = hits.map((h) => ({
            isrc: h.isrc,
            title: h.title,
            artist: h.artist,
            album: h.album,
            duration: h.duration,
          }));

          const best = findBestCandidate(candidates, query);
          if (best?.isrc) {
            const ttmlRes = await fetch(`https://lrc.red/s/${best.isrc}.ttml`, {
              headers: { 'User-Agent': 'Century/1.0' },
              signal,
            });

            if (ttmlRes.ok) {
              const xml = await ttmlRes.text();
              const lines = parseTtml(xml);
              if (lines.length > 0) {
                const hasWordSync = lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
                return applyInlineBackgroundSplit({
                  lines,
                  synced: true,
                  source: 'lrcred',
                  provider: 'lrc.red',
                  hasWordSync,
                  match: {
                    title: best.title,
                    artist: best.artist,
                    album: best.album,
                    duration: best.duration,
                  },
                });
              }
            }
          }
        }
      }

      // Fallback via lyrics-api.binimum.org redirect
      const binimumParams = new URLSearchParams({
        track: cleaned,
        artist: query.artist || '',
        duration: query.duration ? String(Math.round(query.duration)) : '',
      });
      const binimumRes = await fetch(`https://lyrics-api.binimum.org/?${binimumParams.toString()}`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (binimumRes.ok) {
        const binimumData = (await binimumRes.json()) as { results?: Array<{ lyricsUrl?: string }> };
        const lyricsUrl = binimumData?.results?.[0]?.lyricsUrl;
        if (lyricsUrl) {
          const lyricsRes = await fetch(lyricsUrl, {
            headers: { 'User-Agent': 'Century/1.0' },
            signal,
          });
          if (lyricsRes.ok) {
            const xml = await lyricsRes.text();
            const lines = parseTtml(xml);
            if (lines.length > 0) {
              const hasWordSync = lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
              return applyInlineBackgroundSplit({
                lines,
                synced: true,
                source: 'lrcred',
                provider: 'lrc.red',
                hasWordSync,
              });
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
