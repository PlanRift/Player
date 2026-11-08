import { inflateSync } from 'node:zlib';
import type { LyricLine, LyricWord } from '../types';
import { applyOverlapBackground } from './overlap';

/**
 * KuGou KRC lyrics: decode + parse.
 *
 * KuGou's download endpoint returns the word-synced KRC payload as Base64
 * when asked with fmt=krc. The bytes start with the ASCII magic "krc1";
 * the rest is XOR-encrypted with a fixed 16-byte key (cycling from the
 * first byte after the magic) and then zlib compressed. Verified against
 * a captured live payload for 夜に駆ける (YOASOBI), which decrypts to a
 * zlib stream starting 78 9c.
 */

const KRC_MAGIC = 'krc1';

// Signed bytes from the reference client; normalized to 0-255 at load.
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, -50, -46, 110, 105].map(
  (v) => (v + 256) % 256,
);

/**
 * Decode one KRC payload (Base64 content from the download endpoint).
 * Returns "" when undecodable.
 */
export function decodeKrcPayload(base64Content: string): string {
  if (!base64Content) return '';
  try {
    const bytes = Buffer.from(base64Content, 'base64');
    if (bytes.length === 0) return '';
    const body = bytes.subarray(0, 4).toString('ascii') === KRC_MAGIC ? bytes.subarray(4) : bytes;
    const xored = Buffer.alloc(body.length);
    for (let i = 0; i < body.length; i++) xored[i] = body[i] ^ KRC_KEY[i % KRC_KEY.length];
    const inflated = inflateSync(xored);
    return inflated.toString('utf-8');
  } catch {
    return '';
  }
}

const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const KRC_WORD = /<(\d+),(\d+),\d+>/g;
const META_LINE = /^\[[a-zA-Z]+:/;

/**
 * Parse KRC text into lyric lines with per-word timings. Line format:
 * [(startMs),(durMs)]<(offsetMs),(durMs),?>word<(offsetMs),(durMs),?>word...
 * where each word's timing tag precedes its text and offsets are relative
 * to the line start. Metadata lines ([ti:], [ar:], [kana:], [language:],
 * [offset:], ...) are skipped; [offset:N] shifts all times by N ms. A line
 * with a single word spanning the whole line text is line timing, not word
 * timing (same guard as the LRC parser).
 */
export function parseKrc(text: string): LyricLine[] {
  if (!text) return [];
  const lines: LyricLine[] = [];
  let offsetMs = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\]$/i);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }
    if (META_LINE.test(line)) continue;

    const lineMatch = KRC_LINE.exec(line);
    if (!lineMatch) continue;
    const lineStart = parseInt(lineMatch[1], 10);
    const lineContent = lineMatch[3];
    if (lineContent.includes('//')) continue;

    const offsets: number[] = [];
    const texts: string[] = [];
    KRC_WORD.lastIndex = 0;
    let wordMatch: RegExpExecArray | null;
    const tags: Array<{ offset: number; start: number; end: number }> = [];
    while ((wordMatch = KRC_WORD.exec(lineContent)) !== null) {
      tags.push({
        offset: parseInt(wordMatch[1], 10),
        start: wordMatch.index,
        end: wordMatch.index + wordMatch[0].length,
      });
    }
    for (let i = 0; i < tags.length; i++) {
      const nextStart = i < tags.length - 1 ? tags[i + 1].start : lineContent.length;
      texts.push(lineContent.slice(tags[i].end, nextStart));
      offsets.push(tags[i].offset);
    }

    const words: LyricWord[] = [];
    let full = '';
    for (let i = 0; i < offsets.length; i++) {
      const rawText = texts[i];
      full += rawText;
      const wordText = rawText.trim();
      if (!wordText) continue;
      const wordStartMs = lineStart + offsets[i] + offsetMs;
      words.push({ t: Math.round((wordStartMs / 1000) * 1000) / 1000, text: wordText });
    }
    let plain = full.trim();
    if (words.length === 0 && lineContent) {
      plain = lineContent.replace(/<\d+,\d+,\d+>/g, '').trim();
    }
    if (!plain) continue;

    const t = Math.max(0, Math.round(((lineStart + offsetMs) / 1000) * 1000) / 1000);
    const entry: LyricLine = { t, text: plain };
    if (words.length > 0) {
      // Single word spanning the whole line text is line timing, not word timing.
      if (!(words.length === 1 && words[0].text === plain)) {
        entry.words = words;
      }
    }
    lines.push(entry);
  }

  return applyOverlapBackground(lines.sort((a, b) => a.t - b.t));
}
