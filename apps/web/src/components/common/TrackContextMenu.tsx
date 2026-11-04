import { useState, useRef, useEffect } from 'react';
import {
  MoreVertical,
  ListPlus,
  PlayCircle,
  Plus,
  Disc3,
  User,
  Check,
  Star,
  Trash2,
} from 'lucide-react';
import type { SubsonicSong } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { usePlaybackStore } from '../../stores/playbackStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';

interface TrackContextMenuProps {
  song: SubsonicSong;
  className?: string;
  isQueueContext?: boolean;
  onRemoveFromQueue?: () => void;
  onStarredChange?: (isStarred: boolean) => void;
}

export function TrackContextMenu({
  song,
  className = '',
  isQueueContext = false,
  onRemoveFromQueue,
  onStarredChange,
}: TrackContextMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showPlaylists, setShowPlaylists] = useState(false);
  const [addedPlaylistId, setAddedPlaylistId] = useState<string | null>(null);
  const [isStarred, setIsStarred] = useState(Boolean(song.starred));

  const menuRef = useRef<HTMLDivElement | null>(null);

  const { enqueue, enqueueNext } = usePlaybackStore();
  const { playlists, loadPlaylists, createPlaylist } = useLibraryStore();
  const { navigate } = useNavigationStore();

  useEffect(() => {
    setIsStarred(Boolean(song.starred));
  }, [song.starred]);

  useEffect(() => {
    if (!isOpen) {
      setShowPlaylists(false);
      setAddedPlaylistId(null);
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOpen) {
      loadPlaylists();
    }
    setIsOpen(!isOpen);
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    enqueueNext(song);
    setIsOpen(false);
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    enqueue(song);
    setIsOpen(false);
  };

  const handleAddToPlaylist = async (e: React.MouseEvent, playlistId: string) => {
    e.stopPropagation();
    try {
      await subsonicClient.updatePlaylist(playlistId, [song.id], []);
      setAddedPlaylistId(playlistId);
      setTimeout(() => {
        setIsOpen(false);
      }, 600);
    } catch (err) {
      console.error('Failed to add track to playlist:', err);
    }
  };

  const handleCreateAndAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = window.prompt('New playlist name:');
    if (name?.trim()) {
      try {
        const created = await createPlaylist(name.trim(), [song.id]);
        setAddedPlaylistId(created.id);
        setTimeout(() => {
          setIsOpen(false);
        }, 600);
      } catch (err) {
        console.error('Failed to create playlist with song:', err);
      }
    }
  };

  const handleGoToAlbum = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (song.albumId) {
      navigate('album-detail', { albumId: song.albumId });
      setIsOpen(false);
    }
  };

  const handleGoToArtist = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (song.artistId || song.artist) {
      navigate('albums', {
        artist: {
          id: song.artistId || `artist-${song.artist}`,
          name: song.artist || 'Unknown Artist',
        },
      });
      setIsOpen(false);
    }
  };

  const handleToggleStar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStarred = !isStarred;
    try {
      if (isStarred) {
        await subsonicClient.unstar(song.id, 'song');
      } else {
        await subsonicClient.star(song.id, 'song');
      }
      setIsStarred(nextStarred);
      onStarredChange?.(nextStarred);
    } catch (err) {
      console.error('Failed to star/unstar track:', err);
    }
  };

  const handleRemoveFromQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemoveFromQueue?.();
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block ${className}`} ref={menuRef}>
      <button
        type="button"
        onClick={handleToggle}
        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
        title="More options"
        aria-label="More options"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-52 rounded-md border border-zinc-700 bg-zinc-900 shadow-2xl py-1 z-50 text-xs font-sans text-zinc-200 select-none animate-in fade-in zoom-in-95 duration-100"
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Play Next */}
          <button
            type="button"
            onClick={handlePlayNext}
            className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors"
            role="menuitem"
          >
            <PlayCircle className="w-4 h-4 shrink-0 text-zinc-400" />
            <span>Play Next</span>
          </button>

          {/* Add to Queue */}
          <button
            type="button"
            onClick={handleAddToQueue}
            className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors"
            role="menuitem"
          >
            <ListPlus className="w-4 h-4 shrink-0 text-zinc-400" />
            <span>Add to Queue</span>
          </button>

          {/* Star / Unstar Track */}
          <button
            type="button"
            onClick={handleToggleStar}
            className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors"
            role="menuitem"
          >
            <Star
              className={`w-4 h-4 shrink-0 ${
                isStarred ? 'fill-emerald-400 text-emerald-400' : 'text-zinc-400'
              }`}
            />
            <span>{isStarred ? 'Unstar Track' : 'Star Track'}</span>
          </button>

          {/* Remove from Queue (when in queue context) */}
          {isQueueContext && onRemoveFromQueue && (
            <button
              type="button"
              onClick={handleRemoveFromQueue}
              className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-red-400 text-zinc-300 flex items-center gap-2 cursor-pointer transition-colors"
              role="menuitem"
            >
              <Trash2 className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>Remove from Queue</span>
            </button>
          )}

          {/* Add to Playlist (Submenu toggle) */}
          <div className="border-t border-zinc-800 my-1" />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowPlaylists(!showPlaylists);
            }}
            className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center justify-between cursor-pointer transition-colors"
            role="menuitem"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 shrink-0 text-zinc-400" />
              <span>Add to Playlist</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-400">
              {showPlaylists ? '▲' : '▶'}
            </span>
          </button>

          {showPlaylists && (
            <div className="bg-zinc-950/80 border-y border-zinc-800 max-h-40 overflow-y-auto divide-y divide-zinc-800/60">
              <button
                type="button"
                onClick={handleCreateAndAdd}
                className="w-full text-left px-4 py-1.5 hover:bg-zinc-800 text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors font-medium text-[11px]"
              >
                <Plus className="w-3 h-3 shrink-0" />
                <span>+ New Playlist</span>
              </button>

              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={(e) => handleAddToPlaylist(e, pl.id)}
                  className="w-full text-left px-4 py-1.5 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 flex items-center justify-between cursor-pointer transition-colors text-[11px]"
                >
                  <span className="truncate">{pl.name}</span>
                  {addedPlaylistId === pl.id && (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Navigation Links */}
          {(song.albumId || song.artist) && (
            <>
              <div className="border-t border-zinc-800 my-1" />
              {song.albumId && (
                <button
                  type="button"
                  onClick={handleGoToAlbum}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors"
                  role="menuitem"
                >
                  <Disc3 className="w-4 h-4 shrink-0 text-zinc-400" />
                  <span>Go to Album</span>
                </button>
              )}
              {song.artist && (
                <button
                  type="button"
                  onClick={handleGoToArtist}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 hover:text-emerald-400 flex items-center gap-2 cursor-pointer transition-colors"
                  role="menuitem"
                >
                  <User className="w-4 h-4 shrink-0 text-zinc-400" />
                  <span>Go to Artist</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
