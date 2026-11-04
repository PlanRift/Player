import { useState } from 'react';
import {
  Sliders,
  Radio,
  FileText,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import {
  getProviderPriority,
  setProviderPriority,
  DEFAULT_PROVIDER_PRIORITY,
  PROVIDERS_BY_ID,
} from '@player/shared';
import { audioEngine } from '../audio/audioEngine';
import { useLastFmStore } from '../stores/lastFmStore';

export function SettingsView() {
  const [crossfade, setCrossfadeState] = useState<number>(() => audioEngine.getCrossfade());
  const [lyricsPriority, setLyricsPriorityState] = useState<string[]>(() =>
    getProviderPriority()
  );

  const {
    apiKey,
    apiSecret,
    sessionKey,
    username,
    isEnabled,
    setCredentials,
    connect,
    disconnect,
    setIsEnabled,
    error: lastFmError,
  } = useLastFmStore();

  const [inputApiKey, setInputApiKey] = useState(apiKey);
  const [inputApiSecret, setInputApiSecret] = useState(apiSecret);
  const [showCreds, setShowCreds] = useState(false);
  const [credSaved, setCredSaved] = useState(false);

  const handleSaveAndConnect = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputApiKey.trim() || !inputApiSecret.trim()) return;
    setCredentials(inputApiKey, inputApiSecret);
    connect(inputApiKey, inputApiSecret);
  };

  const handleSaveCredentialsOnly = (e: React.FormEvent) => {
    e.preventDefault();
    setCredentials(inputApiKey, inputApiSecret);
    setCredSaved(true);
    setTimeout(() => setCredSaved(false), 2000);
  };

  const handleCrossfadeChange = (val: number) => {
    setCrossfadeState(val);
    audioEngine.setCrossfade(val);
  };

  const handleMoveProvider = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= lyricsPriority.length) return;

    const next = [...lyricsPriority];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);

    setLyricsPriorityState(next);
    setProviderPriority(next);
  };

  const handleResetLyricsPriority = () => {
    setLyricsPriorityState(DEFAULT_PROVIDER_PRIORITY);
    setProviderPriority(DEFAULT_PROVIDER_PRIORITY);
  };

  const isLastFmConnected = Boolean(sessionKey && username);

  return (
    <div className="p-6 max-w-7xl mx-auto flex flex-col gap-8">
      <div className="flex flex-col gap-1 border-b border-zinc-700 pb-4">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
          Settings
        </h2>
        <p className="font-mono text-xs text-zinc-400">
          Audio Engine, Scrobbling & Lyrics Preferences
        </p>
      </div>

      <section className="flex flex-col gap-4 studio-panel p-5 rounded-lg border border-zinc-800">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h3 className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wider">
            Two-Deck Gapless Engine & Crossfade
          </h3>
        </div>

        <div className="flex flex-col gap-3 max-w-xl">
          <div className="flex items-center justify-between">
            <label
              htmlFor="crossfade-range"
              className="text-xs font-medium text-zinc-200"
            >
              Crossfade Duration
            </label>
            <span className="font-mono text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
              {crossfade === 0 ? '0s (Off — Instant Gapless)' : `${crossfade}s`}
            </span>
          </div>

          <input
            id="crossfade-range"
            type="range"
            min={0}
            max={12}
            step={1}
            value={crossfade}
            onChange={(e) => handleCrossfadeChange(Number(e.target.value))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
          />

          <p className="text-[11px] text-zinc-400 leading-relaxed">
            The two-deck audio engine automatically preloads the upcoming track in the queue on an idle deck.
            At 0s, transitions are instant and gapless with zero re-buffering stall. When set greater than 0s,
            the outgoing and incoming tracks blend linearly across the selected duration.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-4 studio-panel p-5 rounded-lg border border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400" />
            <h3 className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wider">
              Last.fm Scrobbler (Single User)
            </h3>
          </div>
          {isLastFmConnected ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-0.5 rounded-full">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Connected as {username}</span>
            </span>
          ) : (
            <span className="text-xs font-mono text-zinc-400">Not connected</span>
          )}
        </div>

        {lastFmError && (
          <div className="p-3 bg-red-950/30 border border-red-800/50 rounded text-xs font-mono text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{lastFmError}</span>
          </div>
        )}

        <div className="flex flex-col gap-4 max-w-xl">
          {isLastFmConnected ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setIsEnabled(e.target.checked)}
                    className="w-4 h-4 rounded bg-zinc-900 border-zinc-700 text-emerald-400 focus:ring-emerald-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 accent-emerald-400 cursor-pointer"
                  />
                  <span>Scrobble tracks to Last.fm</span>
                </label>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={disconnect}
                  className="font-mono text-xs text-zinc-400 hover:text-red-400 hover:underline cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded px-1"
                >
                  Disconnect account
                </button>
                <a
                  href={`https://www.last.fm/user/${username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-zinc-400 hover:text-emerald-400 inline-flex items-center gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded px-1"
                >
                  <span>View profile</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => setShowCreds(!showCreds)}
                  className="font-mono text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors ml-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded px-1"
                >
                  {showCreds ? 'Hide credentials' : 'Edit credentials'}
                </button>
              </div>

              {showCreds && (
                <form onSubmit={handleSaveCredentialsOnly} className="mt-2 p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-md flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-zinc-400">API Key</label>
                    <input
                      type="text"
                      value={inputApiKey}
                      onChange={(e) => setInputApiKey(e.target.value)}
                      placeholder="Last.fm API Key..."
                      className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400 font-mono"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-mono text-zinc-400">Shared Secret</label>
                    <input
                      type="password"
                      value={inputApiSecret}
                      onChange={(e) => setInputApiSecret(e.target.value)}
                      placeholder="Last.fm Shared Secret..."
                      className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400 font-mono"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    {credSaved && <span className="text-xs font-mono text-emerald-400">Credentials updated!</span>}
                    <button
                      type="submit"
                      className="ml-auto bg-zinc-800 border border-zinc-700 text-zinc-200 hover:text-zinc-50 font-mono text-xs px-3 py-1 rounded cursor-pointer hover:bg-zinc-700 transition-colors"
                    >
                      Save changes
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Connect your Last.fm account to enable Now Playing updates and scrobbling.
                Tracks are scrobbled once 50% or 240 seconds of the song has elapsed (for tracks &ge; 30s).
              </p>

              <form onSubmit={handleSaveAndConnect} className="flex flex-col gap-3 p-4 bg-zinc-900/60 border border-zinc-800 rounded-lg">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-mono text-zinc-300">Last.fm API Key</label>
                    <a
                      href="https://www.last.fm/api/account/create"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] font-mono text-emerald-400 hover:underline inline-flex items-center gap-1"
                    >
                      <span>Get API Key</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <input
                    type="text"
                    required
                    value={inputApiKey}
                    onChange={(e) => setInputApiKey(e.target.value)}
                    placeholder="Enter 32-character API Key..."
                    className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400 font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-mono text-zinc-300">Shared Secret</label>
                  <input
                    type="password"
                    required
                    value={inputApiSecret}
                    onChange={(e) => setInputApiSecret(e.target.value)}
                    placeholder="Enter Shared Secret..."
                    className="bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-400 font-mono"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80">
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Stored securely in your browser's local storage
                  </span>
                  <button
                    type="submit"
                    disabled={!inputApiKey.trim() || !inputApiSecret.trim()}
                    className="bg-emerald-400 text-zinc-950 font-mono font-semibold text-xs px-4 py-2 rounded-md hover:bg-emerald-300 active:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer transition-colors inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Connect Last.fm</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-4 studio-panel p-5 rounded-lg border border-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h3 className="font-mono text-xs font-semibold text-zinc-100 uppercase tracking-wider">
              Lyrics Provider Priority ("Otomatis")
            </h3>
          </div>
          <button
            type="button"
            onClick={handleResetLyricsPriority}
            className="text-[11px] font-mono text-zinc-400 hover:text-emerald-400 inline-flex items-center gap-1 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded px-1.5 py-0.5"
            title="Reset priority order to defaults"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset default</span>
          </button>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed max-w-xl">
          When a track uses "Otomatis" lyrics mode, providers are queried in the order shown below.
          The first provider returning valid synced or plain lyrics is displayed.
        </p>

        <div className="flex flex-col gap-1.5 max-w-md">
          {lyricsPriority.map((providerId, idx) => {
            const provider = PROVIDERS_BY_ID[providerId];
            const name = provider ? provider.name : providerId;
            const isFirst = idx === 0;
            const isLast = idx === lyricsPriority.length - 1;

            return (
              <div
                key={providerId}
                className="flex items-center justify-between p-2.5 rounded bg-zinc-900/80 border border-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-zinc-400 w-5 text-center">
                    {idx + 1}
                  </span>
                  <span className="text-xs font-medium text-zinc-200">{name}</span>
                  {providerId === 'lrclib' && (
                    <span className="font-mono text-[9px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 px-1.5 py-0.5 rounded">
                      Direct CORS
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveProvider(idx, 'up')}
                    disabled={isFirst}
                    className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
                    title="Move up"
                    aria-label={`Move ${name} up`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveProvider(idx, 'down')}
                    disabled={isLast}
                    className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
                    title="Move down"
                    aria-label={`Move ${name} down`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
