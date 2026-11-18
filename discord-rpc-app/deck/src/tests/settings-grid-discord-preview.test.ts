import { describe, it, expect, beforeEach } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DiscordPreviewCard,
  buildDiscordPreviewModel,
} from '../components/DiscordPreviewCard';
import type { DiscordPresenceCustomization } from '../services/discordPresence';
import { DEFAULT_DISCORD_CUSTOMIZATION } from '../services/discordPresence';
import { usePlaybackStore } from '../stores/playbackStore';
import { EMPTY_QUEUE } from '@century/crate';

const SAMPLE_SONG = {
  title: "Choir 'S' Choir",
  artist: 'Ave Mujica',
  album: 'Alea jacta est - EP',
  durationSec: 278,
};

describe('Settings per-section grid (round 3, user 16:31)', () => {
  const source = readFileSync(
    resolve(import.meta.dir, '../views/SettingsView.tsx'),
    'utf-8',
  );

  it('renders ONE section at a time, not all seven in a combined grid', () => {
    // Round 2 combined every section into one grid page; round 3
    // reverts that. No combined grid, no section cards, no ring.
    expect(source).not.toContain('grid grid-cols-1 xl:grid-cols-2 gap-6 items-start');
    expect(source).not.toContain('settingsSectionCardClass');
    expect(source).not.toContain('ring-1 ring-vela-blue');
    expect(source).not.toContain('scrollIntoView');
    for (const id of ['appearance', 'library', 'nas', 'lyrics', 'playback', 'discord', 'about']) {
      expect(source).toContain(`{activeSection === '${id}' && (`);
      expect(source).toContain(`id="settings-section-${id}"`);
    }
  });

  it('deep-links: the active section is the only one rendered', () => {
    // No scroll-to-section effect remains: the deep link renders
    // exactly the requested section, so there is nothing to scroll.
    expect(source).not.toContain('settings-section-${activeSection}');
    expect(source).toContain('settingsSection');
  });

  it('lays out each section content in a grid (2 columns on desktop, 1 on mobile)', () => {
    expect(source).toContain('grid grid-cols-1 lg:grid-cols-2 gap-6 items-start');
    expect(source).toContain('settingsGridClass');
    // Wide blocks span both columns.
    expect(source).toContain('lg:col-span-2');
  });

  it('mounts the Discord preview card inside the Discord section', () => {
    expect(source).toContain('<DiscordPreviewCard />');
    expect(source).toContain('Live preview');
  });
});

describe('DiscordPreviewCard (default store state, nothing playing)', () => {
  // The card reads the current song from the playback store, so this
  // test needs a clean store. Bun runs all test files in one process
  // with no isolation, and phase-8-motion leaves a current song
  // (songB) behind; without this reset the card shows that song
  // instead of the sample track, depending on file order.
  // currentSong() reads queueModel.current, not queue/currentIndex,
  // so the reset must restore the empty queue model too.
  beforeEach(() => {
    usePlaybackStore.setState({
      queueModel: EMPTY_QUEUE,
      queue: [],
      currentIndex: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    });
  });

  it('shows the sample track with the default templates', () => {
    const html = renderToStaticMarkup(createElement(DiscordPreviewCard));
    expect(html).toContain('data-testid="discord-preview-card"');
    expect(html).toContain('sample track');
    expect(html).toContain("Listening to Choir &#x27;S&#x27; Choir");
    expect(html).toContain("Choir &#x27;S&#x27; Choir");
    expect(html).toContain('Ave Mujica - Alea jacta est - EP');
    // Sample position 1:24 of 4:38.
    expect(html).toContain('1:24 / 4:38');
  });
});

describe('buildDiscordPreviewModel', () => {
  const model = (
    overrides: Partial<DiscordPresenceCustomization> = {},
    song = SAMPLE_SONG,
    positionSec = 84,
  ) =>
    buildDiscordPreviewModel(
      { ...DEFAULT_DISCORD_CUSTOMIZATION, ...overrides },
      song,
      positionSec,
    );

  it('renders the templates with the same substitution as the sender', () => {
    const m = model({
      detailsTemplate: '{artist}',
      stateTemplate: '{album}',
    });
    expect(m.lines).toEqual(['Ave Mujica', 'Alea jacta est - EP']);
  });

  it('reads "Playing" for the playing type and "Listening to" otherwise', () => {
    expect(model().header).toBe("Listening to Choir 'S' Choir");
    expect(model({ activityType: 'playing' }).header).toBe("Playing Choir 'S' Choir");
  });

  it('uses the app name for activityName app, the custom name for custom', () => {
    expect(model({ activityName: 'app' }).header).toBe('Listening to Photon');
    expect(model({ activityName: 'custom', activityNameCustom: '  ' }).header).toBe(
      "Listening to Choir 'S' Choir",
    );
    expect(model({ activityName: 'custom', activityNameCustom: 'Void FM' }).header).toBe(
      'Listening to Void FM',
    );
  });

  it('hides a button whose URL is not https, shows one whose label and https URL are set', () => {
    const m = model({
      button1Label: 'Listen',
      button1Url: 'http://example.com/x',
      button2Label: 'Album',
      button2Url: 'https://example.com/album',
    });
    expect(m.buttons).toEqual([{ label: 'Album', url: 'https://example.com/album' }]);
  });

  it('hides a button whose label is empty, clamps a long label to 32 chars', () => {
    const m = model({
      button1Label: '   ',
      button1Url: 'https://example.com/a',
      button2Label: 'A very long button label that keeps going past thirty two',
      button2Url: 'https://example.com/b',
    });
    expect(m.buttons).toHaveLength(1);
    expect(m.buttons[0].label).toBe('A very long button label that ke');
    expect(m.buttons[0].label.length).toBe(32);
  });

  it('hides the progress bar when timestamps are off', () => {
    expect(model({ showTimestamps: true }).showProgress).toBe(true);
    expect(model({ showTimestamps: false }).showProgress).toBe(false);
  });

  it('reports progress as a clamped percentage of the duration', () => {
    expect(model({}, SAMPLE_SONG, 84).progressPct).toBeCloseTo(30.22, 1);
    expect(model({}, SAMPLE_SONG, 999).progressPct).toBe(100);
  });

  it('passes the image modes through for the card to render', () => {
    expect(model().largeImage).toBe('cover');
    expect(model({ largeImage: 'asset' }).largeImage).toBe('asset');
    expect(model({ largeImage: 'none' }).largeImage).toBe('none');
    expect(model({ smallImage: 'none' }).smallImage).toBe('none');
  });
});
