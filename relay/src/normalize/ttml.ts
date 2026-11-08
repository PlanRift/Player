import type { LyricAgent, LyricLine, LyricWord } from '../types';

export function parseTtmlTime(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(/s$/, '');

  // Format 1: "01:23:45.678"
  const hms = clean.split(':');
  if (hms.length === 3) {
    const hours = parseFloat(hms[0]) || 0;
    const mins = parseFloat(hms[1]) || 0;
    const secs = parseFloat(hms[2]) || 0;
    return hours * 3600 + mins * 60 + secs;
  }

  // Format 2: "01:23.456"
  if (hms.length === 2) {
    const mins = parseFloat(hms[0]) || 0;
    const secs = parseFloat(hms[1]) || 0;
    return mins * 60 + secs;
  }

  // Format 3: "33.642" or "33.642s"
  const val = parseFloat(clean);
  return isNaN(val) ? 0 : val;
}

function attrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return match ? match[1] : null;
}

/**
 * TTML ttm:agent parity (Phase 9, item 6): v1 = lead, v2 = duet
 * (right-aligned); Apple centred agents v1000 / v2000 stay centred.
 * A span-level agent overrides the line agent when present.
 */
export function parseTtmlAgent(agent: string | null | undefined): LyricAgent | undefined {
  if (!agent) return undefined;
  const value = agent.trim().toLowerCase();
  if (value === 'v1000' || value === 'v2000') return 'center';
  if (value === 'v2' || value === 'f' || value === 'female' || value.includes('duet')) return 'duet';
  if (value === 'v1' || value === 'm' || value === 'male' || value === 'lead') return 'lead';
  return undefined;
}

export function parseTtml(xmlText: string): LyricLine[] {
  if (!xmlText || typeof xmlText !== 'string') return [];

  const lines: LyricLine[] = [];

  // Match all <p ...>...</p> tags
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
  const beginRegex = /\bbegin=["']([^"']+)["']/i;

  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(xmlText)) !== null) {
    const pAttrs = pMatch[1];
    const pContent = pMatch[2];

    const pBeginMatch = pAttrs.match(beginRegex);
    const lineTime = pBeginMatch ? parseTtmlTime(pBeginMatch[1]) : 0;

    const lineAgent = parseTtmlAgent(attrValue(pAttrs, 'ttm:agent'));
    const linePart = attrValue(pAttrs, 'itunes:songPart') || attrValue(pAttrs, 'songPart');
    const lineIsBG = (attrValue(pAttrs, 'ttm:role') || '').toLowerCase() === 'x-bg';

    const words: LyricWord[] = [];
    let spanMatch: RegExpExecArray | null;

    let spanAgent: LyricAgent | undefined;
    let spanIsBG = false;

    // Translation and romanization spans (ttm:role="x-translation" /
    // "x-roman", e.g. AMLL's inline zh/ko/en translations) are not sung
    // words: skip them here and strip them from the line text below, or
    // the line carries every language at once and never matches another
    // provider's line in the word-timing guard.
    const TRANSLATION_SPAN_RE =
      /<span\b[^>]*\bttm:role\s*=\s*["']x-(?:translation|roman)["'][^>]*>[\s\S]*?<\/span>/gi;
    const singableContent = pContent.replace(TRANSLATION_SPAN_RE, '');

    // Check for span tags inside <p>
    while ((spanMatch = spanRegex.exec(pContent)) !== null) {
      const spanAttrs = spanMatch[1];
      const spanText = spanMatch[2].replace(/<[^>]+>/g, '').trim();

      const spanRole = (attrValue(spanAttrs, 'ttm:role') || '').toLowerCase();
      if (spanRole === 'x-translation' || spanRole === 'x-roman') continue;

      const spanBeginMatch = spanAttrs.match(beginRegex) ?? spanMatch[2].match(beginRegex);
      const wordTime = spanBeginMatch ? parseTtmlTime(spanBeginMatch[1]) : lineTime;

      const agent = parseTtmlAgent(attrValue(spanAttrs, 'ttm:agent'));
      if (agent) spanAgent = agent;
      if (spanRole === 'x-bg') spanIsBG = true;

      if (spanText) {
        words.push({
          t: Math.round(wordTime * 1000) / 1000,
          text: spanText,
        });
      }
    }

    // Strip HTML/XML tags from the singable content to get full line text
    const fullText = singableContent.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

    if (fullText) {
      const line: LyricLine = {
        t: Math.round(lineTime * 1000) / 1000,
        text: fullText,
        words: words.length > 0 ? words : undefined,
      };
      const agent = spanAgent ?? lineAgent;
      if (agent) line.agent = agent;
      if (lineIsBG || spanIsBG) line.isBG = true;
      if (linePart) line.part = linePart;
      lines.push(line);
    }
  }

  return lines.sort((a, b) => a.t - b.t);
}
