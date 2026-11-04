import { create } from 'zustand';
import type { SubsonicSong } from '@player/shared';

export interface QueueItem {
  sessionId: string;
  song: SubsonicSong;
}

export type RepeatMode = 'off' | 'all' | 'one';

interface PlaybackState {
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  isQueueOpen: boolean;
  isSignatureOpen: boolean;

  playTrack: (song: SubsonicSong, contextSongs?: SubsonicSong[]) => void;
  playIndex: (index: number) => void;
  togglePlay: () => void;
  setIsPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setVolume: (vol: number) => void;
  next: () => void;
  previous: () => void;
  enqueue: (songs: SubsonicSong | SubsonicSong[]) => void;
  enqueueNext: (songs: SubsonicSong | SubsonicSong[]) => void;
  removeFromQueue: (sessionId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  toggleQueue: () => void;
  toggleSignatureView: () => void;
  setSignatureOpen: (open: boolean) => void;
  currentSong: () => SubsonicSong | null;
}

let sessionCounter = 0;
function createQueueItem(song: SubsonicSong): QueueItem {
  sessionCounter += 1;
  return {
    sessionId: `q-${Date.now()}-${sessionCounter}-${song.id}`,
    song,
  };
}

function balancedShuffleList(items: QueueItem[]): QueueItem[] {
  if (items.length <= 2) return [...items].reverse();

  const grouped = new Map<string, QueueItem[]>();
  for (const item of items) {
    const artist = item.song.artist || 'Unknown';
    if (!grouped.has(artist)) grouped.set(artist, []);
    grouped.get(artist)!.push(item);
  }

  const pools = Array.from(grouped.values()).map((list) => {
    return [...list].sort(() => Math.random() - 0.5);
  });

  const result: QueueItem[] = [];
  let lastArtist: string | null = null;

  while (pools.some((p) => p.length > 0)) {
    const validPools = pools.filter(
      (p) => p.length > 0 && (pools.length === 1 || p[0].song.artist !== lastArtist)
    );

    const chosenPool =
      validPools.length > 0
        ? validPools[Math.floor(Math.random() * validPools.length)]
        : pools.find((p) => p.length > 0)!;

    const item = chosenPool.shift()!;
    result.push(item);
    lastArtist = item.song.artist || null;
  }

  return result;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.85,
  isShuffle: false,
  repeatMode: 'off',
  isQueueOpen: false,
  isSignatureOpen: false,

  currentSong: () => {
    const { queue, currentIndex } = get();
    if (currentIndex >= 0 && currentIndex < queue.length) {
      return queue[currentIndex].song;
    }
    return null;
  },

  playTrack: (song, contextSongs) => {
    const { queue } = get();
    let newQueue: QueueItem[];
    let newIndex = 0;

    if (contextSongs && contextSongs.length > 0) {
      newQueue = contextSongs.map(createQueueItem);
      const matchIdx = newQueue.findIndex((item) => item.song.id === song.id);
      newIndex = matchIdx >= 0 ? matchIdx : 0;
    } else {
      const existingIdx = queue.findIndex((item) => item.song.id === song.id);
      if (existingIdx >= 0) {
        newQueue = queue;
        newIndex = existingIdx;
      } else {
        const newItem = createQueueItem(song);
        newQueue = [...queue, newItem];
        newIndex = newQueue.length - 1;
      }
    }

    set({
      queue: newQueue,
      currentIndex: newIndex,
      isPlaying: true,
      currentTime: 0,
      duration: song.duration || 0,
    });
  },

  playIndex: (index) => {
    const { queue } = get();
    if (index >= 0 && index < queue.length) {
      set({
        currentIndex: index,
        isPlaying: true,
        currentTime: 0,
        duration: queue[index].song.duration || 0,
      });
    }
  },

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setTime: (time) => set({ currentTime: time }),
  setDuration: (dur) => set({ duration: dur }),
  setVolume: (vol) => set({ volume: Math.max(0, Math.min(1, vol)) }),

  next: () => {
    const { queue, currentIndex, repeatMode } = get();
    if (queue.length === 0) {
      set({ isPlaying: false });
      return;
    }

    if (repeatMode === 'one' && currentIndex >= 0) {
      set({
        isPlaying: true,
        currentTime: 0,
      });
      return;
    }

    if (currentIndex < queue.length - 1) {
      const nextIndex = currentIndex + 1;
      set({
        currentIndex: nextIndex,
        isPlaying: true,
        currentTime: 0,
        duration: queue[nextIndex].song.duration || 0,
      });
    } else if (repeatMode === 'all') {
      set({
        currentIndex: 0,
        isPlaying: true,
        currentTime: 0,
        duration: queue[0].song.duration || 0,
      });
    } else {
      set({ isPlaying: false });
    }
  },

  previous: () => {
    const { queue, currentIndex, currentTime, repeatMode } = get();
    if (currentTime > 3) {
      set({ currentTime: 0 });
      return;
    }
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      set({
        currentIndex: prevIndex,
        isPlaying: true,
        currentTime: 0,
        duration: queue[prevIndex].song.duration || 0,
      });
    } else if (repeatMode === 'all' && queue.length > 0) {
      const lastIndex = queue.length - 1;
      set({
        currentIndex: lastIndex,
        isPlaying: true,
        currentTime: 0,
        duration: queue[lastIndex].song.duration || 0,
      });
    } else {
      set({ currentTime: 0 });
    }
  },

  enqueue: (songs) => {
    const list = Array.isArray(songs) ? songs : [songs];
    if (list.length === 0) return;
    const items = list.map(createQueueItem);
    set((state) => ({ queue: [...state.queue, ...items] }));
  },

  enqueueNext: (songs) => {
    const list = Array.isArray(songs) ? songs : [songs];
    if (list.length === 0) return;
    const items = list.map(createQueueItem);
    set((state) => {
      const insertAt = state.currentIndex + 1;
      return {
        queue: [
          ...state.queue.slice(0, insertAt),
          ...items,
          ...state.queue.slice(insertAt),
        ],
      };
    });
  },

  removeFromQueue: (sessionId) => {
    set((state) => {
      const targetIndex = state.queue.findIndex((item) => item.sessionId === sessionId);
      if (targetIndex < 0) return state;

      const nextQueue = state.queue.filter((item) => item.sessionId !== sessionId);
      let nextIndex = state.currentIndex;

      if (targetIndex < state.currentIndex) {
        nextIndex -= 1;
      } else if (targetIndex === state.currentIndex) {
        if (nextIndex >= nextQueue.length) {
          nextIndex = nextQueue.length - 1;
        }
      }

      return {
        queue: nextQueue,
        currentIndex: nextIndex,
      };
    });
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((state) => {
      if (
        fromIndex < 0 ||
        fromIndex >= state.queue.length ||
        toIndex < 0 ||
        toIndex >= state.queue.length ||
        fromIndex === toIndex
      ) {
        return state;
      }

      const currentItem = state.queue[state.currentIndex];
      const nextQueue = [...state.queue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, moved);

      const newCurrentIndex = currentItem
        ? nextQueue.findIndex((item) => item.sessionId === currentItem.sessionId)
        : -1;

      return {
        queue: nextQueue,
        currentIndex: newCurrentIndex,
      };
    });
  },

  clearQueue: () => {
    set({
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      currentTime: 0,
    });
  },

  toggleShuffle: () => {
    set((state) => {
      const nextShuffle = !state.isShuffle;
      if (!nextShuffle) {
        return { isShuffle: false };
      }

      if (state.currentIndex >= state.queue.length - 1) {
        return { isShuffle: true };
      }

      const played = state.queue.slice(0, state.currentIndex + 1);
      const upcoming = state.queue.slice(state.currentIndex + 1);
      const shuffledUpcoming = balancedShuffleList(upcoming);

      return {
        isShuffle: true,
        queue: [...played, ...shuffledUpcoming],
      };
    });
  },

  toggleRepeat: () => {
    set((state) => {
      const cycle: Record<RepeatMode, RepeatMode> = {
        off: 'all',
        all: 'one',
        one: 'off',
      };
      return { repeatMode: cycle[state.repeatMode] };
    });
  },

  setRepeatMode: (mode) => set({ repeatMode: mode }),
  toggleQueue: () => set((state) => ({ isQueueOpen: !state.isQueueOpen })),
  toggleSignatureView: () => set((state) => ({ isSignatureOpen: !state.isSignatureOpen })),
  setSignatureOpen: (open) => set({ isSignatureOpen: open }),
}));
