import { create } from 'zustand';
import type { SubsonicAlbum, SubsonicArtist, SubsonicPlaylist } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useConnectionStore } from './connectionStore';

interface LibraryState {
  artists: SubsonicArtist[];
  recentAlbums: SubsonicAlbum[];
  albumsByArtist: Record<string, SubsonicAlbum[]>;
  playlists: SubsonicPlaylist[];
  isLoadingArtists: boolean;
  isLoadingRecent: boolean;
  isLoadingPlaylists: boolean;

  loadArtists: () => Promise<void>;
  loadRecentlyAdded: () => Promise<void>;
  loadArtistAlbums: (artist: SubsonicArtist) => Promise<SubsonicAlbum[]>;
  loadPlaylists: () => Promise<void>;
  createPlaylist: (name: string, songIds?: string[]) => Promise<SubsonicPlaylist>;
  deletePlaylist: (id: string) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  artists: [],
  recentAlbums: [],
  albumsByArtist: {},
  playlists: [],
  isLoadingArtists: false,
  isLoadingRecent: false,
  isLoadingPlaylists: false,

  loadArtists: async () => {
    set({ isLoadingArtists: true });
    try {
      const list = await subsonicClient.getArtists();
      set({ artists: list, isLoadingArtists: false });
      useConnectionStore.getState().hideStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ isLoadingArtists: false });
      useConnectionStore.getState().showStatus({
        title: 'Failed to Load Artists',
        message: msg,
        showRetry: true,
      });
    }
  },

  loadRecentlyAdded: async () => {
    set({ isLoadingRecent: true });
    try {
      const list = await subsonicClient.getAlbumList2('newest', 18);
      set({ recentAlbums: list, isLoadingRecent: false });
    } catch (err: unknown) {
      set({ isLoadingRecent: false });
      console.warn('Failed to load recent albums:', err);
    }
  },

  loadArtistAlbums: async (artist: SubsonicArtist) => {
    const cached = get().albumsByArtist[artist.id];
    if (cached) return cached;

    try {
      const albums = await subsonicClient.resolveArtistAlbums(artist);
      set((state) => ({
        albumsByArtist: {
          ...state.albumsByArtist,
          [artist.id]: albums,
        },
      }));
      return albums;
    } catch (err) {
      console.error(`Failed to load albums for artist ${artist.name}:`, err);
      return [];
    }
  },

  loadPlaylists: async () => {
    set({ isLoadingPlaylists: true });
    try {
      const list = await subsonicClient.getPlaylists();
      set({ playlists: list, isLoadingPlaylists: false });
    } catch (err: unknown) {
      set({ isLoadingPlaylists: false });
      console.warn('Failed to load playlists:', err);
    }
  },

  createPlaylist: async (name: string, songIds: string[] = []) => {
    const created = await subsonicClient.createPlaylist(name, songIds);
    await get().loadPlaylists();
    return created;
  },

  deletePlaylist: async (id: string) => {
    await subsonicClient.deletePlaylist(id);
    await get().loadPlaylists();
  },
}));
