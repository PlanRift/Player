// ytm-downloader.js - Server-side YouTube Music Downloader & Persistent Cookie Manager
// Cross-platform (Windows & Linux/macOS) with 128kbps expiration safeguard.
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getFfmpegBinaryPath } from './audio-tagger.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

// Persistent cookies storage strictly OUTSIDE G:\Server\Music / STORAGE_DIR
export const COOKIES_CONFIG_DIR = path.resolve(__dirname, 'config');
export const COOKIES_FILE_PATH = path.resolve(COOKIES_CONFIG_DIR, 'cookies.txt');

export const LOW_BITRATE_THRESHOLD_KBPS = 135;
const ALLOWED_FORMATS = new Set(['opus', 'm4a']);
const ALLOWED_DEST_MODES = new Set(['current', 'choose', 'auto']);
const YT_HOST_RE = /^(?:(?:www|music|m)\.)?(?:youtube\.com|youtu\.be)$/i;
const YT_COOKIE_DOMAINS = ['youtube.com', 'google.com', 'googleusercontent.com'];
const YT_AUTH_COOKIE_NAMES = new Set([
  'SID',
  'HSID',
  'SSID',
  'APISID',
  'SAPISID',
  '__Secure-1PSID',
  '__Secure-3PSID',
  '__Secure-1PAPISID',
  '__Secure-3PAPISID',
  'LOGIN_INFO',
  'SIDCC',
]);

let cachedYtDlp = null;
let lastYtDlpCheck = 0;

/**
 * Resolve yt-dlp executable across Windows, Linux, and macOS (with python module fallback).
 */
export async function resolveYtDlpBinary(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedYtDlp && (cachedYtDlp.available || now - lastYtDlpCheck < 30000)) {
    return cachedYtDlp;
  }
  lastYtDlpCheck = now;

  const isWin = process.platform === 'win32';
  const candidates = [];

  if (process.env.YT_DLP_PATH) {
    candidates.push({ command: process.env.YT_DLP_PATH, prefixArgs: [] });
  }

  const exeName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
  candidates.push({ command: path.join(__dirname, 'bin', exeName), prefixArgs: [] });
  candidates.push({ command: path.join(PROJECT_DIR, 'bin', exeName), prefixArgs: [] });
  candidates.push({ command: 'yt-dlp', prefixArgs: [] });
  if (isWin) {
    candidates.push({ command: 'yt-dlp.exe', prefixArgs: [] });
    candidates.push({ command: 'py', prefixArgs: ['-m', 'yt_dlp'] });
    candidates.push({ command: 'python', prefixArgs: ['-m', 'yt_dlp'] });
    candidates.push({ command: 'python3', prefixArgs: ['-m', 'yt_dlp'] });
  } else {
    candidates.push({ command: 'python3', prefixArgs: ['-m', 'yt_dlp'] });
    candidates.push({ command: 'python', prefixArgs: ['-m', 'yt_dlp'] });
  }

  for (const cand of candidates) {
    // Skip local path candidates that don't exist
    if (
      (cand.command.includes('/') || cand.command.includes('\\')) &&
      !fsSync.existsSync(cand.command)
    ) {
      continue;
    }
    try {
      const { stdout } = await execFileAsync(
        cand.command,
        [...cand.prefixArgs, '--version'],
        { timeout: 4000, windowsHide: true }
      );
      const version = String(stdout || '').trim().split(/\r?\n/)[0] || 'unknown';
      cachedYtDlp = { available: true, command: cand.command, prefixArgs: cand.prefixArgs, version };
      return cachedYtDlp;
    } catch (_) {
      // Try next candidate
    }
  }

  cachedYtDlp = { available: false, command: null, prefixArgs: [], version: null };
  return cachedYtDlp;
}

/**
 * Parse and validate Netscape cookies.txt content without ever exposing secrets.
 */
export function inspectCookiesContent(rawContent) {
  const normalized = String(rawContent || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const domains = new Set();
  let totalCookies = 0;
  let youtubeCookieCount = 0;
  let hasAuthCookies = false;
  let expiredAuthCount = 0;
  let activeAuthCount = 0;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // Netscape files often prefix HttpOnly cookies with "#HttpOnly_" — that IS a real cookie line!
    if (line.startsWith('#HttpOnly_')) {
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue;
    }

    const cols = line.split('\t');
    if (cols.length < 7) continue;

    const domain = cols[0].trim().toLowerCase().replace(/^\./, '');
    const expSec = Number(cols[4]) || 0;
    const cookieName = cols[5].trim();
    const cookieValue = cols[6].trim();
    if (!domain || !cookieName) continue;

    totalCookies += 1;
    domains.add(domain);

    const isYtDomain = YT_COOKIE_DOMAINS.some(
      (d) => domain === d || domain.endsWith(`.${d}`)
    );
    if (isYtDomain) {
      youtubeCookieCount += 1;
      if (YT_AUTH_COOKIE_NAMES.has(cookieName) && cookieValue) {
        hasAuthCookies = true;
        if (expSec > 0 && expSec < nowSec) {
          expiredAuthCount += 1;
        } else {
          activeAuthCount += 1;
        }
      }
    }
  }

  const active = totalCookies > 0 && youtubeCookieCount > 0 && hasAuthCookies && activeAuthCount > 0;
  let warning = '';
  if (totalCookies === 0) {
    warning = 'No valid Netscape cookie entries found.';
  } else if (youtubeCookieCount === 0) {
    warning = 'No YouTube or Google domain cookies found in cookies.txt.';
  } else if (!hasAuthCookies) {
    warning = 'No logged-in YouTube session cookies found (export cookies while signed in).';
  } else if (activeAuthCount === 0 && expiredAuthCount > 0) {
    warning = 'All YouTube authentication cookies appear expired.';
  }

  return {
    normalizedText: normalized,
    totalCookies,
    domainCount: domains.size,
    youtubeCookieCount,
    hasAuthCookies,
    activeAuthCount,
    expiredAuthCount,
    active,
    warning,
  };
}

/**
 * Read current server-side cookies.txt status metadata (never returns raw cookie strings).
 */
export async function getCookieStatus() {
  if (!fsSync.existsSync(COOKIES_FILE_PATH)) {
    return {
      exists: false,
      active: false,
      lastUpdated: null,
      lastUpdatedIso: null,
      domainCount: 0,
      totalCookies: 0,
      youtubeCookieCount: 0,
      hasAuthCookies: false,
      expiredAuthCount: 0,
      warning: 'No cookies.txt configured on server (free-tier 128kbps limit may apply).',
    };
  }

  try {
    const [stat, content] = await Promise.all([
      fs.stat(COOKIES_FILE_PATH),
      fs.readFile(COOKIES_FILE_PATH, 'utf8'),
    ]);
    const info = inspectCookiesContent(content);
    return {
      exists: true,
      active: info.active,
      lastUpdated: stat.mtimeMs,
      lastUpdatedIso: new Date(stat.mtimeMs).toISOString(),
      domainCount: info.domainCount,
      totalCookies: info.totalCookies,
      youtubeCookieCount: info.youtubeCookieCount,
      hasAuthCookies: info.hasAuthCookies,
      expiredAuthCount: info.expiredAuthCount,
      warning: info.warning,
    };
  } catch (err) {
    return {
      exists: false,
      active: false,
      lastUpdated: null,
      lastUpdatedIso: null,
      domainCount: 0,
      totalCookies: 0,
      youtubeCookieCount: 0,
      hasAuthCookies: false,
      expiredAuthCount: 0,
      warning: `Could not read server cookies: ${err.message}`,
    };
  }
}

/**
 * Save validated Netscape cookies.txt content atomically outside G:\Server\Music.
 */
export async function saveCookiesContent(rawContent) {
  const input = String(rawContent || '');
  if (input.includes('\0')) {
    throw new Error('Invalid cookies.txt content (null bytes forbidden)');
  }

  const parsed = inspectCookiesContent(input);
  if (parsed.totalCookies === 0) {
    throw new Error(
      'Invalid cookies.txt format: expected Netscape HTTP Cookie File tab-separated lines (export from YouTube Music using "Get cookies.txt LOCALLY").'
    );
  }

  await fs.mkdir(COOKIES_CONFIG_DIR, { recursive: true });
  let finalContent = parsed.normalizedText.trimStart();
  if (!finalContent.startsWith('# Netscape HTTP Cookie File') && !finalContent.startsWith('# HTTP Cookie File')) {
    finalContent = `# Netscape HTTP Cookie File\n${finalContent}`;
  }
  if (!finalContent.endsWith('\n')) finalContent += '\n';

  const stagePath = path.join(
    COOKIES_CONFIG_DIR,
    `.cookies_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.tmp`
  );
  await fs.writeFile(stagePath, finalContent, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(stagePath, COOKIES_FILE_PATH);
  try {
    await fs.chmod(COOKIES_FILE_PATH, 0o600);
  } catch (_) {}

  return await getCookieStatus();
}

export async function deleteCookiesFile() {
  if (fsSync.existsSync(COOKIES_FILE_PATH)) {
    await fs.unlink(COOKIES_FILE_PATH);
  }
  return await getCookieStatus();
}

/**
 * Validate a YouTube / YouTube Music URL safely.
 */
export function validateYtmUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('Invalid URL format. Please enter a valid https://music.youtube.com or YouTube URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('URL must start with https:// or http://');
  }
  if (!YT_HOST_RE.test(parsed.hostname)) {
    throw new Error(`Unsupported host "${parsed.hostname}". Only YouTube and YouTube Music URLs are supported.`);
  }
  return parsed.toString();
}

/**
 * Inspect downloaded audio file bitrate via bundled ffmpeg binary.
 */
async function inspectLocalAudioFileBitrateKbps(filePath) {
  const ffmpegBin = getFfmpegBinaryPath();
  let stderr = '';
  try {
    await execFileAsync(ffmpegBin, ['-i', filePath], { timeout: 10000, windowsHide: true });
  } catch (err) {
    // ffmpeg -i without output exits code 1 with stream summary in stderr
    stderr = String(err?.stderr || err?.message || '');
  }

  // Try overall bitrate in Duration line: "Duration: 00:03:21.45, start: ..., bitrate: 256 kb/s"
  const containerMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?).*?bitrate:\s*(\d+)\s*kb\/s/i);
  if (containerMatch) {
    const kbps = Number(containerMatch[4]);
    if (kbps > 0) return kbps;
  }

  // Fallback to Audio stream line: "Stream #0:0: Audio: ..., 256 kb/s"
  const streamMatch = stderr.match(/Audio:.*?,\s*(\d+)\s*kb\/s/i);
  if (streamMatch) {
    const kbps = Number(streamMatch[1]);
    if (kbps > 0) return kbps;
  }

  // Last resort: compute from Duration + file size
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (durMatch) {
    const totalSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
    if (totalSec > 0.5) {
      const stat = await fs.stat(filePath);
      const calcKbps = Math.round((stat.size * 8) / (totalSec * 1000));
      if (calcKbps > 0) return calcKbps;
    }
  }

  return 0;
}

/**
 * Spawn yt-dlp with `--js-runtimes node` and collect stdout/stderr cleanly.
 */
function spawnYtDlpCollect(ytDlp, args, { timeoutMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const fullArgs = [...ytDlp.prefixArgs, '--js-runtimes', 'node', ...args];
    const child = spawn(ytDlp.command, fullArgs, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killSpawnedProcess(child).finally(() => {
        reject(new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`));
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < 30 * 1024 * 1024) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
      resolve({ stdout, stderr });
    });
  });
}

function extractCleanArtist(info) {
  if (!info || typeof info !== 'object') return '';
  let raw =
    info.album_artist ||
    info.artist ||
    (Array.isArray(info.artists) && info.artists.length > 0 ? info.artists[0] : '') ||
    info.creator ||
    info.uploader ||
    info.channel ||
    '';
  if (Array.isArray(raw)) raw = raw[0] || '';
  return String(raw || '')
    .replace(/\s*-\s*Topic$/i, '')
    .trim();
}

function pickAudioStreamFromInfo(info, requestedFormat = 'opus') {
  const formats = Array.isArray(info?.formats) ? info.formats : [];
  const audioOnly = formats.filter(
    (f) => f && (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none'
  );

  const byBitrateDesc = (a, b) => (Number(b.abr || b.tbr) || 0) - (Number(a.abr || a.tbr) || 0);

  let chosen = null;
  if (audioOnly.length > 0) {
    if (requestedFormat === 'm4a') {
      chosen =
        audioOnly.find((f) => String(f.format_id) === '141') ||
        audioOnly
          .filter((f) => f.ext === 'm4a' || f.audio_ext === 'm4a' || String(f.acodec).includes('mp4a'))
          .sort(byBitrateDesc)[0] ||
        audioOnly.slice().sort(byBitrateDesc)[0];
    } else {
      chosen =
        audioOnly.find((f) => String(f.format_id) === '251') ||
        audioOnly
          .filter((f) => String(f.acodec).includes('opus') || f.ext === 'webm')
          .sort(byBitrateDesc)[0] ||
        audioOnly.slice().sort(byBitrateDesc)[0];
    }
  }

  if (chosen) {
    const abr = Number(chosen.abr);
    const tbr = Number(chosen.tbr);
    return {
      formatId: String(chosen.format_id || ''),
      acodec: String(chosen.acodec || ''),
      ext: String(chosen.ext || ''),
      streamBitrateKbps: abr > 0 ? Math.round(abr) : tbr > 0 ? Math.round(tbr) : 0,
    };
  }

  const rawAbr = Number(info?.abr);
  const rawTbr = Number(info?.tbr);
  const isAudioOnly = !info?.vcodec || info.vcodec === 'none';
  return {
    formatId: String(info?.format_id || ''),
    acodec: String(info?.acodec || ''),
    ext: String(info?.ext || ''),
    streamBitrateKbps: rawAbr > 0 ? Math.round(rawAbr) : isAudioOnly && rawTbr > 0 ? Math.round(rawTbr) : 0,
  };
}

/**
 * Extract stream bitrate & metadata using yt-dlp --dump-single-json (without -f format filtering).
 */
async function inspectTrackStreamInfo(ytDlp, trackUrl, cookiesActivePath, requestedFormat = 'opus') {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--dump-single-json',
  ];
  if (cookiesActivePath) {
    args.push('--cookies', cookiesActivePath);
  }
  args.push('--', trackUrl);

  const { stdout } = await spawnYtDlpCollect(ytDlp, args, { timeoutMs: 45000 });
  const info = JSON.parse(stdout);
  const stream = pickAudioStreamFromInfo(info, requestedFormat);

  return {
    id: info.id || '',
    title: info.track || info.title || 'Unknown Track',
    artist: extractCleanArtist(info),
    album: info.album || info.playlist_title || '',
    formatId: stream.formatId,
    acodec: stream.acodec,
    ext: stream.ext,
    streamBitrateKbps: stream.streamBitrateKbps,
  };
}

/**
 * Resolve single track or playlist/album entries via yt-dlp --flat-playlist --dump-single-json.
 */
async function fetchUrlPlaylistInfo(ytDlp, url, cookiesActivePath) {
  const args = [
    '--flat-playlist',
    '--no-warnings',
    '--dump-single-json',
  ];
  if (cookiesActivePath) {
    args.push('--cookies', cookiesActivePath);
  }
  args.push('--', url);

  const { stdout } = await spawnYtDlpCollect(ytDlp, args, { timeoutMs: 45000 });
  const data = JSON.parse(stdout);

  if (Array.isArray(data.entries) && data.entries.length > 0) {
    const tracks = data.entries
      .filter(Boolean)
      .map((entry, idx) => {
        const entryUrl =
          entry.webpage_url ||
          entry.url ||
          (entry.id ? `https://music.youtube.com/watch?v=${entry.id}` : '');
        return {
          index: idx + 1,
          id: entry.id || '',
          title: entry.track || entry.title || `Track ${idx + 1}`,
          artist: extractCleanArtist(entry) || extractCleanArtist(data),
          album: entry.album || data.album || data.title || data.playlist_title || '',
          url: entryUrl.startsWith('http') ? entryUrl : `https://music.youtube.com/watch?v=${entry.id}`,
        };
      })
      .filter((t) => Boolean(t.url));

    return {
      isPlaylist: tracks.length > 1 || data._type === 'playlist',
      collectionTitle: data.title || data.playlist_title || '',
      tracks,
    };
  }

  return {
    isPlaylist: false,
    collectionTitle: data.album || '',
    tracks: [
      {
        index: 1,
        id: data.id || '',
        title: data.track || data.title || 'YouTube Music Track',
        artist: extractCleanArtist(data),
        album: data.album || '',
        url: data.webpage_url || url,
      },
    ],
  };
}

/**
 * Kill a spawned yt-dlp process cleanly across Windows and POSIX.
 */
async function killSpawnedProcess(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.once('close', finish);
    setTimeout(finish, 3000);

    try {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => finish());
      } else {
        child.kill('SIGKILL');
      }
    } catch (_) {
      finish();
    }
  });
}

/**
 * Create and register all /api/ytm/* endpoints plus the background download queue engine.
 */
export function registerYtmRoutes(app, deps) {
  const {
    STORAGE_DIR,
    MUSIC_DIR,
    TMP_CHUNKS_DIR,
    stagingUpload,
    resolveSafePath,
    sanitizePathSegment,
    assertSafeFileWriteTarget,
    verifyFilesAccess,
  } = deps;

  const jobs = new Map();
  const MAX_HISTORY_JOBS = 20;

  const resolvedStorageRoot = path.resolve(STORAGE_DIR);
  const resolvedMusicRoot = path.resolve(MUSIC_DIR);
  const musicRelFromStorage = path.relative(resolvedStorageRoot, resolvedMusicRoot).replace(/\\/g, '/');

  function canonicalComparePath(targetPath) {
    const resolved = path.resolve(String(targetPath || ''));
    const stripped = resolved.replace(/[\\/.\s]+$/, '');
    return process.platform === 'win32' ? stripped.toLowerCase() : stripped;
  }

  const CANONICAL_MUSIC_ROOT = canonicalComparePath(resolvedMusicRoot);

  function assertInsideMusicRoot(resolvedCandidate) {
    const resolved = path.resolve(resolvedCandidate);
    const canonical = canonicalComparePath(resolved);
    if (
      canonical !== CANONICAL_MUSIC_ROOT &&
      !canonical.startsWith(CANONICAL_MUSIC_ROOT + path.sep)
    ) {
      throw new Error(
        `Security boundary violation: Destination "${resolved}" must stay inside Music root "${resolvedMusicRoot}"`
      );
    }
    return resolved;
  }

  /**
   * Resolve a relative path strictly inside MUSIC_DIR via path.resolve.
   * Accepts paths relative to MUSIC_DIR (e.g. "Artist/Album") or prefixed with musicRelFromStorage (e.g. "Music/Artist/Album").
   */
  function resolveSafeMusicSubPath(rawRel = '', { stripMusicPrefix = true } = {}) {
    const input = String(rawRel ?? '').normalize('NFC').trim();
    if (input.includes('\0')) {
      throw new Error('Security boundary violation: null byte in destination path');
    }

    let parts = input.replace(/\\/g, '/').split('/').filter(Boolean);
    if (
      stripMusicPrefix &&
      musicRelFromStorage &&
      parts.length > 0 &&
      parts[0].toLowerCase() === musicRelFromStorage.split('/')[0].toLowerCase()
    ) {
      const musicParts = musicRelFromStorage.split('/').filter(Boolean);
      const matchesPrefix =
        parts.length >= musicParts.length &&
        musicParts.every((mp, idx) => parts[idx].toLowerCase() === mp.toLowerCase());
      if (matchesPrefix) {
        parts = parts.slice(musicParts.length);
      }
    }

    const cleanParts = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed === '.') continue;
      if (/^\.{2,}$/.test(trimmed)) {
        throw new Error(`Security boundary violation: traversal segment "${trimmed}" is forbidden`);
      }
      if (trimmed.replace(/[\s.]+$/, '') === '') {
        throw new Error(`Security boundary violation: invalid segment "${trimmed}"`);
      }
      const clean = sanitizePathSegment(trimmed);
      if (!clean) {
        throw new Error(`Security boundary violation: invalid path segment "${trimmed}"`);
      }
      cleanParts.push(clean);
    }

    const resolved =
      cleanParts.length > 0
        ? path.resolve(resolvedMusicRoot, ...cleanParts)
        : path.resolve(resolvedMusicRoot);
    return assertInsideMusicRoot(resolved);
  }

  /**
   * Resolve a Files UI active folder path (relative to STORAGE_DIR) and verify via path.resolve
   * that it sits strictly inside MUSIC_DIR (G:\Server\Music).
   */
  function resolveCurrentFolderInMusic(rawStorageRel = '') {
    const input = String(rawStorageRel ?? '').normalize('NFC').trim();
    if (input.includes('\0')) {
      throw new Error('Security boundary violation: null byte in folder path');
    }
    const parts = input.replace(/\\/g, '/').split('/').filter(Boolean);
    const cleanParts = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed === '.') continue;
      if (/^\.{2,}$/.test(trimmed)) {
        throw new Error(`Security boundary violation: traversal segment "${trimmed}" is forbidden`);
      }
      const clean = sanitizePathSegment(trimmed);
      if (!clean) {
        throw new Error(`Security boundary violation: invalid path segment "${trimmed}"`);
      }
      cleanParts.push(clean);
    }

    const resolved =
      cleanParts.length > 0
        ? path.resolve(resolvedStorageRoot, ...cleanParts)
        : resolvedStorageRoot;

    return assertInsideMusicRoot(resolved);
  }

  /**
   * Compute and validate Root\Music\(Artist)\(Album/Single) directory via path.resolve for Auto-Sort mode.
   */
  function resolveAutoSortTrackDir({ artist, album, trackTitle, collectionTitle, isPlaylist }) {
    const rawArtist = String(artist || '').replace(/\s*-\s*Topic$/i, '').trim();
    const artistSeg = sanitizePathSegment(rawArtist) || 'Unknown Artist';

    const rawAlbum =
      String(album || '').trim() ||
      String(collectionTitle || '').trim() ||
      (isPlaylist ? 'Unknown Album' : String(trackTitle || '').trim()) ||
      'Singles';
    const albumSeg = sanitizePathSegment(rawAlbum) || 'Singles';

    const candidate = path.resolve(resolvedMusicRoot, artistSeg, albumSeg);
    return assertInsideMusicRoot(candidate);
  }

  function pruneOldJobs() {
    if (jobs.size <= MAX_HISTORY_JOBS) return;
    const list = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const j of list) {
      if (jobs.size <= MAX_HISTORY_JOBS) break;
      if (j.status === 'completed' || j.status === 'cancelled' || j.status === 'failed') {
        jobs.delete(j.id);
      }
    }
  }

  function serializeJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      url: job.url,
      format: job.format,
      destMode: job.destMode,
      destRelPath: job.destRelPath,
      collectionTitle: job.collectionTitle,
      status: job.status,
      pausedReason: job.pausedReason,
      totalTracks: job.totalTracks,
      completedTracks: job.completedTracks,
      currentTrackIndex: job.currentTrackIndex,
      currentTrackTitle: job.currentTrackTitle,
      detectedBitrateKbps: job.detectedBitrateKbps,
      allowLowBitrate: job.allowLowBitrate,
      lowBitrateAlert: job.lowBitrateAlert
        ? {
            trackTitle: job.lowBitrateAlert.trackTitle,
            bitrateKbps: job.lowBitrateAlert.bitrateKbps,
            formatId: job.lowBitrateAlert.formatId,
            acodec: job.lowBitrateAlert.acodec,
            plannedFileName: job.lowBitrateAlert.plannedFileName,
            cookiesWereUsed: job.lowBitrateAlert.cookiesWereUsed,
            thresholdKbps: LOW_BITRATE_THRESHOLD_KBPS,
          }
        : null,
      downloadedFiles: job.downloadedFiles,
      failedTracks: job.failedTracks,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  /**
   * Move a downloaded track from staging into its verified NTFS/Linux-safe MUSIC_DIR destination.
   */
  async function commitStagedTrackToDest(stagedFilePath, destDir, trackIndex, totalTracks, desiredBaseName = '') {
    const safeDestDir = assertInsideMusicRoot(destDir);
    await fs.mkdir(safeDestDir, { recursive: true });
    const ext = path.extname(stagedFilePath);
    const rawStem = desiredBaseName || path.basename(stagedFilePath, ext);
    const cleanStem = sanitizePathSegment(rawStem) || `track_${trackIndex}`;
    const prefix = totalTracks > 1 ? `${String(trackIndex).padStart(2, '0')} - ` : '';

    // Avoid redundant numeric prefix if filename already starts with "01 - "
    const hasPrefix = /^\d{2,3}\s*[-._]\s*/.test(cleanStem);
    const baseWithPrefix = hasPrefix ? cleanStem : `${prefix}${cleanStem}`;
    const finalFileName = `${baseWithPrefix}${ext}`;

    const relDestDir = path.relative(STORAGE_DIR, safeDestDir);
    const verifiedDir = resolveSafePath(relDestDir, { forbidRoot: true });
    assertInsideMusicRoot(verifiedDir);
    const finalTarget = path.resolve(verifiedDir, finalFileName);
    assertInsideMusicRoot(finalTarget);
    assertSafeFileWriteTarget(finalTarget, verifiedDir);

    await fs.copyFile(stagedFilePath, finalTarget);
    await fs.unlink(stagedFilePath).catch(() => {});

    return {
      fileName: finalFileName,
      fullPath: finalTarget,
      relPath: path.relative(STORAGE_DIR, finalTarget).replace(/\\/g, '/'),
      folderRelPath: path.relative(STORAGE_DIR, verifiedDir).replace(/\\/g, '/'),
    };
  }

  /**
   * Download a single track into staging using explicit format selectors & JS runtime.
   */
  async function downloadTrackIntoStaging(job, ytDlp, track, cookiesActivePath) {
    await fs.mkdir(job.stagingDir, { recursive: true });
    // Clear previous files inside stagingDir before single track extraction
    const existing = await fs.readdir(job.stagingDir);
    for (const f of existing) {
      await fs.unlink(path.join(job.stagingDir, f)).catch(() => {});
    }

    const ffmpegBin = getFfmpegBinaryPath();
    const outTemplate = path.join(job.stagingDir, '%(title).180B.%(ext)s');

    const formatSelector =
      job.format === 'm4a'
        ? '141/bestaudio[ext=m4a]/bestaudio'
        : '251/bestaudio[acodec=opus]/bestaudio';
    const audioFormat = job.format === 'm4a' ? 'm4a' : 'opus';

    const args = [
      ...ytDlp.prefixArgs,
      '--js-runtimes',
      'node',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--windows-filenames',
      '--ffmpeg-location',
      ffmpegBin.includes(path.sep) ? path.dirname(ffmpegBin) : ffmpegBin,
      '-f',
      formatSelector,
      '-x',
      '--audio-format',
      audioFormat,
      '--audio-quality',
      '0',
      '--add-metadata',
      '--embed-thumbnail',
      '--write-info-json',
    ];

    if (cookiesActivePath) {
      args.push('--cookies', cookiesActivePath);
    }
    args.push('-o', outTemplate, '--', track.url);

    await new Promise((resolve, reject) => {
      let stderrTail = '';
      const child = spawn(ytDlp.command, args, { windowsHide: true });
      job.activeChild = child;

      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-1500);
      });

      child.on('error', (err) => {
        job.activeChild = null;
        reject(err);
      });

      child.on('close', (code) => {
        job.activeChild = null;
        if (job.cancelRequested) {
          return reject(new Error('Job cancelled by user'));
        }
        if (code !== 0) {
          return reject(new Error(stderrTail.trim() || `yt-dlp exited with code ${code}`));
        }
        resolve();
      });
    });

    const stagingEntries = await fs.readdir(job.stagingDir);
    let trackInfoJson = null;
    const infoFile = stagingEntries.find((f) => f.endsWith('.info.json'));
    if (infoFile) {
      try {
        trackInfoJson = JSON.parse(await fs.readFile(path.join(job.stagingDir, infoFile), 'utf8'));
      } catch (_) {}
    }

    const audioFiles = stagingEntries.filter((f) => {
      const lower = f.toLowerCase();
      return (
        !lower.endsWith('.part') &&
        !lower.endsWith('.ytdl') &&
        !lower.endsWith('.info.json') &&
        !lower.endsWith('.temp') &&
        /\.(opus|m4a|mp3|flac|ogg|aac|wav|webm|mp4)$/i.test(lower)
      );
    });

    if (audioFiles.length === 0) {
      throw new Error('yt-dlp finished without producing an audio file');
    }

    const stagedFilePath = path.join(job.stagingDir, audioFiles[0]);
    const fileBitrateKbps = await inspectLocalAudioFileBitrateKbps(stagedFilePath);
    return { stagedFilePath, fileBitrateKbps, trackInfoJson };
  }

  /**
   * Sequential queue worker with Track #1 128kbps safeguard.
   */
  async function runDownloadJob(job, startIndex = 0) {
    try {
      const ytDlp = await resolveYtDlpBinary();
      if (!ytDlp.available) {
        throw new Error(
          'yt-dlp binary is not installed on the server. Install yt-dlp (e.g. winget install yt-dlp or pip install yt-dlp) and restart the bridge.'
        );
      }

      const cookiesExist = fsSync.existsSync(COOKIES_FILE_PATH);
      const cookiesPathForCmd = cookiesExist ? COOKIES_FILE_PATH : null;

      if (job.tracks.length === 0) {
        job.status = 'inspecting';
        job.updatedAt = Date.now();
        const playlistInfo = await fetchUrlPlaylistInfo(ytDlp, job.url, cookiesPathForCmd);
        job.tracks = playlistInfo.tracks;
        job.totalTracks = playlistInfo.tracks.length;
        job.collectionTitle = playlistInfo.collectionTitle;
        job.isPlaylist = Boolean(playlistInfo.isPlaylist);
      }

      if (job.cancelRequested) {
        job.status = 'cancelled';
        return;
      }

      for (let i = startIndex; i < job.tracks.length; i++) {
        if (job.cancelRequested) {
          job.status = 'cancelled';
          return;
        }

        const track = job.tracks[i];
        job.currentTrackIndex = i + 1;
        job.currentTrackTitle = track.title || `Track ${i + 1}`;
        job.status = i === 0 && !job.allowLowBitrate ? 'inspecting' : 'downloading';
        job.updatedAt = Date.now();

        try {
          let streamInfo = null;
          if (i === 0 && !job.allowLowBitrate) {
            streamInfo = await inspectTrackStreamInfo(ytDlp, track.url, cookiesPathForCmd, job.format);
            if (streamInfo.title) {
              track.title = streamInfo.title;
              job.currentTrackTitle = streamInfo.title;
            }
            if (streamInfo.artist) track.artist = streamInfo.artist;
            if (streamInfo.album) track.album = streamInfo.album;
          }

          if (job.cancelRequested) {
            job.status = 'cancelled';
            return;
          }

          job.status = 'downloading';
          job.updatedAt = Date.now();

          const { stagedFilePath, fileBitrateKbps, trackInfoJson } = await downloadTrackIntoStaging(
            job,
            ytDlp,
            track,
            cookiesPathForCmd
          );

          // Enrich track metadata from downloaded .info.json (crucial for Auto-Sort tracks 2..N)
          if (trackInfoJson) {
            const jsonTitle = trackInfoJson.track || trackInfoJson.title;
            const jsonArtist = extractCleanArtist(trackInfoJson);
            const jsonAlbum = trackInfoJson.album || trackInfoJson.playlist_title || '';
            if (jsonTitle) {
              track.title = jsonTitle;
              job.currentTrackTitle = jsonTitle;
            }
            if (jsonArtist) track.artist = jsonArtist;
            if (jsonAlbum) track.album = jsonAlbum;
          }

          // Determine track destination directory
          let trackDestDir = job.destDir;
          if (job.destMode === 'auto') {
            trackDestDir = resolveAutoSortTrackDir({
              artist: track.artist,
              album: track.album,
              trackTitle: track.title,
              collectionTitle: job.collectionTitle,
              isPlaylist: job.isPlaylist || job.totalTracks > 1,
            });
            job.destDir = trackDestDir;
            job.destRelPath = path.relative(STORAGE_DIR, trackDestDir).replace(/\\/g, '/');
          } else {
            trackDestDir = assertInsideMusicRoot(job.destDir);
          }

          // Determine pre-transcode source stream bitrate vs file bitrate
          const detectedKbps =
            streamInfo && streamInfo.streamBitrateKbps > 0
              ? streamInfo.streamBitrateKbps
              : fileBitrateKbps;

          if (i === 0 && detectedKbps > 0) {
            job.detectedBitrateKbps = detectedKbps;
          }

          // =================================================================
          // THE 128KBPS EXPIRATION SAFEGUARD (First track check: <= 135 kbps)
          // =================================================================
          if (
            i === 0 &&
            !job.allowLowBitrate &&
            detectedKbps > 0 &&
            detectedKbps <= job.bitrateThreshold
          ) {
            const stagedExt = path.extname(stagedFilePath);
            const cleanTitle = sanitizePathSegment(track.title || path.basename(stagedFilePath, stagedExt)) || 'track_1';
            job.status = 'paused_low_bitrate';
            job.pausedReason = 'low_bitrate_128kbps';
            job.lowBitrateAlert = {
              trackTitle: track.title || cleanTitle,
              bitrateKbps: detectedKbps,
              formatId: streamInfo?.formatId || '',
              acodec: streamInfo?.acodec || '',
              stagedFilePath,
              plannedDestDir: trackDestDir,
              plannedFileName: `${job.totalTracks > 1 ? '01 - ' : ''}${cleanTitle}${stagedExt}`,
              cookiesWereUsed: Boolean(cookiesPathForCmd),
            };
            job.updatedAt = Date.now();
            return; // Pause queue immediately until user chooses Cancel & Update Cookies or Continue Anyway
          }

          const committed = await commitStagedTrackToDest(
            stagedFilePath,
            trackDestDir,
            i + 1,
            job.totalTracks,
            track.title
          );
          job.downloadedFiles.push(committed);
          job.completedTracks = job.downloadedFiles.length;
          job.updatedAt = Date.now();
        } catch (trackErr) {
          if (job.cancelRequested) {
            job.status = 'cancelled';
            return;
          }
          job.failedTracks.push({
            index: i + 1,
            title: track.title || `Track ${i + 1}`,
            error: trackErr.message,
          });
          if (i === 0 && job.totalTracks === 1) {
            throw trackErr;
          }
        }
      }

      if (job.downloadedFiles.length === 0 && job.failedTracks.length > 0) {
        job.status = 'failed';
        job.error = job.failedTracks[0]?.error || 'All tracks failed to download';
      } else {
        job.status = 'completed';
      }
      job.updatedAt = Date.now();
      await fs.rm(job.stagingDir, { recursive: true, force: true }).catch(() => {});
    } catch (err) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
      } else {
        job.status = 'failed';
        job.error = err.message;
      }
      job.updatedAt = Date.now();
      await fs.rm(job.stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Enforce the exact same Files UI authentication on every /api/ytm/* route
  app.use('/api/ytm', (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (typeof verifyFilesAccess === 'function' && !verifyFilesAccess(req)) {
      return res.status(403).json({
        error: 'Forbidden: Files UI authentication is required for YTM Downloader endpoints.',
      });
    }
    next();
  });

  // GET /api/ytm/status - Tool health, cookie status, and active/recent jobs
  app.get('/api/ytm/status', async (req, res) => {
    try {
      const [ytDlp, cookies] = await Promise.all([resolveYtDlpBinary(), getCookieStatus()]);
      const ffmpegPath = getFfmpegBinaryPath();
      const jobList = [...jobs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(serializeJob);

      const defaultMusicRel = musicRelFromStorage || 'Music';
      res.json({
        ytDlp: {
          available: ytDlp.available,
          version: ytDlp.version,
        },
        ffmpeg: {
          available: Boolean(ffmpegPath),
        },
        cookies,
        defaultMusicRelPath: defaultMusicRel,
        musicRootDisplay: resolvedMusicRoot,
        bitrateThresholdKbps: LOW_BITRATE_THRESHOLD_KBPS,
        jobs: jobList,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/ytm/folders - Lightweight directory browser strictly scoped to G:\Server\Music (MUSIC_DIR)
  app.get('/api/ytm/folders', async (req, res) => {
    try {
      const rawPath = String(req.query.path || '').trim();
      const targetDir = resolveSafeMusicSubPath(rawPath, { stripMusicPrefix: true });

      if (!fsSync.existsSync(targetDir)) {
        return res.status(404).json({ error: 'Folder not found inside Music directory' });
      }
      const stat = await fs.lstat(targetDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Requested path is not a folder' });
      }

      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const folders = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => {
          const full = path.resolve(targetDir, e.name);
          return {
            name: e.name,
            musicSubPath: path.relative(resolvedMusicRoot, full).replace(/\\/g, '/'),
            storageRelPath: path.relative(resolvedStorageRoot, full).replace(/\\/g, '/'),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const musicSubPath = path.relative(resolvedMusicRoot, targetDir).replace(/\\/g, '/');
      const parentFull = path.dirname(targetDir);
      const isRoot = canonicalComparePath(targetDir) === CANONICAL_MUSIC_ROOT;
      const parentMusicSubPath = isRoot
        ? ''
        : path.relative(resolvedMusicRoot, parentFull).replace(/\\/g, '/');

      res.json({
        musicSubPath,
        storageRelPath: path.relative(resolvedStorageRoot, targetDir).replace(/\\/g, '/'),
        displayPath: targetDir,
        parentMusicSubPath,
        isRoot,
        folders,
      });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // POST /api/ytm/folders - Create a new subfolder strictly inside G:\Server\Music (MUSIC_DIR)
  app.post('/api/ytm/folders', async (req, res) => {
    try {
      const rawParent = String(req.body?.path || '').trim();
      const rawName = String(req.body?.name || '').trim();
      if (!rawName || rawName.includes('/') || rawName.includes('\\') || /^\.+$/.test(rawName)) {
        return res.status(400).json({ error: 'Invalid folder name' });
      }
      const cleanName = sanitizePathSegment(rawName);
      if (!cleanName) {
        return res.status(400).json({ error: 'Folder name contains only invalid characters' });
      }

      const parentDir = resolveSafeMusicSubPath(rawParent, { stripMusicPrefix: true });
      const newDir = assertInsideMusicRoot(path.resolve(parentDir, cleanName));
      await fs.mkdir(newDir, { recursive: true });

      res.json({
        success: true,
        folder: {
          name: cleanName,
          musicSubPath: path.relative(resolvedMusicRoot, newDir).replace(/\\/g, '/'),
          storageRelPath: path.relative(resolvedStorageRoot, newDir).replace(/\\/g, '/'),
        },
      });
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  });

  // GET /api/ytm/cookies - Return cookie status metadata (never exposes secrets)
  app.get('/api/ytm/cookies', async (req, res) => {
    try {
      const status = await getCookieStatus();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ytm/cookies - Save pasted or uploaded cookies.txt outside MUSIC_DIR
  app.post('/api/ytm/cookies', stagingUpload.any(), async (req, res) => {
    const stagedFiles = Array.isArray(req.files) ? req.files : [];
    try {
      let rawText = '';
      if (stagedFiles.length > 0 && stagedFiles[0]?.path) {
        rawText = await fs.readFile(stagedFiles[0].path, 'utf8');
      } else if (typeof req.body?.content === 'string') {
        rawText = req.body.content;
      } else if (typeof req.body?.cookies === 'string') {
        rawText = req.body.cookies;
      }

      const cookies = await saveCookiesContent(rawText);
      res.json({ success: true, cookies });
    } catch (err) {
      res.status(400).json({ error: err.message });
    } finally {
      for (const f of stagedFiles) {
        if (f?.path && fsSync.existsSync(f.path)) {
          await fs.unlink(f.path).catch(() => {});
        }
      }
    }
  });

  // DELETE /api/ytm/cookies - Delete server/config/cookies.txt
  app.delete('/api/ytm/cookies', async (req, res) => {
    try {
      const cookies = await deleteCookiesFile();
      res.json({ success: true, cookies });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ytm/download - Queue a YouTube Music URL download
  app.post('/api/ytm/download', async (req, res) => {
    try {
      const url = validateYtmUrl(req.body?.url);
      const requestedFormat = String(req.body?.format || 'opus').toLowerCase();
      const format = ALLOWED_FORMATS.has(requestedFormat) ? requestedFormat : 'opus';

      const requestedMode = String(req.body?.destMode || 'auto').toLowerCase();
      const destMode = ALLOWED_DEST_MODES.has(requestedMode) ? requestedMode : 'auto';
      const rawTargetDir = String(req.body?.targetDir || '').trim();

      let baseDestDir = resolvedMusicRoot;
      if (destMode === 'current') {
        if (!rawTargetDir) {
          baseDestDir = resolvedMusicRoot;
        } else {
          try {
            baseDestDir = resolveCurrentFolderInMusic(rawTargetDir);
          } catch (boundaryErr) {
            throw new Error(
              `Current Open Folder must be inside ${resolvedMusicRoot}. Navigate into Music first or switch to Choose Folder / Auto-Sort.`
            );
          }
        }
        if (fsSync.existsSync(baseDestDir) && !fsSync.lstatSync(baseDestDir).isDirectory()) {
          throw new Error('Target download destination exists and is not a folder');
        }
      } else if (destMode === 'choose') {
        baseDestDir = resolveSafeMusicSubPath(rawTargetDir, { stripMusicPrefix: true });
        if (fsSync.existsSync(baseDestDir) && !fsSync.lstatSync(baseDestDir).isDirectory()) {
          throw new Error('Target download destination exists and is not a folder');
        }
      } else {
        // auto mode
        baseDestDir = resolvedMusicRoot;
      }

      const id = `ytm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const stagingDir = path.join(TMP_CHUNKS_DIR, id);
      const job = {
        id,
        url,
        format,
        destMode,
        baseDestDir,
        destDir: baseDestDir,
        destRelPath: path.relative(resolvedStorageRoot, baseDestDir).replace(/\\/g, '/'),
        explicitSubfolder: destMode !== 'auto',
        createdDestFolder: false,
        isPlaylist: false,
        stagingDir,
        collectionTitle: '',
        tracks: [],
        totalTracks: 0,
        completedTracks: 0,
        currentTrackIndex: 0,
        currentTrackTitle: '',
        detectedBitrateKbps: 0,
        bitrateThreshold: LOW_BITRATE_THRESHOLD_KBPS,
        allowLowBitrate: Boolean(req.body?.allowLowBitrate),
        status: 'queued',
        pausedReason: null,
        lowBitrateAlert: null,
        downloadedFiles: [],
        failedTracks: [],
        error: null,
        cancelRequested: false,
        activeChild: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      jobs.set(id, job);
      pruneOldJobs();

      // Start asynchronous download worker (Track 1 bitrate check runs first)
      setImmediate(() => {
        runDownloadJob(job, 0);
      });

      res.json({ success: true, job: serializeJob(job) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/ytm/jobs/:id - Poll single download job status
  app.get('/api/ytm/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    res.json({ job: serializeJob(job) });
  });

  // POST /api/ytm/jobs/:id/resume - Continue Anyway after 128kbps pause
  app.post('/api/ytm/jobs/:id/resume', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Download job not found' });
    }
    if (job.status !== 'paused_low_bitrate') {
      return res.status(400).json({ error: `Job is not paused (${job.status})` });
    }

    try {
      job.allowLowBitrate = true;
      job.pausedReason = null;

      // Commit staged Track #1 to final destination inside MUSIC_DIR
      const alert = job.lowBitrateAlert;
      if (alert?.stagedFilePath && fsSync.existsSync(alert.stagedFilePath)) {
        const track1 = job.tracks[0];
        const destForTrack1 = alert.plannedDestDir || job.destDir;
        const committed = await commitStagedTrackToDest(
          alert.stagedFilePath,
          destForTrack1,
          1,
          job.totalTracks,
          track1?.title || alert.trackTitle
        );
        job.downloadedFiles.push(committed);
        job.completedTracks = job.downloadedFiles.length;
      }

      job.lowBitrateAlert = null;

      if (job.totalTracks <= 1) {
        job.status = 'completed';
        job.updatedAt = Date.now();
        await fs.rm(job.stagingDir, { recursive: true, force: true }).catch(() => {});
      } else {
        job.status = 'downloading';
        job.updatedAt = Date.now();
        setImmediate(() => {
          runDownloadJob(job, 1);
        });
      }

      res.json({ success: true, job: serializeJob(job) });
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/ytm/jobs/:id/cancel - Abort remaining tracks & optionally delete low-bitrate file
  app.post('/api/ytm/jobs/:id/cancel', async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Download job not found' });
    }

    job.cancelRequested = true;
    if (job.activeChild) {
      await killSpawnedProcess(job.activeChild);
    }

    const deleteLowBitrate = req.body?.deleteLowBitrateFile !== false;
    const deletedFiles = [];

    if (deleteLowBitrate && job.lowBitrateAlert?.stagedFilePath) {
      if (fsSync.existsSync(job.lowBitrateAlert.stagedFilePath)) {
        await fs.unlink(job.lowBitrateAlert.stagedFilePath).catch(() => {});
        deletedFiles.push(path.basename(job.lowBitrateAlert.stagedFilePath));
      }
    }

    // Also delete any Track 1 file if already committed and deleteLowBitrate was requested during safeguard cancel
    if (deleteLowBitrate && job.status === 'paused_low_bitrate' && job.downloadedFiles.length > 0) {
      for (const df of job.downloadedFiles) {
        if (df.fullPath && fsSync.existsSync(df.fullPath)) {
          await fs.unlink(df.fullPath).catch(() => {});
          deletedFiles.push(df.fileName);
        }
      }
      job.downloadedFiles = [];
      job.completedTracks = 0;
    }

    // Remove staging folder and any empty newly created playlist directory
    await fs.rm(job.stagingDir, { recursive: true, force: true }).catch(() => {});
    if (job.createdDestFolder && fsSync.existsSync(job.destDir)) {
      try {
        const remaining = await fs.readdir(job.destDir);
        if (remaining.length === 0) {
          await fs.rmdir(job.destDir);
        }
      } catch (_) {}
    }

    job.status = 'cancelled';
    job.pausedReason = null;
    job.lowBitrateAlert = null;
    job.updatedAt = Date.now();

    res.json({ success: true, deletedFiles, job: serializeJob(job) });
  });
}
