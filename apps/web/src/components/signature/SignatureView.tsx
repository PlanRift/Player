import { useEffect, useState, useRef, useMemo } from 'react';
import {
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  X,
  SlidersHorizontal,
} from 'lucide-react';
import {
  resolveLyrics,
  getTrackProviderOverride,
} from '@player/shared';
import { usePlaybackStore } from '../../stores/playbackStore';
import { audioEngine } from '../../audio/audioEngine';
import { CoverImage } from '../common/CoverImage';
import { LyricsSourceModal } from './LyricsSourceModal';

interface LyricLine {
  time: number;
  text: string;
}

function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lines) {
    const match = timeRegex.exec(line.trim());
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const millis = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
      const time = minutes * 60 + seconds + millis / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({ time, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function SignatureView() {
  const {
    isSignatureOpen,
    toggleSignatureView,
    currentSong,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    next,
    previous,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
  } = usePlaybackStore();

  const song = currentSong();

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [lyricOffset, setLyricOffset] = useState<number>(0);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState<string>('auto');
  const [activeProviderLabel, setActiveProviderLabel] = useState<string>('LRCLIB');

  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Restore stored provider override & timing offset per track
  useEffect(() => {
    if (song) {
      const storedOffset = localStorage.getItem(`player.lyrics-offset.v1.${song.id}`);
      setLyricOffset(storedOffset ? parseFloat(storedOffset) || 0 : 0);
      const storedOverride = getTrackProviderOverride(song.id);
      setActiveProviderId(storedOverride || 'auto');
    }
  }, [song?.id]);

  const handleNudge = (delta: number) => {
    if (!song) return;
    const newOffset = Math.round((lyricOffset + delta) * 10) / 10;
    setLyricOffset(newOffset);
    localStorage.setItem(`player.lyrics-offset.v1.${song.id}`, String(newOffset));
  };

  const handleResetNudge = () => {
    if (!song) return;
    setLyricOffset(0);
    localStorage.removeItem(`player.lyrics-offset.v1.${song.id}`);
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSignatureOpen) {
        if (isSourceModalOpen) {
          setIsSourceModalOpen(false);
        } else {
          toggleSignatureView();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSignatureOpen, isSourceModalOpen, toggleSignatureView]);

  // Multi-provider lyrics resolver
  useEffect(() => {
    if (!song || !isSignatureOpen) return;

    setIsLoadingLyrics(true);
    setLyrics([]);
    setPlainLyrics(null);
    setLyricsError(null);

    const controller = new AbortController();

    async function fetchLyrics() {
      try {
        const req = {
          track: song!.title,
          artist: song!.artist || '',
          album: song!.album || '',
          duration: song!.duration || 0,
        };

        const res = await resolveLyrics(
          req,
          song!.id,
          activeProviderId,
          controller.signal
        );

        if (res) {
          if (res.syncedLyrics) {
            setLyrics(parseLrc(res.syncedLyrics));
          } else if (res.plainLyrics) {
            setPlainLyrics(res.plainLyrics);
          }
          setActiveProviderLabel(res.providerId.toUpperCase());
        } else {
          setActiveProviderLabel(activeProviderId.toUpperCase());
        }
        setIsLoadingLyrics(false);
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          setLyricsError('Lyrics unavailable');
          setIsLoadingLyrics(false);
        }
      }
    }

    fetchLyrics();

    return () => {
      controller.abort();
    };
  }, [
    song?.id,
    song?.title,
    song?.artist,
    song?.album,
    song?.duration,
    isSignatureOpen,
    activeProviderId,
  ]);

  // Active lyric index with timing offset applied
  const activeIndex = useMemo(() => {
    if (lyrics.length === 0) return -1;
    const effectiveTime = currentTime + lyricOffset;
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (effectiveTime >= lyrics[i].time) {
        return i;
      }
    }
    return -1;
  }, [lyrics, currentTime, lyricOffset]);

  // Auto-scroll active lyric into view
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex]);

  if (!isSignatureOpen || !song) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0e0e11] text-zinc-100 flex flex-col justify-between selection:bg-emerald-400 selection:text-zinc-950 animate-in fade-in duration-200 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Signature Now Playing Room"
    >
      {/* Top Header */}
      <header className="h-16 border-b border-zinc-700 bg-zinc-950/80 px-6 sm:px-10 flex items-center justify-between shrink-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-emerald-400 rounded-xs" aria-hidden="true" />
          <span className="font-bold tracking-tight text-zinc-100 text-base">
            Plenrip Audio
          </span>
          <span className="font-mono text-[10px] text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded">
            SIGNATURE
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-zinc-400 hidden sm:inline-block">
            {formatTime(currentTime)} / {formatTime(duration || song.duration || 0)}
          </span>
          <button
            type="button"
            onClick={toggleSignatureView}
            className="px-3 py-1.5 rounded-md bg-zinc-900 text-zinc-300 border border-zinc-700 hover:text-zinc-100 hover:bg-zinc-800 hover:border-zinc-500 font-mono text-xs cursor-pointer transition-colors inline-flex items-center gap-1.5"
            aria-label="Exit signature room"
          >
            <span>EXIT ROOM [ESC]</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main Content: Left Column (Art + Controls) and Right Column (Synced Lyrics Canvas) */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 sm:p-10 lg:p-12 grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 overflow-y-auto md:overflow-hidden items-center">
        {/* Left Column: Artwork, Huge Serif Title, Transport */}
        <section className="md:col-span-5 lg:col-span-5 flex flex-col justify-center gap-6">
          <div className="aspect-square w-full max-w-xs sm:max-w-sm md:max-w-md mx-auto md:mx-0 rounded-lg border border-zinc-700 bg-zinc-950 overflow-hidden shadow-2xl">
            <CoverImage
              coverId={song.coverArt || song.id}
              songId={song.id}
              alt={`${song.title} cover`}
              size={600}
            />
          </div>

          <div className="flex flex-col gap-1">
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-normal tracking-tight text-zinc-100 leading-tight">
              {song.title}
            </h2>
            <p className="text-base sm:text-lg text-zinc-300 font-medium mt-1">
              {song.artist || 'Unknown Artist'}
            </p>
            <p className="font-mono text-xs text-zinc-400">
              {song.album} {song.year ? `• ${song.year}` : ''}
            </p>
          </div>

          {/* Scrubber & Controls */}
          <div className="flex flex-col gap-3 pt-3 border-t border-zinc-700">
            <input
              type="range"
              min={0}
              max={duration || song.duration || 100}
              step={0.1}
              value={currentTime}
              onChange={(e) => audioEngine.seek(parseFloat(e.target.value))}
              className="w-full accent-emerald-400 bg-zinc-950 h-2 rounded-sm cursor-pointer border border-zinc-700"
              aria-label="Seek position in signature room"
            />

            <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration || song.duration || 0)}</span>
            </div>

            {/* Transport Button Row (Exact 44px buttons) */}
            <div className="flex items-center justify-center gap-3 pt-1">
              {/* Shuffle */}
              <button
                type="button"
                aria-pressed={isShuffle}
                aria-label="Toggle shuffle mode"
                onClick={toggleShuffle}
                className="toggle-btn min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
              >
                <Shuffle className="w-4 h-4" />
              </button>

              {/* Prev */}
              <button
                type="button"
                aria-label="Previous track"
                onClick={previous}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
              >
                <SkipBack className="w-5 h-5 fill-current" />
              </button>

              {/* Play / Pause */}
              <button
                type="button"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={togglePlay}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-emerald-400 text-zinc-950 flex items-center justify-center hover:bg-emerald-300 active:bg-emerald-500 transition-colors shrink-0 cursor-pointer"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
              </button>

              {/* Next */}
              <button
                type="button"
                aria-label="Next track"
                onClick={next}
                className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>

              {/* Repeat */}
              <button
                type="button"
                aria-pressed={repeatMode !== 'off'}
                aria-label={
                  repeatMode === 'off'
                    ? 'Repeat off'
                    : repeatMode === 'all'
                      ? 'Repeat all'
                      : 'Repeat one'
                }
                onClick={toggleRepeat}
                className="toggle-btn relative min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Right Column: Synced Lyrics Auto-Scrolling Canvas */}
        <section
          ref={scrollContainerRef}
          className="md:col-span-7 h-[65vh] overflow-y-auto px-4 md:px-8 py-16 border-l border-zinc-800/80 flex flex-col gap-6 select-none scroll-smooth"
          aria-label="Lyrics"
        >
          {isLoadingLyrics ? (
            <div className="my-auto text-center font-mono text-xs text-zinc-400 animate-pulse">
              Connecting to LRCLIB synced lyrics...
            </div>
          ) : lyrics.length > 0 ? (
            lyrics.map((line, idx) => {
              const isActive = idx === activeIndex;
              return (
                <div
                  key={`${line.time}-${idx}`}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => audioEngine.seek(line.time)}
                  className={`cursor-pointer transition-all duration-200 text-xl sm:text-2xl font-sans leading-relaxed ${
                    isActive
                      ? 'text-emerald-400 font-semibold scale-102 opacity-100'
                      : 'text-zinc-500 hover:text-zinc-300 opacity-60'
                  }`}
                >
                  {line.text}
                </div>
              );
            })
          ) : plainLyrics ? (
            <div className="whitespace-pre-wrap font-sans text-base text-zinc-300 leading-relaxed my-auto">
              {plainLyrics}
            </div>
          ) : (
            <div className="my-auto text-center flex flex-col gap-2">
              <span className="font-display text-2xl text-zinc-400">
                A quiet recording
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {lyricsError || 'No lyrics available for this track'}
              </span>
            </div>
          )}
        </section>
      </main>

      {/* Floor with Synced Lyrics Timing Nudge */}
      <footer className="h-12 border-t border-zinc-800 px-6 sm:px-10 flex flex-wrap items-center justify-between text-xs font-mono text-zinc-500 shrink-0 select-none">
        <span>Click any lyric line to jump playback</span>

        {lyrics.length > 0 && (
          <div className="flex items-center gap-3">
            <span>
              OFFSET: {lyricOffset > 0 ? `+${lyricOffset.toFixed(1)}s` : `${lyricOffset.toFixed(1)}s`}
            </span>
            {lyricOffset !== 0 && (
              <button
                type="button"
                onClick={handleResetNudge}
                className="text-zinc-400 hover:text-zinc-100 underline cursor-pointer"
              >
                [RESET]
              </button>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleNudge(-0.2)}
                className="border border-zinc-700 bg-zinc-900 text-zinc-300 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
                title="Nudge lyrics 0.2s earlier"
              >
                -0.2s
              </button>
              <button
                type="button"
                onClick={() => handleNudge(0.2)}
                className="border border-zinc-700 bg-zinc-900 text-zinc-300 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
                title="Nudge lyrics 0.2s later"
              >
                +0.2s
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsSourceModalOpen(true)}
          className="hover:text-emerald-400 cursor-pointer flex items-center gap-1.5 transition-colors"
          title="Pilih sumber lirik"
          aria-label="Pilih sumber lirik"
        >
          <span>Sumber lirik: {activeProviderLabel}</span>
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>
      </footer>

      {/* Sumber Lirik Modal */}
      <LyricsSourceModal
        isOpen={isSourceModalOpen}
        onClose={() => setIsSourceModalOpen(false)}
        song={song}
        activeProviderId={activeProviderId}
        onProviderChange={(pid) => {
          setActiveProviderId(pid);
        }}
        onApplyLyrics={(result) => {
          if (result.syncedLyrics) {
            setLyrics(parseLrc(result.syncedLyrics));
            setPlainLyrics(null);
          } else if (result.plainLyrics) {
            setPlainLyrics(result.plainLyrics);
            setLyrics([]);
          }
          setActiveProviderLabel(result.providerId.toUpperCase());
        }}
      />
    </div>
  );
}
