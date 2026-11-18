// discordPresence.ts - deck sender for Discord Rich Presence.
//
// Subscribes to the playback store (no React re-render: store.subscribe,
// never a currentTime selector) and POSTs the current track to the relay
// on track change, play, pause, and seek. The relay owns the Discord IPC
// connection and throttles to one SET_ACTIVITY per 15 s.
//
// Failure is silent and never blocks playback: relay down, 503
// not-configured, or network error means "no presence" (no toast, no
// banner, no retry storm: one attempt per playback event, no polling).
// Status is surfaced only inside the Discord settings section.

import { useEffect, useRef } from 'react';
import { subsonicClient, type SubsonicSong } from '@century/crate';
import { usePlaybackStore } from '../stores/playbackStore';
import {
  useSettingsStore,
  type DiscordRpcActivityName,
  type DiscordRpcActivityType,
  type DiscordRpcLargeImage,
  type DiscordRpcSmallImage,
} from '../stores/settingsStore';
import { relayFetch, readJson } from './relayHttp';

export const DISCORD_CLIENT_ID_PATTERN = /^\d{1,19}$/;
const POST_DEBOUNCE_MS = 400;
/** Retry delays after a network/timeout failure (the relay never saw
 * the post). Bounded: at most 3 attempts per event. The last attempt
 * lands ~12 s after the event, past the ~10 s track-change burst
 * (lyrics fetches) that starves the first attempt on a slow dev
 * server. Only network failures retry: an HTTP response (even
 * 400/503) means the relay got it and decided, so there is nothing
 * to retry. A newer scheduled post supersedes the retries. */
const POST_RETRY_DELAYS_MS = [3000, 9000];
// A jump bigger than this between timeupdate ticks is a seek (natural
// progression is ~0.25 s per tick at 4 Hz).
const SEEK_JUMP_SECONDS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The Discord customization settings, read from the settings store at post time. */
export interface DiscordPresenceCustomization {
  activityName: DiscordRpcActivityName;
  activityNameCustom: string;
  detailsTemplate: string;
  stateTemplate: string;
  activityType: DiscordRpcActivityType;
  showTimestamps: boolean;
  largeImage: DiscordRpcLargeImage;
  largeImageKey: string;
  smallImage: DiscordRpcSmallImage;
  button1Label: string;
  button1Url: string;
  button2Label: string;
  button2Url: string;
}

/** The v1 defaults, used when no customization is passed to buildPresencePost. */
export const DEFAULT_DISCORD_CUSTOMIZATION: DiscordPresenceCustomization = {
  activityName: 'title',
  activityNameCustom: '',
  detailsTemplate: '{title}',
  stateTemplate: '{artist} - {album}',
  activityType: 'listening',
  showTimestamps: true,
  largeImage: 'cover',
  largeImageKey: 'logo',
  smallImage: 'playpause',
  button1Label: '',
  button1Url: '',
  button2Label: '',
  button2Url: '',
};

/**
 * Template renderer for the Settings preview. Mirrors the relay
 * (relay/src/discord-rpc.ts renderPresenceTemplate); keep the two in
 * sync. Deck-tested here.
 */
export function renderPresenceTemplate(
  template: string,
  values: { title: string; artist: string; album?: string },
): string {
  const album = values.album?.trim() ?? '';
  let rendered = template
    .replaceAll('{title}', values.title)
    .replaceAll('{artist}', values.artist)
    .replaceAll('{album}', album);
  rendered = rendered.replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '');
  rendered = rendered.replace(/ {2,}/g, ' ').trim();
  return rendered;
}

export interface PresencePost {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  positionSec: number;
  playing: boolean;
  coverUrl?: string;
  clientId?: string;
  activityName?: DiscordRpcActivityName;
  activityNameCustom?: string;
  detailsTemplate?: string;
  stateTemplate?: string;
  activityType?: DiscordRpcActivityType;
  showTimestamps?: boolean;
  largeImage?: DiscordRpcLargeImage;
  largeImageKey?: string;
  smallImage?: DiscordRpcSmallImage;
  buttons?: Array<{ label: string; url: string }>;
}

/** Pure post builder (exported for tests). */
export function buildPresencePost(
  song: SubsonicSong,
  positionSec: number,
  playing: boolean,
  clientId: string,
  customization: DiscordPresenceCustomization = DEFAULT_DISCORD_CUSTOMIZATION,
): PresencePost {
  const post: PresencePost = {
    title: song.title,
    artist: song.artist ?? '',
    durationSec: Math.max(0, Math.round(song.duration ?? 0)),
    positionSec: Math.max(0, Math.round(positionSec)),
    playing,
    activityName: customization.activityName,
    activityNameCustom: customization.activityNameCustom,
    detailsTemplate: customization.detailsTemplate,
    stateTemplate: customization.stateTemplate,
    activityType: customization.activityType,
    showTimestamps: customization.showTimestamps,
    largeImage: customization.largeImage,
    largeImageKey: customization.largeImageKey,
    smallImage: customization.smallImage,
    buttons: [],
  };
  if (song.album) post.album = song.album;
  // Cover URL only when Discord can fetch it: the Navidrome cover URL
  // is a local http:// address, so it is omitted and the relay sends
  // no large image (the logo asset is optional, not a fallback).
  const coverUrl = subsonicClient.getCoverArtUrl(song.coverArt, 300);
  if (coverUrl.startsWith('https://')) post.coverUrl = coverUrl;
  const trimmed = clientId.trim();
  if (DISCORD_CLIENT_ID_PATTERN.test(trimmed)) post.clientId = trimmed;
  // Buttons: only slots with both a label and a URL, in order.
  for (const [label, url] of [
    [customization.button1Label, customization.button1Url],
    [customization.button2Label, customization.button2Url],
  ] as const) {
    if (label.trim() !== '' && url.trim().startsWith('https://')) {
      post.buttons?.push({ label: label.trim(), url: url.trim() });
    }
  }
  return post;
}

/**
 * POST the presence, retrying a network/timeout failure (the relay
 * never saw the post) up to the bounded delays. The post is rebuilt
 * on every attempt, so a retried post carries the current position
 * instead of the stale event-time one: with the relay anchoring the
 * progress bar to the receipt time, a stale position would shift the
 * bar by the whole retry delay. `isCurrent` drops the retries when a
 * newer post supersedes this one. Exported for tests.
 */
export async function postPresence(
  buildPost: () => PresencePost,
  isCurrent: () => boolean = () => true,
  retryDelaysMs: readonly number[] = POST_RETRY_DELAYS_MS,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const post = buildPost();
    try {
      await relayFetch(
        '/api/presence',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(post),
        },
        5000,
      );
      return;
    } catch {
      // Silent by design (see the header comment).
      if (attempt >= retryDelaysMs.length || !isCurrent()) return;
      await sleep(retryDelaysMs[attempt]);
      if (!isCurrent()) return;
    }
  }
}

async function clearPresence(): Promise<void> {
  try {
    await relayFetch('/api/presence/clear', { method: 'POST' }, 5000);
  } catch {
    // Silent by design (see the header comment).
  }
}

/** Path the deck beacons to on page unload to clear a stale playing card. */
export const DISCORD_PRESENCE_CLEAR_PATH = '/api/presence/clear';

/**
 * Best-effort clear on page unload: without this, a refresh leaves
 * the relay (and Discord) showing the last playing card, because the
 * deck never posts again for a song that is no longer playing. A
 * sendBeacon survives the unload where a fetch would be cancelled.
 * Returns true when a beacon was queued. Exported for tests.
 */
export function clearPresenceOnUnload(): boolean {
  if (!useSettingsStore.getState().discordRpcEnabled) return false;
  try {
    const nav = (globalThis as { navigator?: { sendBeacon?: (url: string) => boolean } })
      .navigator;
    const beacon = nav?.sendBeacon?.bind(nav);
    if (!beacon) return false;
    return beacon(DISCORD_PRESENCE_CLEAR_PATH);
  } catch {
    return false;
  }
}

export interface DiscordPresenceStatus {
  configured: boolean;
  clientIdSet: boolean;
  discordConnected: boolean;
  lastUpdateAt: number | null;
  throttledUntilMs: number;
}

export async function fetchDiscordPresenceStatus(): Promise<DiscordPresenceStatus> {
  const res = await relayFetch('/api/presence/status', {}, 5000);
  return readJson<DiscordPresenceStatus>(res, 'Discord presence status check');
}

type PlaybackSnapshot = ReturnType<typeof usePlaybackStore.getState>;

/** True when any Discord customization setting changed between two store snapshots. */
function discordCustomizationChanged(
  state: ReturnType<typeof useSettingsStore.getState>,
  prev: ReturnType<typeof useSettingsStore.getState>,
): boolean {
  return (
    state.discordRpcActivityName !== prev.discordRpcActivityName ||
    state.discordRpcActivityNameCustom !== prev.discordRpcActivityNameCustom ||
    state.discordRpcDetailsTemplate !== prev.discordRpcDetailsTemplate ||
    state.discordRpcStateTemplate !== prev.discordRpcStateTemplate ||
    state.discordRpcActivityType !== prev.discordRpcActivityType ||
    state.discordRpcShowTimestamps !== prev.discordRpcShowTimestamps ||
    state.discordRpcLargeImage !== prev.discordRpcLargeImage ||
    state.discordRpcLargeImageKey !== prev.discordRpcLargeImageKey ||
    state.discordRpcSmallImage !== prev.discordRpcSmallImage ||
    state.discordRpcButton1Label !== prev.discordRpcButton1Label ||
    state.discordRpcButton1Url !== prev.discordRpcButton1Url ||
    state.discordRpcButton2Label !== prev.discordRpcButton2Label ||
    state.discordRpcButton2Url !== prev.discordRpcButton2Url
  );
}

/** Mount once at the App root. Never in the player bar. */
export function useDiscordPresence(): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSongIdRef = useRef<string | null>(null);
  const hadSongRef = useRef(false);
  // Bumps on every scheduled post; a retry in flight checks it so a
  // newer post supersedes the retries of the older one.
  const postGenerationRef = useRef(0);

  useEffect(() => {
    const schedulePost = (song: SubsonicSong) => {
      if (!useSettingsStore.getState().discordRpcEnabled) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      const generation = ++postGenerationRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // Rebuild on every attempt (including retries): the position
        // and playing flag are read fresh from the store, so a post
        // retried past the track-change burst still carries the
        // current position instead of the stale event-time one.
        const buildPost = (): PresencePost => {
          const playback = usePlaybackStore.getState();
          const settings = useSettingsStore.getState();
          return buildPresencePost(
            song,
            playback.currentTime,
            playback.isPlaying,
            settings.discordRpcClientId,
            {
              activityName: settings.discordRpcActivityName,
              activityNameCustom: settings.discordRpcActivityNameCustom,
              detailsTemplate: settings.discordRpcDetailsTemplate,
              stateTemplate: settings.discordRpcStateTemplate,
              activityType: settings.discordRpcActivityType,
              showTimestamps: settings.discordRpcShowTimestamps,
              largeImage: settings.discordRpcLargeImage,
              largeImageKey: settings.discordRpcLargeImageKey,
              smallImage: settings.discordRpcSmallImage,
              button1Label: settings.discordRpcButton1Label,
              button1Url: settings.discordRpcButton1Url,
              button2Label: settings.discordRpcButton2Label,
              button2Url: settings.discordRpcButton2Url,
            },
          );
        };
        void postPresence(buildPost, () => generation === postGenerationRef.current);
      }, POST_DEBOUNCE_MS);
    };

    const handlePlayback = (state: PlaybackSnapshot, prev: PlaybackSnapshot) => {
      const song = state.currentSong();
      if (!song) {
        if (hadSongRef.current) {
          hadSongRef.current = false;
          lastSongIdRef.current = null;
          if (timerRef.current) clearTimeout(timerRef.current);
          if (useSettingsStore.getState().discordRpcEnabled) void clearPresence();
        }
        return;
      }
      hadSongRef.current = true;
      const songId = song.id;
      const prevSongId = prev.currentSong()?.id ?? null;
      const trackChanged = songId !== prevSongId || songId !== lastSongIdRef.current;
      const playChanged = state.isPlaying !== prev.isPlaying;
      const seeked =
        !trackChanged && Math.abs(state.currentTime - prev.currentTime) > SEEK_JUMP_SECONDS;
      if (trackChanged || playChanged || seeked) {
        lastSongIdRef.current = songId;
        schedulePost(song);
      }
    };

    const unsubPlayback = usePlaybackStore.subscribe(handlePlayback);
    // Toggle flips: on with a song playing posts the current state once;
    // off clears once. Customization edits re-post the current song so
    // the Discord card follows the new settings without waiting for
    // the next track change.
    const unsubSettings = useSettingsStore.subscribe((state, prev) => {
      if (state.discordRpcEnabled !== prev.discordRpcEnabled) {
        if (state.discordRpcEnabled) {
          const playback = usePlaybackStore.getState();
          const song = playback.currentSong();
          if (song) schedulePost(song);
        } else {
          if (timerRef.current) clearTimeout(timerRef.current);
          void clearPresence();
        }
        return;
      }
      if (!state.discordRpcEnabled) return;
      if (!discordCustomizationChanged(state, prev)) return;
      const playback = usePlaybackStore.getState();
      const song = playback.currentSong();
      if (song) schedulePost(song);
    });

    // Mount while a track is already playing: post the current state.
    if (useSettingsStore.getState().discordRpcEnabled) {
      const playback = usePlaybackStore.getState();
      const song = playback.currentSong();
      if (song) {
        hadSongRef.current = true;
        lastSongIdRef.current = song.id;
        schedulePost(song);
      }
    }

    // Page unload (refresh, close, navigate away): clear the presence
    // so Discord does not keep showing the last playing card. The
    // reload restores the queue stopped and posts a paused state, so
    // the card comes back as Paused, not Playing.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', clearPresenceOnUnload);
      window.addEventListener('beforeunload', clearPresenceOnUnload);
    }

    return () => {
      unsubPlayback();
      unsubSettings();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', clearPresenceOnUnload);
        window.removeEventListener('beforeunload', clearPresenceOnUnload);
      }
    };
  }, []);
}
