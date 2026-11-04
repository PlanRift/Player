import { create } from 'zustand';
import type { SubsonicArtist } from '@player/shared';

export type ViewType =
  | 'home'
  | 'search'
  | 'albums'
  | 'artists'
  | 'songs'
  | 'album-detail'
  | 'playlists'
  | 'favourite-songs'
  | 'playlist-detail'
  | 'discovery-detail'
  | 'settings';

export interface NavigationHistoryItem {
  view: ViewType;
  artist?: SubsonicArtist | null;
  albumId?: string | null;
  playlistId?: string | null;
  discoveryCardId?: string | null;
}

export interface NavigationState {
  currentView: ViewType;
  selectedArtist: SubsonicArtist | null;
  selectedAlbumId: string | null;
  selectedPlaylistId: string | null;
  selectedDiscoveryCardId: string | null;
  history: NavigationHistoryItem[];
  isSearchOpen: boolean;

  navigate: (
    view: ViewType,
    params?: {
      artist?: SubsonicArtist | null;
      albumId?: string | null;
      playlistId?: string | null;
      discoveryCardId?: string | null;
    }
  ) => void;
  goBack: () => void;
  getBreadcrumbs: () => { label: string; backLabel: string | null; canGoBack: boolean };
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentView: 'home',
  selectedArtist: null,
  selectedAlbumId: null,
  selectedPlaylistId: null,
  selectedDiscoveryCardId: null,
  history: [],
  isSearchOpen: false,

  setSearchOpen: (open) => set({ isSearchOpen: open }),
  toggleSearch: () => set((state) => ({ isSearchOpen: !state.isSearchOpen })),

  navigate: (view, params) => {
    set((state) => ({
      history: [
        ...state.history,
        {
          view: state.currentView,
          artist: state.selectedArtist,
          albumId: state.selectedAlbumId,
          playlistId: state.selectedPlaylistId,
          discoveryCardId: state.selectedDiscoveryCardId,
        },
      ],
      currentView: view,
      selectedArtist: params?.artist ?? (view === 'artists' ? null : state.selectedArtist),
      selectedAlbumId: params?.albumId ?? null,
      selectedPlaylistId: params?.playlistId ?? null,
      selectedDiscoveryCardId: params?.discoveryCardId ?? null,
    }));
  },

  goBack: () => {
    const { history } = get();
    if (history.length === 0) return;

    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);

    set({
      history: newHistory,
      currentView: previous.view,
      selectedArtist: previous.artist ?? null,
      selectedAlbumId: previous.albumId ?? null,
      selectedPlaylistId: previous.playlistId ?? null,
      selectedDiscoveryCardId: previous.discoveryCardId ?? null,
    });
  },

  getBreadcrumbs: () => {
    const { currentView, selectedArtist, history } = get();
    const canGoBack = history.length > 0;

    let backLabel: string | null = null;

    if (currentView === 'album-detail') {
      const prev = history[history.length - 1];
      if (prev?.view === 'artists' || selectedArtist) {
        backLabel = '← BACK ARTISTS';
      } else {
        backLabel = '← BACK ALBUMS';
      }
    } else if (currentView === 'playlist-detail') {
      backLabel = '← BACK PLAYLISTS';
    } else if (currentView === 'favourite-songs') {
      backLabel = '← BACK PLAYLISTS';
    } else if (currentView === 'discovery-detail') {
      backLabel = '← BACK HOME';
    } else if (currentView === 'settings') {
      backLabel = '← BACK HOME';
    } else if (currentView === 'songs') {
      backLabel = '← BACK HOME';
    } else if (currentView === 'search') {
      backLabel = '← BACK HOME';
    } else if (currentView === 'albums' && selectedArtist) {
      backLabel = '← BACK ARTISTS';
    } else if (canGoBack) {
      const prev = history[history.length - 1];
      if (prev?.view === 'artists') backLabel = '← BACK ARTISTS';
      else if (prev?.view === 'albums') backLabel = '← BACK ALBUMS';
      else if (prev?.view === 'playlists') backLabel = '← BACK PLAYLISTS';
      else backLabel = '← BACK HOME';
    }

    return { label: '', backLabel, canGoBack: Boolean(backLabel) };
  },
}));
