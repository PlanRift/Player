import { useEffect } from 'react';
import { useLibraryStore } from '../stores/libraryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { CoverImage } from '../components/common/CoverImage';

export function ArtistsView() {
  const { artists, isLoadingArtists, loadArtists } = useLibraryStore();
  const { navigate } = useNavigationStore();

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-6">
      <div className="flex items-baseline justify-between border-b border-zinc-700 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
            Artists
          </h2>
          <span className="font-mono text-xs text-zinc-400">
            {artists.length} {artists.length === 1 ? 'artist' : 'artists'}
          </span>
        </div>
      </div>

      {isLoadingArtists ? (
        <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
          Loading artists from library...
        </div>
      ) : artists.length === 0 ? (
        <div className="p-12 studio-panel rounded-lg text-center font-mono text-xs text-zinc-400">
          No artists found in library.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {artists.map((artist) => (
            <button
              key={artist.id}
              type="button"
              onClick={() => navigate('albums', { artist })}
              className="group cursor-pointer flex flex-col gap-2 p-2.5 studio-panel rounded-lg hover:border-zinc-500 hover:bg-zinc-800 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
            >
              <div className="aspect-square w-full bg-zinc-950 rounded-md border border-zinc-700 overflow-hidden">
                <CoverImage
                  coverId={artist.coverArt || artist.id}
                  alt={artist.name}
                  size={240}
                />
              </div>

              <div className="truncate w-full">
                <div className="text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
                  {artist.name}
                </div>
                <div className="text-xs font-mono text-zinc-400 mt-0.5 truncate">
                  {artist.albumCount
                    ? `${artist.albumCount} ${artist.albumCount === 1 ? 'release' : 'releases'}`
                    : 'Open discography'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
