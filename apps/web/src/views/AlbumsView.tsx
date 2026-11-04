import { useEffect, useState } from 'react';
import type { SubsonicAlbum } from '@player/shared';
import { useNavigationStore } from '../stores/navigationStore';
import { useLibraryStore } from '../stores/libraryStore';
import { subsonicClient } from '@player/shared';
import { CoverImage } from '../components/common/CoverImage';

export function AlbumsView() {
  const { selectedArtist, navigate } = useNavigationStore();
  const { loadArtistAlbums } = useLibraryStore();

  const [albums, setAlbums] = useState<SubsonicAlbum[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    if (selectedArtist) {
      loadArtistAlbums(selectedArtist).then((data) => {
        if (isMounted) {
          setAlbums(data);
          setIsLoading(false);
        }
      });
    } else {
      subsonicClient
        .getAlbumList2('newest', 100)
        .then((data) => {
          if (isMounted) {
            setAlbums(data);
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) setIsLoading(false);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [selectedArtist, loadArtistAlbums]);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      {/* Artist Discography Banner if filtered by artist */}
      {selectedArtist && (
        <div className="studio-panel rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-zinc-950 rounded-md border border-zinc-700 shrink-0 overflow-hidden">
            <CoverImage
              coverId={selectedArtist.coverArt || selectedArtist.id}
              alt={selectedArtist.name}
              size={120}
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="text-xs font-mono text-emerald-400">
              Layer 2 · Artist Discography
            </span>
            <h2 className="text-xl font-bold text-zinc-100 truncate mt-0.5">
              {selectedArtist.name}
            </h2>
            <p className="text-xs font-mono text-zinc-400 mt-1">
              {albums.length} {albums.length === 1 ? 'release' : 'releases'} available
            </p>
          </div>
        </div>
      )}

      {/* Heading */}
      <div className="flex items-baseline justify-between border-b border-zinc-700 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
            {selectedArtist ? 'Releases' : 'All Albums'}
          </h2>
          <span className="font-mono text-xs text-zinc-400">
            {albums.length} {albums.length === 1 ? 'album' : 'albums'}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
          Loading albums...
        </div>
      ) : albums.length === 0 ? (
        <div className="p-12 studio-panel rounded-lg text-center font-mono text-xs text-zinc-400">
          No albums found.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              onClick={() =>
                navigate('album-detail', {
                  albumId: album.id,
                  artist: selectedArtist,
                })
              }
              className="group cursor-pointer flex flex-col gap-2 p-2.5 studio-panel rounded-lg hover:border-zinc-500 hover:bg-zinc-800 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
            >
              <div className="relative aspect-square w-full bg-zinc-950 rounded-md border border-zinc-700 overflow-hidden">
                <CoverImage
                  coverId={album.coverArt || album.id}
                  alt={album.name}
                  size={240}
                />
                {album.isVirtualSingles && (
                  <span className="absolute top-2 left-2 text-xs font-mono px-2 py-0.5 rounded bg-emerald-400 text-zinc-950 font-semibold shadow">
                    Singles
                  </span>
                )}
              </div>

              <div className="truncate w-full">
                <div className="text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
                  {album.name}
                </div>
                <div className="text-xs text-zinc-400 truncate mt-0.5">
                  {album.artist || selectedArtist?.name || 'Unknown'}
                </div>
                <div className="text-xs font-mono text-zinc-500 mt-1 flex items-center gap-1.5">
                  {album.year && <span>{album.year}</span>}
                  {album.year && album.songCount && <span>•</span>}
                  {album.songCount && (
                    <span>
                      {album.songCount} {album.songCount === 1 ? 'track' : 'tracks'}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
