// file-bridge.js - Lightweight local storage file manager bridge for Plenrip Audio
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  isAudioFileName,
  detectImageInfo,
  readAudioMetadata,
  writeAudioMetadata,
  searchMetadataOnline,
  fetchRemoteCoverBuffer,
} from './audio-tagger.js';
import { registerYtmRoutes } from './ytm-downloader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

// Load .env if present (project root or current directory)
const envCandidates = [
  path.resolve(PROJECT_DIR, '.env'),
  path.resolve(__dirname, '.env'),
  path.resolve(process.cwd(), '.env'),
];
for (const envPath of envCandidates) {
  if (fsSync.existsSync(envPath)) {
    try {
      const envLines = fsSync.readFileSync(envPath, 'utf-8').split(/\r?\n/);
      for (const line of envLines) {
        const match = line.trim().match(/^([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) {
          process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    } catch (_) {}
    break;
  }
}

const app = express();
const PORT = process.env.FILE_BRIDGE_PORT || process.env.PORT || 3001;
const NAS_API_KEY = process.env.NAS_API_KEY || process.env.FILE_BRIDGE_KEY || '';
const PLACEHOLDER_KEYS = new Set(['your-secret-api-key-here', 'change-me', 'secret']);
if (!NAS_API_KEY || PLACEHOLDER_KEYS.has(NAS_API_KEY)) {
  console.error('ERROR: A real NAS API key is required. Set NAS_API_KEY to a long random value (not the placeholder).');
  console.error('The bridge refuses to start without one: an unauthenticated file bridge exposes your storage.');
  process.exit(1);
}

// Storage root: STORAGE_DIR / NAS_ROOT, or G:\Server, or ./storage at the project root
function resolveStorageRoot() {
  if (process.env.STORAGE_DIR) return path.resolve(process.env.STORAGE_DIR);
  if (process.env.NAS_ROOT) return path.resolve(process.env.NAS_ROOT);
  if (fsSync.existsSync('G:\\Server')) return 'G:\\Server';
  if (process.env.ND_MUSICFOLDER) return path.resolve(process.env.ND_MUSICFOLDER, '..');
  return path.resolve(PROJECT_DIR, 'storage');
}

const STORAGE_DIR = path.resolve(resolveStorageRoot());
const MUSIC_DIR = path.resolve(process.env.ND_MUSICFOLDER || path.join(STORAGE_DIR, 'Music'));
const TMP_CHUNKS_DIR = path.resolve(STORAGE_DIR, '.tmp_chunks');

if (!fsSync.existsSync(STORAGE_DIR)) fsSync.mkdirSync(STORAGE_DIR, { recursive: true });
if (!fsSync.existsSync(TMP_CHUNKS_DIR)) fsSync.mkdirSync(TMP_CHUNKS_DIR, { recursive: true });

// ============================================================================
// HARDCODED SECURITY BOUNDARY & PATH NORMALIZATION
// ============================================================================

// Canonicalize a path for security comparisons.
// On Windows, NTFS is case-insensitive and Win32 silently strips trailing dots/spaces.
function canonicalizePath(targetPath) {
  const resolved = path.resolve(String(targetPath || ''));
  const stripped = resolved.replace(/[\\/.\s]+$/, '');
  return process.platform === 'win32' ? stripped.toLowerCase() : stripped;
}

const CANONICAL_STORAGE_ROOT = canonicalizePath(STORAGE_DIR);
const CANONICAL_MUSIC_ROOT = canonicalizePath(MUSIC_DIR);
const CANONICAL_PROJECT_ROOT = canonicalizePath(PROJECT_DIR);
const CANONICAL_SERVER_ROOT = canonicalizePath(__dirname);
const CANONICAL_TMP_ROOT = canonicalizePath(TMP_CHUNKS_DIR);

// Directories that must NEVER be overwritten, renamed over, or deleted.
const PROTECTED_CANONICAL_DIRS = new Set([
  CANONICAL_STORAGE_ROOT,
  CANONICAL_MUSIC_ROOT,
  CANONICAL_PROJECT_ROOT,
  CANONICAL_SERVER_ROOT,
  CANONICAL_TMP_ROOT,
]);

// macOS / Windows / Linux metadata files that should be ignored during folder uploads
const IGNORED_SYSTEM_NAMES = new Set([
  '.ds_store',
  '__macosx',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  '.temporaryitems',
  '.volumeicon.icns',
  '.apdisk',
  'thumbs.db',
  'desktop.ini',
  '.directory',
]);

// Windows reserved device names (forbidden on NTFS even with extensions)
const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Returns true if the given relative path is a macOS/Windows/Linux hidden metadata file
 * (such as .DS_Store, ._ResourceFork, __MACOSX, Thumbs.db, desktop.ini, .Trash-1000, .directory).
 */
function isSystemMetadataPath(rawPath) {
  if (!rawPath) return false;
  const normalized = String(rawPath).normalize('NFC').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  for (const seg of segments) {
    const clean = seg.trim();
    const lower = clean.toLowerCase();
    if (IGNORED_SYSTEM_NAMES.has(lower)) return true;
    if (clean.startsWith('._')) return true; // macOS AppleDouble resource fork
    if (lower.startsWith('.trash-')) return true; // Linux freedesktop trash folder
  }
  return false;
}

/**
 * Sanitize a single directory or file name segment so it is 100% safe on both
 * Windows NTFS and POSIX without stripping valid Unicode / CJK / artist text.
 * - Normalizes macOS NFD Unicode to composed NFC.
 * - Rejects dot-only segments (".", "..", "...", ".........").
 * - Replaces Windows illegal characters (< > : " / \ | ? * and control chars) with '_'.
 * - Strips trailing dots and spaces (prevents Win32 from collapsing a folder name to empty).
 */
function sanitizePathSegment(rawSegment) {
  if (typeof rawSegment !== 'string') return '';
  let seg = rawSegment.normalize('NFC').trim();
  if (!seg) return '';

  // Reject any segment composed solely of dots (".", "..", "...", ".........")
  if (/^\.+$/.test(seg)) {
    return '';
  }

  // Extract basename after normalizing slashes to ensure a single segment
  seg = path.basename(seg.replace(/\\/g, '/'));
  if (!seg || /^\.+$/.test(seg)) {
    return '';
  }

  // Replace Windows NTFS illegal characters and ASCII control characters with '_'
  // Preserves all letters, numbers, spaces, Japanese/Korean/Chinese/Unicode, and safe punctuation.
  seg = seg.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_');

  // Strip trailing dots and spaces (Win32 strips these at the kernel level, which can collapse names)
  seg = seg.replace(/[\s.]+$/, '').replace(/^\s+/, '');

  if (!seg || /^\.+$/.test(seg)) {
    return '';
  }

  // Prefix Windows reserved device names (CON, NUL, AUX, etc.)
  if (WINDOWS_RESERVED_NAME_RE.test(seg)) {
    seg = `_${seg}`;
  }

  return seg;
}

/**
 * Normalize and validate a client-supplied relative file path (e.g. from webkitRelativePath).
 * Uses path.join and path.basename so folder structures are preserved cleanly without collapsing.
 */
function normalizeUploadRelPath(rawPath, fallbackFilename = '') {
  const input = rawPath && String(rawPath).trim() ? String(rawPath) : String(fallbackFilename || '');
  if (!input || input.includes('\0')) {
    throw new Error('Invalid or empty upload file path');
  }

  // Split on forward or back slashes (strip leading Windows drive letter like "C:\" if present)
  const rawSegments = input
    .normalize('NFC')
    .replace(/^[a-zA-Z]:[\\/]+/, '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSegments.length === 0) {
    throw new Error('Upload path resolved to zero segments');
  }

  const safeSegments = [];
  for (const rawSeg of rawSegments) {
    // Single dot is current dir (ignore)
    if (rawSeg === '.') continue;
    // 2 or more dots ("..", "...", ".........") is a traversal / Win32 collapse hazard: abort!
    if (/^\.{2,}$/.test(rawSeg)) {
      throw new Error(`Security boundary violation: illegal dot-segment "${rawSeg}" in path`);
    }

    const cleanSeg = sanitizePathSegment(rawSeg);
    if (!cleanSeg) {
      throw new Error(`Security boundary violation: path segment "${rawSeg}" is invalid after sanitization`);
    }
    safeSegments.push(cleanSeg);
  }

  if (safeSegments.length === 0) {
    throw new Error('Upload path contained no valid segments');
  }

  const fileName = path.basename(safeSegments[safeSegments.length - 1]);
  const dirSegments = safeSegments.slice(0, -1);
  const relDir = dirSegments.length > 0 ? path.join(...dirSegments) : '';
  const relFull = path.join(...safeSegments);

  return {
    fileName,
    relDir,
    relFull,
    segments: safeSegments,
  };
}

/**
 * Resolve a relative sub-path inside STORAGE_DIR and enforce the hardcoded security boundary.
 *
 * @param {string} sub - Relative path inside STORAGE_DIR
 * @param {object} options
 * @param {boolean} options.forbidRoot - Explicitly throw a fatal error if target === STORAGE_DIR
 * @param {boolean} options.forbidProtected - Explicitly throw if target is STORAGE_DIR, MUSIC_DIR, PROJECT_DIR, etc.
 */
function resolveSafePath(sub = '', { forbidRoot = false, forbidProtected = false } = {}) {
  const rawSub = String(sub ?? '').normalize('NFC').trim();
  if (rawSub.includes('\0')) {
    throw new Error('Security boundary violation: null byte in path');
  }

  // Check raw segments for multi-dot traversal/collapse ("..", "...", ".........")
  const rawParts = rawSub.replace(/\\/g, '/').split('/').filter(Boolean);
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (/^\.{2,}$/.test(trimmed)) {
      throw new Error(`Security boundary violation: path traversal or multi-dot segment "${trimmed}" is forbidden`);
    }
    // Check if stripping trailing dots/spaces collapses a non-dot segment into empty
    if (trimmed !== '.' && trimmed.replace(/[\s.]+$/, '') === '') {
      throw new Error(`Security boundary violation: segment "${trimmed}" collapses under Win32 path rules`);
    }
  }

  const sanitizedParts = [];
  for (const part of rawParts) {
    if (part === '.') continue;
    const clean = sanitizePathSegment(part);
    if (!clean) {
      throw new Error(`Security boundary violation: invalid path segment "${part}"`);
    }
    sanitizedParts.push(clean);
  }

  const root = path.resolve(STORAGE_DIR);
  const target = sanitizedParts.length > 0 ? path.resolve(root, path.join(...sanitizedParts)) : root;
  const canonicalTarget = canonicalizePath(target);

  // 1. Must sit inside STORAGE_DIR
  if (
    canonicalTarget !== CANONICAL_STORAGE_ROOT &&
    !canonicalTarget.startsWith(CANONICAL_STORAGE_ROOT + path.sep)
  ) {
    throw new Error(`FATAL SECURITY BOUNDARY: Target "${target}" escapes storage root "${STORAGE_DIR}"`);
  }

  // 2. Must NEVER touch internal directories (staging or server source)
  if (
    canonicalTarget === CANONICAL_SERVER_ROOT ||
    canonicalTarget.startsWith(CANONICAL_SERVER_ROOT + path.sep) ||
    canonicalTarget === CANONICAL_TMP_ROOT ||
    canonicalTarget.startsWith(CANONICAL_TMP_ROOT + path.sep)
  ) {
    throw new Error(`FATAL SECURITY BOUNDARY: Access to application/internal directory "${target}" is forbidden`);
  }

  // If STORAGE_DIR is located outside PROJECT_DIR, forbid any touch into PROJECT_DIR
  if (
    !CANONICAL_STORAGE_ROOT.startsWith(CANONICAL_PROJECT_ROOT + path.sep) &&
    (canonicalTarget === CANONICAL_PROJECT_ROOT || canonicalTarget.startsWith(CANONICAL_PROJECT_ROOT + path.sep))
  ) {
    throw new Error(`FATAL SECURITY BOUNDARY: Access to application/internal directory "${target}" is forbidden`);
  }

  // 3. Explicit fatal error if target equals STORAGE_DIR when forbidden
  if (forbidRoot && canonicalTarget === CANONICAL_STORAGE_ROOT) {
    throw new Error(`FATAL SECURITY BOUNDARY: Operation directly on root storage directory "${STORAGE_DIR}" is forbidden`);
  }

  // 4. Explicit fatal error if target is any protected root (e.g. G:\Server or G:\Server\Music)
  if (forbidProtected && PROTECTED_CANONICAL_DIRS.has(canonicalTarget)) {
    throw new Error(`FATAL SECURITY BOUNDARY: Destructive or overwrite operation on protected root "${target}" is forbidden`);
  }

  return target;
}

const safe = resolveSafePath;

/**
 * Verify a final file write target is strictly inside destDir and is NOT an existing directory
 * or protected root before any file write/copy takes place.
 */
function assertSafeFileWriteTarget(finalTarget, destDir) {
  const canonicalTarget = canonicalizePath(finalTarget);
  const canonicalDest = canonicalizePath(destDir);

  if (PROTECTED_CANONICAL_DIRS.has(canonicalTarget)) {
    throw new Error(`FATAL SECURITY BOUNDARY: Refusing to overwrite protected root directory "${finalTarget}"`);
  }

  if (
    canonicalTarget === CANONICAL_STORAGE_ROOT ||
    !canonicalTarget.startsWith(CANONICAL_STORAGE_ROOT + path.sep)
  ) {
    throw new Error(`FATAL SECURITY BOUNDARY: Write target "${finalTarget}" is outside storage root "${STORAGE_DIR}"`);
  }

  if (
    canonicalTarget === canonicalDest ||
    !canonicalTarget.startsWith(canonicalDest + path.sep)
  ) {
    throw new Error(`FATAL SECURITY BOUNDARY: Write target "${finalTarget}" must sit strictly inside destination "${destDir}"`);
  }

  // Never allow overwriting an existing directory or symlink with a file
  if (fsSync.existsSync(finalTarget)) {
    const stat = fsSync.lstatSync(finalTarget);
    if (stat.isDirectory()) {
      throw new Error(`FATAL SECURITY BOUNDARY: Target "${finalTarget}" is an existing directory; refusing to overwrite`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`FATAL SECURITY BOUNDARY: Target "${finalTarget}" is a symbolic link; refusing to overwrite`);
    }
  }
}

// ============================================================================
// MIDDLEWARE: CORS, AUTHENTICATION & SECURITY BOUNDARY
// ============================================================================

const ALLOWED_ORIGINS = [
  'https://plenrip.planrift.me',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      ALLOWED_ORIGINS.includes(origin) ||
      origin.endsWith('.planrift.me') ||
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'x-api-key',
    'X-API-Key',
    'x-spotify-client-id',
    'x-spotify-client-secret',
  ],
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Authentication middleware
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') return next();

  const isDownload = req.path === '/api/files/download';
  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['X-API-Key'] ||
    (isDownload ? req.query.apiKey || req.query.key || req.query['x-api-key'] : undefined);

  if (!apiKey || apiKey !== NAS_API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing API key (provide x-api-key header' +
        (isDownload ? ' or ?apiKey= parameter' : '') + ')',
    });
  }
  next();
});

// Strict path-checking security boundary middleware before any fs write/delete action
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  try {
    const rawSubPath = req.query.path ?? req.body?.path ?? '';
    const isDeleteEndpoint = req.method === 'DELETE' && req.path === '/api/files';

    // Pre-verify the base target path sits inside STORAGE_DIR
    // For DELETE /api/files, explicitly forbid targeting STORAGE_DIR or MUSIC_DIR
    const resolvedBase = resolveSafePath(rawSubPath, {
      forbidRoot: isDeleteEndpoint,
      forbidProtected: isDeleteEndpoint,
    });

    req.resolvedBaseDir = resolvedBase;
    next();
  } catch (err) {
    console.error(`[SecurityBoundary] Blocked ${req.method} ${req.originalUrl}: ${err.message}`);
    return res.status(403).json({ error: err.message });
  }
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check endpoint
app.get(['/api/health', '/api/files/health'], (req, res) => {
  res.json({ status: 'ok', service: 'file-bridge', storage: STORAGE_DIR, music: MUSIC_DIR });
});

// 1. List directory
app.get(['/api/files', '/api/files/list'], async (req, res) => {
  try {
    const dir = safe(req.query.path || '');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const visibleEntries = entries.filter(
      (e) => e.name !== '.tmp_chunks' && !IGNORED_SYSTEM_NAMES.has(e.name.toLowerCase()) && !e.name.startsWith('._')
    );
    const items = await Promise.all(
      visibleEntries.map(async (e) => {
        try {
          const s = await fs.stat(path.join(dir, e.name));
          return { name: e.name, isDirectory: e.isDirectory(), size: s.size, mtime: s.mtimeMs };
        } catch {
          return { name: e.name, isDirectory: e.isDirectory(), size: 0, mtime: 0 };
        }
      })
    );
    items.sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
    res.json({ path: path.relative(STORAGE_DIR, dir).replace(/\\/g, '/'), items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create new folder
app.post('/api/files/folder', async (req, res) => {
  try {
    const rawName = String(req.body.name || '').trim();
    if (!rawName || rawName.includes('/') || rawName.includes('\\') || /^\.+$/.test(rawName)) {
      return res.status(400).json({ error: 'Invalid folder name' });
    }
    const cleanName = sanitizePathSegment(rawName);
    if (!cleanName) {
      return res.status(400).json({ error: 'Folder name contains only invalid characters' });
    }
    const baseDir = req.resolvedBaseDir || safe(req.body.path || '');
    const target = resolveSafePath(path.relative(STORAGE_DIR, path.join(baseDir, cleanName)), {
      forbidRoot: true,
    });
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true, name: cleanName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload files (FormData batch upload)
// Files are first staged into isolated TMP_CHUNKS_DIR with random safe filenames,
// then validated, sanitized, and moved into their verified destination paths.
function getPreservedPathsList(body) {
  const p = body?.preservePaths || body?.paths || body?.preservePath || body?.['preservePaths[]'] || body?.['paths[]'];
  if (!p) return [];
  return Array.isArray(p) ? p : [p];
}

// Recover UTF-8 filenames when Multer/Busboy decodes Content-Disposition as Latin-1
function decodeMulterFilename(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  if (/[\u0080-\u00ff]/.test(rawName) && !/[\u0100-\uffff]/.test(rawName)) {
    try {
      const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
      if (!decoded.includes('\ufffd')) {
        return decoded.normalize('NFC');
      }
    } catch (_) {}
  }
  return rawName.normalize('NFC');
}

const stagingUpload = multer({
  limits: {
    fileSize: Infinity,
    fieldSize: 50 * 1024 * 1024,
  },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        if (!fsSync.existsSync(TMP_CHUNKS_DIR)) {
          fsSync.mkdirSync(TMP_CHUNKS_DIR, { recursive: true });
        }
        cb(null, TMP_CHUNKS_DIR);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, _file, cb) => {
      const unique = `stage_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.tmp`;
      cb(null, unique);
    },
  }),
});

async function safeRemoveStagingFile(stagedFilePath) {
  if (!stagedFilePath) return;
  try {
    const canonicalStaged = canonicalizePath(stagedFilePath);
    // Only ever unlink files strictly inside TMP_CHUNKS_DIR
    if (canonicalStaged.startsWith(CANONICAL_TMP_ROOT + path.sep) && fsSync.existsSync(stagedFilePath)) {
      await fs.unlink(stagedFilePath);
    }
  } catch (_) {}
}

app.post('/api/files/upload', stagingUpload.array('files'), async (req, res) => {
  const stagedFiles = Array.isArray(req.files) ? req.files : [];
  const pathsList = getPreservedPathsList(req.body);
  let savedCount = 0;

  try {
    const destDir = req.resolvedBaseDir || safe(req.query.path || '');
    const relDestFromRoot = path.relative(STORAGE_DIR, destDir);

    for (let i = 0; i < stagedFiles.length; i++) {
      const fileObj = stagedFiles[i];
      const stagedPath = fileObj.path;
      const decodedOriginalName = decodeMulterFilename(fileObj.originalname || '');
      const rawRelPath = pathsList[i] ? String(pathsList[i]).trim() : '';
      const candidatePath = rawRelPath || decodedOriginalName;

      // Skip macOS/Windows metadata junk (.DS_Store, ._*, __MACOSX, etc.)
      if (isSystemMetadataPath(candidatePath)) {
        await safeRemoveStagingFile(stagedPath);
        continue;
      }

      let normalized;
      try {
        normalized = normalizeUploadRelPath(rawRelPath, decodedOriginalName);
      } catch (normErr) {
        await safeRemoveStagingFile(stagedPath);
        console.warn(`[Upload] Skipping invalid path "${candidatePath}": ${normErr.message}`);
        continue;
      }

      const combinedRel = relDestFromRoot
        ? path.join(relDestFromRoot, normalized.relFull)
        : normalized.relFull;

      const finalTarget = resolveSafePath(combinedRel, {
        forbidRoot: true,
        forbidProtected: true,
      });

      assertSafeFileWriteTarget(finalTarget, destDir);

      const parentDir = path.dirname(finalTarget);
      await fs.mkdir(parentDir, { recursive: true });

      // Copy from staging temp file into verified target, then delete staging temp file
      await fs.copyFile(stagedPath, finalTarget);
      await safeRemoveStagingFile(stagedPath);
      savedCount++;
    }

    res.json({ success: true, count: savedCount });
  } catch (err) {
    // Clean up any remaining staged files on error
    for (const f of stagedFiles) {
      await safeRemoveStagingFile(f?.path);
    }
    console.error(`[Upload Error] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// 3b. Chunked upload (streams 20MB chunks to bypass Cloudflare's 100MB proxy limit)
function cleanOldTempChunks() {
  try {
    if (!fsSync.existsSync(TMP_CHUNKS_DIR)) return;
    const now = Date.now();
    const entries = fsSync.readdirSync(TMP_CHUNKS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.part') && !entry.name.endsWith('.tmp')) continue;
      const full = path.join(TMP_CHUNKS_DIR, entry.name);
      const canonicalFull = canonicalizePath(full);
      if (!canonicalFull.startsWith(CANONICAL_TMP_ROOT + path.sep)) continue;
      const st = fsSync.statSync(full);
      if (now - st.mtimeMs > 2 * 3600 * 1000) {
        fsSync.unlinkSync(full);
      }
    }
  } catch (_) {}
}

app.post('/api/files/upload-chunk', async (req, res) => {
  try {
    const destDir = req.resolvedBaseDir || safe(req.query.path || '');
    const rawName = String(req.query.preservePath || req.query.name || '').trim();
    const uploadId = String(req.query.uploadId || '').trim();
    const chunkIndex = parseInt(req.query.chunkIndex, 10);
    const totalChunks = parseInt(req.query.totalChunks, 10);

    if (!uploadId || !/^[a-zA-Z0-9_\-]+$/.test(uploadId)) {
      return res.status(400).json({ error: 'Invalid upload ID' });
    }
    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
      return res.status(400).json({ error: 'Invalid chunk index or total chunks' });
    }

    // Ignore macOS metadata files (.DS_Store, ._*, __MACOSX) cleanly without writing to disk
    if (isSystemMetadataPath(rawName)) {
      req.resume(); // Drain request stream
      return res.json({ success: true, completed: true, skipped: true });
    }

    const normalized = normalizeUploadRelPath(rawName);
    const relDestFromRoot = path.relative(STORAGE_DIR, destDir);
    const combinedRel = relDestFromRoot
      ? path.join(relDestFromRoot, normalized.relFull)
      : normalized.relFull;

    const finalTarget = resolveSafePath(combinedRel, {
      forbidRoot: true,
      forbidProtected: true,
    });

    assertSafeFileWriteTarget(finalTarget, destDir);

    if (!fsSync.existsSync(TMP_CHUNKS_DIR)) {
      fsSync.mkdirSync(TMP_CHUNKS_DIR, { recursive: true });
    }

    if (chunkIndex === 0 && Math.random() < 0.2) {
      cleanOldTempChunks();
    }

    const partFilePath = path.join(TMP_CHUNKS_DIR, `${uploadId}.part`);
    const canonicalPart = canonicalizePath(partFilePath);
    if (!canonicalPart.startsWith(CANONICAL_TMP_ROOT + path.sep)) {
      return res.status(403).json({ error: 'Security boundary violation: invalid part file location' });
    }

    // Stream binary chunk into isolated .part file
    await new Promise((resolve, reject) => {
      const outStream = fsSync.createWriteStream(partFilePath, {
        flags: chunkIndex === 0 ? 'w' : 'a',
      });
      req.pipe(outStream);
      outStream.on('finish', resolve);
      outStream.on('error', reject);
      req.on('error', reject);
    });

    // On final chunk, re-verify boundary and copy into destination
    if (chunkIndex === totalChunks - 1) {
      assertSafeFileWriteTarget(finalTarget, destDir);
      const parentDir = path.dirname(finalTarget);
      await fs.mkdir(parentDir, { recursive: true });

      await fs.copyFile(partFilePath, finalTarget);
      await safeRemoveStagingFile(partFilePath);

      return res.json({ success: true, completed: true, name: normalized.fileName });
    }

    return res.json({ success: true, completed: false, chunkIndex });
  } catch (err) {
    console.error(`[Chunk Upload Error] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/files/upload-chunk', async (req, res) => {
  try {
    const uploadId = String(req.query.uploadId || '').trim();
    if (uploadId && /^[a-zA-Z0-9_\-]+$/.test(uploadId)) {
      const partFilePath = path.join(TMP_CHUNKS_DIR, `${uploadId}.part`);
      await safeRemoveStagingFile(partFilePath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete file or directory
app.delete('/api/files', async (req, res) => {
  try {
    const rawPath = String(req.query.path || '').trim();
    if (!rawPath) {
      return res.status(400).json({ error: 'Missing path parameter for delete' });
    }

    const target = resolveSafePath(rawPath, {
      forbidRoot: true,
      forbidProtected: true,
    });

    const canonicalTarget = canonicalizePath(target);
    // Never allow deleting any ancestor directory of MUSIC_DIR or PROJECT_DIR
    if (
      CANONICAL_MUSIC_ROOT.startsWith(canonicalTarget + path.sep) ||
      CANONICAL_PROJECT_ROOT.startsWith(canonicalTarget + path.sep)
    ) {
      return res.status(403).json({
        error: 'FATAL SECURITY BOUNDARY: Cannot delete a parent directory of Music library or Player folder',
      });
    }

    const stat = await fs.lstat(target);
    if (stat.isDirectory()) {
      await fs.rm(target, { recursive: true, force: false });
    } else {
      await fs.unlink(target);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 5. Download file
app.get('/api/files/download', async (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).json({ error: 'Missing path query parameter' });
    }
    const target = resolveSafePath(rawPath, { forbidRoot: true });
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: 'Cannot download a directory directly' });
    }
    if (req.query.inline === '1' || req.query.inline === 'true') {
      return res.sendFile(target);
    }
    const filename = path.basename(target);
    res.download(target, filename, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'Failed to stream file' });
      }
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// 6. EMBEDDED COVER ART & FULL METADATA EDITOR ENDPOINTS
// ============================================================================

/**
 * Helper to resolve a cover image Buffer from an uploaded file, remote URL, or base64 Data URL.
 */
async function resolveCoverImageBuffer(req) {
  const uploadedFile = Array.isArray(req.files) && req.files.length > 0 ? req.files[0] : req.file;
  if (uploadedFile && uploadedFile.path) {
    const buf = await fs.readFile(uploadedFile.path);
    detectImageInfo(buf);
    return buf;
  }

  const coverUrl = String(req.body?.coverUrl || '').trim();
  if (coverUrl) {
    if (coverUrl.startsWith('data:image/')) {
      const commaIdx = coverUrl.indexOf(',');
      if (commaIdx === -1) throw new Error('Invalid base64 image data URL');
      const buf = Buffer.from(coverUrl.slice(commaIdx + 1), 'base64');
      detectImageInfo(buf);
      return buf;
    }
    return await fetchRemoteCoverBuffer(coverUrl);
  }

  return null;
}

/**
 * Resolve a relative path that may originate either from the Files tab (relative to STORAGE_DIR)
 * or from Navidrome's Subsonic API `song.path` (relative to MUSIC_DIR), with an optional
 * fallback search by artist/album/title hints.
 */
async function resolveExistingLibraryTarget(rawRelPath, { expectDir = false, hints = {} } = {}) {
  const candidates = [];
  const cleanRel = String(rawRelPath || '').normalize('NFC').trim();

  if (!cleanRel || cleanRel === '.' || cleanRel === '/') {
    if (expectDir) {
      if (fsSync.existsSync(MUSIC_DIR) && canonicalizePath(MUSIC_DIR).startsWith(CANONICAL_STORAGE_ROOT)) {
        return MUSIC_DIR;
      }
      return STORAGE_DIR;
    }
  }

  if (cleanRel) {
    // 1. Direct relative to STORAGE_DIR (e.g. "Music/Artist/Album/Track.mp3")
    try {
      const c1 = resolveSafePath(cleanRel, { forbidRoot: true });
      candidates.push(c1);
    } catch (_) {}

    // 2. Relative to MUSIC_DIR (e.g. Subsonic song.path "Artist/Album/Track.mp3" when STORAGE_DIR is G:\Server and MUSIC_DIR is G:\Server\Music)
    const relMusicFromStorage = path.relative(STORAGE_DIR, MUSIC_DIR);
    if (relMusicFromStorage && !relMusicFromStorage.startsWith('..')) {
      try {
        const c2 = resolveSafePath(path.join(relMusicFromStorage, cleanRel), { forbidRoot: true });
        candidates.push(c2);
      } catch (_) {}
    }

    // 3. Also check common "Music" or "music" subfolder inside STORAGE_DIR
    for (const subName of ['Music', 'music']) {
      try {
        const c3 = resolveSafePath(path.join(subName, cleanRel), { forbidRoot: true });
        candidates.push(c3);
      } catch (_) {}
    }
  }

  for (const cand of candidates) {
    if (fsSync.existsSync(cand)) {
      const st = fsSync.lstatSync(cand);
      if (expectDir && st.isFile()) {
        return path.dirname(cand);
      }
      return cand;
    }
  }

  // Fallback search inside MUSIC_DIR / STORAGE_DIR by album/artist/title hints if path wasn't found directly
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().trim();
  const wantTitle = norm(hints.title);
  const wantAlbum = norm(hints.album);
  const wantArtist = norm(hints.artist);

  if (wantTitle || wantAlbum || cleanRel) {
    const baseNameHint = cleanRel ? norm(path.basename(cleanRel.replace(/\\/g, '/'))) : '';
    const searchRoots = [];
    if (fsSync.existsSync(MUSIC_DIR) && canonicalizePath(MUSIC_DIR).startsWith(CANONICAL_STORAGE_ROOT)) {
      searchRoots.push(MUSIC_DIR);
    }
    if (!searchRoots.includes(STORAGE_DIR)) {
      searchRoots.push(STORAGE_DIR);
    }

    const queue = [...searchRoots];
    const visited = new Set(queue.map((d) => canonicalizePath(d)));
    let bestDirMatch = null;
    let bestFileMatch = null;

    while (queue.length > 0 && visited.size < 400) {
      const currentDir = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.name === '.tmp_chunks' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const fullPath = path.join(currentDir, entry.name);
        const canon = canonicalizePath(fullPath);
        if (
          canon === CANONICAL_PROJECT_ROOT ||
          canon.startsWith(CANONICAL_PROJECT_ROOT + path.sep) ||
          canon === CANONICAL_TMP_ROOT
        ) {
          continue;
        }

        const entryLower = norm(entry.name);
        if (entry.isDirectory()) {
          if (!visited.has(canon)) {
            visited.add(canon);
            queue.push(fullPath);
          }
          if (expectDir) {
            if (baseNameHint && entryLower === baseNameHint) {
              return fullPath;
            }
            if (wantAlbum && (entryLower === wantAlbum || entryLower.includes(wantAlbum))) {
              bestDirMatch = fullPath;
            } else if (!bestDirMatch && wantArtist && entryLower === wantArtist) {
              bestDirMatch = fullPath;
            }
          }
        } else if (entry.isFile() && isAudioFileName(entry.name)) {
          const stemLower = norm(path.basename(entry.name, path.extname(entry.name))).replace(/^\d+[\s._-]+/, '');
          if (baseNameHint && entryLower === baseNameHint) {
            return expectDir ? path.dirname(fullPath) : fullPath;
          }
          if (wantTitle && (stemLower === wantTitle || stemLower.includes(wantTitle))) {
            bestFileMatch = fullPath;
          }
        }
      }
    }

    if (expectDir && bestDirMatch) return bestDirMatch;
    if (expectDir && bestFileMatch) return path.dirname(bestFileMatch);
    if (!expectDir && bestFileMatch) return bestFileMatch;
  }

  throw new Error(`Could not locate target audio file or folder on server: "${cleanRel || wantAlbum || wantTitle}"`);
}

/**
 * Recursively collect all supported audio file paths within a directory up to maxDepth.
 */
async function collectAudioFilesRecursively(dirPath, currentDepth = 0, maxDepth = 4) {
  const results = [];
  if (currentDepth > maxDepth) return results;
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') || IGNORED_SYSTEM_NAMES.has(e.name.toLowerCase())) continue;
    const full = path.join(dirPath, e.name);
    if (e.isFile() && isAudioFileName(e.name)) {
      results.push(full);
    } else if (e.isDirectory() && !e.isSymbolicLink()) {
      const sub = await collectAudioFilesRecursively(full, currentDepth + 1, maxDepth);
      results.push(...sub);
    }
  }
  return results;
}

/**
 * Helper to apply metadata/cover updates to either a single audio file or every audio file in an album folder.
 */
async function applyMetadataByScope({
  scope,
  targetRelPath,
  filePaths = [],
  hints = {},
  updates,
  overrideAlbumTitles = false,
}) {
  const normalizedScope = String(scope || 'single').toLowerCase() === 'album' ? 'album' : 'single';

  if (normalizedScope === 'single') {
    const targetFile = await resolveExistingLibraryTarget(targetRelPath, {
      expectDir: false,
      hints,
    });
    const relFromRoot = path.relative(STORAGE_DIR, targetFile);
    const verifiedFile = resolveSafePath(relFromRoot, {
      forbidRoot: true,
      forbidProtected: true,
    });
    assertSafeFileWriteTarget(verifiedFile, STORAGE_DIR);

    if (!isAudioFileName(verifiedFile)) {
      throw new Error(`Unsupported audio file extension: ${path.extname(verifiedFile)}`);
    }

    await writeAudioMetadata(verifiedFile, updates, TMP_CHUNKS_DIR);
    return {
      scope: 'single',
      updatedCount: 1,
      updatedFiles: [path.basename(verifiedFile)],
      errors: [],
    };
  }

  // Album Mode:
  // In album mode, preserve each track's individual song title unless overrideAlbumTitles is true
  const albumUpdates = { ...updates };
  if (!overrideAlbumTitles) {
    delete albumUpdates.title;
  }

  // If explicit track filePaths were supplied (e.g. from Album Detail UI where album.song provides each track's path),
  // resolve all of them and also include all audio files inside their parent album folder.
  const targetTrackFiles = new Set();
  if (Array.isArray(filePaths) && filePaths.length > 0) {
    for (const fp of filePaths) {
      try {
        const resolvedTrack = await resolveExistingLibraryTarget(fp, { expectDir: false, hints });
        if (isAudioFileName(resolvedTrack)) {
          targetTrackFiles.add(resolvedTrack);
        }
      } catch (_) {}
    }
  }

  // Also resolve the album folder itself and include all audio files inside it (including subfolders like CD1/CD2)
  let targetFolder = null;
  try {
    targetFolder = await resolveExistingLibraryTarget(targetRelPath, {
      expectDir: true,
      hints,
    });
  } catch (folderErr) {
    if (targetTrackFiles.size > 0) {
      targetFolder = path.dirname([...targetTrackFiles][0]);
    } else {
      throw folderErr;
    }
  }

  if (targetFolder && fsSync.existsSync(targetFolder) && fsSync.lstatSync(targetFolder).isDirectory()) {
    const collected = await collectAudioFilesRecursively(targetFolder);
    for (const f of collected) {
      targetTrackFiles.add(f);
    }
  }

  if (targetTrackFiles.size === 0) {
    throw new Error('No supported audio files found for the selected album folder');
  }

  const updatedFiles = [];
  const errors = [];

  for (const fullTrackPath of targetTrackFiles) {
    const relTrack = path.relative(STORAGE_DIR, fullTrackPath);
    const safeTrackPath = resolveSafePath(relTrack, {
      forbidRoot: true,
      forbidProtected: true,
    });
    assertSafeFileWriteTarget(safeTrackPath, STORAGE_DIR);

    try {
      await writeAudioMetadata(safeTrackPath, albumUpdates, TMP_CHUNKS_DIR);
      updatedFiles.push(path.basename(safeTrackPath));
    } catch (trackErr) {
      errors.push({ file: path.basename(safeTrackPath), error: trackErr.message });
    }
  }

  if (updatedFiles.length === 0 && errors.length > 0) {
    throw new Error(errors[0].error || 'Failed to update audio files in folder');
  }

  return {
    scope: 'album',
    updatedCount: updatedFiles.length,
    totalAudioFiles: targetTrackFiles.size,
    updatedFiles,
    errors,
  };
}

// 6a. POST /api/update-cover - Update embedded cover art for a single track or entire album folder
app.post(['/api/update-cover', '/api/files/update-cover'], stagingUpload.any(), async (req, res) => {
  const stagedFiles = Array.isArray(req.files) ? req.files : [];
  try {
    const rawScope = String(req.body?.scope || req.body?.type || '').toLowerCase();
    const targetRelPath =
      req.body?.targetPath ||
      (rawScope === 'album' || rawScope === 'folder'
        ? req.body?.folderPath || req.body?.filePath || req.body?.path || ''
        : req.body?.filePath || req.body?.folderPath || req.body?.path || '');

    let scope = rawScope === 'album' || rawScope === 'folder' ? 'album' : (rawScope === 'single' || rawScope === 'file' ? 'single' : '');
    if (!scope && targetRelPath) {
      try {
        const candidate = resolveSafePath(targetRelPath);
        if (fsSync.existsSync(candidate) && fsSync.lstatSync(candidate).isDirectory()) {
          scope = 'album';
        } else {
          scope = 'single';
        }
      } catch (_) {
        scope = 'single';
      }
    }
    if (!scope) scope = 'single';

    let filePaths = [];
    if (req.body?.filePaths) {
      try {
        filePaths = typeof req.body.filePaths === 'string' ? JSON.parse(req.body.filePaths) : req.body.filePaths;
      } catch {
        filePaths = Array.isArray(req.body.filePaths) ? req.body.filePaths : [req.body.filePaths];
      }
    }

    const hints = {
      title: req.body?.hintTitle || req.body?.title || '',
      artist: req.body?.hintArtist || req.body?.artist || '',
      album: req.body?.hintAlbum || req.body?.album || '',
    };

    const coverBuffer = await resolveCoverImageBuffer(req);
    if (!coverBuffer) {
      return res.status(400).json({ error: 'No cover image file (.jpg, .png) or coverUrl provided' });
    }

    const result = await applyMetadataByScope({
      scope,
      targetRelPath,
      filePaths,
      hints,
      updates: { coverBuffer },
      overrideAlbumTitles: false,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error(`[UpdateCover Error] ${err.message}`);
    res.status(400).json({ error: err.message });
  } finally {
    for (const f of stagedFiles) {
      await safeRemoveStagingFile(f?.path);
    }
  }
});

// 6b. GET /api/metadata/read - Read current embedded metadata & cover art from a track or album folder
app.get(['/api/metadata/read', '/api/files/metadata/read'], async (req, res) => {
  try {
    const rawPath = String(req.query.path || '').trim();
    const requestedScope = String(req.query.scope || '').toLowerCase();
    const hints = {
      title: req.query.title || '',
      artist: req.query.artist || '',
      album: req.query.album || '',
    };

    const target = await resolveExistingLibraryTarget(rawPath, {
      expectDir: requestedScope === 'album',
      hints,
    });

    const stat = await fs.lstat(target);
    if (stat.isDirectory()) {
      const audioFiles = (await collectAudioFilesRecursively(target))
        .sort((a, b) => a.localeCompare(b));

      let sampleMeta = {
        title: '',
        artist: '',
        album: path.basename(target),
        year: '',
        hasCover: false,
        coverDataUrl: null,
      };

      if (audioFiles.length > 0) {
        sampleMeta = await readAudioMetadata(audioFiles[0]);
      }

      const relFolder = path.relative(STORAGE_DIR, target).replace(/\\/g, '/');
      return res.json({
        scope: 'album',
        path: relFolder,
        folderPath: relFolder,
        audioTrackCount: audioFiles.length,
        audioFiles: audioFiles.map((f) => path.relative(target, f).replace(/\\/g, '/')),
        metadata: {
          title: '',
          artist: sampleMeta.artist || '',
          album: sampleMeta.album || path.basename(target),
          year: sampleMeta.year || '',
          hasCover: sampleMeta.hasCover,
          coverDataUrl: sampleMeta.coverDataUrl,
        },
      });
    }

    const meta = await readAudioMetadata(target);
    const relFile = path.relative(STORAGE_DIR, target).replace(/\\/g, '/');
    const relFolder = path.relative(STORAGE_DIR, path.dirname(target)).replace(/\\/g, '/');

    return res.json({
      scope: requestedScope === 'album' ? 'album' : 'single',
      path: relFile,
      filePath: relFile,
      folderPath: relFolder,
      metadata: meta,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 6c. GET /api/metadata/search - Search online metadata concurrently (iTunes JP, Spotify JP, MusicBrainz, Deezer)
app.get(['/api/metadata/search', '/api/files/metadata/search'], async (req, res) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const scope = String(req.query.scope || '').toLowerCase();
    if (!q) {
      return res.status(400).json({ error: 'Missing search query parameter (?q=...)' });
    }

    const spotifyClientId =
      req.headers['x-spotify-client-id'] || req.query.spotifyClientId || process.env.SPOTIFY_CLIENT_ID || '';
    const spotifyClientSecret =
      req.headers['x-spotify-client-secret'] || req.query.spotifyClientSecret || process.env.SPOTIFY_CLIENT_SECRET || '';

    const data = await searchMetadataOnline(q, {
      scope,
      spotifyClientId,
      spotifyClientSecret,
    });

    res.json(data);
  } catch (err) {
    console.error(`[MetadataSearch Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 6d. POST /api/metadata/apply - Apply finalized metadata & cover art to single track or album folder
app.post(['/api/metadata/apply', '/api/files/metadata/apply'], stagingUpload.any(), async (req, res) => {
  const stagedFiles = Array.isArray(req.files) ? req.files : [];
  try {
    const rawScope = String(req.body?.scope || req.body?.type || '').toLowerCase();
    const targetRelPath =
      req.body?.targetPath ||
      (rawScope === 'album' || rawScope === 'folder'
        ? req.body?.folderPath || req.body?.filePath || req.body?.path || ''
        : req.body?.filePath || req.body?.folderPath || req.body?.path || '');

    let scope = rawScope === 'album' || rawScope === 'folder' ? 'album' : (rawScope === 'single' || rawScope === 'file' ? 'single' : '');
    if (!scope && targetRelPath) {
      try {
        const candidate = resolveSafePath(targetRelPath);
        if (fsSync.existsSync(candidate) && fsSync.lstatSync(candidate).isDirectory()) {
          scope = 'album';
        } else {
          scope = 'single';
        }
      } catch (_) {
        scope = 'single';
      }
    }
    if (!scope) scope = 'single';

    let filePaths = [];
    if (req.body?.filePaths) {
      try {
        filePaths = typeof req.body.filePaths === 'string' ? JSON.parse(req.body.filePaths) : req.body.filePaths;
      } catch {
        filePaths = Array.isArray(req.body.filePaths) ? req.body.filePaths : [req.body.filePaths];
      }
    }

    const hints = {
      title: req.body?.hintTitle || req.body?.title || '',
      artist: req.body?.hintArtist || req.body?.artist || '',
      album: req.body?.hintAlbum || req.body?.album || '',
    };

    const updates = {};
    if (req.body?.title !== undefined) updates.title = String(req.body.title).normalize('NFC').trim();
    if (req.body?.artist !== undefined) updates.artist = String(req.body.artist).normalize('NFC').trim();
    if (req.body?.album !== undefined) updates.album = String(req.body.album).normalize('NFC').trim();
    if (req.body?.year !== undefined) updates.year = String(req.body.year).normalize('NFC').trim();

    const coverBuffer = await resolveCoverImageBuffer(req);
    if (coverBuffer) {
      updates.coverBuffer = coverBuffer;
    }

    const overrideAlbumTitles =
      req.body?.overrideAlbumTitles === true || req.body?.overrideAlbumTitles === 'true';

    const result = await applyMetadataByScope({
      scope,
      targetRelPath,
      filePaths,
      hints,
      updates,
      overrideAlbumTitles,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error(`[MetadataApply Error] ${err.message}`);
    res.status(400).json({ error: err.message });
  } finally {
    for (const f of stagedFiles) {
      await safeRemoveStagingFile(f?.path);
    }
  }
});

// ============================================================================
// 7. YTM DOWNLOADER FOUNDATION & COOKIE MANAGEMENT (/api/ytm/*)
// ============================================================================
registerYtmRoutes(app, {
  STORAGE_DIR,
  MUSIC_DIR,
  TMP_CHUNKS_DIR,
  stagingUpload,
  resolveSafePath,
  sanitizePathSegment,
  assertSafeFileWriteTarget,
  verifyFilesAccess: (req) => {
    const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
    return Boolean(apiKey && apiKey === NAS_API_KEY);
  },
});

const bridgeServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Plenrip Audio File Bridge (NAS)`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  NAS:     ${STORAGE_DIR}`);
  console.log(`  Music:   ${MUSIC_DIR}\n`);
});

// Disable timeout limits for long-running / multi-gigabyte file transfers
bridgeServer.timeout = 0;
bridgeServer.keepAliveTimeout = 120000;
bridgeServer.headersTimeout = 120000;
if (typeof bridgeServer.requestTimeout !== 'undefined') {
  bridgeServer.requestTimeout = 0;
}
