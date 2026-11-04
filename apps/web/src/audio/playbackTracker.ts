import { usePlaybackStore } from '../stores/playbackStore';
import { useHistoryStore } from '../stores/historyStore';
import type { SubsonicSong } from '@player/shared';

class PlaybackTracker {
  private currentTrackId: string | null = null;
  private currentSong: SubsonicSong | null = null;
  private elapsedPlayTimeMs: number = 0;
  private lastTick: number = 0;
  private hasRecordedHistory = false;
  private isRunning = false;

  public init(): () => void {
    if (this.isRunning) return () => {};
    this.isRunning = true;

    const unsub = usePlaybackStore.subscribe((state, prev) => {
      const song = state.currentSong();

      // Track change
      if (song && song.id !== this.currentTrackId) {
        this.finishCurrentTrack();
        this.startNewTrack(song, state.isPlaying);
      }

      // Play/Pause transition
      if (state.isPlaying !== prev.isPlaying) {
        if (state.isPlaying) {
          this.lastTick = performance.now();
        } else {
          if (this.lastTick > 0) {
            this.elapsedPlayTimeMs += performance.now() - this.lastTick;
            this.lastTick = 0;
          }
        }
      }

      // Check thresholds while playing
      if (state.isPlaying && this.currentSong) {
        const currentElapsedMs =
          this.elapsedPlayTimeMs + (this.lastTick > 0 ? performance.now() - this.lastTick : 0);
        const currentSec = currentElapsedMs / 1000;
        const totalDurationSec = this.currentSong.duration || 60;

        // History record condition: passes 30s elapsed or song ends
        if (!this.hasRecordedHistory && (currentSec >= 30 || currentSec >= totalDurationSec)) {
          this.commitHistoryRecord(currentElapsedMs);
        }
      }
    });

    return () => {
      this.finishCurrentTrack();
      this.isRunning = false;
      unsub();
    };
  }

  private startNewTrack(song: SubsonicSong, isPlaying: boolean): void {
    this.currentTrackId = song.id;
    this.currentSong = song;
    this.elapsedPlayTimeMs = 0;
    this.lastTick = isPlaying ? performance.now() : 0;
    this.hasRecordedHistory = false;
  }

  private commitHistoryRecord(playDurationMs: number): void {
    if (this.hasRecordedHistory || !this.currentSong) return;
    this.hasRecordedHistory = true;

    useHistoryStore.getState().recordPlay({
      songId: this.currentSong.id,
      artistId: this.currentSong.artistId || '',
      albumId: this.currentSong.albumId || '',
      playedAt: Date.now(),
      playDurationMs: Math.round(playDurationMs),
    });
  }

  private finishCurrentTrack(): void {
    if (this.lastTick > 0) {
      this.elapsedPlayTimeMs += performance.now() - this.lastTick;
      this.lastTick = 0;
    }

    if (this.currentSong && !this.hasRecordedHistory) {
      const currentSec = this.elapsedPlayTimeMs / 1000;
      const totalDurationSec = this.currentSong.duration || 60;
      if (currentSec >= 30 || currentSec >= totalDurationSec) {
        this.commitHistoryRecord(this.elapsedPlayTimeMs);
      }
    }

    this.currentTrackId = null;
    this.currentSong = null;
    this.elapsedPlayTimeMs = 0;
    this.hasRecordedHistory = false;
  }
}

export const playbackTracker = new PlaybackTracker();
