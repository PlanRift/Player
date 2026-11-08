import type { LyricLine, LyricWord } from '../types';

interface LyricsPlusWord {
  time: number;
  duration?: number;
  text: string;
}

interface LyricsPlusLine {
  time: number;
  duration?: number;
  text: string;
  syllabus?: LyricsPlusWord[];
}

export function parseLyricsPlus(data: unknown): LyricLine[] {
  if (!data || typeof data !== 'object') return [];

  const payload = data as {
    type?: string;
    lyrics?: LyricsPlusLine[];
  };

  if (!Array.isArray(payload.lyrics) || payload.lyrics.length === 0) {
    return [];
  }

  const result: LyricLine[] = [];

  for (const item of payload.lyrics) {
    if (typeof item.time !== 'number' || typeof item.text !== 'string') continue;

    const lineTimeSec = item.time / 1000;
    const words: LyricWord[] = [];

    if (Array.isArray(item.syllabus) && item.syllabus.length > 0) {
      for (const s of item.syllabus) {
        if (typeof s.time === 'number' && typeof s.text === 'string' && s.text.trim()) {
          words.push({
            t: Math.round((s.time / 1000) * 1000) / 1000,
            text: s.text.trim(),
          });
        }
      }
    }

    result.push({
      t: Math.round(lineTimeSec * 1000) / 1000,
      text: item.text.trim(),
      words: words.length > 0 ? words : undefined,
    });
  }

  return result.sort((a, b) => a.t - b.t);
}
