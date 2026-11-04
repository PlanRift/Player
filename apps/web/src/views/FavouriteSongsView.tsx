import { useState, useEffect } from 'react';
import { Star, Play } from 'lucide-react';
import type { SubsonicSong } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { usePlaybackStore } from '../stores/playbackStore';
import { CoverImage } from '../components/common/CoverImage';
import { TrackContextMenu } from '../components/common/TrackContextMenu';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function FavouriteSongsView() {
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const { playTrack, currentSong } = usePlaybackStore();
  const current = currentSong();

  const loadFavourites = async () => {
    setIsLoading(true);
    try {
      const data = await subsonicClient.getStarred2();
      setSongs(data.song || []);
    } catch (err) {
      console.error('Failed to load starred songs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFavourites();
  }, []);

  const handleToggleStar = async (e: React.MouseEvent, song: SubsonicSong) => {
    e.stopPropagation();
    try {
      await subsonicClient.unstar(song.id, 'song');
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
    } catch (err) {
      console.error('Failed to unstar song:', err);
    }
  };

  const handlePlayAll = () => {
    if (songs.length > 0) {
      playTrack(songs[0], songs);
    }
  };

  const totalDuration = songs.reduce((sum, s) => sum + (s.duration || 0), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-700">
        <div className="space-y-1">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            Favourite Songs
          </h2>
          <p className="font-mono text-xs text-zinc-400">
            {songs.length} starred {songs.length === 1 ? 'track' : 'tracks'}
            {totalDuration > 0 && ` • ${formatDuration(totalDuration)} total`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePlayAll}
            disabled={songs.length === 0}
            className="min-h-[40px] px-4 py-2 rounded-md bg-emerald-400 text-zinc-950 font-semibold text-xs tracking-wider uppercase hover:bg-emerald-300 active:bg-emerald-500 transition-colors inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Play All</span>
          </button>
        </div>
      </div>

      {/* Songs Table */}
      {isLoading ? (
        <div className="p-12 text-center font-mono text-xs text-zinc-500 animate-pulse">
          Loading starred favourites...
        </div>
      ) : songs.length === 0 ? (
        <div className="p-12 text-center font-mono text-xs text-zinc-500 border border-zinc-800 rounded-lg bg-zinc-900/40">
          No favourite tracks yet. Click the ★ icon next to any song to add it here.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg bg-zinc-900/40 overflow-hidden">
          {songs.map((song, idx) => {
            const isCurrent = current?.id === song.id;

            return (
              <div
                key={song.id}
                onClick={() => playTrack(song, songs)}
                className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors group ${
                  isCurrent
                    ? 'bg-zinc-800/90 text-emerald-400'
                    : 'hover:bg-zinc-800/50 text-zinc-300'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 pr-4">
                  <span className="w-6 text-right font-mono text-xs text-zinc-500 group-hover:text-zinc-400 shrink-0">
                    {idx + 1}
                  </span>

                  <div className="w-9 h-9 rounded shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden">
                    <CoverImage
                      coverId={song.coverArt || song.id}
                      songId={song.id}
                      alt=""
                      size={80}
                    />
                  </div>

                  <div className="min-w-0">
                    <div
                      className={`text-xs sm:text-sm font-medium truncate ${
                        isCurrent ? 'text-emerald-400 font-semibold' : 'text-zinc-100'
                      }`}
                    >
                      {song.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {song.artist || 'Unknown'} {song.album ? `• ${song.album}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Star Button */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleStar(e, song)}
                    className="p-1 rounded cursor-pointer text-emerald-400 hover:text-emerald-300 transition-colors"
                    title="Remove from favourites"
                    aria-label="Remove from favourites"
                  >
                    <Star className="w-4 h-4 fill-emerald-400" />
                  </button>

                  <span className="font-mono text-xs text-zinc-400 w-12 text-right">
                    {formatDuration(song.duration || 0)}
                  </span>

                  <div
                    className="flex items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => usePlaybackStore.getState().enqueue(song)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 cursor-pointer border border-zinc-700 transition-colors"
                      title="Add to queue"
                    >
                      +Q
                    </button>
                    <TrackContextMenu
                      song={song}
                      onStarredChange={(starred) => {
                        if (!starred) {
                          setSongs((prev) => prev.filter((s) => s.id !== song.id));
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
