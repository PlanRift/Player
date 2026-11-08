import type { LyricLine, LyricWord, UnifiedLyrics } from '../types';

const BRACKET_MAP: Record<string, string> = {
  ')': '(',
  '）': '（',
  ']': '[',
  '}': '{',
  '>': '<',
};

/**
 * Finds a trailing bracketed segment at the end of a string.
 * Supports (), （）, [], {}, <>.
 * Returns null if not ending with a matching bracket pair.
 */
export function findTrailingBracketSegment(text: string): {
  openIdx: number;
  leadText: string;
  bgText: string;
} | null {
  const trimmed = text.trim();
  if (trimmed.length < 2) return null;

  const closeChar = trimmed[trimmed.length - 1];
  const openChar = BRACKET_MAP[closeChar];
  if (!openChar) return null;

  let depth = 1;
  let openIdx = -1;
  for (let i = trimmed.length - 2; i >= 0; i--) {
    if (trimmed[i] === closeChar) {
      depth++;
    } else if (trimmed[i] === openChar) {
      depth--;
      if (depth === 0) {
        openIdx = i;
        break;
      }
    }
  }

  if (openIdx < 0 || depth !== 0) return null;

  const leadText = trimmed.slice(0, openIdx).trim();
  const bgText = trimmed.slice(openIdx).trim();

  return { openIdx, leadText, bgText };
}

/**
 * Partitions a line's word timings across the lead and background segments
 * based on character position in the original line text.
 */
function partitionWords(
  words: LyricWord[] | undefined,
  fullText: string,
  openIdx: number
): { leadWords?: LyricWord[]; bgWords?: LyricWord[] } {
  if (!words || words.length === 0) return {};

  const leadWords: LyricWord[] = [];
  const bgWords: LyricWord[] = [];
  let cursor = 0;

  for (const word of words) {
    const idx = fullText.indexOf(word.text, cursor);
    const wordStart = idx >= 0 ? idx : cursor;
    cursor = wordStart + word.text.length;

    if (wordStart >= openIdx) {
      bgWords.push(word);
    } else {
      leadWords.push(word);
    }
  }

  return {
    leadWords: leadWords.length > 0 ? leadWords : undefined,
    bgWords: bgWords.length > 0 ? bgWords : undefined,
  };
}

/**
 * Splits a sidecar line (romaji or translation) at its trailing bracket boundary
 * to remain aligned with the main lines array.
 */
function splitSidecarLine(
  sidecarLine: LyricLine | undefined,
  leadTime: number,
  bgTime: number
): { lead?: LyricLine; bg?: LyricLine } {
  if (!sidecarLine) return {};

  const bracket = findTrailingBracketSegment(sidecarLine.text);
  if (!bracket || !bracket.leadText) {
    // If no matching bracket, whole sidecar stays with lead line; BG gets empty text
    return {
      lead: { ...sidecarLine, t: leadTime, isBG: false },
      bg: { t: bgTime, text: '', isBG: true },
    };
  }

  return {
    lead: {
      ...sidecarLine,
      t: leadTime,
      text: bracket.leadText,
      isBG: false,
    },
    bg: {
      ...sidecarLine,
      t: bgTime,
      text: bracket.bgText,
      isBG: true,
      words: undefined,
    },
  };
}

/**
 * Shared post-parse step: splits inline parenthesized background vocal
 * segments at the end of a line into their own separate background lines.
 */
export function splitInlineBackground(
  lines: LyricLine[],
  romajiLines?: LyricLine[],
  translationLines?: LyricLine[]
): {
  lines: LyricLine[];
  romajiLines?: LyricLine[];
  translationLines?: LyricLine[];
} {
  if (!lines || lines.length === 0) {
    return { lines: [], romajiLines, translationLines };
  }

  const newLines: LyricLine[] = [];
  const newRomaji: LyricLine[] | undefined = romajiLines ? [] : undefined;
  const newTranslation: LyricLine[] | undefined = translationLines ? [] : undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const romaLine = romajiLines?.[i];
    const transLine = translationLines?.[i];

    const bracket = findTrailingBracketSegment(line.text);

    // If whole line is wrapped in brackets: do not split, just ensure isBG = true
    if (bracket && !bracket.leadText) {
      newLines.push({ ...line, isBG: true });
      if (newRomaji && romaLine) {
        newRomaji.push({ ...romaLine, isBG: true });
      }
      if (newTranslation && transLine) {
        newTranslation.push({ ...transLine, isBG: true });
      }
      continue;
    }

    // If line has a trailing bracket segment with lead text before it: SPLIT!
    if (bracket && bracket.leadText) {
      const { leadWords, bgWords } = partitionWords(line.words, line.text, bracket.openIdx);
      const bgStart = bgWords && bgWords.length > 0 ? bgWords[0].t : line.t;

      const leadLine: LyricLine = {
        ...line,
        t: line.t,
        text: bracket.leadText,
        isBG: false,
        words: leadWords,
      };

      const bgLine: LyricLine = {
        ...line,
        t: bgStart,
        text: bracket.bgText,
        isBG: true,
        words: bgWords,
      };

      newLines.push(leadLine, bgLine);

      if (newRomaji) {
        const splitRoma = splitSidecarLine(romaLine, leadLine.t, bgLine.t);
        if (splitRoma.lead && splitRoma.bg) {
          newRomaji.push(splitRoma.lead, splitRoma.bg);
        } else if (romaLine) {
          newRomaji.push({ ...romaLine, isBG: false }, { t: bgLine.t, text: '', isBG: true });
        }
      }

      if (newTranslation) {
        const splitTrans = splitSidecarLine(transLine, leadLine.t, bgLine.t);
        if (splitTrans.lead && splitTrans.bg) {
          newTranslation.push(splitTrans.lead, splitTrans.bg);
        } else if (transLine) {
          newTranslation.push({ ...transLine, isBG: false }, { t: bgLine.t, text: '', isBG: true });
        }
      }

      continue;
    }

    // Normal line without trailing bracket
    newLines.push(line);
    if (newRomaji && romaLine) {
      newRomaji.push(romaLine);
    }
    if (newTranslation && transLine) {
      newTranslation.push(transLine);
    }
  }

  return {
    lines: newLines,
    romajiLines: newRomaji,
    translationLines: newTranslation,
  };
}

/**
 * Convenience helper to apply splitInlineBackground to a UnifiedLyrics object.
 */
export function applyInlineBackgroundSplit(lyrics: UnifiedLyrics): UnifiedLyrics {
  const result = splitInlineBackground(
    lyrics.lines,
    lyrics.romajiLines,
    lyrics.translationLines
  );
  return {
    ...lyrics,
    lines: result.lines,
    romajiLines: result.romajiLines,
    translationLines: result.translationLines,
  };
}
