import type { LyricAgent, LyricLine, LyricWord } from '../types';
import { applyOverlapBackground } from './overlap';

export function hasWordTimings(lines: LyricLine[]): boolean {
  return lines.some((l) => Array.isArray(l.words) && l.words.length > 0);
}

function parseWordTags(text: string): { text: string; words?: LyricWord[] } {
  const tagRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;
  const tags = Array.from(text.matchAll(tagRegex));
  if (tags.length === 0) return { text };

  const words: LyricWord[] = [];
  let plain = '';
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const tagIndex = tag.index ?? 0;
    const minutes = Number(tag[1]);
    const seconds = Number(tag[2]);
    const ms = Number((tag[3] || '0').padEnd(3, '0'));
    const wordTime = minutes * 60 + seconds + ms / 1000;
    const nextTagIndex = tags[i + 1]?.index ?? text.length;
    const wordText = text.slice(tagIndex + tag[0].length, nextTagIndex).trim();
    if (wordText) {
      words.push({ t: Math.round(wordTime * 1000) / 1000, text: wordText });
      plain += `${wordText} `;
    }
  }
  plain = plain.replace(/\s+/g, ' ').trim();

  if (words.length === 0) return { text: plain };
  // A single word spanning the whole line text is line timing, not word timing.
  if (words.length === 1 && words[0].text === plain) return { text: plain };
  return { text: plain, words };
}

export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  const lines = lrcText.split(/\r?\n/);
  const result: LyricLine[] = [];
  let offsetMs = 0;
  let currentPart: string | undefined;

  const timestampRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  const offsetRegex = /\[offset:\s*([+-]?\d+)\]/i;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const offsetMatch = trimmed.match(offsetRegex);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }

    // A bare [songPart: X] / [part: X] line labels every line after it.
    const barePart = trimmed.match(/^\[(?:songPart|part)\s*:\s*([^\]]+)\]$/i);
    if (barePart) {
      currentPart = barePart[1].trim();
      continue;
    }

    const matches = Array.from(trimmed.matchAll(timestampRegex));
    if (matches.length === 0) continue;

    let text = trimmed.replace(timestampRegex, '').trim();
    if (!text) continue;

    // Song part tag on the line itself.
    let part = currentPart;
    const partTag = text.match(/^\[(?:songPart|part)\s*:\s*([^\]]+)\]\s*/i);
    if (partTag) {
      part = partTag[1].trim();
      text = text.slice(partTag[0].length);
    }

    // Speaker tag: v1/m/male = lead, v2/f/female = duet.
    let agent: LyricAgent | undefined;
    const bracket = text.match(/^\[(v1|v2|m|f|male|female)\]\s*/i);
    const prefix = bracket ? null : text.match(/^(v1|v2|m|f|male|female)\s*:\s*/i);
    const speakerTag = bracket ?? prefix;
    if (speakerTag) {
      const tag = speakerTag[1].toLowerCase();
      agent = tag === 'v2' || tag === 'f' || tag === 'female' ? 'duet' : 'lead';
      text = text.slice(speakerTag[0].length);
    }

    // Background vocal tag, or a fully parenthesised line.
    let isBG = false;
    const bgTag = text.match(/^\[bg(?::\d+)?\]\s*/i);
    if (bgTag) {
      isBG = true;
      text = text.slice(bgTag[0].length);
    } else if (/^\(.+\)$/.test(text.trim())) {
      isBG = true;
    }

    const worded = parseWordTags(text);
    text = worded.text;
    if (!text) continue;

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const timeSec = minutes * 60 + seconds + frac / 1000 + offsetMs / 1000;

      const line: LyricLine = {
        t: Math.max(0, Math.round(timeSec * 1000) / 1000),
        text,
      };
      if (worded.words) line.words = worded.words;
      if (agent) line.agent = agent;
      if (isBG) line.isBG = true;
      if (part) line.part = part;
      result.push(line);
    }
  }

  const sorted = result.sort((a, b) => a.t - b.t);

  // Echo rule (M10b): a line repeating the previous line within 1200ms is a background vocal.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!cur.isBG && cur.text === prev.text && cur.t - prev.t <= 1.2) {
      cur.isBG = true;
    }
  }

  return applyOverlapBackground(sorted);
}

export function parsePlainLyrics(plainText: string): LyricLine[] {
  if (!plainText || typeof plainText !== 'string') return [];

  return plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text, idx) => ({
      t: idx * 5, // fallback pseudo-timestamp for display order
      text,
    }));
}
