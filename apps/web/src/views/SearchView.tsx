import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Disc3, Mic, Music } from 'lucide-react';
import type { SubsonicSong, SubsonicAlbum, SubsonicArtist } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useNavigationStore } from '../stores/navigationStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { CoverImage } from '../components/common/CoverImage';
import { TrackContextMenu } from '../components/common/TrackContextMenu';

type FlattenedResult =
  | { type: 'artist'; item: SubsonicArtist }
  | { type: 'album'; item: SubsonicAlbum }
  | { type: 'song'; item: SubsonicSong };

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SearchView() {
  const { navigate, goBack } = useNavigationStore();
  const { playTrack } = usePlaybackStore();

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [artists, setArtists] = useState<SubsonicArtist[]>([]);
  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [songs, setSongs] = useState<SubsonicSong[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus input on view mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 250ms debounce against Subsonic search3
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setArtists([]);
      setAlbums([]);
      setSongs([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await subsonicClient.search3(trimmed, {
          artistCount: 8,
          albumCount: 8,
          songCount: 20,
        });
        setArtists(res.artist || []);
        setAlbums(res.album || []);
        setSongs(res.song || []);
        setSelectedIndex(0);
      } catch (err) {
        console.warn('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  // Flattened items for keyboard navigation
  const flatItems: FlattenedResult[] = useMemo(() => {
    const list: FlattenedResult[] = [];
    for (const a of artists) list.push({ type: 'artist', item: a });
    for (const al of albums) list.push({ type: 'album', item: al });
    for (const s of songs) list.push({ type: 'song', item: s });
    return list;
  }, [artists, albums, songs]);

  const handleSelect = (result: FlattenedResult) => {
    if (result.type === 'artist') {
      navigate('albums', { artist: result.item });
    } else if (result.type === 'album') {
      navigate('album-detail', { albumId: result.item.id });
    } else if (result.type === 'song') {
      playTrack(result.item, songs);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      goBack();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < flatItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : flatItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems[selectedIndex]) {
        handleSelect(flatItems[selectedIndex]);
      }
    }
  };

  let currentFlatIdx = -1;

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6" onKeyDown={handleKeyDown}>
      {/* Search Header Bar */}
      <div className="relative">
        <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-700 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400 rounded-lg px-4 py-3 shadow-md transition-colors">
          <Search className="w-5 h-5 text-emerald-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artists, albums, tracks... (↑↓ to select, Enter to choose, Esc to exit)"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            aria-label="Search library query"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-block text-[11px] font-mono text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-700 shrink-0">
            ESC
          </kbd>
        </div>
      </div>

      {/* Live Status / Result Info */}
      <div className="flex items-center justify-between text-xs font-mono text-zinc-500 px-1">
        <span>
          {isSearching
            ? 'Searching library...'
            : query.trim()
              ? `Found ${flatItems.length} results (${artists.length} artists, ${albums.length} albums, ${songs.length} tracks)`
              : 'Type keywords above to search your local library'}
        </span>
        <span className="hidden sm:inline">↑↓ to navigate · Enter to select · Esc to return</span>
      </div>

      {/* Results View */}
      {query.trim() && flatItems.length === 0 && !isSearching && (
        <div className="text-center py-16 font-mono text-xs text-zinc-500 border border-zinc-800 rounded-lg bg-zinc-900/40">
          No matches found for &quot;{query}&quot;
        </div>
      )}

      {/* Grouped Results */}
      {flatItems.length > 0 && (
        <div className="space-y-8">
          {/* Artists Section */}
          {artists.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-mono text-xs font-semibold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
                <span>Artists ({artists.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {artists.map((artist) => {
                  currentFlatIdx++;
                  const isSelected = selectedIndex === currentFlatIdx;
                  return (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => handleSelect({ type: 'artist', item: artist })}
                      className={`text-left p-3 rounded-lg border transition-all cursor-pointer flex flex-col items-center gap-2 group ${
                        isSelected
                          ? 'border-emerald-400 bg-zinc-800'
                          : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="w-16 h-16 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0">
                        {artist.artistImageUrl ? (
                          <img
                            src={artist.artistImageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Mic className="w-7 h-7 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                        )}
                      </div>
                      <span className="text-xs font-medium text-zinc-200 group-hover:text-zinc-100 text-center truncate w-full">
                        {artist.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Albums Section */}
          {albums.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-mono text-xs font-semibold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
                <Disc3 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Albums ({albums.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {albums.map((album) => {
                  currentFlatIdx++;
                  const isSelected = selectedIndex === currentFlatIdx;
                  return (
                    <button
                      key={album.id}
                      type="button"
                      onClick={() => handleSelect({ type: 'album', item: album })}
                      className={`text-left p-2.5 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 group ${
                        isSelected
                          ? 'border-emerald-400 bg-zinc-800'
                          : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="aspect-square w-full rounded-md bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0">
                        <CoverImage
                          coverId={album.coverArt || album.id}
                          alt={album.name}
                          size={200}
                        />
                      </div>
                      <div className="min-w-0 w-full">
                        <div className="text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
                          {album.name}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          {album.artist || 'Unknown'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Tracks Section */}
          {songs.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-mono text-xs font-semibold text-zinc-400 tracking-wider uppercase flex items-center gap-2">
                <Music className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tracks ({songs.length})</span>
              </h3>
              <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg bg-zinc-900/60 overflow-hidden">
                {songs.map((song) => {
                  currentFlatIdx++;
                  const isSelected = selectedIndex === currentFlatIdx;
                  return (
                    <div
                      key={song.id}
                      onClick={() => handleSelect({ type: 'song', item: song })}
                      className={`flex items-center justify-between p-3 cursor-pointer transition-colors group ${
                        isSelected
                          ? 'bg-zinc-800 border-l-2 border-emerald-400'
                          : 'hover:bg-zinc-800/60 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-4">
                        <div className="w-10 h-10 rounded shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden">
                          <CoverImage
                            coverId={song.coverArt || song.id}
                            songId={song.id}
                            alt=""
                            size={80}
                          />
                        </div>
                        <div className="min-w-0">
                          <div
                            className={`text-sm truncate font-medium ${
                              isSelected ? 'text-emerald-400' : 'text-zinc-100'
                            }`}
                          >
                            {song.title}
                          </div>
                          <div className="text-xs text-zinc-400 truncate">
                            {song.artist || 'Unknown'} {song.album ? `• ${song.album}` : ''}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono text-xs text-zinc-400">
                          {formatDuration(song.duration || 0)}
                        </span>
                        <div
                          className="flex items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <TrackContextMenu song={song} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
