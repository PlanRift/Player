import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import type { SubsonicPlaylist } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useLibraryStore } from '../stores/libraryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { getCollageDataUrl, createMonochromePlaceholderDataUrl } from '../utils/collage';

function PlaylistThumbnail({ playlist }: { playlist: SubsonicPlaylist }) {
  const [thumbUrl, setThumbUrl] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (playlist.coverArt) {
        setThumbUrl(subsonicClient.getCoverArtUrl(playlist.coverArt, 200));
        return;
      }

      try {
        const full = await subsonicClient.getPlaylist(playlist.id);
        const covers = (full.entry || [])
          .map((s) => s.coverArt || s.id)
          .filter(Boolean)
          .slice(0, 4)
          .map((id) => subsonicClient.getCoverArtUrl(id, 200));

        const collage = await getCollageDataUrl(covers, `pl-${playlist.id}`, 200);
        if (isMounted) setThumbUrl(collage);
      } catch {
        const fallback = createMonochromePlaceholderDataUrl();
        if (isMounted) setThumbUrl(fallback);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [playlist.id, playlist.coverArt]);

  return (
    <div className="w-16 h-16 rounded-md shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden flex items-center justify-center">
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).src = createMonochromePlaceholderDataUrl();
          }}
        />
      ) : (
        <div className="w-full h-full bg-zinc-900 animate-pulse" />
      )}
    </div>
  );
}

export function PlaylistsView() {
  const { playlists, isLoadingPlaylists, loadPlaylists, createPlaylist } = useLibraryStore();
  const { navigate } = useNavigationStore();

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const handleCreate = async () => {
    const name = window.prompt('Playlist name:');
    if (name?.trim()) {
      try {
        const pl = await createPlaylist(name.trim());
        navigate('playlist-detail', { playlistId: pl.id });
      } catch (err) {
        console.error('Failed to create playlist:', err);
      }
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      {/* View Header */}
      <div className="flex items-center justify-between border-b border-zinc-700 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Playlists</h2>
          <span className="font-mono text-xs text-zinc-400">
            {playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          className="bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-3.5 py-2 rounded-md hover:bg-emerald-300 active:bg-emerald-500 cursor-pointer transition-colors inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>CREATE PLAYLIST</span>
        </button>
      </div>

      {isLoadingPlaylists && playlists.length === 0 ? (
        <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
          Loading playlists...
        </div>
      ) : playlists.length === 0 ? (
        <div className="studio-panel rounded-lg p-12 text-center flex flex-col items-center justify-center gap-3">
          <p className="font-mono text-xs text-zinc-400">
            No playlists found in your library.
          </p>
          <button
            type="button"
            onClick={handleCreate}
            className="bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-3.5 py-1.5 rounded-md hover:bg-emerald-300 cursor-pointer transition-colors"
          >
            Create Your First Playlist
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {playlists.map((pl) => (
            <div
              key={pl.id}
              onClick={() => navigate('playlist-detail', { playlistId: pl.id })}
              className="studio-panel rounded-lg p-4 flex items-center gap-4 hover:border-zinc-500 hover:bg-zinc-900/80 cursor-pointer transition-colors group"
            >
              <PlaylistThumbnail playlist={pl} />

              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-mono text-emerald-400 uppercase tracking-wider block">
                  Playlist
                </span>
                <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-emerald-400 truncate mt-0.5 transition-colors">
                  {pl.name}
                </h3>
                <div className="font-mono text-xs text-zinc-400 mt-1 flex items-center gap-2">
                  <span>{pl.songCount || 0} tracks</span>
                  {pl.duration ? <span>• {Math.round(pl.duration / 60)}m</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
