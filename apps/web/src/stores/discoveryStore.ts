import { create } from 'zustand';
import { subsonicClient } from '@player/shared';
import {
  generateDiscoveryCards,
  type VirtualPlaylist,
} from '../discovery/discoveryEngine';

interface DiscoveryState {
  cards: VirtualPlaylist[];
  isLoading: boolean;
  loadCards: () => Promise<void>;
  getCard: (id: string) => VirtualPlaylist | undefined;
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => ({
  cards: [],
  isLoading: false,

  loadCards: async () => {
    if (get().cards.length > 0) return;

    set({ isLoading: true });
    try {
      const librarySongs = await subsonicClient.getSongs(0, 300);
      const cards = await generateDiscoveryCards(librarySongs);
      set({ cards, isLoading: false });
    } catch (err) {
      console.warn('Failed to generate discovery cards:', err);
      set({ isLoading: false });
    }
  },

  getCard: (id: string) => {
    return get().cards.find((c) => c.id === id);
  },
}));
