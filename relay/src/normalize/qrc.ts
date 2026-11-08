import { inflateSync } from 'node:zlib';
import type { LyricLine, LyricWord } from '../types';
import { applyOverlapBackground } from './overlap';

/**
 * QQ QRC lyrics: decode + parse.
 *
 * QQ's GetPlayLyricInfo returns the word-synced QRC payload as a hex string
 * when asked with crypt=1, qrc=1. The payload is triple-DES-ECB encrypted
 * and then zlib compressed. The DES here is FIPS 46-3 DES, but the QQ web
 * client numbers the 64-bit block's bits little-endian per 32-bit word
 * (byte 3,2,1,0 then 7,6,5,4) and applies the three 8-byte key chunks in
 * the order last/middle/first with decrypt/encrypt/decrypt. That layout was
 * determined empirically: the standard JCE DESede layout does not decrypt
 * live QQ payloads, this one does (verified against a captured 壱雫空
 * payload, which decrypts to a zlib stream starting 78 9c). All tables
 * below are the standard FIPS DES tables (public domain), written here in
 * 0-based numbering.
 */

const QRC_KEY = '!@#)(*$%123ZXC!@!@#)(NHL';

// Initial permutation (0-based FIPS IP).
const IP = [
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
  56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2,
  60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6,
];

// Final permutation: the inverse of IP, computed once at load.
const FP: number[] = (() => {
  const fp = new Array<number>(64).fill(0);
  for (let i = 0; i < 64; i++) fp[IP[i]] = i;
  return fp;
})();

// Expansion (0-based FIPS E).
const E = [
  31, 0, 1, 2, 3, 4, 3, 4, 5, 6, 7, 8, 7, 8, 9, 10, 11, 12,
  11, 12, 13, 14, 15, 16, 15, 16, 17, 18, 19, 20, 19, 20, 21, 22, 23, 24,
  23, 24, 25, 26, 27, 28, 27, 28, 29, 30, 31, 0,
];

// Permutation (0-based FIPS P).
const P = [
  15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9,
  1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24,
];

// Permuted choice 1 (0-based FIPS PC-1): first 28 select C, last 28 select D.
const PC1 = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1,
  58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
  62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5,
  60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
];

// Permuted choice 2 (0-based FIPS PC-2).
const PC2 = [
  13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3,
  25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39,
  50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31,
];

const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

// S-boxes (FIPS S1-S8).
const SBOX: number[][] = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

// --- Block <-> bit array, in the QQ client's bit order ---
// Bit b of the block lives in byte ((b >> 5) * 4 + 3 - ((b & 31) >> 3)),
// at bit position (7 - (b & 7)) inside that byte.

function blockToBits(block: Uint8Array<ArrayBufferLike>): number[] {
  const bits = new Array<number>(64).fill(0);
  for (let b = 0; b < 64; b++) {
    const byteIndex = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
    bits[b] = (block[byteIndex] >>> (7 - (b % 8))) & 1;
  }
  return bits;
}

function bitsToBlock(bits: number[]): Uint8Array {
  const block = new Uint8Array(8);
  for (let b = 0; b < 64; b++) {
    if (bits[b]) {
      const byteIndex = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
      block[byteIndex] |= 1 << (7 - (b % 8));
    }
  }
  return block;
}

function permute(bits: number[], table: number[]): number[] {
  return table.map((i) => bits[i]);
}

function xor(a: number[], b: number[]): number[] {
  return a.map((v, i) => v ^ b[i]);
}

// --- Key schedule ---

function rotate28(value: number, shift: number): number {
  return (((value << shift) | (value >>> (28 - shift))) & 0x0fffffff) >>> 0;
}

/** 16 round subkeys (48 bits each) for one 8-byte chunk. Reversed when decrypting. */
export function keySchedule(key8: Uint8Array, decrypt: boolean): number[][] {
  const keyBits = blockToBits(key8);
  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) {
    c = (c << 1) | keyBits[PC1[i]];
    d = (d << 1) | keyBits[PC1[28 + i]];
  }
  const subkeys: number[][] = [];
  for (let round = 0; round < 16; round++) {
    c = rotate28(c, SHIFTS[round]);
    d = rotate28(d, SHIFTS[round]);
    const cd: number[] = [];
    for (let i = 0; i < 28; i++) cd.push((c >>> (27 - i)) & 1);
    // The D half is read one bit lower than the C half (the reference
    // client's PC-2 indexes D with kc-27, not kc-28); the last D bit is
    // always 0. Matching this is required to decrypt live QQ payloads.
    for (let i = 0; i < 28; i++) cd.push(i <= 26 ? (d >>> (26 - i)) & 1 : 0);
    subkeys.push(permute(cd, PC2));
  }
  return decrypt ? subkeys.reverse() : subkeys;
}

// --- Feistel round function ---

function desF(right: number[], subkey: number[]): number[] {
  const expanded = xor(permute(right, E), subkey);
  const out: number[] = [];
  for (let g = 0; g < 8; g++) {
    const b = expanded.slice(g * 6, g * 6 + 6);
    const row = (b[0] << 1) | b[5];
    const col = (b[1] << 3) | (b[2] << 2) | (b[3] << 1) | b[4];
    const value = SBOX[g][row * 16 + col];
    out.push((value >> 3) & 1, (value >> 2) & 1, (value >> 1) & 1, value & 1);
  }
  return permute(out, P);
}

export function desBlock(block: Uint8Array<ArrayBufferLike>, subkeys: number[][]): Uint8Array {
  const permuted = permute(blockToBits(block), IP);
  let left = permuted.slice(0, 32);
  let right = permuted.slice(32, 64);
  for (let round = 0; round < 16; round++) {
    const nextRight = xor(left, desF(right, subkeys[round]));
    left = right;
    right = nextRight;
  }
  return bitsToBlock(permute([...right, ...left], FP));
}

/**
 * Triple-DES decrypt in the QQ layout: per 8-byte block, DES-decrypt with
 * the last key chunk, DES-encrypt with the middle chunk, DES-decrypt with
 * the first chunk.
 */
export function qrcTripleDesDecrypt(data: Uint8Array<ArrayBufferLike>, key = QRC_KEY): Uint8Array {
  if (data.length === 0 || data.length % 8 !== 0) return new Uint8Array(0);
  const keyBytes = new TextEncoder().encode(key);
  const kLast = keySchedule(keyBytes.subarray(16, 24), true);
  const kMid = keySchedule(keyBytes.subarray(8, 16), false);
  const kFirst = keySchedule(keyBytes.subarray(0, 8), true);
  const out = new Uint8Array(data.length);
  for (let i = 0; i + 8 <= data.length; i += 8) {
    let block: Uint8Array<ArrayBufferLike> = data.slice(i, i + 8);
    block = desBlock(block, kLast);
    block = desBlock(block, kMid);
    block = desBlock(block, kFirst);
    out.set(block, i);
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const value = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) return new Uint8Array(0);
    bytes[i] = value;
  }
  return bytes;
}

/**
 * Decode one QQ lyric payload. A crypt=1 payload is hex-encoded triple-DES
 * + zlib; a crypt=0 payload is Base64 LRC. Returns "" when undecodable.
 */
export function decodeQqLyricPayload(raw: string): string {
  if (!raw) return '';
  const bytes = hexToBytes(raw);
  if (bytes.length > 0 && bytes.length % 8 === 0) {
    try {
      const inflated = inflateSync(Buffer.from(qrcTripleDesDecrypt(bytes)));
      const text = inflated.toString('utf-8');
      if (text) return text;
    } catch {
      // Fall through to the Base64 path below.
    }
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf-8');
    if (decoded) return decoded;
  } catch {
    // Ignore; return the raw string as a last resort.
  }
  return raw;
}

// --- QRC parsing ---

const QRC_XML = /<Lyric_1 LyricType="1" LyricContent="([\s\S]*?)"\/>/;
const NUMERIC_ENTITY = /&#(\d+);/g;
const QRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const QRC_WORD = /\((\d+),(\d+)\)/g;
const META_LINE = /^\[[a-zA-Z]+:/;

function decodeXmlEntities(text: string): string {
  return text
    .replace(NUMERIC_ENTITY, (_m, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Parse QRC text into lyric lines with per-word timings. Line format:
 * [(startMs),(durMs)]word1(startMs,durMs)word2(startMs,durMs)... where each
 * word's timing marker follows its text. Metadata lines ([ti:], [ar:],
 * [kana:], [offset:], ...) are skipped; [offset:N] shifts all times by N ms.
 * A line with a single word spanning the whole line text is line timing,
 * not word timing (same guard as the LRC parser).
 */
export function parseQrc(text: string): LyricLine[] {
  if (!text) return [];
  let content = text;
  const xml = QRC_XML.exec(text);
  if (xml) content = decodeXmlEntities(xml[1]);

  const lines: LyricLine[] = [];
  let offsetMs = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\]$/i);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }
    if (META_LINE.test(line)) continue;

    const lineMatch = QRC_LINE.exec(line);
    if (!lineMatch) continue;
    const lineStart = parseInt(lineMatch[1], 10);
    const lineContent = lineMatch[3];
    if (lineContent.includes('//')) continue;

    const offsets: number[] = [];
    const texts: string[] = [];
    let prevEnd = 0;
    QRC_WORD.lastIndex = 0;
    let wordMatch: RegExpExecArray | null;
    while ((wordMatch = QRC_WORD.exec(lineContent)) !== null) {
      offsets.push(parseInt(wordMatch[1], 10));
      texts.push(lineContent.slice(prevEnd, wordMatch.index));
      prevEnd = wordMatch.index + wordMatch[0].length;
    }
    if (offsets.length > 0) texts.push(lineContent.slice(prevEnd));

    const words: LyricWord[] = [];
    let full = '';
    for (let i = 0; i < offsets.length; i++) {
      const wordStart = offsets[i];
      const rawText = texts[i];
      full += rawText;
      const wordText = rawText.trim();
      if (!wordText) continue;
      words.push({ t: Math.round((wordStart / 1000) * 1000) / 1000, text: wordText });
    }
    let plain = full.trim();
    if (words.length === 0 && lineContent) {
      plain = lineContent.replace(/\(\d+,\d+\)/g, '').trim();
    }
    if (!plain) continue;

    const t = Math.max(0, Math.round(((lineStart + offsetMs) / 1000) * 1000) / 1000);
    const entry: LyricLine = { t, text: plain };
    if (words.length > 0) {
      // Single word spanning the whole line text is line timing, not word timing.
      if (!(words.length === 1 && words[0].text === plain)) {
        entry.words = words.map((w) => ({
          ...w,
          t: Math.max(0, Math.round(((w.t * 1000 + offsetMs) / 1000) * 1000) / 1000),
        }));
      }
    }
    lines.push(entry);
  }

  return applyOverlapBackground(lines.sort((a, b) => a.t - b.t));
}
