import { useEffect, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { StatusCard } from './components/layout/StatusCard';
import { BottomPlayerBar } from './components/player/BottomPlayerBar';
import { QueueDrawer } from './components/queue/QueueDrawer';

import { useNavigationStore } from './stores/navigationStore';
import { usePlaybackStore } from './stores/playbackStore';
import { useConnectionStore } from './stores/connectionStore';
import { audioEngine } from './audio/audioEngine';
import { playbackTracker } from './audio/playbackTracker';
import { scrobbleTracker } from './audio/scrobbleTracker';
import { useLastFmStore } from './stores/lastFmStore';

import { HomeView } from './views/HomeView';
import { SearchView } from './views/SearchView';
import { ArtistsView } from './views/ArtistsView';
import { AlbumsView } from './views/AlbumsView';
import { SongsView } from './views/SongsView';
import { AlbumDetailView } from './views/AlbumDetailView';
import { PlaylistsView } from './views/PlaylistsView';
import { FavouriteSongsView } from './views/FavouriteSongsView';
import { PlaylistDetailView } from './views/PlaylistDetailView';
import { DiscoveryDetailView } from './views/DiscoveryDetailView';
import { SettingsView } from './views/SettingsView';
import { SignatureView } from './components/signature/SignatureView';
import { CheatSheetOverlay } from './components/modals/CheatSheetOverlay';

export default function App() {
  const {
    currentView,
    selectedAlbumId,
    selectedPlaylistId,
    selectedDiscoveryCardId,
    navigate,
    goBack,
    getBreadcrumbs,
  } = useNavigationStore();
  const {
    togglePlay,
    next,
    previous,
    currentTime,
    duration,
    toggleShuffle,
    toggleRepeat,
    toggleQueue,
    isQueueOpen,
    toggleSignatureView,
    isSignatureOpen,
    setSignatureOpen,
  } = usePlaybackStore();
  const { checkConnection } = useConnectionStore();
  const [isCheatSheetOpen, setIsCheatSheetOpen] = useState(false);

  const { canGoBack } = getBreadcrumbs();

  useEffect(() => {
    const unsubAudio = audioEngine.syncWithStore();
    const unsubTracker = playbackTracker.init();
    const unsubScrobble = scrobbleTracker.init();
    checkConnection();

    // Check for Last.fm OAuth callback token
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        useLastFmStore
          .getState()
          .handleCallbackToken(token)
          .then((success) => {
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, document.title, cleanUrl);
            if (success) {
              navigate('settings');
            }
          });
      }
    }

    return () => {
      unsubAudio();
      unsubTracker();
      unsubScrobble();
    };
  }, [checkConnection, navigate]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement;

      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('search');
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        navigate('search');
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setIsCheatSheetOpen((prev) => !prev);
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === ']' || e.key === 'n') {
        e.preventDefault();
        next();
      } else if (e.key === '[' || e.key === 'p') {
        e.preventDefault();
        previous();
      } else if (e.key === 's') {
        e.preventDefault();
        toggleShuffle();
      } else if (e.key === 'r') {
        e.preventDefault();
        toggleRepeat();
      } else if (e.key === 'q') {
        e.preventDefault();
        toggleQueue();
      } else if (e.key === 'u') {
        e.preventDefault();
        toggleSignatureView();
      } else if (e.key === 'Escape') {
        if (isCheatSheetOpen) {
          e.preventDefault();
          setIsCheatSheetOpen(false);
        } else if (isSignatureOpen) {
          e.preventDefault();
          setSignatureOpen(false);
        } else if (isQueueOpen) {
          e.preventDefault();
          toggleQueue();
        } else if (canGoBack) {
          e.preventDefault();
          goBack();
        }
      } else if (e.key === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        audioEngine.seek(Math.min(duration, currentTime + 10));
      } else if (e.key === 'j' || e.key === 'ArrowLeft') {
        e.preventDefault();
        audioEngine.seek(Math.max(0, currentTime - 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    togglePlay,
    next,
    previous,
    currentTime,
    duration,
    toggleShuffle,
    toggleRepeat,
    toggleQueue,
    isQueueOpen,
    toggleSignatureView,
    isSignatureOpen,
    setSignatureOpen,
    isCheatSheetOpen,
    canGoBack,
    goBack,
    navigate,
  ]);

  const renderActiveView = () => {
    switch (currentView) {
      case 'home':
        return <HomeView />;
      case 'search':
        return <SearchView />;
      case 'artists':
        return <ArtistsView />;
      case 'albums':
        return <AlbumsView />;
      case 'songs':
        return <SongsView />;
      case 'album-detail':
        return <AlbumDetailView id={selectedAlbumId} />;
      case 'playlists':
        return <PlaylistsView />;
      case 'favourite-songs':
        return <FavouriteSongsView />;
      case 'playlist-detail':
        return <PlaylistDetailView id={selectedPlaylistId} />;
      case 'discovery-detail':
        return <DiscoveryDetailView id={selectedDiscoveryCardId} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100 selection:bg-emerald-400 selection:text-zinc-950 select-none">
      {/* Collapsible Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-0 relative">
          <div className="pb-24">
            <StatusCard />
            {renderActiveView()}
          </div>
        </main>

        {/* Bottom Seekable Player Bar */}
        <BottomPlayerBar />
      </div>

      {/* Slide-out Queue Drawer */}
      <QueueDrawer />

      {/* Fullscreen Ambient Signature View */}
      <SignatureView />

      {/* Keyboard Shortcuts Cheat Sheet Overlay */}
      <CheatSheetOverlay
        isOpen={isCheatSheetOpen}
        onClose={() => setIsCheatSheetOpen(false)}
      />
    </div>
  );
}
