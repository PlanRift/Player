import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics } from '../types';
import { cleanTitle, findBestCandidate, stripCreditLines } from '../scoring';
import { parseLrc, hasWordTimings } from '../normalize/lrc';
import { decodeQqLyricPayload, parseQrc } from '../normalize/qrc';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface QqSinger {
  name: string;
}

interface QqSongItem {
  songid: number;
  songname: string;
  singer?: QqSinger[];
  interval?: number; // duration in seconds
  albumname?: string;
}

interface QqSearchResponse {
  data?: {
    song?: {
      list?: QqSongItem[];
    };
  };
}

interface QqLyricResponse {
  req_0?: {
    code?: number;
    data?: {
      lyric?: string;
      trans?: string;
      roma?: string;
      qrc?: string;
    };
  };
}

type QqLyricData = NonNullable<NonNullable<QqLyricResponse['req_0']>['data']>;

interface QqBest {
  songid: number;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

async function fetchLyricData(
  best: QqBest,
  crypt: number,
  qrc: number,
  signal?: AbortSignal,
): Promise<QqLyricData | null> {
  const lyricPayload = {
    comm: {
      ct: '11',
      cv: '1003006',
      v: '1003006',
      os_ver: '15',
      phonetype: '24122RKC7C',
      tmeAppID: 'qqmusiclight',
      nettype: 'NETWORK_WIFI',
    },
    req_0: {
      module: 'music.musichallSong.PlayLyricInfo',
      method: 'GetPlayLyricInfo',
      param: {
        songID: best.songid,
        songName: Buffer.from(best.title).toString('base64'),
        albumName: Buffer.from(best.album || '').toString('base64'),
        singerName: Buffer.from(best.artist || '').toString('base64'),
        crypt,
        qrc,
        trans: 1,
        roma: 1,
        cv: 2111,
        ct: 19,
        lrc_t: 0,
        qrc_t: 0,
        roma_t: 0,
        trans_t: 0,
        type: 0,
        interval: best.duration || 0,
      },
    },
  };

  const lyricRes = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': QQ_HEADERS['User-Agent'],
    },
    body: JSON.stringify(lyricPayload),
    signal,
  });

  if (!lyricRes.ok) return null;
  const lyricData = (await lyricRes.json()) as QqLyricResponse;
  return lyricData?.req_0?.data ?? null;
}

function buildResult(
  lines: UnifiedLyrics['lines'],
  best: QqBest,
  romajiLines?: UnifiedLyrics['romajiLines'],
): UnifiedLyrics {
  return applyInlineBackgroundSplit({
    lines,
    synced: true,
    source: 'qq',
    provider: 'QQ Music',
    hasWordSync: hasWordTimings(lines),
    match: {
      title: best.title,
      artist: best.artist,
      album: best.album,
      duration: best.duration,
    },
    romajiLines,
  });
}

/** Strip leading credit lines so the main lines and the roma sidecar align. */
function stripLines(lines: UnifiedLyrics['lines'], best: QqBest): UnifiedLyrics['lines'] {
  const cleaned = stripCreditLines(
    { lines, synced: true, source: 'qq', provider: 'QQ Music' },
    { title: best.title, artist: best.artist },
  );
  return cleaned ? cleaned.lines : lines;
}

/**
 * Decode the roma sidecar (romaji readings). The roma payload is QRC when
 * the main payload is QRC, plain LRC otherwise; try both parsers. The
 * sidecar usually omits the credit lines the main payload carries, so both
 * sides are credit-stripped before the length check. Returns undefined
 * when the sidecar does not align with the main lines.
 *
 * NOTE: QQ's trans field is a Chinese translation, not English. It is
 * deliberately NOT attached as translationLines: the client's Translated
 * toggle promises English, and an attached Chinese sidecar would also
 * block the Gemini English derivation for the track.
 */
function decodeRomaji(raw: string | undefined, lines: UnifiedLyrics['lines'], best: QqBest): UnifiedLyrics['lines'] | undefined {
  if (!raw) {
    console.log(`[QQ] roma sidecar absent for "${best.title}" by "${best.artist}"`);
    return undefined;
  }
  try {
    const decoded = decodeQqLyricPayload(raw);
    if (!decoded) return undefined;
    let parsed = parseQrc(decoded);
    if (parsed.length === 0) parsed = parseLrc(decoded);
    if (parsed.length === 0) return undefined;
    const sideLines = stripLines(parsed, best);
    if (sideLines.length === 0 || lines.length === 0) return undefined;

    // Time-based alignment: for each main line, attach the romaji line whose start time is closest (within 1s)
    let matchedCount = 0;
    const alignedRomajiLines: UnifiedLyrics['lines'] = lines.map((mainLine) => {
      let closest: UnifiedLyrics['lines'][number] | null = null;
      let minDiff = 1.0;

      for (const side of sideLines) {
        const diff = Math.abs(side.t - mainLine.t);
        if (diff <= minDiff) {
          minDiff = diff;
          closest = side;
        }
      }

      if (closest) {
        matchedCount++;
        return {
          ...closest,
          t: mainLine.t,
        };
      }
      return {
        t: mainLine.t,
        text: '',
      };
    });

    if (matchedCount >= lines.length * 0.9) {
      return alignedRomajiLines;
    }
  } catch (err) {
    console.warn('[QQ] Failed to decode roma sidecar:', err);
  }
  return undefined;
}

/** Word-synced QRC path (crypt=1, qrc=1). Returns null when QQ has no QRC. */
function buildFromQrc(data: QqLyricData, best: QqBest): UnifiedLyrics | null {
  if (!data.lyric) return null;
  const decoded = decodeQqLyricPayload(data.lyric);
  if (!decoded) return null;
  const rawLines = parseQrc(decoded);
  if (rawLines.length === 0) return null;
  const lines = stripLines(rawLines, best);
  const romajiLines = decodeRomaji(data.roma, lines, best);
  return buildResult(lines, best, romajiLines);
}

/** Plain line-synced LRC fallback (crypt=0, qrc=0). */
function buildFromLrc(data: QqLyricData, best: QqBest): UnifiedLyrics | null {
  if (!data.lyric) return null;
  let decodedLrc: string;
  try {
    decodedLrc = Buffer.from(data.lyric, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  const rawLines = parseLrc(decodedLrc);
  if (rawLines.length === 0) return null;
  const lines = stripLines(rawLines, best);
  const romajiLines = decodeRomaji(data.roma, lines, best);
  return buildResult(lines, best, romajiLines);
}

const QQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://y.qq.com/',
};

export const qqProvider: LyricsProvider = {
  id: 'qq',
  name: 'QQ Music',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(`${cleaned} ${query.artist || ''}`.trim())}&format=json`;

    try {
      const searchRes = await fetch(searchUrl, { headers: QQ_HEADERS, signal });
      if (!searchRes.ok) return null;

      const searchData = (await searchRes.json()) as QqSearchResponse;
      const list = searchData?.data?.song?.list;
      if (!Array.isArray(list) || list.length === 0) return null;

      const candidates = list.map((item) => ({
        songid: item.songid,
        title: item.songname,
        artist: item.singer?.map((s) => s.name).join('/') || '',
        album: item.albumname,
        duration: item.interval,
      }));

      const best = findBestCandidate(candidates, query);
      if (!best) return null;

      // 1. Word-synced QRC first (crypt=1, qrc=1).
      const qrcData = await fetchLyricData(best, 1, 1, signal);
      if (qrcData) {
        const qrcResult = buildFromQrc(qrcData, best);
        if (qrcResult) return qrcResult;
      }

      // 2. Plain line-synced LRC fallback (crypt=0, qrc=0). The crypt=0
      // lyric field is Base64 LRC (proven live); this keeps QQ working on
      // tracks without a QRC version.
      const lrcData = await fetchLyricData(best, 0, 0, signal);
      if (lrcData) {
        const lrcResult = buildFromLrc(lrcData, best);
        if (lrcResult) return lrcResult;
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
