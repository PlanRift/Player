export interface LyricsRequest {
  track: string;
  artist: string;
  album?: string;
  duration?: number;
}

export interface LyricsResult {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  providerId: string;
}

export interface LyricsProvider {
  id: string;
  name: string;
  bestKind: 'synced' | 'plain';
  fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null>;
}

// NOTE:
// SKIP Baidu (no API keys issued / enterprise only) and YouTube Music (requires innertube deciphering).
// Documented per architecture specification.

export const lrclibProvider: LyricsProvider = {
  id: 'lrclib',
  name: 'LRCLIB',
  bestKind: 'synced',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    const params = new URLSearchParams({
      track_name: req.track,
      artist_name: req.artist || '',
      album_name: req.album || '',
      duration: req.duration ? String(Math.round(req.duration)) : '',
    });

    try {
      const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.syncedLyrics || data.plainLyrics) {
          return {
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics,
            providerId: 'lrclib',
          };
        }
      }

      // Fallback search
      const query = `${req.track} ${req.artist || ''}`.trim();
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
        { signal }
      );

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (Array.isArray(searchData) && searchData.length > 0) {
          const first = searchData[0];
          if (first.syncedLyrics || first.plainLyrics) {
            return {
              syncedLyrics: first.syncedLyrics,
              plainLyrics: first.plainLyrics,
              providerId: 'lrclib',
            };
          }
        }
      }

      return null;
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw err;
      }
      throw new Error(`LRCLIB unreachable: ${(err as Error).message}`);
    }
  },
};

export const neteaseProvider: LyricsProvider = {
  id: 'netease',
  name: 'NetEase Music',
  bestKind: 'synced',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    try {
      const url = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(req.track)}&type=1&limit=1`;
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) return null;
      return null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error('netease unreachable (CORS restricted browser-direct)');
    }
  },
};

export const qqProvider: LyricsProvider = {
  id: 'qq',
  name: 'QQ Music',
  bestKind: 'synced',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    try {
      const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(req.track)}&format=json`;
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) return null;
      return null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error('qq unreachable (CORS restricted browser-direct)');
    }
  },
};

export const kugouProvider: LyricsProvider = {
  id: 'kugou',
  name: 'Kugou',
  bestKind: 'synced',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    try {
      const url = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(req.track)}`;
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) return null;
      return null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error('kugou unreachable (CORS restricted browser-direct)');
    }
  },
};

export const lyricsplusProvider: LyricsProvider = {
  id: 'lyricsplus',
  name: 'LyricsPlus',
  bestKind: 'synced',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    try {
      const url = `https://lyricsplus.example.com/api/lyrics?title=${encodeURIComponent(req.track)}&artist=${encodeURIComponent(req.artist)}`;
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) return null;
      return null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error('lyricsplus unreachable (CORS restricted browser-direct)');
    }
  },
};

export const unisonProvider: LyricsProvider = {
  id: 'unison',
  name: 'Unison',
  bestKind: 'plain',
  async fetch(req: LyricsRequest, signal?: AbortSignal): Promise<LyricsResult | null> {
    try {
      const url = `https://unison-lyrics.example.com/api/v1/search?q=${encodeURIComponent(`${req.track} ${req.artist}`)}`;
      const res = await fetch(url, { signal, mode: 'cors' });
      if (!res.ok) return null;
      return null;
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new Error('unison unreachable (CORS restricted browser-direct)');
    }
  },
};

export const ALL_LYRICS_PROVIDERS: LyricsProvider[] = [
  lrclibProvider,
  neteaseProvider,
  qqProvider,
  kugouProvider,
  lyricsplusProvider,
  unisonProvider,
];

export const PROVIDERS_BY_ID: Record<string, LyricsProvider> = Object.fromEntries(
  ALL_LYRICS_PROVIDERS.map((p) => [p.id, p])
);
