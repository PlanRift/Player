import { Image as ImageIcon, Pause, Play } from 'lucide-react';
import { subsonicClient } from '@century/crate';
import type { SubsonicSong } from '@century/crate';
import { usePlaybackStore } from '../stores/playbackStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { DiscordRpcLargeImage, DiscordRpcSmallImage } from '../stores/settingsStore';
import { useTitleTranslationStore } from '../stores/titleTranslationStore';
import { renderPresenceTemplate } from '../services/discordPresence';
import type { DiscordPresenceCustomization } from '../services/discordPresence';
import { createMonochromePlaceholderDataUrl } from '../utils/collage';

// DiscordPreviewCard - live Discord activity card mock for the
// Discord settings section (round 2, user 16:00).
//
// Shows what the presence will look like: activity name header,
// details/state lines rendered with the SAME template substitution
// the sender uses (renderPresenceTemplate), large image
// (cover/asset/none), small play/pause image, timestamps progress
// bar, and the two buttons. Updates live as any knob changes: every
// value below is read from the settings/playback stores, so a knob
// edit re-renders this card with no extra wiring.
//
// Song source: the currently playing track when one exists, else a
// fixed sample track from the test library ("Choir 'S' Choir" by
// Ave Mujica, "Alea jacta est - EP"), looked up in the song index
// when it has loaded so the real cover shows.
//
// Buttons follow the sender rule (buildPresencePost): a button
// appears only when its label is non-empty AND its URL starts with
// https://, otherwise it is skipped (the relay would 400
// invalid_button on a post carrying one). The label is clamped to
// Discord's 32-character limit for display.
//
// The card itself is a Vela panel (bg-zinc-900, zinc-700 border,
// 12px radius, token colors only). The Discord-blue accent is NOT
// used here: the progress fill is Vela blue, matching the rest of
// the round.

const SAMPLE_TRACK = {
  title: "Choir 'S' Choir",
  artist: 'Ave Mujica',
  album: 'Alea jacta est - EP',
  duration: 278,
};
// Fixed progress position for the sample track, so the bar reads.
const SAMPLE_POSITION_SEC = 84;
const BUTTON_LABEL_MAX = 32;

function formatTime(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export interface PreviewButton {
  label: string;
  url: string;
}

export interface DiscordPreviewSong {
  title: string;
  artist: string;
  album?: string;
  durationSec: number;
  coverId?: string | null;
}

export interface DiscordPreviewModel {
  header: string;
  lines: string[];
  buttons: PreviewButton[];
  coverUrl: string | null;
  coverIsLocal: boolean;
  showProgress: boolean;
  positionSec: number;
  durationSec: number;
  progressPct: number;
  largeImage: DiscordRpcLargeImage;
  smallImage: DiscordRpcSmallImage;
}

/**
 * Pure preview model (exported for tests): the card header, text
 * lines, buttons, cover, and progress for one song under one
 * customization. The component reads the live stores and calls this;
 * the tests call it directly with explicit knobs, because a
 * server-rendered zustand selector does not reflect setState in the
 * bun test env (getState is current, the SSR snapshot is stale).
 */
export function buildDiscordPreviewModel(
  customization: DiscordPresenceCustomization,
  song: DiscordPreviewSong,
  positionSec: number,
): DiscordPreviewModel {
  const name =
    customization.activityName === 'app'
      ? 'Photon'
      : customization.activityName === 'custom'
        ? customization.activityNameCustom.trim() || song.title
        : song.title;
  const header = `${customization.activityType === 'playing' ? 'Playing' : 'Listening to'} ${name}`;
  const lines = [
    renderPresenceTemplate(customization.detailsTemplate, {
      title: song.title,
      artist: song.artist,
      album: song.album,
    }),
    renderPresenceTemplate(customization.stateTemplate, {
      title: song.title,
      artist: song.artist,
      album: song.album,
    }),
  ].filter((line) => line !== '');
  // Buttons follow the sender rule (buildPresencePost): only slots
  // with a non-empty label AND an https:// URL appear (the relay
  // would 400 invalid_button on a post carrying one). The label is
  // clamped to Discord's 32-character limit for display.
  const buttons: PreviewButton[] = (
    [
      [customization.button1Label, customization.button1Url],
      [customization.button2Label, customization.button2Url],
    ] as const
  )
    .filter(([label, url]) => label.trim() !== '' && url.trim().startsWith('https://'))
    .map(([label, url]) => ({
      label: label.trim().slice(0, BUTTON_LABEL_MAX),
      url: url.trim(),
    }));
  const coverUrl = song.coverId ? subsonicClient.getCoverArtUrl(song.coverId, 300) : null;
  // The sender omits a local http cover (Discord cannot fetch it),
  // so the live card may show no image even when the preview below
  // renders the browser-loadable cover. Flag it instead of hiding
  // the cover from the preview.
  const coverIsLocal = coverUrl !== null && !coverUrl.startsWith('https://');
  const durationSec = Math.max(0, Math.round(song.durationSec));
  const clampedPosition = Math.max(0, Math.round(positionSec));
  return {
    header,
    lines,
    buttons,
    coverUrl,
    coverIsLocal,
    showProgress: customization.showTimestamps && durationSec > 0,
    positionSec: clampedPosition,
    durationSec,
    progressPct:
      durationSec > 0 ? Math.min(100, Math.max(0, (clampedPosition / durationSec) * 100)) : 0,
    largeImage: customization.largeImage,
    smallImage: customization.smallImage,
  };
}

export function DiscordPreviewCard() {
  const song = usePlaybackStore((s) => s.currentSong());
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const indexedSongs = useTitleTranslationStore((s) => s.indexedSongs);

  const activityName = useSettingsStore((s) => s.discordRpcActivityName);
  const activityNameCustom = useSettingsStore((s) => s.discordRpcActivityNameCustom);
  const detailsTemplate = useSettingsStore((s) => s.discordRpcDetailsTemplate);
  const stateTemplate = useSettingsStore((s) => s.discordRpcStateTemplate);
  const activityType = useSettingsStore((s) => s.discordRpcActivityType);
  const showTimestamps = useSettingsStore((s) => s.discordRpcShowTimestamps);
  const largeImage = useSettingsStore((s) => s.discordRpcLargeImage);
  const largeImageKey = useSettingsStore((s) => s.discordRpcLargeImageKey);
  const smallImage = useSettingsStore((s) => s.discordRpcSmallImage);
  const button1Label = useSettingsStore((s) => s.discordRpcButton1Label);
  const button1Url = useSettingsStore((s) => s.discordRpcButton1Url);
  const button2Label = useSettingsStore((s) => s.discordRpcButton2Label);
  const button2Url = useSettingsStore((s) => s.discordRpcButton2Url);

  const isSample = song === null;
  // The sample track is the fixed test-library track; prefer the
  // indexed copy when it has loaded (real cover + duration).
  const sampleSong: SubsonicSong | null = isSample
    ? (indexedSongs.find(
        (s) => s.title === SAMPLE_TRACK.title && s.artist === SAMPLE_TRACK.artist,
      ) ?? null)
    : null;
  const customization: DiscordPresenceCustomization = {
    activityName,
    activityNameCustom,
    detailsTemplate,
    stateTemplate,
    activityType,
    showTimestamps,
    largeImage,
    largeImageKey,
    smallImage,
    button1Label,
    button1Url,
    button2Label,
    button2Url,
  };
  const model = buildDiscordPreviewModel(
    customization,
    {
      title: song?.title ?? sampleSong?.title ?? SAMPLE_TRACK.title,
      artist: song?.artist ?? sampleSong?.artist ?? SAMPLE_TRACK.artist,
      album: song?.album ?? sampleSong?.album ?? SAMPLE_TRACK.album,
      durationSec: song?.duration ?? sampleSong?.duration ?? SAMPLE_TRACK.duration,
      coverId: song?.coverArt ?? sampleSong?.coverArt ?? null,
    },
    isSample ? SAMPLE_POSITION_SEC : currentTime,
  );
  const { header, lines, buttons, coverUrl, coverIsLocal } = model;

  return (
    <div
      data-testid="discord-preview-card"
      className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3"
    >
      <p className="text-xs tracking-[var(--tracking-title)] text-zinc-400">
        Live preview{isSample ? ' · sample track' : ' · now playing'}
      </p>
      <div className="flex gap-3 items-start">
        {largeImage !== 'none' && (
          <div className="relative shrink-0">
            {largeImage === 'asset' ? (
              <div
                className="w-24 h-24 bg-zinc-800 border border-zinc-700 radius-inner flex flex-col items-center justify-center gap-1 px-1"
                title={`Asset key: ${largeImageKey || '(empty)'}`}
              >
                <ImageIcon className="w-5 h-5 text-zinc-500" />
                <span className="text-meta font-mono text-zinc-400 truncate max-w-full">
                  {largeImageKey.trim() || '(no key)'}
                </span>
              </div>
            ) : coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                className="w-24 h-24 radius-inner object-cover bg-zinc-800"
              />
            ) : (
              <img
                src={createMonochromePlaceholderDataUrl()}
                alt=""
                className="w-24 h-24 radius-inner object-cover bg-zinc-800"
              />
            )}
            {smallImage === 'playpause' && (
              <span
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-zinc-950 border border-zinc-700 flex items-center justify-center"
                aria-label={isPlaying ? 'Playing' : 'Paused'}
              >
                {isPlaying ? (
                  <Pause className="w-3 h-3 text-zinc-100 fill-current" />
                ) : (
                  <Play className="w-3 h-3 text-zinc-100 fill-current" />
                )}
              </span>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1 pt-0.5">
          <p className="text-[13px] leading-5 font-medium text-zinc-100 truncate">{header}</p>
          {lines.length > 0 ? (
            lines.map((line, idx) => (
              <p
                key={idx}
                className={`text-xs leading-4 truncate ${
                  idx === 0 ? 'text-zinc-200' : 'text-zinc-400'
                }`}
              >
                {line}
              </p>
            ))
          ) : (
            <p className="text-xs leading-4 text-zinc-400">
              No text lines - the card shows the header only.
            </p>
          )}
          {model.showProgress && (
            <div className="pt-1 space-y-1">
              {/* Rule A: the progress track and fill are true pills
              (2px tall), so their radius is height / 2 = 1px via
              .radius-pill, not 9999px. Renders identically. */}
              <div className="h-0.5 bg-zinc-700 radius-pill [--pill-height:2px] overflow-hidden">
                <div
                  className="h-full bg-vela-blue radius-pill [--pill-height:2px]"
                  style={{ width: `${model.progressPct}%` }}
                />
              </div>
              <p className="text-meta font-mono tabular-nums text-zinc-400">
                {formatTime(model.positionSec)} / {formatTime(model.durationSec)}
              </p>
            </div>
          )}
        </div>
      </div>
      {buttons.length > 0 && (
        <div className="flex gap-2">
          {buttons.map((button) => (
            <span
              key={button.label}
              className="flex-1 min-w-0 text-center px-3 py-1.5 bg-zinc-800 rounded text-xs leading-4 text-zinc-100 truncate"
            >
              {button.label}
            </span>
          ))}
        </div>
      )}
      {largeImage === 'cover' && coverIsLocal && (
        <p className="text-meta tracking-[var(--tracking-meta)] text-zinc-400">
          The cover URL is a local address: Discord can only fetch public https covers, so the
          live card may show no image even though the preview renders it.
        </p>
      )}
    </div>
  );
}
