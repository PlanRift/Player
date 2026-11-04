import type { SubsonicSong } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useHistoryStore } from '../stores/historyStore';

export interface VirtualPlaylist {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  tracks: SubsonicSong[];
}

function createMulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function shuffleWithPrng<T>(array: T[], prng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Calculate ISO week string (e.g., '2026-W45')
function getIsoWeekString(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
}

export async function generateDiscoveryCards(
  allLibrarySongs: SubsonicSong[]
): Promise<VirtualPlaylist[]> {
  const history = useHistoryStore.getState();
  const cards: VirtualPlaylist[] = [];
  const now = new Date();

  // -------------------------------------------------------------------------
  // 1. Daylist (4x daily: morning / afternoon / evening / night)
  // -------------------------------------------------------------------------
  const hour = now.getHours();
  let daylistTitle = '';
  let daylistSub = '';
  let windowStart = 0;
  let windowEnd = 0;

  if (hour >= 5 && hour < 12) {
    daylistTitle = 'Morning Daylist';
    daylistSub = 'Early focus & quiet awakening';
    windowStart = 5;
    windowEnd = 12;
  } else if (hour >= 12 && hour < 17) {
    daylistTitle = 'Afternoon Daylist';
    daylistSub = 'Midday flow & focused momentum';
    windowStart = 12;
    windowEnd = 17;
  } else if (hour >= 17 && hour < 22) {
    daylistTitle = 'Evening Daylist';
    daylistSub = 'Twilight wind-down & decompression';
    windowStart = 17;
    windowEnd = 22;
  } else {
    daylistTitle = 'Night Daylist';
    daylistSub = 'Late night solitude & deep listening';
    windowStart = 22;
    windowEnd = 5;
  }

  const windowEntries = history.getPlaysInWindow(windowStart, windowEnd);
  const windowSongIds = new Set(windowEntries.map((e) => e.songId));
  const daylistTracks = allLibrarySongs.filter((s) => windowSongIds.has(s.id)).slice(0, 30);

  cards.push({
    id: 'daylist',
    title: daylistTitle,
    subtitle: daylistSub,
    description: `Tracks matching your ${daylistTitle.toLowerCase()} listening patterns.`,
    tracks: daylistTracks,
  });

  // -------------------------------------------------------------------------
  // 2. Discover Weekly (30 unplayed library tracks, refreshed Fridays)
  // -------------------------------------------------------------------------
  const playedSongIds = history.getPlayedSongIds();
  const unplayedSongs = allLibrarySongs.filter((s) => !playedSongIds.has(s.id));

  // Determine Friday-based seed
  const weekSeedStr = `discover-weekly-${getIsoWeekString(now)}`;
  const prng = createMulberry32(stringToSeed(weekSeedStr));
  const shuffledUnplayed = shuffleWithPrng(unplayedSongs, prng);
  const discoverWeeklyTracks = shuffledUnplayed.slice(0, 30);

  cards.push({
    id: 'discover-weekly',
    title: 'Discover Weekly',
    subtitle: '30 songs from your library waiting to be explored',
    description: 'Weekly curated selection of library tracks with zero recorded plays.',
    tracks: discoverWeeklyTracks,
  });

  // -------------------------------------------------------------------------
  // 3. Release Radar (newest additions filtered by user favorites)
  // -------------------------------------------------------------------------
  const topArtists = history.getTopArtistIds(10);
  const topArtistSet = new Set(topArtists.map((a) => a.artistId.toLowerCase()));
  let releaseRadarTracks: SubsonicSong[] = [];

  try {
    const newestAlbums = await subsonicClient.getAlbumList2('newest', 20);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Filter recent albums
    const recent = newestAlbums.filter((al) => {
      if (!al.created) return true;
      return new Date(al.created).getTime() >= thirtyDaysAgo;
    });

    const targetAlbums = recent.length > 0 ? recent : newestAlbums.slice(0, 8);

    // Resolve songs from target albums
    for (const alb of targetAlbums) {
      if (releaseRadarTracks.length >= 30) break;
      const albSongs = await subsonicClient.resolveAlbumSongs(alb);
      const isFavArtist = alb.artistId && topArtistSet.has(alb.artistId.toLowerCase());
      if (isFavArtist || topArtistSet.size === 0) {
        releaseRadarTracks.push(...albSongs);
      }
    }
    releaseRadarTracks = releaseRadarTracks.slice(0, 30);
  } catch (err) {
    console.warn('Failed to resolve release radar:', err);
  }

  cards.push({
    id: 'release-radar',
    title: 'Release Radar',
    subtitle: 'Recent additions and new album arrivals',
    description: 'Fresh tracks from recently added albums in your local library.',
    tracks: releaseRadarTracks,
  });

  // -------------------------------------------------------------------------
  // 4. Daily Mix (Seeded from top-artist clusters in history)
  // -------------------------------------------------------------------------
  let dailyMixTracks: SubsonicSong[] = [];
  let dailyMixSubtitle = 'A tailored mix inspired by your top listening';

  if (topArtists.length > 0) {
    const primaryArtistId = topArtists[0].artistId;
    const matchingTracks = allLibrarySongs.filter(
      (s) => s.artistId === primaryArtistId || (s.artist && s.artist === allLibrarySongs.find((x) => x.artistId === primaryArtistId)?.artist)
    );
    dailyMixTracks = matchingTracks.slice(0, 25);
    const leadSong = matchingTracks[0];
    if (leadSong?.artist) {
      dailyMixSubtitle = `Mix inspired by ${leadSong.artist}`;
    }
  }

  cards.push({
    id: 'daily-mix',
    title: 'Daily Mix',
    subtitle: dailyMixSubtitle,
    description: 'Personalized mix clustered around your most-played artists.',
    tracks: dailyMixTracks,
  });

  // -------------------------------------------------------------------------
  // 5. On This Day (Tracks played on this date in prior years)
  // -------------------------------------------------------------------------
  const onThisDayEntries = history.getPlaysOnCalendarDayInPriorYears(
    now.getMonth(),
    now.getDate()
  );
  const onThisDaySongIds = new Set(onThisDayEntries.map((e) => e.songId));
  const onThisDayTracks = allLibrarySongs
    .filter((s) => onThisDaySongIds.has(s.id))
    .slice(0, 30);

  cards.push({
    id: 'on-this-day',
    title: 'On This Day',
    subtitle: 'Music you enjoyed on this calendar day in past years',
    description: 'Historical playback memories recorded on this date.',
    tracks: onThisDayTracks,
  });

  return cards;
}
