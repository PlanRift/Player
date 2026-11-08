import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle, findBestCandidate } from '../scoring';
import { parseLrc, hasWordTimings } from '../normalize/lrc';
import { parseYrc } from '../normalize/yrc';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface NeteaseArtist {
  name: string;
}

interface NeteaseSongItem {
  id: number;
  name: string;
  artists?: NeteaseArtist[];
  dt?: number; // duration in ms
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSongItem[];
  };
}

interface NeteaseLyricResponse {
  lrc?: { lyric?: string };
  yrc?: { lyric?: string };
  klyric?: { lyric?: string };
  tlyric?: { lyric?: string };
  romalrc?: { lyric?: string };
}

const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
};

export const neteaseProvider: LyricsProvider = {
  id: 'netease',
  name: 'NetEase Music',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const searchUrl = `https://music.163.com/api/search/get?s=${encodeURIComponent(`${cleaned} ${query.artist || ''}`.trim())}&type=1&limit=10`;

    try {
      const searchRes = await fetch(searchUrl, { headers: NETEASE_HEADERS, signal });
      if (!searchRes.ok) return null;

      const data = (await searchRes.json()) as NeteaseSearchResponse;
      const songs = data?.result?.songs;
      if (!Array.isArray(songs) || songs.length === 0) return null;

      const candidates = songs.map((s) => ({
        id: s.id,
        title: s.name,
        artist: s.artists?.map((a) => a.name).join('/') || '',
        duration: s.dt ? s.dt / 1000 : undefined,
      }));

      const best = findBestCandidate(candidates, query);
      if (!best) return null;

      const lyricUrl = `https://music.163.com/api/song/lyric?id=${best.id}&lv=-1&kv=-1&tv=-1&rv=-1`;
      const lyricRes = await fetch(lyricUrl, { headers: NETEASE_HEADERS, signal });
      if (!lyricRes.ok) return null;

      const lyricData = (await lyricRes.json()) as NeteaseLyricResponse;

      let translationLines: UnifiedLyrics['translationLines'];
      let romajiLines: UnifiedLyrics['romajiLines'];

      if (lyricData?.tlyric?.lyric) {
        const parsed = parseLrc(lyricData.tlyric.lyric);
        if (parsed.length > 0) translationLines = parsed;
      }

      if (lyricData?.romalrc?.lyric) {
        const parsed = parseLrc(lyricData.romalrc.lyric);
        if (parsed.length > 0) romajiLines = parsed;
      }

      // 1. Try word-synced YRC
      if (lyricData?.yrc?.lyric) {
        const lines = parseYrc(lyricData.yrc.lyric);
        if (lines.length > 0) {
          return applyInlineBackgroundSplit({
            lines,
            synced: true,
            source: 'netease',
            provider: 'NetEase Music',
            hasWordSync: true,
            match: { title: best.title, artist: best.artist, duration: best.duration },
            translationLines: translationLines && translationLines.length === lines.length ? translationLines : undefined,
            romajiLines: romajiLines && romajiLines.length === lines.length ? romajiLines : undefined,
          });
        }
      }

      // 2. Try line-synced LRC
      if (lyricData?.lrc?.lyric) {
        const lines = parseLrc(lyricData.lrc.lyric);
        if (lines.length > 0) {
          return applyInlineBackgroundSplit({
            lines,
            synced: true,
            source: 'netease',
            provider: 'NetEase Music',
            hasWordSync: hasWordTimings(lines),
            match: { title: best.title, artist: best.artist, duration: best.duration },
            translationLines: translationLines && translationLines.length === lines.length ? translationLines : undefined,
            romajiLines: romajiLines && romajiLines.length === lines.length ? romajiLines : undefined,
          });
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
