import { useEffect, useState } from 'react';
import { X, Star } from 'lucide-react';
import type { SubsonicPlaylist, SubsonicSong } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { usePlaybackStore } from '../stores/playbackStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { getCollageDataUrl, createMonochromePlaceholderDataUrl } from '../utils/collage';
import { TrackContextMenu } from '../components/common/TrackContextMenu';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function PlaylistDetailView({ id }: { id?: string | null }) {
  const { playTrack, enqueue, repeatMode, toggleRepeat, currentSong, isPlaying } = usePlaybackStore();
  const { deletePlaylist } = useLibraryStore();
  const { navigate } = useNavigationStore();

  const [playlist, setPlaylist] = useState<SubsonicPlaylist | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSong = currentSong();

  const loadData = () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    subsonicClient
      .getPlaylist(id)
      .then((data) => {
        setPlaylist(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, [id]);

  // Generate 2x2 collage thumbnail (Task 7 generator at ~400px)
  useEffect(() => {
    if (!playlist) return;
    let isMounted = true;

    async function loadThumb() {
      if (playlist!.coverArt) {
        setThumbUrl(subsonicClient.getCoverArtUrl(playlist!.coverArt, 400));
        return;
      }

      const covers = (playlist!.entry || [])
        .map((s) => s.coverArt || s.id)
        .filter(Boolean)
        .slice(0, 4)
        .map((coverId) => subsonicClient.getCoverArtUrl(coverId, 300));

      const collage = await getCollageDataUrl(covers, `pl-detail-${playlist!.id}`, 400);
      if (isMounted) setThumbUrl(collage);
    }

    loadThumb();
    return () => {
      isMounted = false;
    };
  }, [playlist?.id, playlist?.coverArt, playlist?.entry]);

  if (isLoading) {
    return (
      <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
        Loading playlist details...
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="p-12 text-center font-mono text-xs text-red-400">
        {error || 'Playlist not found.'}
      </div>
    );
  }

  const entries = playlist.entry || [];
  const totalSecs = entries.reduce((acc, s) => acc + (s.duration || 0), 0);
  const totalMins = Math.round(totalSecs / 60);

  const handleToggleSongStar = async (song: SubsonicSong) => {
    const isStarred = Boolean(song.starred);
    try {
      if (isStarred) {
        await subsonicClient.unstar(song.id, 'song');
      } else {
        await subsonicClient.star(song.id, 'song');
      }
      setPlaylist((prev) =>
        prev
          ? {
              ...prev,
              entry: (prev.entry || []).map((s) =>
                s.id === song.id
                  ? { ...s, starred: isStarred ? undefined : new Date().toISOString() }
                  : s
              ),
            }
          : prev
      );
    } catch (err) {
      console.error('Failed to toggle song star:', err);
    }
  };

  const handlePlayAll = () => {
    if (entries.length > 0) {
      playTrack(entries[0], entries);
    }
  };

  const handleEnqueueAll = () => {
    if (entries.length > 0) {
      enqueue(entries);
    }
  };

  const handleRemoveTrack = async (e: React.MouseEvent, indexToRemove: number) => {
    e.stopPropagation();
    try {
      await subsonicClient.updatePlaylist(playlist.id, [], [indexToRemove]);
      loadData();
    } catch (err) {
      console.error('Failed to remove track from playlist:', err);
    }
  };

  const handleDeletePlaylist = async () => {
    const confirmed = window.confirm(`Are you sure you want to delete playlist "${playlist.name}"?`);
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      await deletePlaylist(playlist.id);
      navigate('playlists');
    } catch (err) {
      setIsDeleting(false);
      console.error('Failed to delete playlist:', err);
      alert('Failed to delete playlist');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      {/* Header Block — Mirrored from AlbumDetailView */}
      <div className="studio-panel rounded-lg p-5 sm:p-6 flex flex-col sm:flex-row gap-6 items-start">
        <div className="w-44 h-44 sm:w-48 sm:h-48 rounded-md shrink-0 bg-zinc-950 border border-zinc-700 overflow-hidden flex items-center justify-center">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={playlist.name}
              className="w-full h-full object-cover select-none"
              onError={(e) => {
                (e.target as HTMLImageElement).src = createMonochromePlaceholderDataUrl();
              }}
            />
          ) : (
            <div className="w-full h-full bg-zinc-900 animate-pulse" />
          )}
        </div>

        <div className="flex-1 flex flex-col justify-between self-stretch gap-4 min-w-0">
          <div>
            <span className="text-xs font-mono text-emerald-400">
              Layer 3 · Playlist
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100 mt-1 truncate">
              {playlist.name}
            </h2>

            {playlist.comment && (
              <p className="text-xs sm:text-sm text-zinc-300 mt-1 line-clamp-2">
                {playlist.comment}
              </p>
            )}

            <div className="font-mono text-xs text-zinc-400 mt-1">
              {entries.length} tracks • {totalMins} minutes
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handlePlayAll}
              disabled={entries.length === 0}
              className="bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-4 py-2 rounded-md hover:bg-emerald-300 active:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer transition-colors"
            >
              PLAY ALL
            </button>

            {/* Repeat Toggle */}
            <button
              type="button"
              onClick={toggleRepeat}
              className={`font-mono text-xs px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                repeatMode !== 'off'
                  ? 'bg-emerald-400 text-zinc-950 border-emerald-400 font-semibold'
                  : 'bg-zinc-950 text-zinc-100 border-zinc-500 hover:bg-zinc-800 hover:border-zinc-300'
              }`}
              title={`Repeat mode: ${repeatMode}`}
              aria-label={`Repeat mode: ${repeatMode}`}
            >
              {repeatMode === 'off' && 'REP: OFF'}
              {repeatMode === 'all' && 'REP: ALL'}
              {repeatMode === 'one' && 'REP: 1'}
            </button>

            <button
              type="button"
              onClick={handleEnqueueAll}
              disabled={entries.length === 0}
              className="bg-zinc-950 text-zinc-100 border border-zinc-500 hover:bg-zinc-800 hover:border-zinc-300 font-mono text-xs px-3 py-2 rounded-md disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer transition-colors"
            >
              ENQUEUE ALL
            </button>

            <button
              type="button"
              onClick={handleDeletePlaylist}
              disabled={isDeleting}
              className="bg-zinc-950 text-red-400 border border-zinc-700 hover:border-red-500 hover:bg-red-950/30 font-mono text-xs px-3 py-2 rounded-md disabled:opacity-40 cursor-pointer transition-colors"
            >
              {isDeleting ? 'DELETING...' : 'DELETE PLAYLIST'}
            </button>
          </div>
        </div>
      </div>

      {/* Tracklist Table */}
      <div className="flex flex-col studio-panel rounded-lg overflow-hidden">
        <div className="border-b border-zinc-700 py-2.5 px-4 flex items-center justify-between font-mono text-xs text-zinc-400 uppercase tracking-wider bg-zinc-950/70">
          <div className="flex items-center gap-4">
            <span className="w-8">#</span>
            <span>Title</span>
          </div>
          <div className="flex items-center gap-8">
            <span className="w-12 text-right">Time</span>
            <span className="w-20 text-right">Actions</span>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="p-8 text-center font-mono text-xs text-zinc-400">
            This playlist has no tracks yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {entries.map((song, idx) => {
              const isCurrent = Boolean(activeSong && song.id === activeSong.id);
              return (
                <div
                  key={`${song.id}-${idx}`}
                  onClick={() => playTrack(song, entries)}
                  className={`group flex items-center justify-between p-3.5 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-zinc-800 text-emerald-400 border-l-2 border-emerald-400'
                      : 'hover:bg-zinc-800/60 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-4 truncate pr-4">
                    <span className="font-mono text-xs text-zinc-400 w-8 shrink-0">
                      {(idx + 1).toString().padStart(2, '0')}
                    </span>
                    <div className="truncate flex items-center gap-2">
                      <div className="truncate">
                        <span
                          className={`text-xs font-medium truncate block ${
                            isCurrent ? 'text-emerald-400 font-semibold' : 'text-zinc-100 group-hover:text-emerald-400'
                          }`}
                        >
                          {song.title}
                        </span>
                        <span className="text-[11px] text-zinc-400 truncate block">
                          {song.artist} — {song.album}
                        </span>
                      </div>
                      {isCurrent && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-400 text-zinc-950 font-semibold shrink-0">
                          {isPlaying ? 'Playing' : 'Paused'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <span className="font-mono text-xs text-zinc-400 w-12 text-right">
                      {formatDuration(song.duration || 0)}
                    </span>
                    <div
                      className="flex items-center gap-1.5 w-24 justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSongStar(song)}
                        className={`p-1 rounded cursor-pointer transition-colors ${
                          song.starred
                            ? 'text-emerald-400'
                            : 'text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100'
                        }`}
                        title={song.starred ? 'Unstar song' : 'Star song'}
                        aria-label={song.starred ? 'Unstar song' : 'Star song'}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${song.starred ? 'fill-emerald-400' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => enqueue(song)}
                        className="p-1 text-zinc-400 hover:text-emerald-400 font-mono text-xs cursor-pointer"
                        title="Add to queue"
                      >
                        +Q
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveTrack(e, idx)}
                        className="p-1 text-zinc-400 hover:text-red-400 cursor-pointer transition-colors"
                        title="Remove from playlist"
                        aria-label="Remove from playlist"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <TrackContextMenu
                        song={song}
                        onStarredChange={(starred) => {
                          setPlaylist((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  entry: (prev.entry || []).map((s) =>
                                    s.id === song.id
                                      ? {
                                          ...s,
                                          starred: starred
                                            ? new Date().toISOString()
                                            : undefined,
                                        }
                                      : s
                                  ),
                                }
                              : prev
                          );
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
    </div>
  );
}
