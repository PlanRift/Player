import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import type { SubsonicAlbum } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useLibraryStore } from '../stores/libraryStore';
import { useNavigationStore } from '../stores/navigationStore';
import { usePlaybackStore } from '../stores/playbackStore';
import { useDiscoveryStore } from '../stores/discoveryStore';
import { CoverImage } from '../components/common/CoverImage';
import { GenerativeThumbnail } from '../components/common/GenerativeThumbnail';

export function HomeView() {
  const { recentAlbums, isLoadingRecent, loadRecentlyAdded } = useLibraryStore();
  const { navigate } = useNavigationStore();
  const { playTrack } = usePlaybackStore();
  const { cards: discoveryCards, isLoading: isLoadingDiscovery, loadCards } = useDiscoveryStore();

  useEffect(() => {
    loadRecentlyAdded();
    loadCards();
  }, [loadRecentlyAdded, loadCards]);

  const handleQuickPlay = async (e: React.MouseEvent, album: SubsonicAlbum) => {
    e.stopPropagation();
    try {
      const full = await subsonicClient.getAlbum(album.id);
      if (full.song && full.song.length > 0) {
        playTrack(full.song[0], full.song);
      }
    } catch (err) {
      console.error('Quick play failed', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-8">
      {/* Page Title */}
      <div className="flex flex-col gap-1 border-b border-zinc-700 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
          Library
        </h2>
        <p className="font-mono text-xs text-zinc-400">
          Personal Music Collection
        </p>
      </div>

      {/* Discovery Section (Phase D / E) */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
          <h3 className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Discovery</span>
          </h3>
        </div>

        {isLoadingDiscovery ? (
          <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
            Generating discovery playlists...
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {discoveryCards.map((card) => {
              const hasTracks = card.tracks && card.tracks.length > 0;

              return (
                <div
                  key={card.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate('discovery-detail', { discoveryCardId: card.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      navigate('discovery-detail', { discoveryCardId: card.id });
                    }
                  }}
                  className="group flex flex-col gap-2 p-2.5 studio-panel rounded-lg hover:border-zinc-500 hover:bg-zinc-800 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                  aria-label={`Open ${card.title} discovery playlist`}
                >
                  <div className="relative aspect-square w-full bg-zinc-950 rounded-md border border-zinc-700 overflow-hidden">
                    <GenerativeThumbnail seed={card.id} size={240} />
                    {hasTracks && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playTrack(card.tracks[0], card.tracks);
                        }}
                        className="absolute bottom-2 right-2 bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-2.5 py-1 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-emerald-300 active:bg-emerald-500"
                        title={`Play ${card.title}`}
                      >
                        PLAY
                      </button>
                    )}
                  </div>

                  <div className="truncate">
                    <div className="text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
                      {card.title}
                    </div>
                    <div className="text-xs text-zinc-400 truncate mt-0.5">
                      {card.subtitle}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recently Added Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between border-b border-zinc-700 pb-2">
          <h3 className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wider">
            Recently Added
          </h3>
          <button
            type="button"
            onClick={() => navigate('albums')}
            className="font-mono text-xs text-zinc-400 hover:text-emerald-400 cursor-pointer transition-colors"
          >
            VIEW ALL →
          </button>
        </div>

        {isLoadingRecent ? (
          <div className="p-12 text-center font-mono text-xs text-zinc-400 animate-pulse">
            Loading recently added releases...
          </div>
        ) : recentAlbums.length === 0 ? (
          <div className="p-12 studio-panel rounded-lg text-center font-mono text-xs text-zinc-400">
            No albums found in library.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {recentAlbums.map((album) => (
              <div
                key={album.id}
                onClick={() => navigate('album-detail', { albumId: album.id })}
                className="group cursor-pointer flex flex-col gap-2 p-2.5 studio-panel rounded-lg hover:border-zinc-500 hover:bg-zinc-800 transition-colors"
              >
                <div className="relative aspect-square w-full bg-zinc-950 rounded-md border border-zinc-700 overflow-hidden">
                  <CoverImage
                    coverId={album.coverArt || album.id}
                    alt={album.name}
                    size={240}
                  />
                  <button
                    type="button"
                    onClick={(e) => handleQuickPlay(e, album)}
                    className="absolute bottom-2 right-2 bg-emerald-400 text-zinc-950 font-semibold font-mono text-xs px-2.5 py-1 rounded shadow opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:bg-emerald-300 active:bg-emerald-500"
                    title="Play album"
                  >
                    PLAY
                  </button>
                </div>

                <div className="truncate">
                  <div className="text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-400 transition-colors">
                    {album.name}
                  </div>
                  <div className="text-xs text-zinc-400 truncate mt-0.5">
                    {album.artist || 'Unknown'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
