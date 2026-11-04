import { usePlaybackStore } from '../stores/playbackStore';
import { subsonicClient, type SubsonicSong } from '@player/shared';

const STORAGE_CROSSFADE = 'planrift.settings.crossfade';

export class AudioEngine {
  private deckA: HTMLAudioElement;
  private deckB: HTMLAudioElement;
  private activeDeckName: 'A' | 'B' = 'A';

  private currentSongId: string | null = null;
  private preloadedSongId: string | null = null;

  private engineVolume: number = 0.85;
  private crossfadeDuration: number = 0;
  private isTransitioning = false;
  private crossfadeTimer: ReturnType<typeof setInterval> | null = null;
  private isSeeking = false;
  private pendingSeek: number | null = null;

  constructor() {
    const hasAudio = typeof Audio !== 'undefined';
    this.deckA = hasAudio ? new Audio() : ({} as HTMLAudioElement);
    this.deckB = hasAudio ? new Audio() : ({} as HTMLAudioElement);

    if (hasAudio) {
      this.deckA.preload = 'metadata';
      this.deckB.preload = 'metadata';

      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_CROSSFADE);
        if (saved !== null) {
          const parsed = parseFloat(saved);
          if (!isNaN(parsed) && parsed >= 0) {
            this.crossfadeDuration = parsed;
          }
        }
      }

      this.bindDeckEvents('A', this.deckA);
      this.bindDeckEvents('B', this.deckB);
      this.setupMediaSession();
    }
  }

  public getActiveDeck(): HTMLAudioElement {
    return this.activeDeckName === 'A' ? this.deckA : this.deckB;
  }

  public getIdleDeck(): HTMLAudioElement {
    return this.activeDeckName === 'A' ? this.deckB : this.deckA;
  }

  public getActiveDeckName(): 'A' | 'B' {
    return this.activeDeckName;
  }

  public getCrossfade(): number {
    return this.crossfadeDuration;
  }

  public setCrossfade(seconds: number): void {
    this.crossfadeDuration = Math.max(0, Math.min(12, seconds));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_CROSSFADE, String(this.crossfadeDuration));
    }
  }

  private bindDeckEvents(name: 'A' | 'B', deck: HTMLAudioElement): void {
    if (typeof Audio === 'undefined') return;

    deck.addEventListener('timeupdate', () => {
      // Only active deck updates playback state & checks transitions
      if (this.activeDeckName !== name) return;
      if (this.isSeeking || deck.seeking) return;

      const currentTime = deck.currentTime;
      usePlaybackStore.getState().setTime(currentTime);
      this.updateMediaSessionPosition();

      // Check crossfade trigger if enabled
      if (
        this.crossfadeDuration > 0 &&
        !this.isTransitioning &&
        deck.duration &&
        deck.duration > 0
      ) {
        const remaining = deck.duration - currentTime;
        if (remaining <= this.crossfadeDuration && remaining > 0) {
          const nextSong = this.getNextSong();
          if (nextSong) {
            this.startCrossfadeTransition();
          }
        }
      }
    });

    deck.addEventListener('seeked', () => {
      if (this.activeDeckName !== name) return;
      this.isSeeking = false;
      usePlaybackStore.getState().setTime(deck.currentTime);
      this.updateMediaSessionPosition();
    });

    deck.addEventListener('loadedmetadata', () => {
      if (this.activeDeckName !== name) return;
      if (deck.duration && !isNaN(deck.duration)) {
        usePlaybackStore.getState().setDuration(deck.duration);
        this.updateMediaSessionPosition();
      }
      if (this.pendingSeek !== null) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        try {
          deck.currentTime = target;
        } catch (err) {
          console.warn('Failed to apply pending seek on metadata:', err);
        }
      }
    });

    deck.addEventListener('ended', () => {
      if (this.activeDeckName !== name) return;

      const { repeatMode } = usePlaybackStore.getState();
      if (repeatMode === 'one') {
        deck.currentTime = 0;
        deck.play().catch(console.warn);
        return;
      }

      // If hard cut (crossfade === 0) or crossfade didn't trigger, transition now
      if (!this.isTransitioning) {
        const nextSong = this.getNextSong();
        if (nextSong) {
          this.swapDecksAndPlayNext();
        } else {
          usePlaybackStore.getState().next();
        }
      }
    });

    deck.addEventListener('error', () => {
      if (this.activeDeckName === name) {
        console.error(`AudioEngine deck ${name} error:`, deck.error);
        usePlaybackStore.getState().setIsPlaying(false);
      }
    });
  }

  private getNextSong(): SubsonicSong | null {
    const state = usePlaybackStore.getState();
    if (state.repeatMode === 'one') return null;

    if (state.currentIndex < state.queue.length - 1) {
      return state.queue[state.currentIndex + 1].song;
    }
    if (state.repeatMode === 'all' && state.queue.length > 0) {
      return state.queue[0].song;
    }
    return null;
  }

  public preloadNextTrack(): void {
    const nextSong = this.getNextSong();
    const idleDeck = this.getIdleDeck();

    if (!nextSong) {
      this.preloadedSongId = null;
      return;
    }

    if (this.preloadedSongId === nextSong.id && idleDeck.src) {
      return;
    }

    this.preloadedSongId = nextSong.id;
    const streamUrl = subsonicClient.getStreamUrl(nextSong.id);
    idleDeck.src = streamUrl;
    idleDeck.preload = 'auto';
    idleDeck.volume = this.engineVolume;
    idleDeck.load?.();
  }

  private startCrossfadeTransition(): void {
    this.isTransitioning = true;
    const oldDeck = this.getActiveDeck();
    const newDeck = this.getIdleDeck();
    const fadeDuration = this.crossfadeDuration;

    newDeck.currentTime = 0;
    newDeck.volume = 0;
    newDeck.play?.().catch((err) => {
      console.warn('Crossfade idle deck autoplay prevented:', err);
    });

    this.activeDeckName = this.activeDeckName === 'A' ? 'B' : 'A';
    usePlaybackStore.getState().next();
    this.updateMediaSessionMetadata();

    const intervalMs = 50;
    const totalSteps = Math.max(1, Math.round((fadeDuration * 1000) / intervalMs));
    let step = 0;

    this.crossfadeTimer = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / totalSteps);

      // Linear volume ramps
      oldDeck.volume = Math.max(0, this.engineVolume * (1 - progress));
      newDeck.volume = Math.min(this.engineVolume, this.engineVolume * progress);

      if (progress >= 1) {
        this.cancelCrossfade();
        oldDeck.pause?.();
        oldDeck.currentTime = 0;
        oldDeck.volume = this.engineVolume;
        this.preloadNextTrack();
      }
    }, intervalMs);
  }

  private swapDecksAndPlayNext(): void {
    const oldDeck = this.getActiveDeck();
    const newDeck = this.getIdleDeck();

    oldDeck.pause?.();
    oldDeck.currentTime = 0;

    newDeck.volume = this.engineVolume;
    newDeck.play?.().catch((err) => {
      console.warn('Gapless idle deck play prevented:', err);
    });

    this.activeDeckName = this.activeDeckName === 'A' ? 'B' : 'A';
    usePlaybackStore.getState().next();
    this.updateMediaSessionMetadata();
    this.preloadNextTrack();
  }

  public cancelCrossfade(): void {
    if (this.crossfadeTimer) {
      clearInterval(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    if (this.isTransitioning) {
      this.isTransitioning = false;
      const idleDeck = this.getIdleDeck();
      idleDeck.pause?.();
      idleDeck.currentTime = 0;
      idleDeck.volume = this.engineVolume;
      this.getActiveDeck().volume = this.engineVolume;
    }
  }

  private setupMediaSession(): void {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      usePlaybackStore.getState().setIsPlaying(true);
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      usePlaybackStore.getState().setIsPlaying(false);
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      usePlaybackStore.getState().previous();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      usePlaybackStore.getState().next();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        this.seek(details.seekTime);
      }
    });
  }

  public updateMediaSessionMetadata(): void {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    const song = usePlaybackStore.getState().currentSong();
    if (!song) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const coverUrl = subsonicClient.getCoverArtUrl(song.coverArt || song.id, 300);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      album: song.album || 'Unknown Album',
      artwork: [{ src: coverUrl, sizes: '300x300', type: 'image/jpeg' }],
    });
  }

  public updateMediaSessionPosition(): void {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    const deck = this.getActiveDeck();
    if (deck.duration && !isNaN(deck.duration) && 'setPositionState' in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({
          duration: deck.duration,
          playbackRate: deck.playbackRate || 1,
          position: Math.min(deck.currentTime, deck.duration),
        });
      } catch {
        // Ignore
      }
    }
  }

  public syncWithStore(): () => void {
    const unsub = usePlaybackStore.subscribe((state, prev) => {
      const song = state.currentSong();

      if (song && song.id !== this.currentSongId) {
        this.currentSongId = song.id;
        const activeDeck = this.getActiveDeck();
        const streamUrl = subsonicClient.getStreamUrl(song.id);

        if (activeDeck.src !== streamUrl) {
          this.cancelCrossfade();
          activeDeck.src = streamUrl;
          activeDeck.volume = state.volume;
          this.updateMediaSessionMetadata();

          if (state.isPlaying) {
            activeDeck.play?.().catch((err) => {
              console.warn('Playback play request interrupted:', err);
            });
          }
        }

        this.preloadNextTrack();
      }

      if (state.isPlaying !== prev.isPlaying) {
        const activeDeck = this.getActiveDeck();
        if (state.isPlaying) {
          if (!activeDeck.src && song) {
            activeDeck.src = subsonicClient.getStreamUrl(song.id);
          }
          activeDeck.play?.().catch((err) => {
            console.warn('Autoplay prevented:', err);
            usePlaybackStore.getState().setIsPlaying(false);
          });
          if ('playbackState' in navigator.mediaSession) {
            navigator.mediaSession.playbackState = 'playing';
          }
        } else {
          this.cancelCrossfade();
          activeDeck.pause?.();
          if ('playbackState' in navigator.mediaSession) {
            navigator.mediaSession.playbackState = 'paused';
          }
        }
      }

      if (state.volume !== prev.volume) {
        this.engineVolume = state.volume;
        if (!this.isTransitioning) {
          this.deckA.volume = state.volume;
          this.deckB.volume = state.volume;
        }
      }

      if (
        state.queue !== prev.queue ||
        state.currentIndex !== prev.currentIndex ||
        state.repeatMode !== prev.repeatMode
      ) {
        this.preloadNextTrack();
      }
    });

    return unsub;
  }

  public seek(seconds: number): void {
    this.cancelCrossfade();
    const activeDeck = this.getActiveDeck();
    if (!activeDeck) return;

    const maxDuration =
      activeDeck.duration && !isNaN(activeDeck.duration)
        ? activeDeck.duration
        : usePlaybackStore.getState().duration || Infinity;

    // Clamp seconds safely to avoid immediately tripping 'ended' at the boundary
    const safeMax = isFinite(maxDuration) && maxDuration > 1 ? maxDuration - 0.5 : maxDuration;
    const clamped = Math.max(0, Math.min(seconds, safeMax));

    this.isSeeking = true;
    usePlaybackStore.getState().setTime(clamped);

    if (activeDeck.readyState >= 1) {
      try {
        activeDeck.currentTime = clamped;
      } catch (err) {
        console.warn('Failed to set currentTime on active deck:', err);
      }
    } else {
      this.pendingSeek = clamped;
    }

    this.updateMediaSessionPosition();
  }

  public getCurrentTime(): number {
    return this.getActiveDeck()?.currentTime || 0;
  }
}

export const audioEngine = new AudioEngine();
