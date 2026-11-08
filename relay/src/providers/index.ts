import type { LyricsProvider } from './base';
import { lrclibProvider } from './lrclib';
import { neteaseProvider } from './netease';
import { kugouProvider } from './kugou';
import { qqProvider } from './qq';
import { unisonProvider } from './unison';
import { lrcredProvider } from './lrcred';
import { lyricsplusProvider } from './lyricsplus';
import { amllProvider } from './amll';

export type { LyricsProvider } from './base';
export { lrclibProvider, neteaseProvider, kugouProvider, qqProvider, unisonProvider, lrcredProvider, lyricsplusProvider, amllProvider };

export const ALL_PROVIDERS: LyricsProvider[] = [
  lrclibProvider,
  neteaseProvider,
  kugouProvider,
  qqProvider,
  unisonProvider,
  lrcredProvider,
  amllProvider,
  lyricsplusProvider,
];

export const PROVIDERS_BY_ID: Record<string, LyricsProvider> = Object.fromEntries(
  ALL_PROVIDERS.map((p) => [p.id, p])
);
