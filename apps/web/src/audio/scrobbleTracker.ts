// The secret ships in client JS, which is acceptable for this single-user self-hosted app, NOT for a public multi-user service.

import { lastFmClient, type SubsonicSong } from '@player/shared';
import { usePlaybackStore } from '../stores/playbackStore';
import { useLastFmStore } from '../stores/lastFmStore';

class ScrobbleTracker {
  private currentSong: SubsonicSong | null = null;
  private startedAtTimestamp: number = 0;
  private nowPlayingSent = false;
  private scrobbled = false;

  public init(): () => void {
    const unsub = usePlaybackStore.subscribe((state, prev) => {
      const song = state.currentSong();
      const isPlaying = state.isPlaying;

      if (song && (!this.currentSong || song.id !== this.currentSong.id)) {
        this.currentSong = song;
        this.startedAtTimestamp = Math.floor(Date.now() / 1000);
        this.nowPlayingSent = false;
        this.scrobbled = false;

        if (isPlaying) {
          this.sendNowPlaying(song);
        }
      } else if (isPlaying && !prev.isPlaying && song) {
        if (!this.nowPlayingSent) {
          this.sendNowPlaying(song);
        }
      }

      if (isPlaying && song && !this.scrobbled) {
        const duration = song.duration || state.duration || 0;
        if (duration >= 30) {
          const threshold = Math.min(240, duration * 0.5);
          if (state.currentTime >= threshold) {
            this.scrobbled = true;
            this.sendScrobble(song, this.startedAtTimestamp || Math.floor(Date.now() / 1000));
          }
        }
      }
    });

    return unsub;
  }

  private sendNowPlaying(song: SubsonicSong): void {
    const { sessionKey, apiKey, apiSecret, isEnabled } = useLastFmStore.getState();
    if (!isEnabled || !sessionKey || !apiKey || !apiSecret) {
      return; // Skip silently when not connected or disabled
    }

    this.nowPlayingSent = true;
    lastFmClient
      .updateNowPlaying(song, sessionKey, apiKey, apiSecret)
      .catch((err) => {
        console.warn('Silent Last.fm now playing update error:', err);
      });
  }

  private sendScrobble(song: SubsonicSong, timestamp: number): void {
    const { sessionKey, apiKey, apiSecret, isEnabled } = useLastFmStore.getState();
    if (!isEnabled || !sessionKey || !apiKey || !apiSecret) {
      return; // Skip silently when not connected or disabled
    }

    lastFmClient
      .scrobble(song, timestamp, sessionKey, apiKey, apiSecret)
      .catch((err) => {
        console.warn('Silent Last.fm scrobble error:', err);
      });
  }
}

export const scrobbleTracker = new ScrobbleTracker();
