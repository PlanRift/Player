import { useEffect, useState, type ReactNode } from 'react';
import {
  Search,
  Home,
  Disc3,
  Mic,
  Music,
  ListMusic,
  Star,
  Plus,
  ChevronLeft,
  ChevronRight,
  Settings,
} from 'lucide-react';
import type { SubsonicPlaylist } from '@player/shared';
import { subsonicClient } from '@player/shared';
import { useSidebarStore } from '../../stores/sidebarStore';
import { useNavigationStore, type ViewType } from '../../stores/navigationStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { getCollageDataUrl, createMonochromePlaceholderDataUrl } from '../../utils/collage';

interface NavItem {
  id: ViewType;
  label: string;
  icon: ReactNode;
  isActive: boolean;
}

function SidebarPlaylistThumb({ playlist }: { playlist: SubsonicPlaylist }) {
  const [thumbUrl, setThumbUrl] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (playlist.coverArt) {
        setThumbUrl(subsonicClient.getCoverArtUrl(playlist.coverArt, 80));
        return;
      }
      try {
        const full = await subsonicClient.getPlaylist(playlist.id);
        const covers = (full.entry || [])
          .map((s) => s.coverArt || s.id)
          .filter(Boolean)
          .slice(0, 4)
          .map((id) => subsonicClient.getCoverArtUrl(id, 80));

        const collage = await getCollageDataUrl(covers, `pl-side-${playlist.id}`, 80);
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
    <div className="w-5 h-5 rounded-xs shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden flex items-center justify-center">
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

export function Sidebar() {
  const { isCollapsed, toggleSidebar } = useSidebarStore();
  const { currentView, selectedArtist, selectedPlaylistId, navigate } = useNavigationStore();
  const { playlists, loadPlaylists, createPlaylist } = useLibraryStore();

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  const topItems: NavItem[] = [
    {
      id: 'search',
      label: 'Search',
      icon: <Search className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'search',
    },
    {
      id: 'home',
      label: 'Home',
      icon: <Home className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'home',
    },
  ];

  const libraryItems: NavItem[] = [
    {
      id: 'artists',
      label: 'Artists',
      icon: <Mic className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'artists' || (currentView === 'albums' && selectedArtist !== null),
    },
    {
      id: 'albums',
      label: 'Albums',
      icon: <Disc3 className="w-5 h-5 shrink-0" />,
      isActive:
        (currentView === 'albums' && selectedArtist === null) || currentView === 'album-detail',
    },
    {
      id: 'songs',
      label: 'Songs',
      icon: <Music className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'songs',
    },
  ];

  const playlistNavItems: NavItem[] = [
    {
      id: 'playlists',
      label: 'All Playlists',
      icon: <ListMusic className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'playlists',
    },
    {
      id: 'favourite-songs',
      label: 'Favourite Songs',
      icon: <Star className="w-5 h-5 shrink-0" />,
      isActive: currentView === 'favourite-songs',
    },
  ];

  const handleCreatePlaylist = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const renderNavButton = (item: NavItem) => (
    <button
      key={item.id}
      type="button"
      onClick={() => navigate(item.id)}
      className={`transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
        isCollapsed
          ? `p-2.5 rounded-md flex items-center justify-center ${
              item.isActive
                ? 'bg-zinc-900 text-emerald-400 border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent'
            }`
          : `px-3 py-2 rounded-md text-sm font-medium flex items-center gap-3 text-left ${
              item.isActive
                ? 'bg-zinc-900 text-emerald-400 border border-zinc-700 font-semibold'
                : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent'
            }`
      }`}
      title={isCollapsed ? item.label : undefined}
      aria-label={item.label}
    >
      {item.icon}
      {!isCollapsed && <span className="truncate">{item.label}</span>}
    </button>
  );

  return (
    <aside
      className={`border-r border-zinc-700 bg-zinc-950 flex flex-col justify-between shrink-0 select-none transition-all duration-200 ${
        isCollapsed ? 'w-16' : 'w-56'
      }`}
      aria-label="Sidebar Navigation"
    >
      <div className="flex flex-col flex-1 min-h-0">
        {/* Brand Header */}
        {!isCollapsed ? (
          <div className="h-14 border-b border-zinc-700 flex items-center justify-between px-4 shrink-0">
            <h1 className="font-bold tracking-tight text-zinc-100 text-base truncate">
              Plenrip Audio
            </h1>
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded font-mono text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 transition-colors"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="h-14 border-b border-zinc-700 flex items-center justify-center shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              className="p-2 text-emerald-400 hover:bg-zinc-800 rounded-md cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Body */}
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-3">
          {/* Top Section (Search, Home) */}
          <nav className="flex flex-col gap-1 shrink-0" aria-label="Main Navigation">
            {topItems.map(renderNavButton)}
          </nav>

          {/* Hairline Separator */}
          <div className="border-t border-zinc-800/80 my-0.5" />

          {/* Library Section (Artists, Albums, Songs) */}
          <div className="flex flex-col gap-1 shrink-0">
            {!isCollapsed && (
              <span className="font-mono text-[10px] font-semibold text-zinc-400 tracking-wider uppercase px-2 mb-1">
                Library
              </span>
            )}
            <nav className="flex flex-col gap-1" aria-label="Library Navigation">
              {libraryItems.map(renderNavButton)}
            </nav>
          </div>

          <div className="border-t border-zinc-800/80 my-0.5" />

          <div className="flex flex-col flex-1 min-h-0 gap-1">
            {!isCollapsed && (
              <div className="flex items-center justify-between px-2 mb-1 shrink-0">
                <span className="font-mono text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">
                  Playlists
                </span>
                <button
                  type="button"
                  onClick={handleCreatePlaylist}
                  className="text-[10px] font-mono font-semibold text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 px-1.5 py-0.5 rounded cursor-pointer transition-colors inline-flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                  title="Create new playlist"
                  aria-label="Create new playlist"
                >
                  <Plus className="w-3 h-3" />
                  <span>NEW</span>
                </button>
              </div>
            )}

            <nav className="flex flex-col gap-1 shrink-0" aria-label="Playlists Navigation">
              {playlistNavItems.map(renderNavButton)}
            </nav>

            {!isCollapsed && (
              <div className="flex-1 overflow-y-auto space-y-1">
                {playlists.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] font-mono text-zinc-400 text-center">
                    No custom playlists
                  </div>
                ) : (
                  playlists.map((pl) => {
                    const isActive =
                      currentView === 'playlist-detail' && selectedPlaylistId === pl.id;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => navigate('playlist-detail', { playlistId: pl.id })}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer group ${
                          isActive
                            ? 'bg-zinc-900 text-emerald-400 border border-zinc-700 font-semibold'
                            : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent'
                        }`}
                        title={pl.name}
                      >
                        <SidebarPlaylistThumb playlist={pl} />
                        <span className="truncate flex-1">{pl.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings Navigation */}
      <div className="p-2 border-t border-zinc-800 shrink-0">
        <button
          type="button"
          onClick={() => navigate('settings')}
          className={`w-full text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 ${
            isCollapsed
              ? `p-2.5 rounded-md flex items-center justify-center ${
                  currentView === 'settings'
                    ? 'bg-zinc-900 text-emerald-400 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`
              : `px-3 py-2 rounded-md text-sm font-medium flex items-center gap-3 ${
                  currentView === 'settings'
                    ? 'bg-zinc-900 text-emerald-400 border border-zinc-700 font-semibold'
                    : 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-transparent'
                }`
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5 shrink-0" />
          {!isCollapsed && <span className="truncate">Settings</span>}
        </button>
      </div>

      {/* Footer System Indicator */}
      <div className="p-3 border-t border-zinc-800 text-xs font-mono text-zinc-400 flex items-center justify-center truncate shrink-0">
        {!isCollapsed ? <span>Subsonic v1.16.1</span> : <span>v1.16</span>}
      </div>
    </aside>
  );
}
