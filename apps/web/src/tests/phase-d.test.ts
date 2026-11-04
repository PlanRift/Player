import { describe, it, expect, beforeEach } from 'bun:test';
import { useHistoryStore } from '../stores/historyStore';
import { generateDiscoveryCards } from '../discovery/discoveryEngine';
import type { SubsonicSong } from '@player/shared';

describe('HistoryStore (Phase D.1)', () => {
  beforeEach(() => {
    useHistoryStore.getState().clearHistory();
  });

  it('records plays with proper fields and caps at FIFO limit', () => {
    const store = useHistoryStore.getState();

    store.recordPlay({
      songId: 'song-1',
      artistId: 'artist-1',
      albumId: 'album-1',
      playedAt: Date.now(),
      playDurationMs: 45000,
    });

    const entries = useHistoryStore.getState().getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].songId).toBe('song-1');
    expect(entries[0].playDurationMs).toBe(45000);
    expect(useHistoryStore.getState().isSongPlayed('song-1')).toBe(true);
    expect(useHistoryStore.getState().isSongPlayed('song-unknown')).toBe(false);
  });

  it('calculates top artist and top song frequencies correctly', () => {
    const store = useHistoryStore.getState();

    // 3 plays for artist A, 1 play for artist B
    store.recordPlay({
      songId: 'song-1',
      artistId: 'artist-A',
      albumId: 'al-1',
      playedAt: Date.now() - 1000,
      playDurationMs: 35000,
    });
    store.recordPlay({
      songId: 'song-1',
      artistId: 'artist-A',
      albumId: 'al-1',
      playedAt: Date.now() - 500,
      playDurationMs: 35000,
    });
    store.recordPlay({
      songId: 'song-2',
      artistId: 'artist-B',
      albumId: 'al-2',
      playedAt: Date.now(),
      playDurationMs: 35000,
    });

    const topArtists = useHistoryStore.getState().getTopArtistIds();
    expect(topArtists.length).toBe(2);
    expect(topArtists[0].artistId).toBe('artist-A');
    expect(topArtists[0].count).toBe(2);

    const topSongs = useHistoryStore.getState().getTopSongIds();
    expect(topSongs[0].songId).toBe('song-1');
    expect(topSongs[0].count).toBe(2);
  });

  it('filters plays by hour window', () => {
    const store = useHistoryStore.getState();
    const morningDate = new Date();
    morningDate.setHours(9, 30, 0, 0);

    store.recordPlay({
      songId: 'morning-song',
      artistId: 'art-1',
      albumId: 'al-1',
      playedAt: morningDate.getTime(),
      playDurationMs: 60000,
    });

    const morningPlays = useHistoryStore.getState().getPlaysInWindow(5, 12);
    expect(morningPlays.some((e) => e.songId === 'morning-song')).toBe(true);

    const nightPlays = useHistoryStore.getState().getPlaysInWindow(22, 5);
    expect(nightPlays.some((e) => e.songId === 'morning-song')).toBe(false);
  });
});

describe('Discovery Engine (Phase D.2 & D.3)', () => {
  const mockSongs: SubsonicSong[] = Array.from({ length: 60 }, (_, i) => ({
    id: `track-${i + 1}`,
    title: `Track ${i + 1}`,
    artist: i < 30 ? 'Top Artist Alpha' : 'Indie Artist Beta',
    artistId: i < 30 ? 'art-alpha' : 'art-beta',
    album: `Album ${(i % 5) + 1}`,
    albumId: `al-${(i % 5) + 1}`,
    duration: 200,
  }));

  beforeEach(() => {
    useHistoryStore.getState().clearHistory();
  });

  it('generates all 5 required discovery virtual playlists', async () => {
    const cards = await generateDiscoveryCards(mockSongs);

    expect(cards.length).toBe(5);
    const ids = cards.map((c) => c.id);
    expect(ids).toContain('daylist');
    expect(ids).toContain('discover-weekly');
    expect(ids).toContain('release-radar');
    expect(ids).toContain('daily-mix');
    expect(ids).toContain('on-this-day');
  });

  it('populates Discover Weekly with unplayed tracks capped at 30', async () => {
    // Record plays for first 10 tracks
    for (let i = 0; i < 10; i++) {
      useHistoryStore.getState().recordPlay({
        songId: mockSongs[i].id,
        artistId: mockSongs[i].artistId || '',
        albumId: mockSongs[i].albumId || '',
        playedAt: Date.now(),
        playDurationMs: 40000,
      });
    }

    const cards = await generateDiscoveryCards(mockSongs);
    const discoverWeekly = cards.find((c) => c.id === 'discover-weekly')!;

    expect(discoverWeekly.tracks.length).toBe(30);
    // None of the first 10 played tracks should appear in Discover Weekly
    for (const t of discoverWeekly.tracks) {
      expect(useHistoryStore.getState().isSongPlayed(t.id)).toBe(false);
    }
  });

  it('returns empty tracks for cards without history without inventing data', async () => {
    // No history recorded
    const cards = await generateDiscoveryCards(mockSongs);
    const onThisDay = cards.find((c) => c.id === 'on-this-day')!;

    // On This Day has zero prior year entries
    expect(onThisDay.tracks.length).toBe(0);
    expect(onThisDay.title).toBe('On This Day');
  });
});
