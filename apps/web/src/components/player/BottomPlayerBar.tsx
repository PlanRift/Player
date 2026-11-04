import { useState, useEffect } from 'react';
import {
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  ListMusic,
  Maximize2,
} from 'lucide-react';
import { usePlaybackStore } from '../../stores/playbackStore';
import { audioEngine } from '../../audio/audioEngine';
import { CoverImage } from '../common/CoverImage';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function BottomPlayerBar() {
  const {
    isPlaying,
    currentTime,
    duration,
    volume,
    queue,
    isShuffle,
    repeatMode,
    togglePlay,
    next,
    previous,
    toggleShuffle,
    toggleRepeat,
    setVolume,
    toggleQueue,
    isQueueOpen,
    toggleSignatureView,
    currentSong,
  } = usePlaybackStore();

  const song = currentSong();
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);

  const trackDuration = Math.max(1, (duration && duration > 0 ? duration : song?.duration) || 0);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    setScrubValue(val);
    if (!isScrubbing) {
      audioEngine.seek(val);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    setIsScrubbing(true);
    const val = parseFloat((e.target as HTMLInputElement).value);
    setScrubValue(isNaN(val) ? currentTime : val);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLInputElement>) => {
    setIsScrubbing(false);
    const val = parseFloat((e.target as HTMLInputElement).value);
    const targetVal = !isNaN(val) ? val : scrubValue;
    audioEngine.seek(targetVal);
  };

  useEffect(() => {
    if (!isScrubbing) return;
    const handleGlobalUp = () => {
      setIsScrubbing(false);
      audioEngine.seek(scrubValue);
    };
    window.addEventListener('pointerup', handleGlobalUp);
    window.addEventListener('pointercancel', handleGlobalUp);
    return () => {
      window.removeEventListener('pointerup', handleGlobalUp);
      window.removeEventListener('pointercancel', handleGlobalUp);
    };
  }, [isScrubbing, scrubValue]);

  return (
    <footer
      id="player-bar"
      aria-label="Audio player controls"
      className="bg-zinc-900 border-t border-zinc-700 px-4 py-3 sm:px-6 z-40 select-none shrink-0"
    >
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 lg:gap-6">
        {/* Track Info (Left) — Click to open Signature Room */}
        <div
          onClick={song ? toggleSignatureView : undefined}
          className={`flex items-center gap-3 min-w-0 lg:w-64 xl:w-72 shrink-0 ${
            song ? 'cursor-pointer group' : ''
          }`}
          title={song ? 'Open Signature Room (r)' : undefined}
          role={song ? 'button' : undefined}
          aria-label={song ? 'Open Signature Room' : undefined}
        >
          <div className="w-12 h-12 rounded-md shrink-0 border border-zinc-700 bg-zinc-950 overflow-hidden relative">
            <CoverImage
              coverId={song?.coverArt || song?.id}
              songId={song?.id}
              alt={song ? `${song.title} cover` : ''}
              size={100}
            />
            {song && (
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="w-4 h-4 text-emerald-400" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p id="player-title" className="text-sm font-semibold text-zinc-100 group-hover:text-emerald-400 truncate transition-colors">
              {song?.title || 'No track selected'}
            </p>
            <p id="player-artist" className="text-xs text-zinc-400 truncate mt-0.5">
              {song?.artist || 'Choose an artist to begin playback'}
            </p>
          </div>
        </div>

        {/* Transport Controls & Timeline in ONE ROW on desktop */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
          {/* Transport Buttons: Shuffle, Prev, Play/Pause, Next, Repeat */}
          <div className="flex items-center justify-between sm:justify-start gap-2 shrink-0">
            {/* Shuffle Toggle */}
            <button
              id="player-shuffle-btn"
              type="button"
              aria-pressed={isShuffle}
              aria-label="Toggle shuffle mode"
              onClick={toggleShuffle}
              className="toggle-btn min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors shrink-0 cursor-pointer"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            {/* Previous Track */}
            <button
              id="prev-btn"
              type="button"
              disabled={!song}
              aria-label="Previous track"
              onClick={previous}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-400 disabled:border-zinc-600 transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>

            {/* Play / Pause */}
            <button
              id="play-pause-btn"
              type="button"
              disabled={!song}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              onClick={togglePlay}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-emerald-400 text-zinc-950 flex items-center justify-center hover:bg-emerald-300 active:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-400 disabled:border disabled:border-zinc-600 transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </button>

            {/* Next Track */}
            <button
              id="next-btn"
              type="button"
              disabled={!song}
              aria-label="Next track"
              onClick={next}
              className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 flex items-center justify-center hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-400 disabled:border-zinc-600 transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            {/* Repeat Toggle */}
            <button
              id="player-repeat-btn"
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

          {/* Clickable Timeline in the SAME row */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span id="current-time" className="text-xs font-mono text-zinc-300 w-10 text-right shrink-0">
              {formatTime(isScrubbing ? scrubValue : currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={trackDuration}
              step={0.1}
              value={isScrubbing ? scrubValue : Math.min(currentTime, trackDuration)}
              onChange={handleSeekChange}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              disabled={!song}
              className="flex-1 accent-emerald-400 bg-zinc-950 h-2.5 rounded-sm cursor-pointer border border-zinc-700 disabled:opacity-40"
              aria-label="Seek timeline"
            />
            <span id="total-duration" className="text-xs font-mono text-zinc-300 w-10 shrink-0">
              {formatTime(trackDuration)}
            </span>
          </div>
        </div>

        {/* Volume & Queue (Right) */}
        <div className="flex items-center justify-end gap-3 lg:gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-400">VOL</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-16 sm:w-20 accent-emerald-400 bg-zinc-950 h-2 rounded-sm cursor-pointer border border-zinc-700"
              aria-label="Volume"
            />
          </div>

          <button
            id="queue-toggle-btn"
            type="button"
            aria-expanded={isQueueOpen}
            aria-controls="queue-drawer"
            aria-label="Toggle playback queue"
            onClick={toggleQueue}
            className="toggle-btn min-h-[44px] px-3 py-2 rounded-md bg-zinc-950 text-zinc-100 border border-zinc-500 inline-flex items-center gap-2 hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors text-xs font-mono shrink-0 cursor-pointer"
          >
            <ListMusic className="w-4 h-4 shrink-0" />
            <span id="queue-badge-count">Queue ({queue.length})</span>
          </button>
        </div>
      </div>
    </footer>
  );
}
