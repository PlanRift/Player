import type { LyricsQuery, ProviderCandidate, UnifiedLyrics } from './types';

/**
 * Score gate (Phase 9). Formula (max 130): title exact +60, title
 * contains +35, otherwise -100; artist exact +30, contains +20,
 * otherwise -15; duration diff <= 2s +40, <= 5s +25, <= 10s -20,
 * otherwise -60. SOFT_MIN (50): a candidate at or above this paints as
 * a gated match. FALLBACK_MIN (20): when nothing passes the gate, the
 * single best candidate may still paint if it reaches this floor.
 * Below it the candidate is rejected and never paints.
 */
export const SOFT_MIN = 50;
export const FALLBACK_MIN = 20;

export function cleanTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(
      /\s*[([](?:[^)\]]*?\b(?:remaster(?:ed)?|deluxe|explicit|clean|mono|stereo|bonus|single|radio edit|edit|version|mix|live|demo|acoustic|feat\.?|ft\.?|with)\b[^)\]]*)[)\]]/gi,
      ''
    )
    .replace(
      /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|demo|acoustic|radio edit|mono|stereo|single version)\b.*$/i,
      ''
    )
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreCandidate(candidate: ProviderCandidate, query: LyricsQuery): number {
  let score = 0;

  const targetTitle = normalize(cleanTitle(query.title) || query.title);
  const candTitle = normalize(cleanTitle(candidate.title) || candidate.title);

  if (targetTitle === candTitle) {
    score += 60;
  } else if (candTitle.includes(targetTitle) || targetTitle.includes(candTitle)) {
    score += 35;
  } else {
    // If titles do not match at all, heavily penalize
    score -= 100;
  }

  if (query.artist) {
    const targetArtist = normalize(query.artist);
    const candArtist = normalize(candidate.artist);

    if (targetArtist === candArtist) {
      score += 30;
    } else if (candArtist.includes(targetArtist) || targetArtist.includes(candArtist)) {
      score += 20;
    } else {
      score -= 15;
    }
  }

  if (typeof query.duration === 'number' && query.duration > 0 && typeof candidate.duration === 'number' && candidate.duration > 0) {
    const diff = Math.abs(candidate.duration - query.duration);
    if (diff <= 2) {
      score += 40;
    } else if (diff <= 5) {
      score += 25;
    } else if (diff <= 10) {
      score -= 20;
    } else {
      score -= 60;
    }
  }

  return score;
}

export function findBestCandidate<T extends ProviderCandidate>(
  candidates: T[],
  query: LyricsQuery,
  minScore = FALLBACK_MIN
): T | null {
  if (!candidates || candidates.length === 0) return null;

  let best: T | null = null;
  let bestScore = -Infinity;

  for (const c of candidates) {
    const score = scoreCandidate(c, query);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // Score gate (Phase 9): a candidate at or above SOFT_MIN paints as a
  // gated match. When nothing passes, the single best candidate is the
  // fallback only if it reaches minScore (FALLBACK_MIN by default).
  // Below that floor the candidate is rejected and never paints.
  if (bestScore >= SOFT_MIN) {
    return best;
  }
  if (bestScore >= minScore) {
    return best;
  }

  return null;
}

// --- Lyrics quality: credit stripping + timing agreement ---

const CREDIT_PREFIX =
  /^(作词|作曲|编曲|作詞|作曲|編曲|填词|谱曲|制作人|制作|演唱|原唱|监制|混音|母带|词|曲|OP|ED|主题曲|片头曲|片尾曲|插曲)\s*[:：]/;

const UNMATCHED_PENALTY_SEC = 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isCreditLine(text: string, query?: LyricsQuery): boolean {
  const trimmed = text.trim();
  if (CREDIT_PREFIX.test(trimmed)) return true;
  if (query) {
    const dash = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
    if (dash) {
      const hay = normalize(trimmed);
      const title = normalize(query.title || '');
      const artist = normalize(query.artist || '');
      if ((title && hay.includes(title)) || (artist && hay.includes(artist))) return true;
    }
  }
  return false;
}

/**
 * Remove leading credit lines (作词/作曲/词:/曲: headers, "Title - Artist"
 * headers) from a hit. Credits are never sung; providers that prepend them
 * (NetEase, QQ) otherwise show junk as the first lyric lines. Only lines
 * within the first 2 seconds are considered, and stripping stops at the
 * first non-credit line. Sidecars aligned by index lose the same indices.
 * Returns null when nothing remains.
 */
export function stripCreditLines(hit: UnifiedLyrics, query?: LyricsQuery): UnifiedLyrics | null {
  let cut = 0;
  while (cut < hit.lines.length && hit.lines[cut].t <= 2 && isCreditLine(hit.lines[cut].text, query)) {
    cut++;
  }
  if (cut === 0) return hit;
  const lines = hit.lines.slice(cut);
  if (lines.length === 0) return null;
  const stripSidecar = (side?: UnifiedLyrics['translationLines']) => {
    if (!side || side.length !== hit.lines.length) return undefined;
    return side.slice(cut);
  };
  return {
    ...hit,
    lines,
    translationLines: stripSidecar(hit.translationLines),
    romajiLines: stripSidecar(hit.romajiLines),
  };
}

/**
 * Timing agreement: how closely a hit's line timings match the other hits
 * for the same song. For each line, find the same normalized text in the
 * other hit and record the absolute time difference; unmatched lines cost
 * UNMATCHED_PENALTY_SEC. Returns the median of the per-other medians
 * (lower is better). Hits that agree with each other are most likely timed
 * right; a lone drifted hit (e.g. LRCLIB splitting long lines) scores worse.
 */
export function timingAgreement(hit: UnifiedLyrics, others: UnifiedLyrics[]): number {
  const perOther: number[] = [];
  for (const other of others) {
    if (other === hit || other.lines.length === 0) continue;
    const deltas: number[] = [];
    const used = new Set<number>();
    for (const line of hit.lines) {
      const key = normalize(line.text);
      if (!key) continue;
      let best: number | null = null;
      let bestIdx = -1;
      for (let i = 0; i < other.lines.length; i++) {
        if (used.has(i)) continue;
        if (normalize(other.lines[i].text) === key) {
          const d = Math.abs(other.lines[i].t - line.t);
          if (best === null || d < best) {
            best = d;
            bestIdx = i;
          }
        }
      }
      if (best !== null) {
        deltas.push(best);
        used.add(bestIdx);
      } else {
        deltas.push(UNMATCHED_PENALTY_SEC);
      }
    }
    if (deltas.length > 0) perOther.push(median(deltas));
  }
  if (perOther.length === 0) return 0;
  return median(perOther);
}

/**
 * Auto-mode winner selection (extracted from the relay race so it is
 * unit-testable). Gate-passing hits rank first, then sync rank (word above
 * line above plain), then metadata score. When rank and score tie, the
 * sidecar tie-breaker prefers hits carrying romaji / translation sidecars,
 * then the timing-agreement tie-breaker picks the hit whose line timings agree most
 * with the other candidates; remaining ties keep provider order (stable
 * sort). Returns null when no hit is eligible.
 */
export function selectAutoWinner(hits: UnifiedLyrics[], query: LyricsQuery): UnifiedLyrics | null {
  const scored = hits.map((hit) => ({
    hit,
    score: hit.match ? scoreCandidate(hit.match, query) : null,
  }));
  const eligible = scored.filter((s) => s.score === null || s.score >= FALLBACK_MIN);
  const passing = eligible.filter((s) => s.score === null || s.score >= SOFT_MIN);
  const pool = passing.length > 0 ? passing : eligible;
  if (pool.length === 0) return null;
  const poolHits = pool.map((p) => p.hit);
  const ranked = pool.map((p) => ({
    ...p,
    agreement: timingAgreement(p.hit, poolHits),
  }));
  ranked.sort((a, b) => {
    const rankA = a.hit.hasWordSync ? 2 : a.hit.synced ? 1 : 0;
    const rankB = b.hit.hasWordSync ? 2 : b.hit.synced ? 1 : 0;
    if (rankB !== rankA) return rankB - rankA;
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    // Sidecar tie-breaker: a word-synced hit that also carries romaji /
    // translation sidecars wins over one that does not. This keeps AUTO
    // from picking a bare word-sync hit (e.g. lrcred) over QQ when both
    // tie on match score - the sidecars are what power the Romaji /
    // Translated sub-lines, so losing them to a tie-break means the
    // client must derive readings separately (and shows nothing until it
    // does). Sidecars never outrank match score, only break ties.
    const romajiA = Array.isArray(a.hit.romajiLines) && a.hit.romajiLines.length > 0 ? 1 : 0;
    const romajiB = Array.isArray(b.hit.romajiLines) && b.hit.romajiLines.length > 0 ? 1 : 0;
    if (romajiB !== romajiA) return romajiB - romajiA;
    const transA = Array.isArray(a.hit.translationLines) && a.hit.translationLines.length > 0 ? 1 : 0;
    const transB = Array.isArray(b.hit.translationLines) && b.hit.translationLines.length > 0 ? 1 : 0;
    if (transB !== transA) return transB - transA;
    if (a.agreement !== b.agreement) return a.agreement - b.agreement;
    return 0;
  });
  return ranked[0].hit;
}
