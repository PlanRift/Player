import { ProviderError, type LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle, findBestCandidate } from '../scoring';
import { parseLrc, parsePlainLyrics, hasWordTimings } from '../normalize/lrc';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface LrclibSong {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export const lrclibProvider: LyricsProvider = {
  id: 'lrclib',
  name: 'LRCLIB',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;

    // 1. Try exact match
    const getParams = new URLSearchParams({
      track_name: cleaned,
      artist_name: query.artist || '',
    });
    if (query.album) getParams.set('album_name', query.album);
    if (query.duration) getParams.set('duration', String(Math.round(query.duration)));

    try {
      const getRes = await fetch(`https://lrclib.net/api/get?${getParams.toString()}`, {
        headers: { 'User-Agent': 'Century/1.0' },
        signal,
      });

      if (getRes.ok) {
        const data = (await getRes.json()) as LrclibSong;
        const match = {
          title: data.trackName,
          artist: data.artistName,
          album: data.albumName,
          duration: data.duration,
        };
        if (data.syncedLyrics) {
          const lines = parseLrc(data.syncedLyrics);
          if (lines.length > 0) {
            return applyInlineBackgroundSplit({
              lines,
              synced: true,
              source: 'lrclib',
              provider: 'LRCLIB',
              hasWordSync: hasWordTimings(lines),
              match,
            });
          }
        }
        if (data.plainLyrics) {
          const lines = parsePlainLyrics(data.plainLyrics);
          if (lines.length > 0) {
            return { lines, synced: false, source: 'lrclib', provider: 'LRCLIB', match };
          }
        }
      } else if (getRes.status !== 404 && getRes.status !== 400) {
        throw new ProviderError(`LRCLIB get failed with HTTP ${getRes.status}`, getRes.status);
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError((err as Error).message);
    }

    // 2. Try search fallback with candidate scoring
    try {
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleaned} ${query.artist || ''}`.trim())}`,
        {
          headers: { 'User-Agent': 'Century/1.0' },
          signal,
        }
      );

      if (searchRes.ok) {
        const list = (await searchRes.json()) as LrclibSong[];
        if (Array.isArray(list) && list.length > 0) {
          const candidates = list.map((item) => ({
            ...item,
            title: item.trackName,
            artist: item.artistName,
            duration: item.duration,
          }));

          const best = findBestCandidate(candidates, query);
          if (best) {
            const match = {
              title: best.trackName,
              artist: best.artistName,
              album: best.albumName,
              duration: best.duration,
            };
            if (best.syncedLyrics) {
              const lines = parseLrc(best.syncedLyrics);
              if (lines.length > 0) {
                return applyInlineBackgroundSplit({
                  lines,
                  synced: true,
                  source: 'lrclib',
                  provider: 'LRCLIB',
                  hasWordSync: hasWordTimings(lines),
                  match,
                });
              }
            }
            if (best.plainLyrics) {
              const lines = parsePlainLyrics(best.plainLyrics);
              if (lines.length > 0) {
                return { lines, synced: false, source: 'lrclib', provider: 'LRCLIB', match };
              }
            }
          }
        }
      } else if (searchRes.status !== 404) {
        throw new ProviderError(`LRCLIB search failed with HTTP ${searchRes.status}`, searchRes.status);
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError((err as Error).message);
    }

    return null;
  },
};
