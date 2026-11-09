import type { LyricsQuery, UnifiedLyrics } from '../types';

export class ProviderError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface LyricsProvider {
  id: string;
  name: string;
  fetch(query: LyricsQuery, signal?: AbortSignal): Promise<UnifiedLyrics | null>;
}
