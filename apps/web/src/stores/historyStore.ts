import { create } from 'zustand';

export interface HistoryEntry {
  id: string;
  songId: string;
  artistId: string;
  albumId: string;
  playedAt: number; // Unix timestamp in ms
  playDurationMs: number;
}

const STORAGE_KEY = 'planrift.history.v1';
const MAX_HISTORY_ENTRIES = 10000;

function loadHistoryFromStorage(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(-MAX_HISTORY_ENTRIES);
    }
  } catch (err) {
    console.warn('Failed to parse listening history:', err);
  }
  return [];
}

function saveHistoryToStorage(entries: HistoryEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const capped = entries.slice(-MAX_HISTORY_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch (err) {
    console.warn('Failed to save listening history:', err);
  }
}

interface HistoryState {
  entries: HistoryEntry[];

  recordPlay: (entryData: Omit<HistoryEntry, 'id'>) => void;
  getEntries: () => HistoryEntry[];
  getTopArtistIds: (limit?: number) => Array<{ artistId: string; count: number }>;
  getTopSongIds: (limit?: number) => Array<{ songId: string; count: number }>;
  getPlayedSongIds: () => Set<string>;
  getPlaysInWindow: (startHour: number, endHour: number) => HistoryEntry[];
  getPlaysOnCalendarDayInPriorYears: (targetMonth: number, targetDay: number) => HistoryEntry[];
  getHistorySpanDays: () => number;
  isSongPlayed: (songId: string) => boolean;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: loadHistoryFromStorage(),

  recordPlay: (entryData) => {
    const current = get().entries;

    const newEntry: HistoryEntry = {
      ...entryData,
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    const updated = [...current, newEntry].slice(-MAX_HISTORY_ENTRIES);
    saveHistoryToStorage(updated);

    set({ entries: updated });
  },

  getEntries: () => {
    return get().entries;
  },

  getTopArtistIds: (limit = 5) => {
    const entries = get().entries;
    const counts: Record<string, number> = {};

    for (const e of entries) {
      if (!e.artistId) continue;
      counts[e.artistId] = (counts[e.artistId] || 0) + 1;
    }

    return Object.entries(counts)
      .map(([artistId, count]) => ({ artistId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },

  getTopSongIds: (limit = 10) => {
    const entries = get().entries;
    const counts: Record<string, number> = {};

    for (const e of entries) {
      if (!e.songId) continue;
      counts[e.songId] = (counts[e.songId] || 0) + 1;
    }

    return Object.entries(counts)
      .map(([songId, count]) => ({ songId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },

  getPlayedSongIds: () => {
    const entries = get().entries;
    return new Set(entries.map((e) => e.songId));
  },

  getPlaysInWindow: (startHour: number, endHour: number) => {
    const entries = get().entries;
    return entries.filter((e) => {
      const date = new Date(e.playedAt);
      const h = date.getHours();
      if (startHour <= endHour) {
        return h >= startHour && h < endHour;
      }
      // Overnight window (e.g. 22 to 5)
      return h >= startHour || h < endHour;
    });
  },

  getPlaysOnCalendarDayInPriorYears: (targetMonth: number, targetDay: number) => {
    const entries = get().entries;
    const currentYear = new Date().getFullYear();

    return entries.filter((e) => {
      const d = new Date(e.playedAt);
      return (
        d.getFullYear() < currentYear &&
        d.getMonth() === targetMonth &&
        d.getDate() === targetDay
      );
    });
  },

  getHistorySpanDays: () => {
    const entries = get().entries;
    if (entries.length < 2) return entries.length;

    const first = entries[0].playedAt;
    const last = entries[entries.length - 1].playedAt;
    const spanMs = Math.abs(last - first);
    return Math.max(1, Math.floor(spanMs / (1000 * 60 * 60 * 24)));
  },

  isSongPlayed: (songId: string) => {
    return get().entries.some((e) => e.songId === songId);
  },

  clearHistory: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ entries: [] });
  },
}));
