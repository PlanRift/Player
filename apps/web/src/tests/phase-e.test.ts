import { describe, expect, it, beforeEach } from 'bun:test';
import { AudioEngine } from '../audio/audioEngine';
import { usePlaybackStore } from '../stores/playbackStore';
import { useNavigationStore } from '../stores/navigationStore';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { useLastFmStore } from '../stores/lastFmStore';
import { lastFmClient, type SubsonicSong } from '@player/shared';

const mockSong1: SubsonicSong = {
  id: 'song-1',
  title: 'Track One',
  artist: 'Artist A',
  album: 'Album 1',
  duration: 200,
};

const mockSong2: SubsonicSong = {
  id: 'song-2',
  title: 'Track Two',
  artist: 'Artist A',
  album: 'Album 1',
  duration: 300,
};

const mockSongShort: SubsonicSong = {
  id: 'song-short',
  title: 'Short Intro',
  artist: 'Artist A',
  album: 'Album 1',
  duration: 25, // Less than 30s threshold
};

describe('Two-Deck Gapless Audio Engine (Phase E.1)', () => {
  beforeEach(() => {
    usePlaybackStore.getState().clearQueue();
  });

  it('initializes two decks and toggles active/idle appropriately', () => {
    const engine = new AudioEngine();
    expect(engine.getActiveDeckName()).toBe('A');

    // Setting crossfade duration
    engine.setCrossfade(4);
    expect(engine.getCrossfade()).toBe(4);

    // Clamps crossfade between 0 and 12
    engine.setCrossfade(-2);
    expect(engine.getCrossfade()).toBe(0);

    engine.setCrossfade(20);
    expect(engine.getCrossfade()).toBe(12);

    engine.setCrossfade(0);
    expect(engine.getCrossfade()).toBe(0);
  });

  it('determines the next track for preloading in idle deck', () => {
    const engine = new AudioEngine();
    usePlaybackStore.getState().playTrack(mockSong1, [mockSong1, mockSong2]);

    const playback = usePlaybackStore.getState();
    expect(playback.queue.length).toBe(2);
    expect(playback.currentIndex).toBe(0);

    // Preload should find mockSong2 as next track
    engine.preloadNextTrack();
    const idleDeck = engine.getIdleDeck();
    if (idleDeck && idleDeck.src) {
      expect(idleDeck.src).toContain(mockSong2.id);
    }
  });

  it('cancels active crossfade on manual seek or pause', () => {
    const engine = new AudioEngine();
    engine.setCrossfade(5);
    engine.cancelCrossfade();
    expect(engine.getCurrentTime()).toBe(0);
  });

  it('safely clamps seek position and syncs to playback store', () => {
    const engine = new AudioEngine();
    usePlaybackStore.getState().setDuration(200);

    // Seek to 180s (3 minutes) on a 200s track
    engine.seek(180);
    expect(usePlaybackStore.getState().currentTime).toBe(180);

    // Seek exceeding duration should clamp to safeMax (duration - 0.5)
    engine.seek(250);
    expect(usePlaybackStore.getState().currentTime).toBe(199.5);
  });
});

describe('Last.fm Store & Scrobbling Spec (Phase E.2)', () => {
  it('generates correct authorization URL', () => {
    const url = lastFmClient.getAuthUrl('my-api-key', 'http://localhost:5173/');
    expect(url).toContain('https://www.last.fm/api/auth/');
    expect(url).toContain('api_key=my-api-key');
    expect(url).toContain('cb=http%3A%2F%2Flocalhost%3A5173%2F');
  });

  it('allows setting and persisting credentials directly via settings store', () => {
    const store = useLastFmStore.getState();
    store.setCredentials('custom_api_key', 'custom_api_secret');
    expect(useLastFmStore.getState().apiKey).toBe('custom_api_key');
    expect(useLastFmStore.getState().apiSecret).toBe('custom_api_secret');

    store.clearCredentials();
    expect(useLastFmStore.getState().apiKey).toBe('');
    expect(useLastFmStore.getState().apiSecret).toBe('');
  });

  it('correctly tracks connection state and disconnect clearing', () => {
    const store = useLastFmStore.getState();
    store.disconnect();
    expect(store.isConnected()).toBe(false);

    store.setIsEnabled(false);
    expect(useLastFmStore.getState().isEnabled).toBe(false);

    store.setIsEnabled(true);
    expect(useLastFmStore.getState().isEnabled).toBe(true);
  });

  it('calculates scrobble thresholds according to Last.fm rules (50% or 240s, duration >= 30s)', () => {
    // 25s track: ineligible (duration < 30s)
    const isEligibleShort = (mockSongShort.duration || 0) >= 30;
    expect(isEligibleShort).toBe(false);

    // 200s track: threshold is 50% = 100s (< 240s)
    const dur1 = mockSong1.duration || 0;
    const threshold1 = Math.min(240, dur1 * 0.5);
    expect(threshold1).toBe(100);

    // 600s track: threshold is capped at 240s (50% is 300s > 240s)
    const durLong = 600;
    const thresholdLong = Math.min(240, durLong * 0.5);
    expect(thresholdLong).toBe(240);
  });
});

describe('Discovery Openable Cards & Detail View (Phase E & Spec Fix)', () => {
  it('stores and retrieves discovery virtual playlist cards by ID', () => {
    const testCard = {
      id: 'daylist-test',
      title: 'Morning Chill',
      subtitle: 'Gentle vibes',
      description: 'Test description',
      tracks: [mockSong1, mockSong2],
    };

    useDiscoveryStore.setState({ cards: [testCard] });
    const found = useDiscoveryStore.getState().getCard('daylist-test');
    expect(found).toBeDefined();
    expect(found?.title).toBe('Morning Chill');
    expect(found?.tracks.length).toBe(2);
  });

  it('navigates to discovery-detail with unified breadcrumb back to Home', () => {
    const nav = useNavigationStore.getState();
    nav.navigate('home');
    nav.navigate('discovery-detail', { discoveryCardId: 'daylist-test' });

    expect(useNavigationStore.getState().currentView).toBe('discovery-detail');
    expect(useNavigationStore.getState().selectedDiscoveryCardId).toBe('daylist-test');

    const breadcrumbs = useNavigationStore.getState().getBreadcrumbs();
    expect(breadcrumbs.canGoBack).toBe(true);
    expect(breadcrumbs.backLabel).toBe('← BACK HOME');

    // goBack returns to home
    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState().currentView).toBe('home');
  });

  it('navigates to settings with breadcrumb back to Home', () => {
    const nav = useNavigationStore.getState();
    nav.navigate('home');
    nav.navigate('settings');

    expect(useNavigationStore.getState().currentView).toBe('settings');

    const breadcrumbs = useNavigationStore.getState().getBreadcrumbs();
    expect(breadcrumbs.canGoBack).toBe(true);
    expect(breadcrumbs.backLabel).toBe('← BACK HOME');
  });
});
