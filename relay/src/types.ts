export interface LyricWord {
  t: number; // in seconds
  text: string;
}

export type LyricAgent = 'lead' | 'duet' | 'center';

export interface LyricLine {
  t: number; // in seconds
  text: string;
  words?: LyricWord[];
  /** Duet side: lead (default), duet (right-aligned), center (Apple v1000/v2000). */
  agent?: LyricAgent;
  /** Background vocal line, split at parse time (ttm:role="x-bg", [bg] tags, echo rule). */
  isBG?: boolean;
  /** Song part label from itunes:songPart / [songPart] (e.g. "Verse", "Chorus"). */
  part?: string;
}

export interface UnifiedLyrics {
  lines: LyricLine[];
  synced: boolean;
  source: string; // provider id (e.g. 'lrclib')
  provider: string; // friendly display name (e.g. 'LRCLIB')
  hasWordSync?: boolean;
  /** What the provider matched, for client-side score gating. Absent when unknown. */
  match?: ProviderCandidate;
  /** Sidecar translation lines aligned with lines */
  translationLines?: LyricLine[];
  /** Sidecar romaji lines aligned with lines */
  romajiLines?: LyricLine[];
}

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // in seconds
}

export interface ProviderCandidate {
  title: string;
  artist: string;
  album?: string;
  duration?: number; // in seconds
}
