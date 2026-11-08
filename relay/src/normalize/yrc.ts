import type { LyricLine, LyricWord } from '../types';

export function parseYrc(yrcText: string): LyricLine[] {
  if (!yrcText || typeof yrcText !== 'string') return [];

  const rawLines = yrcText.split(/\r?\n/);
  const result: LyricLine[] = [];

  const lineTimestampRegex = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;
  const wordRegex = /\((\d+),(\d+),\d+\)([^(\n]+)/g;

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const lineMatch = trimmed.match(lineTimestampRegex);
    if (!lineMatch) continue;

    const minutes = parseInt(lineMatch[1], 10);
    const seconds = parseInt(lineMatch[2], 10);
    const frac = lineMatch[3] ? parseInt(lineMatch[3].padEnd(3, '0').slice(0, 3), 10) : 0;
    const lineTimeSec = minutes * 60 + seconds + frac / 1000;

    const content = lineMatch[4];
    const words: LyricWord[] = [];
    let lineText = '';

    const wordMatches = Array.from(content.matchAll(wordRegex));
    if (wordMatches.length > 0) {
      for (const wm of wordMatches) {
        const startOffsetMs = parseInt(wm[1], 10);
        const wText = wm[3].trim();
        if (wText) {
          words.push({
            t: Math.round((lineTimeSec + startOffsetMs / 1000) * 1000) / 1000,
            text: wText,
          });
        }
      }
      lineText = content.replace(/\(\d+,\d+,\d+\)/g, '').trim();
    } else {
      lineText = content.trim();
    }

    if (lineText) {
      result.push({
        t: Math.round(lineTimeSec * 1000) / 1000,
        text: lineText,
        words: words.length > 0 ? words : undefined,
      });
    }
  }

  return result.sort((a, b) => a.t - b.t);
}
