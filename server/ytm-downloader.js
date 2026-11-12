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
const ALLOWED_FORMATS = new Set(['opus', 'm4a', 'mp3', 'flac', 'best']);
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
 * Extract the selected stream's bitrate & metadata using yt-dlp --dump-single-json.
 */
async function inspectTrackStreamInfo(ytDlp, trackUrl, cookiesActivePath) {
  const args = [
    ...ytDlp.prefixArgs,
    '--no-playlist',
    '--no-warnings',
    '--dump-single-json',
    '-f',
    'bestaudio/best',
  ];
  if (cookiesActivePath) {
    args.push('--cookies', cookiesActivePath);
  }
  args.push('--', trackUrl);

  const { stdout } = await execFileAsync(ytDlp.command, args, {
    timeout: 45000,
    maxBuffer: 25 * 1024 * 1024,
    windowsHide: true,
  });
  const info = JSON.parse(stdout);
  const rawAbr = Number(info.abr);
  const rawTbr = Number(info.tbr);
  const isAudioOnly = !info.vcodec || info.vcodec === 'none';
  const streamBitrateKbps =
    rawAbr > 0 ? Math.round(rawAbr) : isAudioOnly && rawTbr > 0 ? Math.round(rawTbr) : 0;

  return {
    id: info.id || '',
    title: info.track || info.title || 'Unknown Track',
    artist: info.artist || info.uploader || info.channel || '',
    album: info.album || info.playlist_title || '',
    formatId: String(info.format_id || ''),
    acodec: String(info.acodec || ''),
    ext: String(info.ext || ''),
    streamBitrateKbps,
  };
}

/**
 * Resolve single track or playlist/album entries via yt-dlp --flat-playlist --dump-single-json.
 */
async function fetchUrlPlaylistInfo(ytDlp, url, cookiesActivePath) {
  const args = [
    ...ytDlp.prefixArgs,
    '--flat-playlist',
    '--no-warnings',
    '--dump-single-json',
  ];
  if (cookiesActivePath) {
    args.push('--cookies', cookiesActivePath);
  }
  args.push('--', url);

  const { stdout } = await execFileAsync(ytDlp.command, args, {
    timeout: 45000,
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  });
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
          title: entry.title || `Track ${idx + 1}`,
          artist: entry.artist || entry.uploader || entry.channel || data.uploader || '',
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
        artist: data.artist || data.uploader || data.channel || '',
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
    await fs.mkdir(destDir, { recursive: true });
    const ext = path.extname(stagedFilePath);
    const rawStem = desiredBaseName || path.basename(stagedFilePath, ext);
    const cleanStem = sanitizePathSegment(rawStem) || `track_${trackIndex}`;
    const prefix = totalTracks > 1 ? `${String(trackIndex).padStart(2, '0')} - ` : '';

    // Avoid redundant numeric prefix if filename already starts with "01 - "
    const hasPrefix = /^\d{2,3}\s*[-._]\s*/.test(cleanStem);
    const baseWithPrefix = hasPrefix ? cleanStem : `${prefix}${cleanStem}`;
    const finalFileName = `${baseWithPrefix}${ext}`;

    const relDestDir = path.relative(STORAGE_DIR, destDir);
    const verifiedDir = resolveSafePath(relDestDir, { forbidRoot: true });
    const finalTarget = path.join(verifiedDir, finalFileName);
    assertSafeFileWriteTarget(finalTarget, verifiedDir);

    await fs.copyFile(stagedFilePath, finalTarget);
    await fs.unlink(stagedFilePath).catch(() => {});

    return {
      fileName: finalFileName,
      fullPath: finalTarget,
      relPath: path.relative(STORAGE_DIR, finalTarget).replace(/\\/g, '/'),
    };
  }

  /**
   * Download a single track into staging and return staged file path + bitrate metadata.
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
    const args = [
      ...ytDlp.prefixArgs,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--ffmpeg-location',
      ffmpegBin.includes(path.sep) ? path.dirname(ffmpegBin) : ffmpegBin,
      '-f',
      'bestaudio/best',
      '--add-metadata',
      '--embed-thumbnail',
    ];

    if (job.format !== 'best') {
      args.push('--extract-audio', '--audio-format', job.format, '--audio-quality', '0');
    }
    if (cookiesActivePath) {
      args.push('--cookies', cookiesActivePath);
    }
    args.push('-o', outTemplate, '--', track.url);

    await new Promise((resolve, reject) => {
      let stderrTail = '';
      const child = spawn(ytDlp.command, args, { windowsHide: true });
      job.activeChild = child;

      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-1200);
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

    const files = (await fs.readdir(job.stagingDir)).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (files.length === 0) {
      throw new Error('yt-dlp finished without producing an audio file');
    }

    const stagedFilePath = path.join(job.stagingDir, files[0]);
    const fileBitrateKbps = await inspectLocalAudioFileBitrateKbps(stagedFilePath);
    return { stagedFilePath, fileBitrateKbps };
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

        // If downloading a playlist/album into MUSIC_DIR or parent folder without explicit album folder, create safe subfolder
        if (playlistInfo.isPlaylist && playlistInfo.collectionTitle && !job.explicitSubfolder) {
          const folderSeg = sanitizePathSegment(playlistInfo.collectionTitle) || `YTM_Playlist_${Date.now()}`;
          const candidateDir = path.join(job.baseDestDir, folderSeg);
          const rel = path.relative(STORAGE_DIR, candidateDir);
          job.destDir = resolveSafePath(rel, { forbidRoot: true });
          job.destRelPath = path.relative(STORAGE_DIR, job.destDir).replace(/\\/g, '/');
          job.createdDestFolder = !fsSync.existsSync(job.destDir);
        }
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
            streamInfo = await inspectTrackStreamInfo(ytDlp, track.url, cookiesPathForCmd);
            if (streamInfo.title) {
              track.title = streamInfo.title;
              job.currentTrackTitle = streamInfo.title;
            }
          }

          if (job.cancelRequested) {
            job.status = 'cancelled';
            return;
          }

          job.status = 'downloading';
          job.updatedAt = Date.now();

          const { stagedFilePath, fileBitrateKbps } = await downloadTrackIntoStaging(
            job,
            ytDlp,
            track,
            cookiesPathForCmd
          );

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
              plannedFileName: `${job.totalTracks > 1 ? '01 - ' : ''}${cleanTitle}${stagedExt}`,
              cookiesWereUsed: Boolean(cookiesPathForCmd),
            };
            job.updatedAt = Date.now();
            return; // Pause queue immediately until user chooses Cancel & Update Cookies or Continue Anyway
          }

          const committed = await commitStagedTrackToDest(
            stagedFilePath,
            job.destDir,
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

      const defaultMusicRel = path.relative(STORAGE_DIR, MUSIC_DIR).replace(/\\/g, '/') || 'Music';
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
        bitrateThresholdKbps: LOW_BITRATE_THRESHOLD_KBPS,
        jobs: jobList,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
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
      const rawTargetDir = String(req.body?.targetDir || '').trim();

      let baseDestDir = MUSIC_DIR;
      let explicitSubfolder = false;
      if (rawTargetDir) {
        const resolved = resolveSafePath(rawTargetDir, { forbidRoot: true });
        if (fsSync.existsSync(resolved) && !fsSync.lstatSync(resolved).isDirectory()) {
          throw new Error('Target download destination exists and is not a folder');
        }
        baseDestDir = resolved;
        // Treat explicit subfolder inside Music (e.g. "Music/Artist/Album") as user-chosen folder
        const musicRel = path.relative(STORAGE_DIR, MUSIC_DIR).replace(/\\/g, '/');
        const targetRel = path.relative(STORAGE_DIR, resolved).replace(/\\/g, '/');
        if (targetRel !== musicRel) {
          explicitSubfolder = true;
        }
      }

      const id = `ytm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const stagingDir = path.join(TMP_CHUNKS_DIR, id);
      const job = {
        id,
        url,
        format,
        baseDestDir,
        destDir: baseDestDir,
        destRelPath: path.relative(STORAGE_DIR, baseDestDir).replace(/\\/g, '/'),
        explicitSubfolder,
        createdDestFolder: false,
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
        const committed = await commitStagedTrackToDest(
          alert.stagedFilePath,
          job.destDir,
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
