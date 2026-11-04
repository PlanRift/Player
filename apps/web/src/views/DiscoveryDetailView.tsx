import { useState } from 'react';
import { Star } from 'lucide-react';
import type { SubsonicSong } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { GenerativeThumbnail } from '../components/common/GenerativeThumbnail';
import { TrackContextMenu } from '../components/common/TrackContextMenu';

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function DiscoveryDetailView({ id }: { id?: string | null }) {
  const { getCard } = useDiscoveryStore();
  const { playTrack, enqueue, repeatMode, toggleRepeat, currentSong, isPlaying } =
    usePlaybackStore();
  const { createPlaylist, loadPlaylists } = useLibraryStore();
  const { navigate } = useNavigationStore();

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [starredMap, setStarredMap] = useState<Record<string, boolean>>({});

  const card = id ? getCard(id) : undefined;
  const activeSong = currentSong();

  if (!card) {
    return (
      <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
        <div className="p-12 studio-panel rounded-lg text-center font-mono text-xs text-zinc-400">
          Discovery playlist not found.{' '}
          <button
            type="button"
            onClick={() => navigate('home')}
            className="text-emerald-400 underline ml-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const tracks = card.tracks || [];
  const totalSecs = tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalMins = Math.round(totalSecs / 60);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
    }
  };

  const handleEnqueueAll = () => {
    if (tracks.length > 0) {
      enqueue(tracks);
    }
  };

  const handleSavePlaylist = async () => {
    if (tracks.length === 0 || saving) return;
    setSaving(true);
    try {
      const pl = await createPlaylist(
        card.title,
        tracks.map((t) => t.id)
      );
      setSaveSuccess(true);
      await loadPlaylists();
      setTimeout(() => {
        navigate('playlist-detail', { playlistId: pl.id });
      }, 500);
    } catch (err) {
      console.error('Failed to save virtual playlist:', err);
      alert('Failed to save playlist');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSongStar = async (song: SubsonicSong) => {
    const isCurrentlyStarred =
      starredMap[song.id] !== undefined ? starredMap[song.id] : Boolean(song.starred);
    const nextState = !isCurrentlyStarred;

    setStarredMap((prev) => ({ ...prev, [song.id]: nextState }));

    try {
      if (nextState) {
        await subsonicClient.star(song.id, 'song');
      } else {
        await subsonicClient.unstar(song.id, 'song');
      }
    } catch (err) {
      console.error('Failed to toggle song star:', err);
      setStarredMap((prev) => ({ ...prev, [song.id]: isCurrentlyStarred }));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      <div className="studio-panel rounded-lg p-5 sm:p-6 flex flex-col sm:flex-row gap-6 items-start">
        <div className="w-44 h-44 sm:w-48 sm:h-48 rounded-md shrink-0 bg-zinc-950 border border-zinc-700 overflow-hidden flex items-center justify-center">
          <GenerativeThumbnail seed={card.id} size={240} className="w-full h-full object-cover select-none" />
        </div>

        <div className="flex-1 flex flex-col justify-between self-stretch gap-4 min-w-0">
          <div>
            <span className="text-xs font-mono text-emerald-400">
              Layer 3 · Discovery
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100 mt-1 truncate">
              {card.title}
            </h2>

            {card.subtitle && (
              <p className="text-xs sm:text-sm text-zinc-300 mt-1 line-clamp-2">
                {card.subtitle} — {card.description}
              </p>
            )}

            <div className="font-mono text-xs text-zinc-400 mt-1">
              {tracks.length} tracks • {totalMins} minutes
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-4 py-2 rounded-md hover:bg-emerald-300 active:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
            >
              PLAY ALL
            </button>

            <button
              type="button"
              onClick={toggleRepeat}
              className={`font-mono text-xs px-3 py-2 rounded-md border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
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
              disabled={tracks.length === 0}
              className="bg-zinc-950 text-zinc-100 border border-zinc-500 hover:bg-zinc-800 hover:border-zinc-300 font-mono text-xs px-3 py-2 rounded-md disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
            >
              ENQUEUE ALL
            </button>

            <button
              type="button"
              onClick={handleSavePlaylist}
              disabled={saving || saveSuccess || tracks.length === 0}
              className="bg-zinc-950 text-emerald-400 border border-zinc-700 hover:border-emerald-400 hover:bg-emerald-950/30 font-mono text-xs px-3 py-2 rounded-md disabled:opacity-40 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
            >
              {saveSuccess ? 'SAVED' : saving ? 'SAVING...' : 'SAVE AS PLAYLIST'}
            </button>
          </div>
        </div>
      </div>

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

        {tracks.length === 0 ? (
          <div className="p-8 text-center font-mono text-xs text-zinc-400">
            No tracks found matching this discovery criteria yet.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {tracks.map((song, idx) => {
              const isCurrent = Boolean(activeSong && song.id === activeSong.id);
              const isStarred =
                starredMap[song.id] !== undefined
                  ? starredMap[song.id]
                  : Boolean(song.starred);

              return (
                <div
                  key={`${song.id}-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(song, tracks)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      playTrack(song, tracks);
                    }
                  }}
                  className={`group flex items-center justify-between p-3.5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
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
                      className="flex items-center gap-1.5 w-20 justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleSongStar(song)}
                        className={`p-1 rounded cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
                          isStarred
                            ? 'text-emerald-400'
                            : 'text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100'
                        }`}
                        title={isStarred ? 'Unstar song' : 'Star song'}
                        aria-label={isStarred ? 'Unstar song' : 'Star song'}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${isStarred ? 'fill-emerald-400' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => enqueue(song)}
                        className="p-1 text-zinc-400 hover:text-emerald-400 font-mono text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
                        title="Add to queue"
                      >
                        +Q
                      </button>
                      <TrackContextMenu
                        song={song}
                        onStarredChange={(starred) => {
                          setStarredMap((prev) => ({ ...prev, [song.id]: starred }));
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
