import { useState, useEffect } from 'react';
import { X, Search, RotateCw, Music } from 'lucide-react';
import type { SubsonicSong } from '@player/shared';
import {
  ALL_LYRICS_PROVIDERS,
  probeProvider,
  searchLrclibManual,
  getTrackProviderOverride,
  setTrackProviderOverride,
  cacheTrackLyrics,
  type LyricsResult,
} from '@player/shared';

interface LyricsSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: SubsonicSong;
  activeProviderId: string;
  onProviderChange: (providerId: string) => void;
  onApplyLyrics: (result: LyricsResult) => void;
}

interface ProviderProbeState {
  status: 'idle' | 'checking' | 'found' | 'not_found' | 'unreachable';
  error?: string;
  result?: LyricsResult;
}

export function LyricsSourceModal({
  isOpen,
  onClose,
  song,
  activeProviderId,
  onProviderChange,
  onApplyLyrics,
}: LyricsSourceModalProps) {
  const [probeStates, setProbeStates] = useState<Record<string, ProviderProbeState>>({});
  const [searchTrack, setSearchTrack] = useState(song.title);
  const [searchArtist, setSearchArtist] = useState(song.artist || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{
      id: number;
      trackName: string;
      artistName: string;
      albumName?: string;
      duration?: number;
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    }>
  >([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const currentOverride = getTrackProviderOverride(song.id);

  // Probe all providers when modal is opened
  useEffect(() => {
    if (!isOpen) return;

    setSearchTrack(song.title);
    setSearchArtist(song.artist || '');
    setSearchResults([]);
    setSearchError(null);

    const initialStates: Record<string, ProviderProbeState> = {};
    ALL_LYRICS_PROVIDERS.forEach((p) => {
      initialStates[p.id] = { status: 'checking' };
    });
    setProbeStates(initialStates);

    const req = {
      track: song.title,
      artist: song.artist || '',
      album: song.album || '',
      duration: song.duration || 0,
    };

    ALL_LYRICS_PROVIDERS.forEach(async (provider) => {
      const probe = await probeProvider(provider, req);
      setProbeStates((prev) => ({
        ...prev,
        [provider.id]: {
          status: probe.status,
          error: probe.error,
          result: probe.result,
        },
      }));
    });
  }, [isOpen, song.id, song.title, song.artist, song.album, song.duration]);

  const handleRetryProvider = async (providerId: string) => {
    const provider = ALL_LYRICS_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return;

    setProbeStates((prev) => ({
      ...prev,
      [providerId]: { status: 'checking' },
    }));

    const req = {
      track: song.title,
      artist: song.artist || '',
      album: song.album || '',
      duration: song.duration || 0,
    };

    const probe = await probeProvider(provider, req);
    setProbeStates((prev) => ({
      ...prev,
      [providerId]: {
        status: probe.status,
        error: probe.error,
        result: probe.result,
      },
    }));
  };

  const handleSelectProvider = (providerId: string) => {
    setTrackProviderOverride(song.id, providerId === 'auto' ? null : providerId);
    onProviderChange(providerId);
  };

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTrack.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    try {
      const results = await searchLrclibManual(searchTrack.trim(), searchArtist.trim());
      setSearchResults(results);
      if (results.length === 0) {
        setSearchError('No matching lyrics found on LRCLIB');
      }
    } catch (err) {
      setSearchError((err as Error).message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleApplySearchResult = (res: {
    syncedLyrics?: string | null;
    plainLyrics?: string | null;
  }) => {
    const result: LyricsResult = {
      syncedLyrics: res.syncedLyrics || null,
      plainLyrics: res.plainLyrics || null,
      providerId: 'lrclib',
    };
    cacheTrackLyrics(song.id, 'lrclib', result);
    cacheTrackLyrics(song.id, 'auto', result);
    onApplyLyrics(result);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sumber Lirik (Lyrics Source)"
    >
      <div
        className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-14 border-b border-zinc-700 px-6 flex items-center justify-between bg-zinc-950 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Music className="w-4 h-4 text-emerald-400" />
              <span>Sumber Lirik</span>
            </h2>
            <p className="text-xs text-zinc-400 truncate max-w-md">
              {song.title} — {song.artist || 'Unknown Artist'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Section 1: Provider Selection with Live Status Badges */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Pilih Penyedia Lirik
              </h3>
              {currentOverride && (
                <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                  Per-track override aktif
                </span>
              )}
            </div>

            <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-md bg-zinc-950/60 overflow-hidden">
              {/* "Otomatis" Priority Option */}
              <label
                className={`flex items-center justify-between p-3 cursor-pointer transition-colors hover:bg-zinc-800/40 ${
                  activeProviderId === 'auto' ? 'bg-zinc-800/60 border-l-2 border-emerald-400' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="lyricsProvider"
                    value="auto"
                    checked={activeProviderId === 'auto'}
                    onChange={() => handleSelectProvider('auto')}
                    className="accent-emerald-400 cursor-pointer"
                  />
                  <div>
                    <div className="text-xs font-medium text-zinc-100">
                      Otomatis (Rekomendasi)
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      Coba LRCLIB lalu fallback ke penyedia berikutnya
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[10px] text-zinc-400 border border-zinc-700 bg-zinc-900 px-2 py-0.5 rounded">
                  PRIORITAS
                </span>
              </label>

              {/* Provider List */}
              {ALL_LYRICS_PROVIDERS.map((p) => {
                const state = probeStates[p.id] || { status: 'idle' };
                const isSelected = activeProviderId === p.id;

                return (
                  <label
                    key={p.id}
                    className={`flex items-center justify-between p-3 cursor-pointer transition-colors hover:bg-zinc-800/40 ${
                      isSelected ? 'bg-zinc-800/60 border-l-2 border-emerald-400' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="lyricsProvider"
                        value={p.id}
                        checked={isSelected}
                        onChange={() => handleSelectProvider(p.id)}
                        className="accent-emerald-400 cursor-pointer"
                      />
                      <div>
                        <div className="text-xs font-medium text-zinc-100 flex items-center gap-2">
                          <span>{p.name}</span>
                          <span className="text-[10px] font-mono text-zinc-500">
                            [{p.bestKind}]
                          </span>
                        </div>
                        {p.id !== 'lrclib' && (
                          <div className="text-[10px] text-zinc-500">
                            Browser-direct CORS terbatas
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {state.status === 'checking' && (
                        <span className="font-mono text-[10px] text-zinc-400 animate-pulse">
                          checking...
                        </span>
                      )}
                      {state.status === 'found' && (
                        <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                          found
                        </span>
                      )}
                      {state.status === 'not_found' && (
                        <span className="font-mono text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">
                          not found
                        </span>
                      )}
                      {state.status === 'unreachable' && (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="font-mono text-[10px] text-red-400 bg-red-950/60 border border-red-800 px-2 py-0.5 rounded"
                            title={state.error}
                          >
                            unreachable
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRetryProvider(p.id);
                            }}
                            className="p-1 text-zinc-400 hover:text-zinc-100 cursor-pointer"
                            title="Retry provider"
                            aria-label={`Retry ${p.name}`}
                          >
                            <RotateCw className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Section 2: Manual Search at the Bottom (LRCLIB) */}
          <div className="space-y-3 pt-4 border-t border-zinc-800">
            <h3 className="font-mono text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Pencarian Manual (LRCLIB)
            </h3>

            <form onSubmit={handleManualSearch} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    Judul Lagu
                  </label>
                  <input
                    type="text"
                    value={searchTrack}
                    onChange={(e) => setSearchTrack(e.target.value)}
                    placeholder="Judul lagu..."
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-mono text-zinc-400 mb-1">
                    Artis
                  </label>
                  <input
                    type="text"
                    value={searchArtist}
                    onChange={(e) => setSearchArtist(e.target.value)}
                    placeholder="Nama artis..."
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSearching || !searchTrack.trim()}
                  className="px-3.5 py-1.5 rounded bg-emerald-400 text-zinc-950 font-semibold text-xs tracking-wider uppercase hover:bg-emerald-300 active:bg-emerald-500 transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isSearching ? 'Mencari...' : 'Cari'}</span>
                </button>
              </div>
            </form>

            {searchError && (
              <div className="text-xs font-mono text-red-400 bg-red-950/40 border border-red-900/60 p-2.5 rounded">
                {searchError}
              </div>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto divide-y divide-zinc-800 border border-zinc-800 rounded bg-zinc-950/60">
                {searchResults.map((r) => (
                  <div
                    key={r.id}
                    className="p-2.5 flex items-center justify-between text-xs hover:bg-zinc-800/40 gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-200 truncate">{r.trackName}</div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {r.artistName} {r.albumName ? `• ${r.albumName}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[10px] text-zinc-500">
                        {r.syncedLyrics ? 'synced' : 'plain'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleApplySearchResult(r)}
                        className="px-2 py-1 rounded bg-zinc-800 text-emerald-400 hover:bg-emerald-400 hover:text-zinc-950 font-mono text-[11px] transition-colors cursor-pointer border border-zinc-700"
                      >
                        Pilih
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between text-xs font-mono text-zinc-500">
          <span>Pilihan sumber tersimpan otomatis per lagu</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
