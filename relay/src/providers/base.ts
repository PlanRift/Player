import type { LyricsQuery, UnifiedLyrics } from '../types';

export interface LyricsProvider {
  id: string;
  name: string;
  fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null>;
}
