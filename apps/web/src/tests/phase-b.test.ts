import { describe, it, expect, beforeEach } from 'bun:test';
import { createMonochromePlaceholderDataUrl, getCollageDataUrl } from '../utils/collage';
import { useNavigationStore } from '../stores/navigationStore';
import { usePlaybackStore } from '../stores/playbackStore';

describe('Collage Utility', () => {
  it('generates monochrome placeholder SVG data URL', () => {
    const dataUrl = createMonochromePlaceholderDataUrl();
    expect(dataUrl.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(dataUrl).toContain('%2318181b'); // #18181b in URL-encoded SVG
  });

  it('returns placeholder for empty cover list', async () => {
    const dataUrl = await getCollageDataUrl([], 'empty-key');
    expect(dataUrl.startsWith('data:image/svg+xml;utf8,')).toBe(true);
  });

  it('returns single cover URL directly when only 1 cover is provided', async () => {
    const singleUrl = 'https://music.planrift.me/rest/getCoverArt.view?id=123';
    const result = await getCollageDataUrl([singleUrl], 'single-key');
    expect(result).toBe(singleUrl);
  });
});

describe('NavigationStore Playlists Support', () => {
  beforeEach(() => {
    useNavigationStore.setState({
      currentView: 'home',
      selectedArtist: null,
      selectedAlbumId: null,
      selectedPlaylistId: null,
      history: [],
    });
  });

  it('navigates to playlists and playlist-detail with proper breadcrumbs', () => {
    const store = useNavigationStore.getState();
    store.navigate('playlists');

    expect(useNavigationStore.getState().currentView).toBe('playlists');

    useNavigationStore.getState().navigate('playlist-detail', { playlistId: 'pl-42' });
    expect(useNavigationStore.getState().currentView).toBe('playlist-detail');
    expect(useNavigationStore.getState().selectedPlaylistId).toBe('pl-42');
    expect(useNavigationStore.getState().getBreadcrumbs().backLabel).toBe('← BACK PLAYLISTS');
    expect(useNavigationStore.getState().getBreadcrumbs().canGoBack).toBe(true);

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState().currentView).toBe('playlists');
  });
});

describe('PlaybackStore Signature View & Repeat Controls', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
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
    });
  });

  it('toggles and sets signature view state', () => {
    expect(usePlaybackStore.getState().isSignatureOpen).toBe(false);

    usePlaybackStore.getState().toggleSignatureView();
    expect(usePlaybackStore.getState().isSignatureOpen).toBe(true);

    usePlaybackStore.getState().setSignatureOpen(false);
    expect(usePlaybackStore.getState().isSignatureOpen).toBe(false);
  });

  it('cycles repeat mode off -> all -> one -> off', () => {
    expect(usePlaybackStore.getState().repeatMode).toBe('off');

    usePlaybackStore.getState().toggleRepeat();
    expect(usePlaybackStore.getState().repeatMode).toBe('all');

    usePlaybackStore.getState().toggleRepeat();
    expect(usePlaybackStore.getState().repeatMode).toBe('one');

    usePlaybackStore.getState().toggleRepeat();
    expect(usePlaybackStore.getState().repeatMode).toBe('off');
  });
});
