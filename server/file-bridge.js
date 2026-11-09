// file-bridge.js - Lightweight local storage file manager bridge for Plenrip Audio
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// No .env file is ever read (Century bridge rule). Configuration comes from
// the environment only.
const app = express();
const PORT = process.env.FILE_BRIDGE_PORT || process.env.PORT || 3001;
const NAS_API_KEY = process.env.NAS_API_KEY || process.env.FILE_BRIDGE_KEY || '';
const PLACEHOLDER_KEYS = new Set(['your-secret-api-key-here', 'change-me', 'secret']);
if (!NAS_API_KEY || PLACEHOLDER_KEYS.has(NAS_API_KEY)) {
  console.error('ERROR: A real NAS API key is required. Set NAS_API_KEY to a long random value (not the placeholder).');
  console.error('The bridge refuses to start without one — an unauthenticated file bridge exposes your storage.');
  process.exit(1);
}

// Storage root: only STORAGE_DIR / NAS_ROOT, else ./storage at the
// project root (Century bridge rule). No auto-detection of G:\\Server or the
// music folder's parent.
function resolveStorageRoot() {
  if (process.env.STORAGE_DIR) return path.resolve(process.env.STORAGE_DIR);
  if (process.env.NAS_ROOT) return path.resolve(process.env.NAS_ROOT);
  return path.resolve(__dirname, '..', 'storage');
}

const STORAGE_DIR = path.resolve(resolveStorageRoot());

if (!fsSync.existsSync(STORAGE_DIR)) fsSync.mkdirSync(STORAGE_DIR, { recursive: true });

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'X-API-Key'],
}));
app.use(express.json());

// Authentication middleware (Century bridge):
// x-api-key header on EVERY request. Native browser downloads cannot set
// headers, so /api/files/download also accepts ?apiKey (or ?key).
// Every other endpoint requires the header; a query-string key is NOT
// accepted there (it would leak the key into logs and referrers).
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
        (isDownload ? ' or ?apiKey= parameter' : '') + ')'
    });
  }
  next();
});

// Resolve a client-supplied relative path inside the storage root.
// Throws when the resolved path would escape the root. (Century
// resolveSafePath: the root + path.sep check also rejects a sibling
// directory whose name merely starts with the root, e.g. /storage-evil.)
const resolveSafePath = (sub = '') => {
  const root = path.resolve(STORAGE_DIR);
  const target = path.resolve(root, sub);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Access denied: path traversal');
  }
  return target;
};
const safe = resolveSafePath;

// 1. List directory
app.get('/api/files', async (req, res) => {
  try {
    const dir = safe(req.query.path || '');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
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
    // Century parity: a folder name must be a single segment — reject
    // '/', '\', '.', '..' with a 400 instead of silently creating
    // nested folders (or surfacing a 500 for '..').
    const name = String(req.body.name || '');
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      return res.status(400).json({ error: 'Invalid folder name' });
    }
    const target = safe(path.join(req.body.path || '', name));
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Upload files (Century bridge: folder upload via a parallel `paths`
// form field — one webkitRelativePath per file, in the same order as the
// `files`. The client must append all `paths` BEFORE any `files` so the
// field is parsed before the first file's destination runs.)
// A per-request file index (req._uploadFileIndex) pairs each file with its
// path. Without a path, the file lands by basename in the destination
// (the previous behaviour). A path that escapes the destination is SKIPPED
// (not saved, not counted) — matching Century's `continue`, and the
// PORT-PLAN ("a path that escapes the destination is skipped, not an
// error"). The fileFilter below enforces the skip; the destination
// fallback is defense-in-depth only.
function isUnsafeRelPath(relPath) {
  if (!relPath) return false;
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return true;
  return relPath.split(/[/\\]/).some((seg) => seg === '..');
}

const upload = multer({
  fileFilter: (req, file, cb) => {
    // Pair this file with its `paths` entry (same index). The index is
    // incremented here so destination/filename see (index - 1) for it.
    const idx = req._uploadFileIndex || 0;
    req._uploadFileIndex = idx + 1;
    const paths = req.body?.paths;
    const pathsList = Array.isArray(paths) ? paths : (paths ? [paths] : []);
    const relPath = pathsList[idx] ? String(pathsList[idx]).trim() : '';
    // Unsafe path (absolute, or a `..` segment): skip the file entirely.
    if (isUnsafeRelPath(relPath)) return cb(null, false);
    return cb(null, true);
  },
  storage: multer.diskStorage({
    destination: (req, f, cb) => {
      try {
        const dest = safe(req.query.path || '');
        const idx = (req._uploadFileIndex || 1) - 1;
        const paths = req.body?.paths;
        const pathsList = Array.isArray(paths) ? paths : (paths ? [paths] : []);
        const relPath = pathsList[idx] ? String(pathsList[idx]).trim() : '';
        let dir = dest;
        if (relPath) {
          if (isUnsafeRelPath(relPath)) {
            // Defense-in-depth (fileFilter already rejects these): fall
            // back to basename in the destination.
            fsSync.mkdirSync(dest, { recursive: true });
            return cb(null, dest);
          }
          let target;
          try {
            target = safe(path.join(dest, relPath));
          } catch {
            fsSync.mkdirSync(dest, { recursive: true });
            return cb(null, dest);
          }
          if (target === dest || !target.startsWith(dest + path.sep)) {
            fsSync.mkdirSync(dest, { recursive: true });
            return cb(null, dest);
          }
          dir = path.dirname(target);
        }
        fsSync.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, f, cb) => {
      // The file whose destination was just computed is index (count - 1).
      const idx = (req._uploadFileIndex || 1) - 1;
      const paths = req.body?.paths;
      const pathsList = Array.isArray(paths) ? paths : (paths ? [paths] : []);
      const relPath = pathsList[idx] ? String(pathsList[idx]).trim() : '';
      const name = relPath ? path.basename(relPath) : path.basename(f.originalname);
      cb(null, name && name !== '.' && name !== '..' ? name : 'file');
    },
  }),
});

app.post('/api/files/upload', upload.array('files'), (req, res) => {
  res.json({ success: true, count: req.files?.length || 0 });
});

// 4. Delete file or directory
app.delete('/api/files', async (req, res) => {
  try {
    const target = safe(req.query.path || '');
    if (target === STORAGE_DIR || target === __dirname) {
      return res.status(400).json({ error: 'Cannot delete server root or Player application folder' });
    }
    const stat = await fs.stat(target);
    if (stat.isDirectory()) await fs.rm(target, { recursive: true, force: true });
    else await fs.unlink(target);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Download file
app.get('/api/files/download', async (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) {
      return res.status(400).json({ error: 'Missing path query parameter' });
    }
    const target = safe(rawPath);
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
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Plenrip Audio File Bridge (NAS)`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  NAS:     ${STORAGE_DIR}`);
  console.log(`  Music:   ${process.env.ND_MUSICFOLDER || path.join(STORAGE_DIR, 'Music')}\n`);
});
