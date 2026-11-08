import type { LyricsProvider } from './base';
import type { LyricsQuery, UnifiedLyrics, LyricLine } from '../types';
import { cleanTitle, findBestCandidate, stripCreditLines } from '../scoring';
import { parseLrc, hasWordTimings } from '../normalize/lrc';
import { decodeKrcPayload, parseKrc } from '../normalize/krc';
import { applyInlineBackgroundSplit } from '../normalize/split-bg';

interface KugouCandidate {
  id: string;
  accesskey: string;
  song: string;
  singer: string;
  duration?: number; // in ms
}

interface KugouSearchResponse {
  candidates?: KugouCandidate[];
}

interface KugouDownloadResponse {
  status: number;
  content?: string;
}

interface KugouBest {
  id: string;
  accesskey: string;
  title: string;
  artist: string;
  duration?: number;
}

async function downloadLyrics(
  best: KugouBest,
  fmt: 'krc' | 'lrc',
  signal?: AbortSignal,
): Promise<string | null> {
  const downloadUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&fmt=${fmt}&charset=utf8&id=${best.id}&accesskey=${best.accesskey}`;
  const downRes = await fetch(downloadUrl, { headers: KUGOU_HEADERS, signal });
  if (!downRes.ok) return null;
  const downData = (await downRes.json()) as KugouDownloadResponse;
  return downData?.content ?? null;
}

/** Word-synced KRC path (fmt=krc). Returns null when KuGou has no KRC. */
function buildFromKrc(
  content: string,
  best: KugouBest,
): UnifiedLyrics | null {
  const decoded = decodeKrcPayload(content);
  if (!decoded) return null;
  const lines = parseKrc(decoded);
  if (lines.length === 0) return null;
  const { romajiLines } = extractKugouSidecars(decoded, lines);
  return applyInlineBackgroundSplit({
    lines,
    synced: true,
    source: 'kugou',
    provider: 'KuGou',
    hasWordSync: hasWordTimings(lines),
    match: { title: best.title, artist: best.artist, duration: best.duration },
    romajiLines,
  });
}

/** Plain line-synced LRC fallback (fmt=lrc). */
function buildFromLrc(
  content: string,
  best: KugouBest,
): UnifiedLyrics | null {
  const decodedLrc = Buffer.from(content, 'base64').toString('utf-8');
  const rawLines = parseLrc(decodedLrc);
  if (rawLines.length === 0) return null;
  // Strip leading credit lines so the main lines and the [language:]
  // sidecars (which usually omit credits) align by index.
  const cleaned = stripCreditLines(
    { lines: rawLines, synced: true, source: 'kugou', provider: 'KuGou' },
    { title: best.title, artist: best.artist },
  );
  const lines = cleaned ? cleaned.lines : rawLines;
  const { romajiLines } = extractKugouSidecars(decodedLrc, lines);
  return applyInlineBackgroundSplit({
    lines,
    synced: true,
    source: 'kugou',
    provider: 'KuGou',
    hasWordSync: hasWordTimings(lines),
    match: { title: best.title, artist: best.artist, duration: best.duration },
    romajiLines,
  });
}

const KUGOU_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/**
 * Extract the romaji (type 0) sidecar from KuGou's [language:<base64 JSON>]
 * tag. Only romaji is attached: the type 1 sidecar is a Chinese
 * translation, not English, and attaching it as translationLines would
 * both mislabel it under the Translated toggle and block the Gemini
 * English derivation for the track.
 */
function extractKugouSidecars(
  rawLrc: string,
  lines: LyricLine[],
): { romajiLines?: LyricLine[] } {
  const match = rawLrc.match(/\[language:([A-Za-z0-9+/=]+)\]/);
  if (!match) return {};
  try {
    const jsonStr = Buffer.from(match[1], 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonStr);
    const content = parsed?.content;
    if (!Array.isArray(content)) return {};

    let romajiLines: LyricLine[] | undefined;

    for (const item of content) {
      if (item.type === 0 && Array.isArray(item.lyricContent)) {
        const textLines = item.lyricContent.map((sub: string[]) =>
          Array.isArray(sub) ? sub.join('') : String(sub),
        );
        if (textLines.length === lines.length) {
          romajiLines = lines.map((l, i) => ({ ...l, text: textLines[i] || l.text }));
        }
      }
    }

    return { romajiLines };
  } catch {
    return {};
  }
}

export const kugouProvider: LyricsProvider = {
  id: 'kugou',
  name: 'KuGou',
  async fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null> {
    const cleaned = cleanTitle(query.title) || query.title;
    const durParam = query.duration ? `&duration=${Math.round(query.duration * 1000)}` : '';
    const searchUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(`${cleaned} ${query.artist || ''}`.trim())}${durParam}`;

    try {
      const searchRes = await fetch(searchUrl, { headers: KUGOU_HEADERS, signal });
      if (!searchRes.ok) return null;

      const data = (await searchRes.json()) as KugouSearchResponse;
      const candidatesRaw = data?.candidates;
      if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) return null;

      const candidates = candidatesRaw.map((c) => ({
        id: c.id,
        accesskey: c.accesskey,
        title: c.song,
        artist: c.singer,
        duration: c.duration ? c.duration / 1000 : undefined,
      }));

      const best = findBestCandidate(candidates, query);
      if (!best) return null;

      const krcContent = await downloadLyrics(best, 'krc', signal);
      if (krcContent) {
        const krcResult = buildFromKrc(krcContent, best);
        if (krcResult) return krcResult;
      }

      const lrcContent = await downloadLyrics(best, 'lrc', signal);
      if (!lrcContent) return null;
      return buildFromLrc(lrcContent, best);
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') throw err;
    }

    return null;
  },
};
