import type { UnifiedLyrics } from '../types';

interface CacheEntry {
  data: UnifiedLyrics | null; // null represents an honest miss
  timestamp: number;
}

const MISS_CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for honest misses

class LyricsCache {
  private cache = new Map<string, CacheEntry>();

  private buildKey(title: string, artist: string, duration?: number, provider?: string): string {
    const t = (title || '').toLowerCase().trim();
    const a = (artist || '').toLowerCase().trim();
    const d = duration ? Math.round(duration) : 0;
    const p = provider || 'auto';
    return `${p}:${t}:${a}:${d}`;
  }

  get(title: string, artist: string, duration?: number, provider?: string): UnifiedLyrics | null | undefined {
    const key = this.buildKey(title, artist, duration, provider);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL for misses
    if (entry.data === null) {
      if (Date.now() - entry.timestamp > MISS_CACHE_TTL_MS) {
        this.cache.delete(key);
        return undefined;
      }
      return null;
    }

    return entry.data;
  }

  setSuccess(title: string, artist: string, duration: number | undefined, provider: string, data: UnifiedLyrics): void {
    const key = this.buildKey(title, artist, duration, provider);
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  setMiss(title: string, artist: string, duration: number | undefined, provider: string): void {
    const key = this.buildKey(title, artist, duration, provider);
    this.cache.set(key, { data: null, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const lyricsCache = new LyricsCache();
