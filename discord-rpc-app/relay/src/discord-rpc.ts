// discord-rpc.ts - Discord Rich Presence bridge for the relay.
//
// The deck (browser) cannot reach Discord IPC, so the relay owns the IPC
// connection and exposes it over HTTP (POST /api/presence). The daemon
// throttles to at most one SET_ACTIVITY per 15 s and coalesces the latest
// track state; Discord renders the progress bar from timestamps.
//
// Transport: @xhayper/discord-rpc (maintained fork, IPC transport),
// smoke-tested under Bun 1.4.4. The socket search is a custom path list
// that covers $XDG_RUNTIME_DIR, $TMPDIR and /tmp for discord-ipc-0..9
// (the fork's default list only tries ONE temp dir: the first env var
// that is set). That matters for Vesktop on NixOS, which exposes the
// standard Unix socket $XDG_RUNTIME_DIR/discord-ipc-0, same as the
// official Discord desktop client. The Flatpak socket dance
// ($XDG_RUNTIME_DIR/app/dev.vencord.Vesktop/...) does not apply here:
// the user installs Vesktop natively from nixpkgs.
//
// The client ID is an 18-digit Application ID: public, not a secret, but
// it is never logged and never echoed in any response (status reports a
// boolean clientIdSet only).

import { join } from 'node:path';
import { Client } from '@xhayper/discord-rpc';

export const PRESENCE_THROTTLE_MS = 15_000;
export const CLIENT_ID_PATTERN = /^\d{1,19}$/;
export const MAX_TEXT_LENGTH = 128;
export const MAX_BUTTON_LABEL_LENGTH = 32;
/** How often the stale-playing expiry is checked. */
const PRESENCE_EXPIRY_CHECK_MS = 30_000;
/** A playing activity is stale this long after its track end. */
const PRESENCE_STALE_GRACE_MS = 60_000;

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

export type DiscordRpcActivityName = 'title' | 'app' | 'custom';
export type DiscordRpcActivityType = 'listening' | 'playing';
export type DiscordRpcLargeImage = 'cover' | 'asset' | 'none';
export type DiscordRpcSmallImage = 'playpause' | 'none';

export const ACTIVITY_NAMES: readonly DiscordRpcActivityName[] = ['title', 'app', 'custom'];
export const ACTIVITY_TYPES: readonly DiscordRpcActivityType[] = ['listening', 'playing'];
export const LARGE_IMAGES: readonly DiscordRpcLargeImage[] = ['cover', 'asset', 'none'];
export const SMALL_IMAGES: readonly DiscordRpcSmallImage[] = ['playpause', 'none'];

export interface PresenceButton {
  label: string;
  url: string;
}

export interface PresenceInput {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  positionSec: number;
  playing: boolean;
  coverUrl?: string;
  clientId?: string;
  /** Card header: song title (default), portal app name, or custom text. */
  activityName?: DiscordRpcActivityName;
  /** Custom header text (only when activityName is 'custom'). */
  activityNameCustom?: string;
  /** Details-line template, e.g. '{title}' (default). */
  detailsTemplate?: string;
  /** State-line template, e.g. '{artist} - {album}' (default). */
  stateTemplate?: string;
  activityType?: DiscordRpcActivityType;
  showTimestamps?: boolean;
  largeImage?: DiscordRpcLargeImage;
  /** Asset key used when largeImage is 'asset' (default 'logo'). */
  largeImageKey?: string;
  smallImage?: DiscordRpcSmallImage;
  buttons?: PresenceButton[];
}

export interface PresenceActivity {
  name?: string;
  type: 2 | 0;
  details?: string;
  state?: string;
  timestamps?: { start: number; end?: number };
  assets: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  buttons?: PresenceButton[];
}

export interface PresenceStatus {
  configured: boolean;
  clientIdSet: boolean;
  discordConnected: boolean;
  lastUpdateAt: number | null;
  throttledUntilMs: number;
}

export interface PresencePostResult {
  queued: boolean;
  discordConnected: boolean;
}

function truncateText(value: string, max: number = MAX_TEXT_LENGTH): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Render a details/state template: {title}, {artist} and {album}
 * placeholders. A dangling separator left by an empty album (a
 * trailing " -" or a leading "- ") is stripped, runs of 2+ spaces
 * collapse to one, and the result is trimmed. An empty result means
 * the line is omitted from the activity. Pure; exported for tests.
 * The deck preview (deck/src/services/discordPresence.ts) mirrors
 * this function; keep the two in sync.
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

/**
 * Pure payload mapping (research report section 5). Exported for tests.
 * `receivedAtSec` is the time the POST arrived at the relay, NOT the
 * time the activity is sent: a send delayed by the 15 s throttle
 * must not shift the track start forward, or Discord's progress bar
 * lags real playback by the whole wait. Callers pass the receipt
 * time; see DiscordPresence.trySendNow.
 */
export function buildActivity(input: PresenceInput, receivedAtSec: number): PresenceActivity {
  const activityName = input.activityName ?? 'title';
  const detailsTemplate = input.detailsTemplate ?? '{title}';
  const stateTemplate = input.stateTemplate ?? '{artist} - {album}';
  const activityType = input.activityType ?? 'listening';
  const showTimestamps = input.showTimestamps ?? true;
  const largeImage = input.largeImage ?? 'cover';
  const smallImage = input.smallImage ?? 'playpause';
  const details = truncateText(renderPresenceTemplate(detailsTemplate, input));
  const state = truncateText(renderPresenceTemplate(stateTemplate, input));
  const start = Math.max(0, Math.floor(receivedAtSec - input.positionSec));
  const activity: PresenceActivity = {
    type: activityType === 'playing' ? 0 : 2,
    assets: {},
  };
  // `name` resolves from the activity-name mode. `title` is the track
  // title (verified on Vesktop: Discord honors it, so the card reads
  // "Listening to <song>"). `app` omits the key entirely, so Discord
  // uses the portal application name. `custom` uses the custom text,
  // falling back to the title when it is blank.
  if (activityName === 'custom') {
    const custom = (input.activityNameCustom ?? '').trim();
    activity.name = truncateText(custom ? custom : input.title);
  } else if (activityName === 'title') {
    activity.name = truncateText(input.title);
  }
  if (details) activity.details = details;
  if (state) activity.state = state;
  // Large image: `cover` follows the album cover, but only when
  // Discord can fetch it (a public https:// URL; a local http://
  // cover URL is unreachable from Discord's servers, so no large
  // image is sent then). `asset` uses the configured asset key.
  // `none` sends no large image. No `logo` fallback is forced.
  if (largeImage === 'cover') {
    if (input.coverUrl && input.coverUrl.startsWith('https://')) {
      activity.assets.large_image = input.coverUrl;
    }
  } else if (largeImage === 'asset') {
    const key = (input.largeImageKey ?? 'logo').trim() || 'logo';
    activity.assets.large_image = key;
  }
  if (input.album && input.album.trim()) {
    activity.assets.large_text = truncateText(input.album.trim());
  }
  if (smallImage === 'playpause') {
    activity.assets.small_image = input.playing ? 'play' : 'pause';
    activity.assets.small_text = input.playing ? 'Playing' : 'Paused';
  }
  if (showTimestamps) {
    if (input.playing) {
      activity.timestamps = { start, end: start + Math.max(0, Math.floor(input.durationSec)) };
    } else {
      // Paused: omit end so the bar does not keep counting. Start alone
      // still shows elapsed time; Discord treats a missing end as no
      // countdown.
      activity.timestamps = { start };
    }
  }
  // Buttons: only valid ones (non-empty label, https URL), at most 2,
  // in order. Labels longer than 32 chars are truncated, not rejected.
  const buttons = (input.buttons ?? [])
    .filter((b) => b.label.trim() !== '' && b.url.startsWith('https://'))
    .slice(0, 2)
    .map((b) => ({ label: truncateText(b.label.trim(), MAX_BUTTON_LABEL_LENGTH), url: b.url }));
  if (buttons.length > 0) activity.buttons = buttons;
  return activity;
}

export type ValidationResult =
  | { ok: true; input: PresenceInput }
  | { ok: false; code: string; message: string };

function invalid(code: string, message: string): ValidationResult {
  return { ok: false, code, message };
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Pure body validation for POST /api/presence. Exported for tests. */
export function validatePresenceInput(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalid('invalid_body', 'Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  if (typeof b.title !== 'string' || !b.title.trim()) {
    return invalid('invalid_title', 'title must be a non-empty string');
  }
  if (typeof b.artist !== 'string' || !b.artist.trim()) {
    return invalid('invalid_artist', 'artist must be a non-empty string');
  }
  if (typeof b.durationSec !== 'number' || !Number.isFinite(b.durationSec) || b.durationSec < 0) {
    return invalid('invalid_duration', 'durationSec must be a number >= 0');
  }
  if (typeof b.positionSec !== 'number' || !Number.isFinite(b.positionSec) || b.positionSec < 0) {
    return invalid('invalid_position', 'positionSec must be a number >= 0');
  }
  if (b.durationSec > 0 && b.positionSec > b.durationSec) {
    return invalid('invalid_position', 'positionSec must not exceed durationSec');
  }
  if (typeof b.playing !== 'boolean') {
    return invalid('invalid_playing', 'playing must be a boolean');
  }
  if (b.album !== undefined && typeof b.album !== 'string') {
    return invalid('invalid_album', 'album must be a string');
  }
  if (b.coverUrl !== undefined && typeof b.coverUrl !== 'string') {
    return invalid('invalid_cover_url', 'coverUrl must be a string');
  }
  if (b.clientId !== undefined) {
    if (typeof b.clientId !== 'string' || !CLIENT_ID_PATTERN.test(b.clientId.trim())) {
      return invalid('invalid_client_id', 'clientId must be a numeric Application ID');
    }
  }
  if (b.activityName !== undefined && !isEnumValue(b.activityName, ACTIVITY_NAMES)) {
    return invalid('invalid_activity_name', "activityName must be 'title', 'app' or 'custom'");
  }
  if (b.activityNameCustom !== undefined && typeof b.activityNameCustom !== 'string') {
    return invalid('invalid_activity_name_custom', 'activityNameCustom must be a string');
  }
  if (b.detailsTemplate !== undefined && typeof b.detailsTemplate !== 'string') {
    return invalid('invalid_details_template', 'detailsTemplate must be a string');
  }
  if (b.stateTemplate !== undefined && typeof b.stateTemplate !== 'string') {
    return invalid('invalid_state_template', 'stateTemplate must be a string');
  }
  if (b.activityType !== undefined && !isEnumValue(b.activityType, ACTIVITY_TYPES)) {
    return invalid('invalid_activity_type', "activityType must be 'listening' or 'playing'");
  }
  if (b.showTimestamps !== undefined && typeof b.showTimestamps !== 'boolean') {
    return invalid('invalid_show_timestamps', 'showTimestamps must be a boolean');
  }
  if (b.largeImage !== undefined && !isEnumValue(b.largeImage, LARGE_IMAGES)) {
    return invalid('invalid_large_image', "largeImage must be 'cover', 'asset' or 'none'");
  }
  if (b.largeImageKey !== undefined && typeof b.largeImageKey !== 'string') {
    return invalid('invalid_large_image_key', 'largeImageKey must be a string');
  }
  if (b.smallImage !== undefined && !isEnumValue(b.smallImage, SMALL_IMAGES)) {
    return invalid('invalid_small_image', "smallImage must be 'playpause' or 'none'");
  }
  let buttons: PresenceButton[] | undefined;
  if (b.buttons !== undefined) {
    if (!Array.isArray(b.buttons)) {
      return invalid('invalid_button', 'buttons must be an array');
    }
    buttons = [];
    for (const entry of b.buttons as unknown[]) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return invalid('invalid_button', 'each button must be an object with label and url');
      }
      const e = entry as Record<string, unknown>;
      if (typeof e.label !== 'string' || e.label.trim() === '') {
        return invalid('invalid_button', 'each button needs a non-empty label');
      }
      if (typeof e.url !== 'string' || !e.url.startsWith('https://')) {
        return invalid('invalid_button', 'each button URL must start with https://');
      }
      buttons.push({ label: e.label.trim(), url: e.url.trim() });
    }
  }
  return {
    ok: true,
    input: {
      title: b.title.trim(),
      artist: b.artist.trim(),
      album: typeof b.album === 'string' ? b.album.trim() : undefined,
      durationSec: b.durationSec,
      positionSec: b.positionSec,
      playing: b.playing,
      coverUrl: typeof b.coverUrl === 'string' ? b.coverUrl : undefined,
      clientId: typeof b.clientId === 'string' ? b.clientId.trim() : undefined,
      activityName: isEnumValue(b.activityName, ACTIVITY_NAMES) ? b.activityName : undefined,
      activityNameCustom:
        typeof b.activityNameCustom === 'string' ? b.activityNameCustom : undefined,
      detailsTemplate: typeof b.detailsTemplate === 'string' ? b.detailsTemplate : undefined,
      stateTemplate: typeof b.stateTemplate === 'string' ? b.stateTemplate : undefined,
      activityType: isEnumValue(b.activityType, ACTIVITY_TYPES) ? b.activityType : undefined,
      showTimestamps: typeof b.showTimestamps === 'boolean' ? b.showTimestamps : undefined,
      largeImage: isEnumValue(b.largeImage, LARGE_IMAGES) ? b.largeImage : undefined,
      largeImageKey: typeof b.largeImageKey === 'string' ? b.largeImageKey : undefined,
      smallImage: isEnumValue(b.smallImage, SMALL_IMAGES) ? b.smallImage : undefined,
      buttons,
    },
  };
}

/**
 * IPC socket search. The fork's default list resolves ONE temp dir
 * (XDG_RUNTIME_DIR ?? TMPDIR ?? TMP ?? TEMP ?? /tmp), so a socket in a
 * different dir is missed. This list tries every candidate dir for ids
 * 0..9: $XDG_RUNTIME_DIR, $TMPDIR, then /tmp, plus the snap and Flatpak
 * variants the fork ships (superset of its defaults, never fewer).
 * Vesktop installed natively from nixpkgs uses the first entry.
 */
export function ipcSocketPathList(): Array<{
  platform: NodeJS.Platform[];
  format: (id: number) => string;
}> {
  const env = process.env;
  const dirs: string[] = [];
  for (const dir of [env.XDG_RUNTIME_DIR, env.TMPDIR, '/tmp']) {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  }
  const unixPlatforms: NodeJS.Platform[] = ['darwin', 'linux', 'freebsd', 'openbsd', 'netbsd'];
  const list: Array<{ platform: NodeJS.Platform[]; format: (id: number) => string }> = [
    {
      platform: ['win32'],
      format: (id) => `\\\\?\\pipe\\discord-ipc-${id}`,
    },
    ...dirs.map((dir) => ({
      platform: unixPlatforms,
      format: (id: number) => join(dir, `discord-ipc-${id}`),
    })),
    {
      platform: ['linux'],
      format: (id: number) => join(dirs[0] ?? '/tmp', 'snap.discord', `discord-ipc-${id}`),
    },
    ...['com.discordapp.Discord', 'com.discordapp.DiscordCanary', 'com.discordapp.DiscordPTB', 'dev.vencord.Vesktop'].map(
      (app) => ({
        platform: ['linux'] as NodeJS.Platform[],
        format: (id: number) => join(dirs[0] ?? '/tmp', 'app', app, `discord-ipc-${id}`),
      }),
    ),
  ];
  return list;
}

/** Minimal surface of the fork Client used here, so tests can inject a fake. */
export interface RpcClientLike {
  readonly isConnected: boolean;
  login(): Promise<void>;
  request(cmd: string, args: unknown): Promise<unknown>;
  destroy(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscordPresenceOptions {
  /** Override for tests: replaces the real @xhayper/discord-rpc Client. */
  clientFactory?: (clientId: string) => RpcClientLike;
  /** Override for tests: throttle window in ms. */
  throttleMs?: number;
  /** Override for tests: clock in ms. */
  now?: () => number;
}

export class PresenceNotConfiguredError extends Error {
  readonly code = 'discord_rpc_not_configured';
  constructor() {
    super('Discord RPC is not configured: no client ID available');
  }
}

function resolveEnvClientId(): string | undefined {
  const raw = process.env.DISCORD_CLIENT_ID?.trim();
  if (!raw) return undefined;
  if (!CLIENT_ID_PATTERN.test(raw)) {
    console.warn('[Discord RPC] DISCORD_CLIENT_ID is set but is not a numeric Application ID; ignoring it.');
    return undefined;
  }
  return raw;
}

/**
 * Owns the Discord IPC connection: lazy login, reconnect with
 * exponential back-off, 15 s throttle with coalescing of the latest
 * state. Never logs the client ID value.
 *
 * Freshness rules (presence-freshness fix, 2026-11-15):
 * - Timestamps anchor to the POST arrival time, not the send time,
 *   so a throttled send does not shift the progress bar.
 * - A pending update that lands while the throttle window is still
 *   closed is flushed when the window opens, even when it arrived
 *   during a reconnect.
 * - A playing activity whose track ended over a minute ago with no
 *   newer post is cleared (the deck died without an unload beacon).
 *   Paused cards never auto-expire: a paused song can sit for hours.
 */
export class DiscordPresence {
  private envClientId: string | undefined;
  private postedClientId: string | undefined;
  private client: RpcClientLike | null = null;
  private clientGeneration = 0;
  private loginInFlight = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: PresenceInput | null = null;
  /** Wall time (ms) the pending POST arrived; the timestamp anchor. */
  private pendingReceivedAtMs = 0;
  private lastSentAtMs = 0;
  private lastUpdateAt: number | null = null;
  /** End (sec) of the last activity actually sent; null when unknown. */
  private lastSentEndSec: number | null = null;
  private lastSentPlaying = false;
  private expiryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly throttleMs: number;
  private readonly now: () => number;
  private readonly clientFactory: (clientId: string) => RpcClientLike;

  constructor(options: DiscordPresenceOptions = {}) {
    this.envClientId = resolveEnvClientId();
    this.throttleMs = options.throttleMs ?? PRESENCE_THROTTLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.clientFactory =
      options.clientFactory ??
      ((clientId: string) => {
        const real = new Client({
          clientId,
          transport: { type: 'ipc', pathList: ipcSocketPathList() },
        });
        return real as unknown as RpcClientLike;
      });
  }

  get configured(): boolean {
    return this.clientId !== undefined;
  }

  get clientId(): string | undefined {
    return this.postedClientId ?? this.envClientId;
  }

  get discordConnected(): boolean {
    return this.client?.isConnected ?? false;
  }

  /** A posted clientId takes precedence over the env config. */
  setClientId(clientId: string | undefined): void {
    const next = clientId?.trim() || undefined;
    if (next === this.postedClientId) return;
    this.postedClientId = next;
    // A different client ID means a different Discord application:
    // drop the old connection so the next post logs in with the new one.
    void this.dropClient();
  }

  /**
   * Queue (or send) a presence update. Throws PresenceNotConfiguredError
   * when no client ID is available anywhere. Never awaits the Discord
   * connection: when Discord is down the state is queued and flushed on
   * reconnect.
   */
  async post(input: PresenceInput): Promise<PresencePostResult> {
    if (input.clientId) this.setClientId(input.clientId);
    if (!this.clientId) throw new PresenceNotConfiguredError();
    this.pending = input;
    this.pendingReceivedAtMs = this.now();
    if (this.discordConnected) {
      if (this.trySendNow()) return { queued: false, discordConnected: true };
      this.scheduleFlush();
      return { queued: true, discordConnected: true };
    }
    void this.ensureConnected();
    return { queued: true, discordConnected: false };
  }

  /** Clear presence immediately (ignores the throttle) and drop queued state. */
  async clear(): Promise<void> {
    this.pending = null;
    this.pendingReceivedAtMs = 0;
    this.lastSentEndSec = null;
    this.lastSentPlaying = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.discordConnected || !this.client) return;
    try {
      await this.client.request('SET_ACTIVITY', { pid: process.pid, activity: null });
      // The null activity is itself a SET_ACTIVITY, so it consumes
      // the rate-limit window: the next post waits the remainder
      // instead of firing a second update inside the window and
      // being dropped by Discord.
      this.lastSentAtMs = this.now();
      this.lastUpdateAt = this.now();
    } catch (err) {
      console.warn('[Discord RPC] Clear failed:', (err as Error).message);
    }
  }

  /**
   * Clear a playing activity whose track ended over a minute ago
   * with no newer post arriving (the deck died or was killed without
   * an unload beacon). Only playing activities expire: a paused card
   * can sit legitimately for hours. Returns true when it cleared.
   * Called by the expiry timer; public so tests can drive it with a
   * fake clock.
   */
  expireStaleActivity(): boolean {
    if (this.pending || !this.lastSentPlaying || this.lastSentEndSec === null) return false;
    if (this.now() / 1000 <= this.lastSentEndSec + PRESENCE_STALE_GRACE_MS / 1000) return false;
    void this.clear();
    return true;
  }

  /**
   * Status for GET /api/presence/status. Kicks off a lazy login attempt
   * when configured but not connected (fire and forget). Never includes
   * the client ID value.
   */
  status(): PresenceStatus {
    if (this.configured && !this.discordConnected) void this.ensureConnected();
    return {
      configured: this.configured,
      clientIdSet: this.clientId !== undefined,
      discordConnected: this.discordConnected,
      lastUpdateAt: this.lastUpdateAt,
      throttledUntilMs: Math.max(0, this.lastSentAtMs + this.throttleMs - this.now()),
    };
  }

  /** Clear presence and close the IPC connection (process shutdown). */
  async shutdown(): Promise<void> {
    if (this.expiryTimer) {
      clearInterval(this.expiryTimer);
      this.expiryTimer = null;
    }
    await this.clear();
    await this.dropClient();
  }

  private async dropClient(): Promise<void> {
    this.clientGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.client;
    this.client = null;
    if (old) {
      try {
        await old.destroy();
      } catch {
        // Already gone; nothing to do.
      }
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.discordConnected) return true;
    if (this.loginInFlight || !this.clientId) return false;
    this.loginInFlight = true;
    try {
      const generation = this.clientGeneration;
      const client = this.clientFactory(this.clientId);
      this.client = client;
      client.on('disconnected', () => {
        if (generation !== this.clientGeneration) return;
        console.warn('[Discord RPC] Disconnected from Discord; will retry.');
        void this.dropClient().then(() => this.scheduleReconnect());
      });
      await client.login();
      if (generation !== this.clientGeneration) return false;
      if (!client.isConnected) return false;
      this.reconnectDelayMs = RECONNECT_BASE_MS;
      if (this.pending) {
        // A pending update that lands while the throttle window is
        // still closed must be flushed when the window opens: without
        // this, a song change posted during a reconnect sits unsent
        // until the next playback event.
        if (!this.trySendNow()) this.scheduleFlush();
      }
      return true;
    } catch (err) {
      console.warn('[Discord RPC] Could not connect to Discord:', (err as Error).message);
      await this.dropClient();
      this.scheduleReconnect();
      return false;
    } finally {
      this.loginInFlight = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.configured) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, delay);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const wait = this.lastSentAtMs + this.throttleMs - this.now();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.trySendNow();
    }, Math.max(0, wait));
  }

  /** Send the pending state now if the throttle window is open. */
  private trySendNow(): boolean {
    if (!this.pending || !this.discordConnected || !this.client) return false;
    const nowMs = this.now();
    if (nowMs - this.lastSentAtMs < this.throttleMs && this.lastSentAtMs !== 0) return false;
    const input = this.pending;
    this.pending = null;
    this.lastSentAtMs = nowMs;
    // Anchor the progress bar to when the POST arrived, not when the
    // throttle opened: a send delayed by the 15 s window must not
    // shift the track start forward, or Discord's bar lags real
    // playback by the whole wait.
    const anchorMs = this.pendingReceivedAtMs > 0 ? this.pendingReceivedAtMs : nowMs;
    this.pendingReceivedAtMs = 0;
    const activity = buildActivity(input, Math.floor(anchorMs / 1000));
    this.lastSentPlaying = input.playing;
    this.lastSentEndSec = activity.timestamps?.end ?? null;
    this.startExpiryTimer();
    void this.client
      .request('SET_ACTIVITY', { pid: process.pid, activity })
      .then(() => {
        this.lastUpdateAt = this.now();
      })
      .catch((err: unknown) => {
        console.warn('[Discord RPC] SET_ACTIVITY failed:', (err as Error).message);
      });
    return true;
  }

  /** Start the stale-playing check once, on the first real send. */
  private startExpiryTimer(): void {
    if (this.expiryTimer) return;
    this.expiryTimer = setInterval(() => {
      this.expireStaleActivity();
    }, PRESENCE_EXPIRY_CHECK_MS);
    // Never keep a test or a CLI process alive for the timer alone.
    const timer = this.expiryTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }
}

/** Process-wide singleton used by the relay routes. */
export const presence = new DiscordPresence();
