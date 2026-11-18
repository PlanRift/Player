// discord-presence.test.ts - unit tests for the deck presence post
// builder. The sender hook itself is not tested here (it subscribes to
// the live playback store); the builder carries the mapping rules.

import { describe, expect, it, afterEach } from 'bun:test';
import { subsonicClient, type SubsonicSong } from '@century/crate';
import {
  DEFAULT_DISCORD_CUSTOMIZATION,
  DISCORD_PRESENCE_CLEAR_PATH,
  buildPresencePost,
  clearPresenceOnUnload,
  postPresence,
  renderPresenceTemplate,
  type DiscordPresenceCustomization,
} from '../services/discordPresence';
import { useSettingsStore } from '../stores/settingsStore';

const SONG: SubsonicSong = {
  id: 'song-1',
  title: 'Namonaki',
  artist: 'MyGO!!!!!',
  album: 'Meisekiha',
  coverArt: 'cover-1',
  duration: 254.6,
};

const DEFAULT_SERVER_URL = subsonicClient.getConfig().serverUrl;

afterEach(() => {
  subsonicClient.updateConfig({ serverUrl: DEFAULT_SERVER_URL });
});

describe('buildPresencePost', () => {
  it('maps song fields and rounds position and duration', () => {
    const post = buildPresencePost(SONG, 83.4, true, '');
    expect(post.title).toBe('Namonaki');
    expect(post.artist).toBe('MyGO!!!!!');
    expect(post.album).toBe('Meisekiha');
    expect(post.durationSec).toBe(255);
    expect(post.positionSec).toBe(83);
    expect(post.playing).toBe(true);
    expect(post.clientId).toBeUndefined();
  });

  it('omits the local http cover URL so the relay sends no large image', () => {
    const post = buildPresencePost(SONG, 0, true, '');
    expect(post.coverUrl).toBeUndefined();
  });

  it('includes the cover URL only when it starts with https://', () => {
    subsonicClient.updateConfig({ serverUrl: 'https://music.example.com' });
    const post = buildPresencePost(SONG, 0, true, '');
    expect(post.coverUrl?.startsWith('https://music.example.com/rest/getCoverArt.view?')).toBe(true);
    expect(post.coverUrl).toContain('id=cover-1');
  });

  it('includes a valid numeric client ID, trimmed', () => {
    const post = buildPresencePost(SONG, 0, true, '  123456789012345678  ');
    expect(post.clientId).toBe('123456789012345678');
  });

  it('drops an invalid client ID so the relay falls back to its env config', () => {
    const post = buildPresencePost(SONG, 0, true, 'not-a-number');
    expect(post.clientId).toBeUndefined();
    const empty = buildPresencePost(SONG, 0, true, '');
    expect(empty.clientId).toBeUndefined();
  });

  it('keeps position at 0 and playing false for a paused track', () => {
    const post = buildPresencePost(SONG, 0, false, '');
    expect(post.positionSec).toBe(0);
    expect(post.playing).toBe(false);
  });

  it('includes the v1 defaults when no customization is passed', () => {
    const post = buildPresencePost(SONG, 0, true, '');
    expect(post.activityName).toBe('title');
    expect(post.activityNameCustom).toBe('');
    expect(post.detailsTemplate).toBe('{title}');
    expect(post.stateTemplate).toBe('{artist} - {album}');
    expect(post.activityType).toBe('listening');
    expect(post.showTimestamps).toBe(true);
    expect(post.largeImage).toBe('cover');
    expect(post.largeImageKey).toBe('logo');
    expect(post.smallImage).toBe('playpause');
    expect(post.buttons).toEqual([]);
    expect(DEFAULT_DISCORD_CUSTOMIZATION.activityName).toBe('title');
  });

  it('includes the stored customization in the post body', () => {
    const customization: DiscordPresenceCustomization = {
      ...DEFAULT_DISCORD_CUSTOMIZATION,
      activityName: 'custom',
      activityNameCustom: 'My radio',
      detailsTemplate: '{artist} - {title}',
      stateTemplate: '{album}',
      activityType: 'playing',
      showTimestamps: false,
      largeImage: 'asset',
      largeImageKey: 'cover-art',
      smallImage: 'none',
      button1Label: 'Open',
      button1Url: 'https://example.com/track',
      button2Label: '',
      button2Url: '',
    };
    const post = buildPresencePost(SONG, 0, true, '', customization);
    expect(post.activityName).toBe('custom');
    expect(post.activityNameCustom).toBe('My radio');
    expect(post.detailsTemplate).toBe('{artist} - {title}');
    expect(post.stateTemplate).toBe('{album}');
    expect(post.activityType).toBe('playing');
    expect(post.showTimestamps).toBe(false);
    expect(post.largeImage).toBe('asset');
    expect(post.largeImageKey).toBe('cover-art');
    expect(post.smallImage).toBe('none');
    expect(post.buttons).toEqual([{ label: 'Open', url: 'https://example.com/track' }]);
  });

  it('sends only buttons with both a label and an https URL', () => {
    const customization: DiscordPresenceCustomization = {
      ...DEFAULT_DISCORD_CUSTOMIZATION,
      button1Label: 'No URL',
      button1Url: '',
      button2Label: 'Bad URL',
      button2Url: 'http://example.com',
    };
    const post = buildPresencePost(SONG, 0, true, '', customization);
    expect(post.buttons).toEqual([]);
    const trimmed = buildPresencePost(
      SONG,
      0,
      true,
      '',
      {
        ...DEFAULT_DISCORD_CUSTOMIZATION,
        button1Label: '  Open  ',
        button1Url: '  https://example.com/track  ',
      },
    );
    expect(trimmed.buttons).toEqual([{ label: 'Open', url: 'https://example.com/track' }]);
  });
});

describe('clearPresenceOnUnload', () => {
  const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

  afterEach(() => {
    (globalThis as { navigator?: unknown }).navigator = originalNavigator;
    useSettingsStore.setState({ discordRpcEnabled: false });
  });

  it('beacons the clear path when RPC is enabled', () => {
    const sent: string[] = [];
    (globalThis as { navigator?: unknown }).navigator = {
      sendBeacon: (url: string) => {
        sent.push(url);
        return true;
      },
    };
    useSettingsStore.setState({ discordRpcEnabled: true });
    expect(clearPresenceOnUnload()).toBe(true);
    expect(sent).toEqual([DISCORD_PRESENCE_CLEAR_PATH]);
  });

  it('sends nothing when RPC is disabled', () => {
    const sent: string[] = [];
    (globalThis as { navigator?: unknown }).navigator = {
      sendBeacon: (url: string) => {
        sent.push(url);
        return true;
      },
    };
    useSettingsStore.setState({ discordRpcEnabled: false });
    expect(clearPresenceOnUnload()).toBe(false);
    expect(sent).toEqual([]);
  });

  it('returns false without a sendBeacon implementation', () => {
    (globalThis as { navigator?: unknown }).navigator = {};
    useSettingsStore.setState({ discordRpcEnabled: true });
    expect(clearPresenceOnUnload()).toBe(false);
  });
});

describe('postPresence retry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries a timed-out post and rebuilds it per attempt', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls <= 2) throw new Error('boom');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    let built = 0;
    await postPresence(
      () => {
        built += 1;
        return buildPresencePost(SONG, 0, true, '');
      },
      () => true,
      [0, 0],
    );
    expect(calls).toBe(3);
    expect(built).toBe(3);
  });

  it('does not retry an HTTP error response', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('x', { status: 503 });
    }) as typeof fetch;
    await postPresence(() => buildPresencePost(SONG, 0, true, ''), () => true, [0, 0]);
    expect(calls).toBe(1);
  });

  it('stops retrying when a newer post supersedes it', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('boom');
    }) as typeof fetch;
    await postPresence(() => buildPresencePost(SONG, 0, true, ''), () => false, [0, 0]);
    expect(calls).toBe(1);
  });
});

describe('renderPresenceTemplate (deck mirror of the relay renderer)', () => {
  it('replaces placeholders and strips a dangling separator', () => {
    expect(
      renderPresenceTemplate('{title} - {artist}', {
        title: 'Namonaki',
        artist: 'MyGO!!!!!',
        album: 'Meisekiha',
      }),
    ).toBe('Namonaki - MyGO!!!!!');
    expect(
      renderPresenceTemplate('{artist} - {album}', {
        title: 'Namonaki',
        artist: 'MyGO!!!!!',
        album: '',
      }),
    ).toBe('MyGO!!!!!');
    expect(
      renderPresenceTemplate('{album}', { title: 'Namonaki', artist: 'MyGO!!!!!', album: '' }),
    ).toBe('');
  });
});
