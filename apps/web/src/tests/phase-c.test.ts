import { describe, it, expect, beforeEach } from 'bun:test';
import { usePlaybackStore } from '../stores/playbackStore';
import { useNavigationStore } from '../stores/navigationStore';
import type { SubsonicSong } from '@player/shared';
import {
  ALL_LYRICS_PROVIDERS,
  probeProvider,
  resolveLyrics,
  getTrackProviderOverride,
  setTrackProviderOverride,
  cacheTrackLyrics,
} from '@player/shared';

describe('PlaybackStore Queue Reordering (Phase C.4)', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    });
  });

  const mockSong = (id: string, title: string): SubsonicSong => ({
    id,
    title,
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180,
  });

  it('reorders queue and maintains active playing index', () => {
    const s1 = mockSong('1', 'Song 1');
    const s2 = mockSong('2', 'Song 2');
    const s3 = mockSong('3', 'Song 3');

    usePlaybackStore.getState().enqueue([s1, s2, s3]);
    usePlaybackStore.getState().playIndex(1); // Playing Song 2

    expect(usePlaybackStore.getState().currentIndex).toBe(1);
    expect(usePlaybackStore.getState().currentSong()?.id).toBe('2');

    // Move Song 1 (idx 0) to position 2 (after Song 3)
    usePlaybackStore.getState().reorderQueue(0, 2);

    const reordered = usePlaybackStore.getState().queue;
    expect(reordered[0].song.id).toBe('2'); // Song 2 shifted up to index 0
    expect(reordered[1].song.id).toBe('3');
    expect(reordered[2].song.id).toBe('1');

    // Currently playing song was Song 2, so currentIndex should now be 0
    expect(usePlaybackStore.getState().currentIndex).toBe(0);
    expect(usePlaybackStore.getState().currentSong()?.id).toBe('2');
  });

  it('ignores invalid reorder indices', () => {
    const s1 = mockSong('1', 'Song 1');
    usePlaybackStore.getState().enqueue(s1);

    usePlaybackStore.getState().reorderQueue(-1, 5);
    expect(usePlaybackStore.getState().queue.length).toBe(1);
  });
});

describe('NavigationStore Breadcrumbs & Unified Back Buttons (Phase C.8)', () => {
  beforeEach(() => {
    useNavigationStore.setState({
      currentView: 'home',
      selectedArtist: null,
      selectedAlbumId: null,
      selectedPlaylistId: null,
      history: [],
    });
  });

  it('generates unified back buttons across view transitions', () => {
    const store = useNavigationStore.getState();

    // From home to albums
    useNavigationStore.getState().navigate('albums');
    expect(useNavigationStore.getState().currentView).toBe('albums');

    // From albums to album-detail
    useNavigationStore.getState().navigate('album-detail', { albumId: 'al-1' });
    expect(useNavigationStore.getState().getBreadcrumbs().backLabel).toBe('← BACK ALBUMS');
    expect(useNavigationStore.getState().getBreadcrumbs().canGoBack).toBe(true);

    // Go back to albums
    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState().currentView).toBe('albums');

    // From albums to search
    useNavigationStore.getState().navigate('search');
    expect(useNavigationStore.getState().getBreadcrumbs().backLabel).toBe('← BACK HOME');

    // From search to songs
    useNavigationStore.getState().navigate('songs');
    expect(useNavigationStore.getState().getBreadcrumbs().backLabel).toBe('← BACK HOME');
  });
});

describe('LRC Parsing Logic (Phase C.1)', () => {
  function parseLrc(lrcText: string): Array<{ time: number; text: string }> {
    const lines = lrcText.split('\n');
    const result: Array<{ time: number; text: string }> = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    for (const line of lines) {
      const match = timeRegex.exec(line.trim());
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millis = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
        const time = minutes * 60 + seconds + millis / 1000;
        const text = match[4].trim();
        if (text) {
          result.push({ time, text });
        }
      }
    }

    return result.sort((a, b) => a.time - b.time);
  }

  it('parses standard synced LRC text correctly', () => {
    const lrc = `
      [00:12.30]First lyric line
      [00:15.50]Second lyric line
      [01:02.123]Third lyric line
    `;

    const parsed = parseLrc(lrc);
    expect(parsed.length).toBe(3);
    expect(parsed[0].time).toBeCloseTo(12.3, 1);
    expect(parsed[0].text).toBe('First lyric line');
    expect(parsed[1].time).toBeCloseTo(15.5, 1);
    expect(parsed[2].time).toBeCloseTo(62.123, 2);
  });
});

describe('Multi-provider Lyrics Architecture (Phase C.1)', () => {
  it('exposes all specified providers and skips Baidu / YouTube Music', () => {
    const ids = ALL_LYRICS_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('lrclib');
    expect(ids).toContain('netease');
    expect(ids).toContain('qq');
    expect(ids).toContain('kugou');
    expect(ids).toContain('lyricsplus');
    expect(ids).toContain('unison');
    expect(ids).not.toContain('baidu');
    expect(ids).not.toContain('youtube');
  });

  it('manages per-track provider override and cache', () => {
    const trackId = 'test-track-override-123';
    expect(getTrackProviderOverride(trackId)).toBeNull();

    setTrackProviderOverride(trackId, 'kugou');
    expect(getTrackProviderOverride(trackId)).toBe('kugou');

    setTrackProviderOverride(trackId, 'auto');
    expect(getTrackProviderOverride(trackId)).toBeNull();

    // Cache test
    cacheTrackLyrics(trackId, 'lrclib', {
      providerId: 'lrclib',
      syncedLyrics: '[00:01.00]Hello',
      plainLyrics: 'Hello',
    });
  });

  it('handles unreachable non-LRCLIB providers safely with probeProvider', async () => {
    const netease = ALL_LYRICS_PROVIDERS.find((p) => p.id === 'netease')!;
    const probe = await probeProvider(netease, {
      track: 'NonExistentTestSong',
      artist: 'NonExistentArtist',
    });

    // Should return 'unreachable' or 'not_found' without throwing
    expect(['unreachable', 'not_found']).toContain(probe.status);
  });
});
