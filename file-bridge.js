// file-bridge.js - Lightweight local storage file manager bridge for Plenrip Audio
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.FILE_BRIDGE_PORT || process.env.PORT || 3001;

// Storage root for NAS (e.g. G:\Server).
// When Player is at G:\Server\Player, automatically uses parent G:\Server.
function resolveStorageRoot() {
  if (process.env.STORAGE_DIR) return path.resolve(process.env.STORAGE_DIR);
  if (process.env.NAS_ROOT) return path.resolve(process.env.NAS_ROOT);
  if (fsSync.existsSync('G:\\Server')) return 'G:\\Server';
  if (process.env.ND_MUSICFOLDER) return path.resolve(process.env.ND_MUSICFOLDER, '..');
  const parent = path.resolve(__dirname, '..');
  if (path.basename(__dirname).toLowerCase() === 'player') return parent;
  return './storage';
}

const STORAGE_DIR = path.resolve(resolveStorageRoot());

if (!fsSync.existsSync(STORAGE_DIR)) fsSync.mkdirSync(STORAGE_DIR, { recursive: true });

app.use(cors());
app.use(express.json());

const safe = (sub = '') => {
  const norm = path.normalize(path.join(STORAGE_DIR, sub));
  if (!norm.startsWith(STORAGE_DIR)) throw new Error('Access denied: path traversal');
  return norm;
};

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
    const target = safe(path.join(req.body.path || '', req.body.name || ''));
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Upload files
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, f, cb) => {
      try {
        cb(null, safe(req.query.path || ''));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, f, cb) => cb(null, f.originalname),
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Plenrip Audio File Bridge (NAS)`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  NAS:     ${STORAGE_DIR}`);
  console.log(`  Music:   ${process.env.ND_MUSICFOLDER || path.join(STORAGE_DIR, 'Music')}\n`);
});
