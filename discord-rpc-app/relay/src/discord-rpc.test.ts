// discord-rpc.test.ts - unit tests for the Discord presence bridge.
// No real Discord IPC connection is opened here: the DiscordPresence
// class takes an injected fake transport, and the payload/validation
// helpers are pure functions.

import { describe, expect, it } from 'bun:test';
import {
  DiscordPresence,
  PresenceNotConfiguredError,
  buildActivity,
  ipcSocketPathList,
  renderPresenceTemplate,
  validatePresenceInput,
  type PresenceInput,
  type RpcClientLike,
} from './discord-rpc';

const BASE_INPUT: PresenceInput = {
  title: 'Namonaki',
  artist: 'MyGO!!!!!',
  album: 'Meisekiha',
  durationSec: 254,
  positionSec: 83,
  playing: true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fake RPC client: records SET_ACTIVITY calls, never touches a socket. */
class FakeRpcClient implements RpcClientLike {
  isConnected = false;
  requests: Array<{ cmd: string; args: unknown }> = [];
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }

  async login(): Promise<void> {
    this.isConnected = true;
  }

  async request(cmd: string, args: unknown): Promise<unknown> {
    this.requests.push({ cmd, args });
    return {};
  }

  async destroy(): Promise<void> {
    this.isConnected = false;
  }
}

describe('buildActivity payload mapping', () => {
  it('maps title/artist/album to details/state with Listening type', () => {
    const activity = buildActivity(BASE_INPUT, 1_000_000);
    expect(activity.type).toBe(2);
    expect(activity.details).toBe('Namonaki');
    expect(activity.state).toBe('MyGO!!!!! - Meisekiha');
    expect(activity.name).toBe('Namonaki');
  });

  it('truncates details and state to 128 chars', () => {
    const long = 'x'.repeat(200);
    const activity = buildActivity({ ...BASE_INPUT, title: long, artist: long, album: long }, 1_000_000);
    expect(activity.details.length).toBe(128);
    expect(activity.state.length).toBe(128);
    expect(activity.name.length).toBe(128);
  });

  it('omits the album from state when empty', () => {
    const activity = buildActivity({ ...BASE_INPUT, album: '' }, 1_000_000);
    expect(activity.state).toBe('MyGO!!!!!');
    expect(activity.assets.large_text).toBeUndefined();
  });

  it('computes timestamps from position and duration while playing', () => {
    const activity = buildActivity(BASE_INPUT, 1_000_000);
    expect(activity.timestamps).toEqual({ start: 1_000_000 - 83, end: 1_000_000 - 83 + 254 });
  });

  it('omits end timestamp when paused so the bar does not keep counting', () => {
    const activity = buildActivity({ ...BASE_INPUT, playing: false }, 1_000_000);
    expect(activity.timestamps).toEqual({ start: 1_000_000 - 83 });
    expect(activity.timestamps?.end).toBeUndefined();
    expect(activity.assets.small_image).toBe('pause');
    expect(activity.assets.small_text).toBe('Paused');
  });

  it('uses the https cover URL and omits the large image otherwise', () => {
    const https = buildActivity({ ...BASE_INPUT, coverUrl: 'https://example.com/cover.jpg' }, 1_000_000);
    expect(https.assets.large_image).toBe('https://example.com/cover.jpg');
    const http = buildActivity({ ...BASE_INPUT, coverUrl: 'http://127.0.0.1:4533/rest/getCoverArt.view?id=1' }, 1_000_000);
    expect(http.assets.large_image).toBeUndefined();
    const none = buildActivity(BASE_INPUT, 1_000_000);
    expect(none.assets.large_image).toBeUndefined();
  });

  it('uses the play small image while playing', () => {
    const activity = buildActivity(BASE_INPUT, 1_000_000);
    expect(activity.assets.small_image).toBe('play');
  });
});

describe('renderPresenceTemplate', () => {
  const values = { title: 'Namonaki', artist: 'MyGO!!!!!', album: 'Meisekiha' };

  it('replaces all three placeholders', () => {
    expect(renderPresenceTemplate('{title} by {artist} ({album})', values)).toBe(
      'Namonaki by MyGO!!!!! (Meisekiha)',
    );
  });

  it('strips a trailing dangling separator when the album is empty', () => {
    expect(renderPresenceTemplate('{artist} - {album}', { ...values, album: '' })).toBe(
      'MyGO!!!!!',
    );
  });

  it('strips a leading dangling separator when the album is empty', () => {
    expect(renderPresenceTemplate('{album} - {artist}', { ...values, album: '' })).toBe(
      'MyGO!!!!!',
    );
  });

  it('renders empty when the template is only an empty placeholder', () => {
    expect(renderPresenceTemplate('{album}', { ...values, album: '' })).toBe('');
  });

  it('collapses runs of spaces left by an empty placeholder', () => {
    expect(renderPresenceTemplate('{title}  {album}  live', { ...values, album: '' })).toBe(
      'Namonaki live',
    );
  });
});

describe('buildActivity customization', () => {
  it('omits name entirely for activityName app', () => {
    const activity = buildActivity({ ...BASE_INPUT, activityName: 'app' }, 1_000_000);
    expect(activity.name).toBeUndefined();
    expect('name' in activity).toBe(false);
  });

  it('uses the custom name, falling back to the title when blank', () => {
    const custom = buildActivity(
      { ...BASE_INPUT, activityName: 'custom', activityNameCustom: 'My radio' },
      1_000_000,
    );
    expect(custom.name).toBe('My radio');
    const blank = buildActivity(
      { ...BASE_INPUT, activityName: 'custom', activityNameCustom: '   ' },
      1_000_000,
    );
    expect(blank.name).toBe('Namonaki');
  });

  it('uses type 0 for activityType playing', () => {
    const activity = buildActivity({ ...BASE_INPUT, activityType: 'playing' }, 1_000_000);
    expect(activity.type).toBe(0);
  });

  it('renders details and state from templates, omitting empty lines', () => {
    const activity = buildActivity(
      {
        ...BASE_INPUT,
        detailsTemplate: '{artist} - {title}',
        stateTemplate: '{album}',
      },
      1_000_000,
    );
    expect(activity.details).toBe('MyGO!!!!! - Namonaki');
    expect(activity.state).toBe('Meisekiha');
    const empty = buildActivity({ ...BASE_INPUT, stateTemplate: '{album}', album: '' }, 1_000_000);
    expect(empty.state).toBeUndefined();
    expect('state' in empty).toBe(false);
  });

  it('truncates rendered details/state/name to 128 chars', () => {
    const long = 'y'.repeat(200);
    const activity = buildActivity(
      {
        ...BASE_INPUT,
        detailsTemplate: long,
        stateTemplate: long,
        activityName: 'custom',
        activityNameCustom: long,
      },
      1_000_000,
    );
    expect(activity.details?.length).toBe(128);
    expect(activity.state?.length).toBe(128);
    expect(activity.name?.length).toBe(128);
  });

  it('omits timestamps entirely when showTimestamps is false', () => {
    const playing = buildActivity({ ...BASE_INPUT, showTimestamps: false }, 1_000_000);
    expect(playing.timestamps).toBeUndefined();
    const paused = buildActivity(
      { ...BASE_INPUT, playing: false, showTimestamps: false },
      1_000_000,
    );
    expect(paused.timestamps).toBeUndefined();
  });

  it('uses the asset key for largeImage asset, defaulting to logo', () => {
    const keyed = buildActivity(
      { ...BASE_INPUT, largeImage: 'asset', largeImageKey: 'cover-art' },
      1_000_000,
    );
    expect(keyed.assets.large_image).toBe('cover-art');
    const fallback = buildActivity({ ...BASE_INPUT, largeImage: 'asset' }, 1_000_000);
    expect(fallback.assets.large_image).toBe('logo');
  });

  it('omits the large image for largeImage none', () => {
    const activity = buildActivity(
      { ...BASE_INPUT, largeImage: 'none', coverUrl: 'https://example.com/cover.jpg' },
      1_000_000,
    );
    expect(activity.assets.large_image).toBeUndefined();
  });

  it('omits both small fields for smallImage none', () => {
    const activity = buildActivity({ ...BASE_INPUT, smallImage: 'none' }, 1_000_000);
    expect(activity.assets.small_image).toBeUndefined();
    expect(activity.assets.small_text).toBeUndefined();
  });

  it('includes one or two valid buttons, truncating long labels to 32', () => {
    const one = buildActivity(
      {
        ...BASE_INPUT,
        buttons: [{ label: 'Open', url: 'https://example.com/track' }],
      },
      1_000_000,
    );
    expect(one.buttons).toEqual([{ label: 'Open', url: 'https://example.com/track' }]);
    const two = buildActivity(
      {
        ...BASE_INPUT,
        buttons: [
          { label: 'A'.repeat(40), url: 'https://example.com/a' },
          { label: 'Second', url: 'https://example.com/b' },
          { label: 'Third', url: 'https://example.com/c' },
        ],
      },
      1_000_000,
    );
    expect(two.buttons?.length).toBe(2);
    expect(two.buttons?.[0].label.length).toBe(32);
    expect(two.buttons?.[1].label).toBe('Second');
  });

  it('drops invalid buttons in buildActivity (bad URL, empty label)', () => {
    const activity = buildActivity(
      {
        ...BASE_INPUT,
        buttons: [
          { label: 'Bad', url: 'http://example.com' },
          { label: '   ', url: 'https://example.com' },
          { label: 'Good', url: 'https://example.com/good' },
        ],
      },
      1_000_000,
    );
    expect(activity.buttons).toEqual([{ label: 'Good', url: 'https://example.com/good' }]);
  });
});

describe('validatePresenceInput', () => {
  it('accepts a valid body', () => {
    const result = validatePresenceInput({
      title: 'Song',
      artist: 'Artist',
      durationSec: 200,
      positionSec: 10,
      playing: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing title with a code', () => {
    const result = validatePresenceInput({ artist: 'A', durationSec: 0, positionSec: 0, playing: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_title');
  });

  it('rejects an empty artist', () => {
    const result = validatePresenceInput({ title: 'T', artist: '  ', durationSec: 0, positionSec: 0, playing: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_artist');
  });

  it('rejects position beyond duration', () => {
    const result = validatePresenceInput({ title: 'T', artist: 'A', durationSec: 100, positionSec: 101, playing: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_position');
  });

  it('rejects a negative duration', () => {
    const result = validatePresenceInput({ title: 'T', artist: 'A', durationSec: -1, positionSec: 0, playing: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_duration');
  });

  it('rejects a non-boolean playing flag', () => {
    const result = validatePresenceInput({ title: 'T', artist: 'A', durationSec: 0, positionSec: 0, playing: 'yes' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_playing');
  });

  it('rejects a malformed clientId', () => {
    const result = validatePresenceInput({
      title: 'T',
      artist: 'A',
      durationSec: 0,
      positionSec: 0,
      playing: true,
      clientId: 'not-a-number',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_client_id');
  });

  it('accepts a numeric clientId', () => {
    const result = validatePresenceInput({
      title: 'T',
      artist: 'A',
      durationSec: 0,
      positionSec: 0,
      playing: true,
      clientId: '123456789012345678',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.clientId).toBe('123456789012345678');
  });

  it('rejects unknown enum values with a code', () => {
    const base = { title: 'T', artist: 'A', durationSec: 0, positionSec: 0, playing: true };
    for (const [field, value, code] of [
      ['activityName', 'weird', 'invalid_activity_name'],
      ['activityType', 'watching', 'invalid_activity_type'],
      ['largeImage', 'url', 'invalid_large_image'],
      ['smallImage', 'big', 'invalid_small_image'],
    ] as const) {
      const result = validatePresenceInput({ ...base, [field]: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
    const badBool = validatePresenceInput({ ...base, showTimestamps: 'yes' });
    expect(badBool.ok).toBe(false);
    if (!badBool.ok) expect(badBool.code).toBe('invalid_show_timestamps');
  });

  it('rejects an invalid button with invalid_button', () => {
    const base = { title: 'T', artist: 'A', durationSec: 0, positionSec: 0, playing: true };
    const badUrl = validatePresenceInput({
      ...base,
      buttons: [{ label: 'Open', url: 'http://example.com' }],
    });
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.code).toBe('invalid_button');
    const emptyLabel = validatePresenceInput({
      ...base,
      buttons: [{ label: '   ', url: 'https://example.com' }],
    });
    expect(emptyLabel.ok).toBe(false);
    if (!emptyLabel.ok) expect(emptyLabel.code).toBe('invalid_button');
    const notArray = validatePresenceInput({ ...base, buttons: 'nope' });
    expect(notArray.ok).toBe(false);
    if (!notArray.ok) expect(notArray.code).toBe('invalid_button');
  });

  it('accepts valid customization fields and normalizes them', () => {
    const result = validatePresenceInput({
      title: 'T',
      artist: 'A',
      durationSec: 0,
      positionSec: 0,
      playing: true,
      activityName: 'custom',
      activityNameCustom: '  My radio ',
      detailsTemplate: '{title}',
      stateTemplate: '{artist} - {album}',
      activityType: 'playing',
      showTimestamps: false,
      largeImage: 'asset',
      largeImageKey: '  cover-art ',
      smallImage: 'none',
      buttons: [{ label: '  Open  ', url: 'https://example.com/track' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.activityName).toBe('custom');
      expect(result.input.activityNameCustom).toBe('  My radio ');
      expect(result.input.activityType).toBe('playing');
      expect(result.input.showTimestamps).toBe(false);
      expect(result.input.largeImageKey).toBe('  cover-art ');
      expect(result.input.buttons).toEqual([
        { label: 'Open', url: 'https://example.com/track' },
      ]);
    }
  });
});

describe('ipcSocketPathList (Vesktop on NixOS)', () => {
  it('covers $XDG_RUNTIME_DIR, $TMPDIR and /tmp for discord-ipc-0..9', () => {
    const savedXdg = process.env.XDG_RUNTIME_DIR;
    const savedTmp = process.env.TMPDIR;
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    process.env.TMPDIR = '/tmp/custom-tmp';
    try {
      const list = ipcSocketPathList();
      const unixFormats = list.filter((entry) => entry.platform.includes('linux'));
      const paths0 = unixFormats.map((entry) => entry.format(0));
      expect(paths0).toContain('/run/user/1000/discord-ipc-0');
      expect(paths0).toContain('/tmp/custom-tmp/discord-ipc-0');
      expect(paths0).toContain('/tmp/discord-ipc-0');
      const paths9 = unixFormats.map((entry) => entry.format(9));
      expect(paths9).toContain('/run/user/1000/discord-ipc-9');
      expect(paths9).toContain('/tmp/discord-ipc-9');
    } finally {
      if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = savedXdg;
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
    }
  });
});

describe('stale playing expiry', () => {
  it('clears a playing activity past its end plus grace', async () => {
    const fake = new FakeRpcClient();
    let nowMs = 3_000_000_000;
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 100,
      now: () => nowMs,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    // Track: received at 3_000_000 s, position 83, duration 254, so
    // the activity ends at 3_000_000 - 83 + 254 = 3_000_171 s.
    nowMs = (3_000_171 + 61) * 1000;
    expect(presence.expireStaleActivity()).toBe(true);
    await sleep(0);
    expect(fake.requests.length).toBe(2);
    const cleared = fake.requests[1]?.args as { activity?: unknown };
    expect(cleared.activity).toBeNull();
    // A second expiry call is a no-op: the stale state was reset.
    expect(presence.expireStaleActivity()).toBe(false);
    expect(fake.requests.length).toBe(2);
    await presence.shutdown();
  });

  it('does not expire a paused activity', async () => {
    const fake = new FakeRpcClient();
    let nowMs = 3_000_000_000;
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 100,
      now: () => nowMs,
    });
    await presence.post({ ...BASE_INPUT, playing: false, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    // An hour later, still paused: a paused card can sit for hours.
    nowMs += 3_600_000;
    expect(presence.expireStaleActivity()).toBe(false);
    expect(fake.requests.length).toBe(1);
    await presence.shutdown();
  });

  it('does not expire while a newer update is still pending', async () => {
    const fake = new FakeRpcClient();
    let nowMs = 3_000_000_000;
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 500,
      now: () => nowMs,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    nowMs = 3_000_000_100;
    await presence.post({
      ...BASE_INPUT,
      title: 'Second Song',
      clientId: '123456789012345678',
    });
    expect(fake.requests.length).toBe(1);
    // Past the first track's end, but the second song is queued.
    nowMs = (3_000_171 + 61) * 1000;
    expect(presence.expireStaleActivity()).toBe(false);
    expect(fake.requests.length).toBe(1);
    await sleep(600);
    expect(fake.requests.length).toBe(2);
    const second = fake.requests[1]?.args as { activity?: { details?: string } };
    expect(second.activity?.details).toBe('Second Song');
    await presence.shutdown();
  });
});

describe('DiscordPresence with a fake transport', () => {
  it('throws not-configured when no client ID is available', async () => {
    const saved = process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_ID;
    try {
      const presence = new DiscordPresence({ clientFactory: () => new FakeRpcClient() });
      let caught: unknown;
      try {
        await presence.post(BASE_INPUT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PresenceNotConfiguredError);
      expect((caught as PresenceNotConfiguredError).code).toBe('discord_rpc_not_configured');
      expect(presence.status().configured).toBe(false);
    } finally {
      if (saved !== undefined) process.env.DISCORD_CLIENT_ID = saved;
    }
  });

  it('uses the posted clientId and reports configured without leaking it', async () => {
    const saved = process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_ID;
    try {
      const fake = new FakeRpcClient();
      const presence = new DiscordPresence({ clientFactory: () => fake });
      // The first post returns before the lazy login finishes, so it is
      // queued; the connection completes on the next tick.
      const result = await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
      expect(result.queued).toBe(true);
      expect(result.discordConnected).toBe(false);
      await sleep(0);
      expect(presence.discordConnected).toBe(true);
      const status = presence.status();
      expect(status.configured).toBe(true);
      expect(status.clientIdSet).toBe(true);
      expect(JSON.stringify(status)).not.toContain('123456789012345678');
    } finally {
      if (saved !== undefined) process.env.DISCORD_CLIENT_ID = saved;
    }
  });

  it('coalesces two rapid posts into one send with the latest state', async () => {
    const fake = new FakeRpcClient();
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 200,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    await presence.post({ ...BASE_INPUT, title: 'Second Song', clientId: '123456789012345678' });
    // First post sends immediately; the second is queued by the throttle.
    expect(fake.requests.length).toBe(1);
    await sleep(300);
    expect(fake.requests.length).toBe(2);
    const second = fake.requests[1]?.args as { activity?: { details?: string } };
    expect(second.activity?.details).toBe('Second Song');
    await presence.shutdown();
  });

  it('clear drops queued state and sends an empty activity', async () => {
    const fake = new FakeRpcClient();
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 60_000,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    await presence.clear();
    expect(fake.requests.length).toBe(2);
    const cleared = fake.requests[1]?.args as { activity?: unknown };
    expect(cleared.activity).toBeNull();
    // The queued state was dropped: no further send follows.
    await sleep(50);
    expect(fake.requests.length).toBe(2);
    await presence.shutdown();
  });

  it('anchors timestamps to the POST arrival time, not the send time', async () => {
    const fake = new FakeRpcClient();
    let nowMs = 1_000_000_800;
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 500,
      now: () => nowMs,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    // A second song posted 100 ms later, inside the throttle window.
    nowMs = 1_000_000_900;
    await presence.post({
      ...BASE_INPUT,
      title: 'Second Song',
      positionSec: 0,
      clientId: '123456789012345678',
    });
    expect(fake.requests.length).toBe(1);
    // The throttle window passes (the fake clock jumps past it).
    nowMs = 1_000_001_400;
    await sleep(600);
    expect(fake.requests.length).toBe(2);
    const second = fake.requests[1]?.args as {
      activity?: { details?: string; timestamps?: { start?: number; end?: number } };
    };
    expect(second.activity?.details).toBe('Second Song');
    // Start is anchored to the post arrival (1_000_000.9 s, position
    // 0), not to the send time (1_000_001.4 s): the progress bar must
    // not lag real playback by the throttle wait.
    expect(second.activity?.timestamps?.start).toBe(1_000_000);
    expect(second.activity?.timestamps?.end).toBe(1_000_000 + 254);
    await presence.shutdown();
  });

  it('flushes a pending update after a reconnect when the throttle window is still closed', async () => {
    const fake = new FakeRpcClient();
    let nowMs = 2_000_000_000;
    const presence = new DiscordPresence({
      clientFactory: () => fake,
      throttleMs: 500,
      now: () => nowMs,
    });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    expect(fake.requests.length).toBe(1);
    // The Discord link drops.
    fake.emit('disconnected');
    await sleep(10);
    // A new song arrives 100 ms later, while the link is down.
    nowMs = 2_000_000_100;
    await presence.post({
      ...BASE_INPUT,
      title: 'Second Song',
      clientId: '123456789012345678',
    });
    await sleep(10);
    expect(presence.discordConnected).toBe(true);
    // The login succeeded but the throttle window is still closed, so
    // the update is queued, not dropped: it must flush when the
    // window opens, without waiting for another playback event.
    expect(fake.requests.length).toBe(1);
    nowMs = 2_000_000_600;
    await sleep(600);
    expect(fake.requests.length).toBe(2);
    const second = fake.requests[1]?.args as { activity?: { details?: string } };
    expect(second.activity?.details).toBe('Second Song');
    await presence.shutdown();
  });

  it('status shape never contains the client ID value', async () => {
    const fake = new FakeRpcClient();
    const presence = new DiscordPresence({ clientFactory: () => fake });
    await presence.post({ ...BASE_INPUT, clientId: '123456789012345678' });
    await sleep(0);
    const status = presence.status();
    expect(status.configured).toBe(true);
    expect(status.discordConnected).toBe(true);
    expect(typeof status.lastUpdateAt).toBe('number');
    expect(status.throttledUntilMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(status)).not.toContain('123456789012345678');
    await presence.shutdown();
  });
});
