import type { LyricLine } from '../types';

/**
 * Shared post-parse step for all provider lines (QRC, KRC, LRC):
 * Mark a line as background vocal when it starts less than 1.0s after
 * the previous line's start (line[i+1].t - line[i].t < 1.0).
 */
export function applyOverlapBackground(lines: LyricLine[]): LyricLine[] {
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    if (!cur.isBG && cur.t - prev.t < 1.0) {
      cur.isBG = true;
    }
  }
  return lines;
}
