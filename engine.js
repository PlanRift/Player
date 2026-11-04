// Plenrip Audio - Core Engine (Subsonic API, Gapless Dual-Deck Audio, Lyrics, Discovery, Last.fm)
// Zero-framework Vanilla JS module.

const STORAGE_KEYS = {
  NAVIDROME_URL: 'planrift.navidrome.url',
  NAVIDROME_USER: 'planrift.navidrome.user',
  NAVIDROME_PASS: 'planrift.navidrome.pass',
  SIDEBAR_COLLAPSED: 'planrift.sidebar.collapsed',
  CROSSFADE: 'planrift.settings.crossfade',
  VOLUME: 'planrift.settings.volume',
  HISTORY: 'planrift.history.v1',
  LYRICS_PRIORITY: 'planrift.lyrics.priorityOrder',
  LYRICS_PROVIDER_PREFIX: 'planrift.lyrics.provider.',
  LYRICS_OFFSET_PREFIX: 'player.lyrics-offset.v1.',
  LASTFM_API_KEY: 'planrift.lastfm.apiKey',
  LASTFM_API_SECRET: 'planrift.lastfm.apiSecret',
  LASTFM_SESSION_KEY: 'planrift.lastfm.sessionKey',
  LASTFM_USERNAME: 'planrift.lastfm.username',
  LASTFM_ENABLED: 'planrift.lastfm.enabled',
};

const DEFAULT_CONFIG = {
  serverUrl: 'http://localhost:4533',
  username: '',
  password: '',
};

function generateSalt(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint32Array(length);
  window.crypto.getRandomValues(arr);
  let salt = '';
  for (let i = 0; i < length; i++) {
    salt += chars[arr[i] % chars.length];
  }
  return salt;
}

function md5Hex(input) {
  return window.CryptoJS.MD5(String(input)).toString();
}

// ============================================================================
// 1. Subsonic API Client + Binary Cover Art Fallback
// ============================================================================
class SubsonicClient {
  constructor() {
    this.loadConfig();
    this.streamCoverCache = new Map();
  }

  loadConfig() {
    const rawUrl = localStorage.getItem(STORAGE_KEYS.NAVIDROME_URL) || DEFAULT_CONFIG.serverUrl;
    this.baseUrl = rawUrl.trim().replace(/\/+$/, '');
    this.username = (localStorage.getItem(STORAGE_KEYS.NAVIDROME_USER) || DEFAULT_CONFIG.username).trim();
    this.password = localStorage.getItem(STORAGE_KEYS.NAVIDROME_PASS) || DEFAULT_CONFIG.password;
  }

  saveConfig(serverUrl, username, password) {
    const cleanUrl = (serverUrl || DEFAULT_CONFIG.serverUrl).trim().replace(/\/+$/, '');
    const cleanUser = (username || DEFAULT_CONFIG.username).trim();
    const cleanPass = password !== undefined ? password : DEFAULT_CONFIG.password;
    localStorage.setItem(STORAGE_KEYS.NAVIDROME_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEYS.NAVIDROME_USER, cleanUser);
    localStorage.setItem(STORAGE_KEYS.NAVIDROME_PASS, cleanPass);
    this.loadConfig();
  }

  buildUrl(endpoint, extraParams = {}) {
    const cleanEndpoint = endpoint.endsWith('.view') ? endpoint : `${endpoint}.view`;
    const url = new URL(`${this.baseUrl}/rest/${cleanEndpoint}`);
    const salt = generateSalt(8);
    const token = md5Hex(this.password + salt);

    url.searchParams.set('u', this.username);
    url.searchParams.set('t', token);
    url.searchParams.set('s', salt);
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'PlenripAudio');
    url.searchParams.set('f', 'json');

    for (const [key, value] of Object.entries(extraParams)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async request(endpoint, extraParams = {}) {
    const url = this.buildUrl(endpoint, extraParams);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const json = await response.json();
    const root = json['subsonic-response'];
    if (!root) {
      throw new Error('Invalid Subsonic response payload');
    }
    if (root.status === 'failed') {
      const msg = root.error?.message || 'Subsonic API error';
      throw new Error(msg);
    }
    return root;
  }

  async ping() {
    try {
      const res = await this.request('ping');
      return res.status === 'ok';
    } catch {
      return false;
    }
  }

  async getArtists() {
    const res = await this.request('getArtists');
    const indices = res.artists?.index || [];
    const list = [];
    for (const group of indices) {
      if (Array.isArray(group.artist)) {
        list.push(...group.artist);
      }
    }
    return list;
  }

  async getArtist(id) {
    const res = await this.request('getArtist', { id });
    if (!res.artist) throw new Error(`Artist not found: ${id}`);
    return {
      ...res.artist,
      album: res.artist.album || [],
    };
  }

  async getAlbumList2(params = { type: 'newest', size: 24, offset: 0 }) {
    const res = await this.request('getAlbumList2', {
      type: params.type || 'newest',
      size: params.size ?? 24,
      offset: params.offset ?? 0,
    });
    return res.albumList2?.album || [];
  }

  async getAlbum(id) {
    const res = await this.request('getAlbum', { id });
    if (!res.album) throw new Error(`Album not found: ${id}`);
    return {
      ...res.album,
      song: res.album.song || [],
    };
  }

  async getSong(id) {
    const res = await this.request('getSong', { id });
    if (!res.song) throw new Error(`Song not found: ${id}`);
    return res.song;
  }

  async search3(query, counts = {}) {
    const res = await this.request('search3', {
      query,
      artistCount: counts.artistCount ?? 20,
      artistOffset: counts.artistOffset ?? 0,
      albumCount: counts.albumCount ?? 20,
      albumOffset: counts.albumOffset ?? 0,
      songCount: counts.songCount ?? 50,
      songOffset: counts.songOffset ?? 0,
    });
    const sr = res.searchResult3 || {};
    return {
      artist: sr.artist || [],
      album: sr.album || [],
      song: sr.song || [],
    };
  }

  async getStarred2() {
    const res = await this.request('getStarred2');
    const st = res.starred2 || {};
    return {
      artist: st.artist || [],
      album: st.album || [],
      song: st.song || [],
    };
  }

  async star(params) {
    await this.request('star', params);
  }

  async unstar(params) {
    await this.request('unstar', params);
  }

  async getPlaylists() {
    const res = await this.request('getPlaylists');
    return res.playlists?.playlist || [];
  }

  async getPlaylist(id) {
    const res = await this.request('getPlaylist', { id });
    if (!res.playlist) throw new Error(`Playlist not found: ${id}`);
    return {
      ...res.playlist,
      entry: res.playlist.entry || [],
    };
  }

  async createPlaylist(name, songIds = []) {
    const params = { name };
    if (songIds.length > 0) params.songId = songIds;
    const res = await this.request('createPlaylist', params);
    return res.playlist;
  }

  async updatePlaylist(params) {
    await this.request('updatePlaylist', params);
  }

  async deletePlaylist(id) {
    await this.request('deletePlaylist', { id });
  }

  getCoverArtUrl(id, size = 300) {
    if (!id) return '';
    return this.buildUrl('getCoverArt', { id, size });
  }

  getStreamUrl(id) {
    if (!id) return '';
    return this.buildUrl('stream', { id });
  }

  // Fallback cover art extractor from raw audio stream header bytes (ID3v2 / FLAC APIC JPEG or PNG)
  async extractCoverFromStream(songId) {
    if (!songId) return null;
    if (this.streamCoverCache.has(songId)) {
      return this.streamCoverCache.get(songId);
    }

    try {
      const streamUrl = this.getStreamUrl(songId);
      const controller = new AbortController();
      const response = await fetch(streamUrl, {
        headers: { Range: 'bytes=0-524287' },
        signal: controller.signal,
      });

      const reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      const maxBytes = 524288;

      while (totalBytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }
      controller.abort();

      const buffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.length;
      }

      // Search for embedded JPEG (FF D8 FF)
      let startIdx = -1;
      for (let i = 0; i < buffer.length - 3; i++) {
        if (buffer[i] === 0xff && buffer[i + 1] === 0xd8 && buffer[i + 2] === 0xff) {
          startIdx = i;
          break;
        }
      }

      if (startIdx !== -1) {
        for (let i = startIdx + 3; i < buffer.length - 1; i++) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            const jpegBytes = buffer.slice(startIdx, i + 2);
            if (jpegBytes.length > 1024) {
              const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
              const objUrl = URL.createObjectURL(blob);
              this.streamCoverCache.set(songId, objUrl);
              return objUrl;
            }
          }
        }
      }

      // Search for embedded PNG (89 50 4E 47)
      let pngStart = -1;
      for (let i = 0; i < buffer.length - 8; i++) {
        if (
          buffer[i] === 0x89 &&
          buffer[i + 1] === 0x50 &&
          buffer[i + 2] === 0x4e &&
          buffer[i + 3] === 0x47
        ) {
          pngStart = i;
          break;
        }
      }

      if (pngStart !== -1) {
        for (let i = pngStart + 8; i < buffer.length - 8; i++) {
          if (
            buffer[i] === 0x49 &&
            buffer[i + 1] === 0x45 &&
            buffer[i + 2] === 0x4e &&
            buffer[i + 3] === 0x44
          ) {
            const pngBytes = buffer.slice(pngStart, i + 8);
            if (pngBytes.length > 1024) {
              const blob = new Blob([pngBytes], { type: 'image/png' });
              const objUrl = URL.createObjectURL(blob);
              this.streamCoverCache.set(songId, objUrl);
              return objUrl;
            }
          }
        }
      }
    } catch {
      // Ignore stream extraction errors
    }

    this.streamCoverCache.set(songId, null);
    return null;
  }
}

// ============================================================================
// 2. Multi-Provider Synced Lyrics Engine
// ============================================================================
const LYRICS_PROVIDERS_META = [
  { id: 'lrclib', name: 'LRCLIB', bestKind: 'synced' },
  { id: 'netease', name: 'NetEase Cloud Music', bestKind: 'synced' },
  { id: 'qq', name: 'QQ Music', bestKind: 'synced' },
  { id: 'kugou', name: 'KuGou', bestKind: 'synced' },
  { id: 'lyricsplus', name: 'LyricsPlus (Musixmatch)', bestKind: 'synced' },
  { id: 'unison', name: 'Unison', bestKind: 'synced' },
];

const DEFAULT_LYRICS_PRIORITY = LYRICS_PROVIDERS_META.map((p) => p.id);

function parseLrc(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const lines = raw.split(/\r?\n/);
  const result = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    const matches = [...rawLine.matchAll(timeRegex)];
    if (matches.length === 0) continue;
    const text = rawLine.replace(timeRegex, '').trim();

    for (const match of matches) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      let millis = 0;
      if (match[3]) {
        const frac = match[3].padEnd(3, '0').slice(0, 3);
        millis = parseInt(frac, 10);
      }
      const timeSeconds = minutes * 60 + seconds + millis / 1000;
      result.push({ timeSeconds, text });
    }
  }
  result.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return result;
}

function findActiveLineIndex(lines, currentTimeSeconds) {
  if (!lines || lines.length === 0) return -1;
  if (currentTimeSeconds < lines[0].timeSeconds) return -1;

  let low = 0;
  let high = lines.length - 1;
  let bestIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lines[mid].timeSeconds <= currentTimeSeconds) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return bestIndex;
}

function normalizeLyricsStr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestLrcLibCandidate(candidates, req) {
  const valid = (candidates || []).filter((c) => c.syncedLyrics || c.plainLyrics);
  if (valid.length === 0) return null;

  const targetTitle = normalizeLyricsStr(req.title);
  const targetArtist = normalizeLyricsStr(req.artist);
  const targetAlbum = req.album ? normalizeLyricsStr(req.album) : '';

  let best = valid[0];
  let bestScore = -Infinity;

  for (const item of valid) {
    let score = 0;
    const itemTitle = normalizeLyricsStr(item.trackName || item.name || '');
    const itemArtist = normalizeLyricsStr(item.artistName || '');
    const itemAlbum = normalizeLyricsStr(item.albumName || '');

    if (item.syncedLyrics) score += 50;
    if (itemTitle === targetTitle) score += 40;
    else if (itemTitle.includes(targetTitle) || targetTitle.includes(itemTitle)) score += 20;

    if (itemArtist === targetArtist) score += 40;
    else if (itemArtist.includes(targetArtist) || targetArtist.includes(itemArtist)) score += 20;

    if (targetAlbum && itemAlbum === targetAlbum) score += 15;

    if (req.durationSeconds && typeof item.duration === 'number') {
      const diff = Math.abs(item.duration - req.durationSeconds);
      if (diff <= 2) score += 25;
      else if (diff <= 5) score += 10;
      else if (diff > 15) score -= 20;
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

async function fetchFromLrcLib(req) {
  try {
    const getUrl = new URL('https://lrclib.net/api/get');
    getUrl.searchParams.set('track_name', req.title);
    getUrl.searchParams.set('artist_name', req.artist);
    if (req.album) getUrl.searchParams.set('album_name', req.album);
    if (req.durationSeconds && req.durationSeconds > 0) {
      getUrl.searchParams.set('duration', String(Math.round(req.durationSeconds)));
    }

    const exactRes = await fetch(getUrl.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (exactRes.ok) {
      const data = await exactRes.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        const lines = data.syncedLyrics ? parseLrc(data.syncedLyrics) : undefined;
        return {
          providerId: 'lrclib',
          providerName: 'LRCLIB',
          kind: lines && lines.length > 0 ? 'synced' : 'plain',
          lines: lines && lines.length > 0 ? lines : undefined,
          plainText: data.plainLyrics || data.syncedLyrics,
          status: 'ok',
        };
      }
    }

    const searchUrl = new URL('https://lrclib.net/api/search');
    searchUrl.searchParams.set('track_name', req.title);
    searchUrl.searchParams.set('artist_name', req.artist);
    if (req.album) searchUrl.searchParams.set('album_name', req.album);

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!searchRes.ok) {
      return {
        providerId: 'lrclib',
        providerName: 'LRCLIB',
        kind: 'plain',
        status: searchRes.status === 404 ? 'not_found' : 'unreachable',
      };
    }

    const candidates = await searchRes.json();
    if (!Array.isArray(candidates) || candidates.length === 0) {
      const fallbackUrl = new URL('https://lrclib.net/api/search');
      fallbackUrl.searchParams.set('q', `${req.artist} ${req.title}`);
      const fbRes = await fetch(fallbackUrl.toString(), {
        headers: { 'Accept': 'application/json' },
      });
      if (!fbRes.ok) {
        return { providerId: 'lrclib', providerName: 'LRCLIB', kind: 'plain', status: 'not_found' };
      }
      const fbCandidates = await fbRes.json();
      const bestFb = pickBestLrcLibCandidate(fbCandidates, req);
      if (!bestFb) {
        return { providerId: 'lrclib', providerName: 'LRCLIB', kind: 'plain', status: 'not_found' };
      }
      const lines = bestFb.syncedLyrics ? parseLrc(bestFb.syncedLyrics) : undefined;
      return {
        providerId: 'lrclib',
        providerName: 'LRCLIB',
        kind: lines && lines.length > 0 ? 'synced' : 'plain',
        lines: lines && lines.length > 0 ? lines : undefined,
        plainText: bestFb.plainLyrics || bestFb.syncedLyrics,
        status: 'ok',
      };
    }

    const best = pickBestLrcLibCandidate(candidates, req);
    if (!best) {
      return { providerId: 'lrclib', providerName: 'LRCLIB', kind: 'plain', status: 'not_found' };
    }

    const lines = best.syncedLyrics ? parseLrc(best.syncedLyrics) : undefined;
    return {
      providerId: 'lrclib',
      providerName: 'LRCLIB',
      kind: lines && lines.length > 0 ? 'synced' : 'plain',
      lines: lines && lines.length > 0 ? lines : undefined,
      plainText: best.plainLyrics || best.syncedLyrics,
      status: 'ok',
    };
  } catch {
    return {
      providerId: 'lrclib',
      providerName: 'LRCLIB',
      kind: 'plain',
      status: 'unreachable',
    };
  }
}

async function fetchFromSecondaryProvider(providerMeta, req) {
  const { id, name } = providerMeta;
  try {
    if (id === 'netease') {
      const searchRes = await fetch(
        `https://music.163.com/api/search/get?s=${encodeURIComponent(`${req.artist} ${req.title}`)}&type=1&limit=5`
      );
      if (!searchRes.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      const searchJson = await searchRes.json();
      const songId = searchJson?.result?.songs?.[0]?.id;
      if (!songId) return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
      const lrcRes = await fetch(`https://music.163.com/api/song/lyric?os=pc&id=${songId}&lv=-1&kv=-1&tv=-1`);
      if (!lrcRes.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      const lrcJson = await lrcRes.json();
      const rawLrc = lrcJson?.lrc?.lyric;
      if (!rawLrc) return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
      const lines = parseLrc(rawLrc);
      return {
        providerId: id,
        providerName: name,
        kind: lines.length > 0 ? 'synced' : 'plain',
        lines: lines.length > 0 ? lines : undefined,
        plainText: rawLrc,
        status: 'ok',
      };
    }

    if (id === 'qq') {
      const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(`${req.artist} ${req.title}`)}&format=json`;
      const res = await fetch(searchUrl);
      if (!res.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
    }

    if (id === 'kugou') {
      const searchUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(`${req.artist} - ${req.title}`)}&duration=${(req.durationSeconds || 0) * 1000}`;
      const res = await fetch(searchUrl);
      if (!res.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
    }

    if (id === 'lyricsplus') {
      const url = `https://lyricsplus.prjktla.workers.dev/lyrics?title=${encodeURIComponent(req.title)}&artist=${encodeURIComponent(req.artist)}`;
      const res = await fetch(url);
      if (!res.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      const data = await res.json();
      const raw = data?.lyrics || data?.lrc;
      if (!raw) return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
      const lines = parseLrc(raw);
      return {
        providerId: id,
        providerName: name,
        kind: lines.length > 0 ? 'synced' : 'plain',
        lines: lines.length > 0 ? lines : undefined,
        plainText: raw,
        status: 'ok',
      };
    }

    if (id === 'unison') {
      const url = `https://api.unison.audio/v1/lyrics?title=${encodeURIComponent(req.title)}&artist=${encodeURIComponent(req.artist)}`;
      const res = await fetch(url);
      if (!res.ok) return { providerId: id, providerName: name, kind: 'plain', status: 'unreachable' };
      return { providerId: id, providerName: name, kind: 'plain', status: 'not_found' };
    }
  } catch {
    // Expected CORS or network rejection for third-party providers in browser
  }
  return {
    providerId: id,
    providerName: name,
    kind: 'plain',
    status: 'unreachable',
  };
}

class LyricsManager {
  getPriorityOrder() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LYRICS_PRIORITY);
      if (!raw) return [...DEFAULT_LYRICS_PRIORITY];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const merged = [...parsed.filter((id) => DEFAULT_LYRICS_PRIORITY.includes(id))];
        for (const id of DEFAULT_LYRICS_PRIORITY) {
          if (!merged.includes(id)) merged.push(id);
        }
        return merged;
      }
    } catch {
      // Ignore parse errors
    }
    return [...DEFAULT_LYRICS_PRIORITY];
  }

  setPriorityOrder(order) {
    localStorage.setItem(STORAGE_KEYS.LYRICS_PRIORITY, JSON.stringify(order));
  }

  getTrackProviderOverride(trackId) {
    if (!trackId) return 'auto';
    return localStorage.getItem(`${STORAGE_KEYS.LYRICS_PROVIDER_PREFIX}${trackId}`) || 'auto';
  }

  setTrackProviderOverride(trackId, providerId) {
    if (!trackId) return;
    const key = `${STORAGE_KEYS.LYRICS_PROVIDER_PREFIX}${trackId}`;
    if (!providerId || providerId === 'auto') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, providerId);
    }
  }

  getTrackOffset(trackId) {
    if (!trackId) return 0;
    const raw = localStorage.getItem(`${STORAGE_KEYS.LYRICS_OFFSET_PREFIX}${trackId}`);
    if (!raw) return 0;
    const num = parseFloat(raw);
    return Number.isNaN(num) ? 0 : Math.round(num * 10) / 10;
  }

  setTrackOffset(trackId, offsetSec) {
    if (!trackId) return;
    const clean = Math.round(offsetSec * 10) / 10;
    const key = `${STORAGE_KEYS.LYRICS_OFFSET_PREFIX}${trackId}`;
    if (Math.abs(clean) < 0.01) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(clean));
    }
  }

  async fetchFromProvider(providerId, req) {
    if (providerId === 'lrclib') {
      return fetchFromLrcLib(req);
    }
    const meta = LYRICS_PROVIDERS_META.find((p) => p.id === providerId);
    if (!meta) {
      return { providerId, providerName: providerId, kind: 'plain', status: 'not_found' };
    }
    return fetchFromSecondaryProvider(meta, req);
  }

  async resolveLyrics(req) {
    const override = this.getTrackProviderOverride(req.trackId);
    if (override && override !== 'auto') {
      return this.fetchFromProvider(override, req);
    }

    const order = this.getPriorityOrder();
    let lastRes = null;

    for (const id of order) {
      const res = await this.fetchFromProvider(id, req);
      lastRes = res;
      if (res.status === 'ok' && (res.lines?.length || res.plainText)) {
        return res;
      }
    }

    return (
      lastRes || {
        providerId: 'lrclib',
        providerName: 'LRCLIB',
        kind: 'plain',
        status: 'not_found',
      }
    );
  }
}

// ============================================================================
// 3. Listening History, Discovery Engine, & Canvas Art Generators
// ============================================================================
class HistoryStore {
  constructor() {
    this.maxEntries = 10000;
    this.entries = this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-this.maxEntries) : [];
    } catch {
      return [];
    }
  }

  save() {
    try {
      this.entries = this.entries.slice(-this.maxEntries);
      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(this.entries));
    } catch {
      // Ignore quota errors
    }
  }

  recordPlay({ songId, artistId, albumId, playedAt, playDurationMs }) {
    if (!songId) return;
    this.entries.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      songId,
      artistId: artistId || '',
      albumId: albumId || '',
      playedAt: playedAt || Date.now(),
      playDurationMs: playDurationMs || 30000,
    });
    this.save();
  }

  getTopArtistIds(limit = 5) {
    const counts = {};
    for (const e of this.entries) {
      if (!e.artistId) continue;
      counts[e.artistId] = (counts[e.artistId] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([artistId, count]) => ({ artistId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  getPlayedSongIds() {
    return new Set(this.entries.map((e) => e.songId));
  }

  getPlaysInWindow(startHour, endHour) {
    return this.entries.filter((e) => {
      const h = new Date(e.playedAt).getHours();
      if (startHour <= endHour) return h >= startHour && h < endHour;
      return h >= startHour || h < endHour;
    });
  }

  getPlaysOnCalendarDayInPriorYears(targetMonth, targetDay) {
    const currentYear = new Date().getFullYear();
    return this.entries.filter((e) => {
      const d = new Date(e.playedAt);
      return d.getFullYear() < currentYear && d.getMonth() === targetMonth && d.getDate() === targetDay;
    });
  }

  getHistorySpanDays() {
    if (this.entries.length < 2) return this.entries.length;
    const first = this.entries[0].playedAt;
    const last = this.entries[this.entries.length - 1].playedAt;
    return Math.max(1, Math.floor(Math.abs(last - first) / (1000 * 60 * 60 * 24)));
  }

  clear() {
    this.entries = [];
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle(items, seedStr) {
  const copy = [...items];
  let seed = hashSeed(seedStr);
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getDaylistTimeWindow(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return { startHour: 5, endHour: 12, label: 'Morning' };
  if (h >= 12 && h < 17) return { startHour: 12, endHour: 17, label: 'Afternoon' };
  if (h >= 17 && h < 22) return { startHour: 17, endHour: 22, label: 'Evening' };
  return { startHour: 22, endHour: 5, label: 'Late Night' };
}

async function generateDiscoveryCards(client, historyStore) {
  const now = new Date();
  const todaySeed = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  let librarySongs = [];
  let newestAlbums = [];
  let frequentAlbums = [];

  try {
    const [searchRes, newestRes, frequentRes] = await Promise.all([
      client.search3('', { songCount: 150, albumCount: 0, artistCount: 0 }),
      client.getAlbumList2({ type: 'newest', size: 12 }),
      client.getAlbumList2({ type: 'frequent', size: 12 }),
    ]);
    librarySongs = searchRes.song || [];
    newestAlbums = newestRes || [];
    frequentAlbums = frequentRes || [];
  } catch {
    // Graceful fallback if server is offline
  }

  const songMap = new Map();
  for (const s of librarySongs) songMap.set(s.id, s);

  // 1. Daylist
  const windowInfo = getDaylistTimeWindow(now);
  const windowEntries = historyStore.getPlaysInWindow(windowInfo.startHour, windowInfo.endHour);
  let daylistTracks = [];

  if (windowEntries.length >= 3) {
    const counts = {};
    for (const e of windowEntries) counts[e.songId] = (counts[e.songId] || 0) + 1;
    const sortedIds = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    for (const id of sortedIds) {
      const s = songMap.get(id);
      if (s) daylistTracks.push(s);
    }
  }
  if (daylistTracks.length < 15 && librarySongs.length > 0) {
    const existing = new Set(daylistTracks.map((t) => t.id));
    const fill = seededShuffle(
      librarySongs.filter((s) => !existing.has(s.id)),
      `daylist-${todaySeed}-${windowInfo.label}`
    );
    daylistTracks = [...daylistTracks, ...fill].slice(0, 25);
  }

  // 2. Discover Weekly
  const playedIds = historyStore.getPlayedSongIds();
  const unplayedPool = librarySongs.filter((s) => !playedIds.has(s.id));
  const discoverWeeklyTracks = seededShuffle(
    unplayedPool.length > 0 ? unplayedPool : librarySongs,
    `discover-weekly-${now.getFullYear()}-w${Math.ceil(now.getDate() / 7)}`
  ).slice(0, 30);

  // 3. Release Radar
  let releaseRadarTracks = [];
  const topNewest = newestAlbums.slice(0, 6);
  const albumDetails = await Promise.all(
    topNewest.map((a) => client.getAlbum(a.id).catch(() => null))
  );
  for (const detail of albumDetails) {
    if (detail?.song) {
      releaseRadarTracks.push(...detail.song.slice(0, 5));
    }
  }
  releaseRadarTracks = releaseRadarTracks.slice(0, 25);

  // 4. Daily Mix
  let dailyMixTracks = [];
  const topArtists = historyStore.getTopArtistIds(4);
  if (topArtists.length > 0) {
    const topSet = new Set(topArtists.map((a) => a.artistId));
    const artistMatches = librarySongs.filter((s) => s.artistId && topSet.has(s.artistId));
    dailyMixTracks = seededShuffle(artistMatches, `daily-mix-${todaySeed}`).slice(0, 25);
  }
  if (dailyMixTracks.length < 15 && frequentAlbums.length > 0) {
    const freqDetails = await Promise.all(
      frequentAlbums.slice(0, 4).map((a) => client.getAlbum(a.id).catch(() => null))
    );
    const existing = new Set(dailyMixTracks.map((t) => t.id));
    for (const d of freqDetails) {
      if (d?.song) {
        for (const s of d.song) {
          if (!existing.has(s.id)) {
            dailyMixTracks.push(s);
            existing.add(s.id);
          }
        }
      }
    }
    dailyMixTracks = dailyMixTracks.slice(0, 25);
  }
  if (dailyMixTracks.length === 0 && librarySongs.length > 0) {
    dailyMixTracks = seededShuffle(librarySongs, `daily-mix-fallback-${todaySeed}`).slice(0, 25);
  }

  // 5. On This Day
  const priorPlays = historyStore.getPlaysOnCalendarDayInPriorYears(now.getMonth(), now.getDate());
  const onThisDayTracks = [];
  const seenOtd = new Set();
  for (const e of priorPlays) {
    if (seenOtd.has(e.songId)) continue;
    const s = songMap.get(e.songId);
    if (s) {
      onThisDayTracks.push(s);
      seenOtd.add(e.songId);
    }
  }
  const spanDays = historyStore.getHistorySpanDays();
  let otdEmptyReason;
  if (onThisDayTracks.length === 0) {
    otdEmptyReason =
      spanDays < 365
        ? `Keep listening - unlocks as your history grows (${spanDays}d recorded so far).`
        : 'No tracks recorded on this calendar date in prior years yet.';
  }

  return [
    {
      id: 'daylist',
      title: `Daylist · ${windowInfo.label}`,
      subtitle: `Tailored for your ${windowInfo.label.toLowerCase()} listening session`,
      badge: windowInfo.label.toUpperCase(),
      accentColor: '#34d399',
      artVariant: 'eclipse',
      tracks: daylistTracks,
      emptyReason: daylistTracks.length === 0 ? 'Add songs to your Navidrome library to generate Daylist.' : undefined,
    },
    {
      id: 'discover-weekly',
      title: 'Discover Weekly',
      subtitle: 'Deep cuts and unplayed tracks from your library',
      badge: 'UNPLAYED GEMS',
      accentColor: '#10b981',
      artVariant: 'rings',
      tracks: discoverWeeklyTracks,
      emptyReason: discoverWeeklyTracks.length === 0 ? 'No unplayed tracks found in library.' : undefined,
    },
    {
      id: 'release-radar',
      title: 'Release Radar',
      subtitle: 'Fresh tracks from your most recently added albums',
      badge: 'NEW ADDITIONS',
      accentColor: '#6ee7b7',
      artVariant: 'radar',
      tracks: releaseRadarTracks,
      emptyReason: releaseRadarTracks.length === 0 ? 'No recently added albums found.' : undefined,
    },
    {
      id: 'daily-mix',
      title: 'Daily Mix',
      subtitle: 'Familiar favorites blended from your top artists',
      badge: 'HEAVY ROTATION',
      accentColor: '#a7f3d0',
      artVariant: 'grid',
      tracks: dailyMixTracks,
      emptyReason: dailyMixTracks.length === 0 ? 'Play a few tracks to build your Daily Mix.' : undefined,
    },
    {
      id: 'on-this-day',
      title: 'On This Day',
      subtitle: 'Tracks you played on this date in previous years',
      badge: 'TIME CAPSULE',
      accentColor: '#d4d4d8',
      artVariant: 'vinyl',
      tracks: onThisDayTracks,
      emptyReason: otdEmptyReason,
    },
  ];
}

// Procedural HTML5 Canvas artwork generator for Discovery Playlists
function drawGenerativeThumbnail(canvas, variant, accentHex = '#34d399', seedText = '', size = 280) {
  if (!canvas) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, size, size);

  const bgGrad = ctx.createRadialGradient(size * 0.8, size * 0.2, 10, size * 0.5, size * 0.5, size * 0.9);
  bgGrad.addColorStop(0, '#27272a');
  bgGrad.addColorStop(1, '#0e0e11');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  let hash = 0;
  const str = `${variant}-${seedText}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const offsetAngle = ((Math.abs(hash) % 360) * Math.PI) / 180;

  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.78);
  ctx.lineTo(size, size * 0.78);
  ctx.stroke();

  if (variant === 'eclipse') {
    const cx = size * 0.52;
    const cy = size * 0.42;
    const r = size * 0.24;

    const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.6);
    glow.addColorStop(0, `${accentHex}55`);
    glow.addColorStop(0.6, `${accentHex}18`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0e0e11';
    ctx.beginPath();
    ctx.arc(cx - r * 0.28, cy - r * 0.12, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 'rings') {
    const cx = size * 0.5;
    const cy = size * 0.42;
    for (let i = 1; i <= 5; i++) {
      const r = size * 0.06 * i;
      ctx.strokeStyle = i === 3 ? accentHex : '#3f3f46';
      ctx.lineWidth = i === 3 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, offsetAngle + i * 0.4, offsetAngle + i * 0.4 + Math.PI * 1.55);
      ctx.stroke();
    }
    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 'radar') {
    const cx = size * 0.18;
    const cy = size * 0.68;
    for (let i = 1; i <= 5; i++) {
      const r = size * 0.13 * i;
      ctx.strokeStyle = i % 2 === 0 ? accentHex : '#3f3f46';
      ctx.lineWidth = i === 4 ? 2.5 : 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI * 0.48, -0.05);
      ctx.stroke();
    }
    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.arc(size * 0.62, size * 0.34, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 'grid') {
    const startX = size * 0.22;
    const startY = size * 0.16;
    const cell = size * 0.16;
    const gap = size * 0.04;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const idx = row * 3 + col;
        const x = startX + col * (cell + gap);
        const y = startY + row * (cell + gap);
        const isActive = (idx + Math.abs(hash)) % 4 === 0 || idx === 4;
        ctx.fillStyle = isActive ? accentHex : '#27272a';
        ctx.strokeStyle = '#3f3f46';
        ctx.lineWidth = 1;
        if (idx % 2 === 1) {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, cell, cell);
          ctx.strokeRect(x, y, cell, cell);
        }
      }
    }
  } else if (variant === 'vinyl') {
    const cx = size * 0.5;
    const cy = size * 0.42;
    const outerR = size * 0.27;
    ctx.fillStyle = '#0e0e11';
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (let r = outerR * 0.45; r < outerR * 0.92; r += 6) {
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = accentHex;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0e0e11';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = accentHex;
  ctx.fillRect(size * 0.08, size * 0.85, 18, 3);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '500 10px "Geist Mono", monospace';
  ctx.fillText('PLENRIP STUDIO', size * 0.08, size * 0.93);

  ctx.restore();
}

// 2x2 Canvas Album Collage generator for Playlists
const collageCache = new Map();

function loadImageWithCors(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

async function generatePlaylistCollage(songs, getCoverArtUrl) {
  const uniqueCoverIds = [];
  for (const s of songs || []) {
    if (s.coverArt && !uniqueCoverIds.includes(s.coverArt)) {
      uniqueCoverIds.push(s.coverArt);
    }
    if (uniqueCoverIds.length === 4) break;
  }

  if (uniqueCoverIds.length === 0) return null;
  if (uniqueCoverIds.length < 4) {
    return getCoverArtUrl(uniqueCoverIds[0], 300);
  }

  const cacheKey = uniqueCoverIds.join('|');
  if (collageCache.has(cacheKey)) {
    return collageCache.get(cacheKey);
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return getCoverArtUrl(uniqueCoverIds[0], 300);

    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, 300, 300);

    const images = await Promise.all(
      uniqueCoverIds.map((id) => loadImageWithCors(getCoverArtUrl(id, 300)))
    );

    const positions = [
      [0, 0],
      [150, 0],
      [0, 150],
      [150, 150],
    ];

    images.forEach((img, idx) => {
      const [x, y] = positions[idx];
      ctx.drawImage(img, x, y, 150, 150);
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    collageCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    return getCoverArtUrl(uniqueCoverIds[0], 300);
  }
}

// ============================================================================
// 4. Last.fm Scrobbler Client
// ============================================================================
class LastFmManager {
  constructor() {
    this.baseUrl = 'https://ws.audioscrobbler.com/2.0/';
  }

  getState() {
    const apiKey = localStorage.getItem(STORAGE_KEYS.LASTFM_API_KEY) || '';
    const apiSecret = localStorage.getItem(STORAGE_KEYS.LASTFM_API_SECRET) || '';
    const sessionKey = localStorage.getItem(STORAGE_KEYS.LASTFM_SESSION_KEY) || null;
    const username = localStorage.getItem(STORAGE_KEYS.LASTFM_USERNAME) || null;
    const isEnabled = localStorage.getItem(STORAGE_KEYS.LASTFM_ENABLED) !== 'false';
    return {
      apiKey,
      apiSecret,
      sessionKey,
      username,
      isEnabled,
      isConnected: Boolean(sessionKey && apiKey && apiSecret),
    };
  }

  setCredentials(apiKey, apiSecret) {
    localStorage.setItem(STORAGE_KEYS.LASTFM_API_KEY, (apiKey || '').trim());
    localStorage.setItem(STORAGE_KEYS.LASTFM_API_SECRET, (apiSecret || '').trim());
  }

  setEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.LASTFM_ENABLED, enabled ? 'true' : 'false');
  }

  disconnect() {
    localStorage.removeItem(STORAGE_KEYS.LASTFM_SESSION_KEY);
    localStorage.removeItem(STORAGE_KEYS.LASTFM_USERNAME);
  }

  sign(params, secret) {
    const keys = Object.keys(params)
      .filter((k) => k !== 'format' && k !== 'callback' && params[k] !== undefined && params[k] !== null)
      .sort();
    let toSign = '';
    for (const k of keys) {
      toSign += `${k}${params[k]}`;
    }
    toSign += secret;
    return md5Hex(toSign);
  }

  getAuthUrl(apiKey, callbackUrl) {
    return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callbackUrl)}`;
  }

  async handleCallbackToken(token) {
    const { apiKey, apiSecret } = this.getState();
    if (!apiKey || !apiSecret) throw new Error('Missing Last.fm API Key or Shared Secret.');

    const params = {
      api_key: apiKey,
      method: 'auth.getSession',
      token,
    };
    const api_sig = this.sign(params, apiSecret);
    const url = new URL(this.baseUrl);
    url.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('api_sig', api_sig);

    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.message || `Last.fm auth failed (${data.error || res.status})`);
    }
    localStorage.setItem(STORAGE_KEYS.LASTFM_SESSION_KEY, data.session.key);
    localStorage.setItem(STORAGE_KEYS.LASTFM_USERNAME, data.session.name);
    localStorage.setItem(STORAGE_KEYS.LASTFM_ENABLED, 'true');
    return data.session;
  }

  async updateNowPlaying(song) {
    const { isConnected, isEnabled, apiKey, apiSecret, sessionKey } = this.getState();
    if (!isConnected || !isEnabled || !song?.title || !song?.artist) return;

    const params = {
      api_key: apiKey,
      artist: song.artist,
      method: 'track.updateNowPlaying',
      sk: sessionKey,
      track: song.title,
    };
    if (song.album) params.album = song.album;
    if (song.duration) params.duration = String(Math.round(song.duration));

    const api_sig = this.sign(params, apiSecret);
    const body = new URLSearchParams();
    body.set('format', 'json');
    for (const [k, v] of Object.entries(params)) body.set(k, v);
    body.set('api_sig', api_sig);

    await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).catch(() => {});
  }

  async scrobble(song, timestampSeconds) {
    const { isConnected, isEnabled, apiKey, apiSecret, sessionKey } = this.getState();
    if (!isConnected || !isEnabled || !song?.title || !song?.artist) return;

    const params = {
      api_key: apiKey,
      artist: song.artist,
      method: 'track.scrobble',
      sk: sessionKey,
      timestamp: String(timestampSeconds),
      track: song.title,
    };
    if (song.album) params.album = song.album;
    if (song.duration) params.duration = String(Math.round(song.duration));

    const api_sig = this.sign(params, apiSecret);
    const body = new URLSearchParams();
    body.set('format', 'json');
    for (const [k, v] of Object.entries(params)) body.set(k, v);
    body.set('api_sig', api_sig);

    await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).catch(() => {});
  }
}

// ============================================================================
// 5. Two-Deck Gapless Audio Engine
// ============================================================================
class GaplessAudioEngine {
  constructor(client, historyStore, lastFmManager, onStateChange) {
    this.client = client;
    this.historyStore = historyStore;
    this.lastFm = lastFmManager;
    this.onStateChange = onStateChange || (() => {});

    this.deckA = new Audio();
    this.deckB = new Audio();
    this.deckA.preload = 'auto';
    this.deckB.preload = 'metadata';

    this.activeDeckKey = 'A';
    this.preloadedNextSongId = null;
    this.isCrossfading = false;
    this.isSeeking = false;
    this.fadeInterval = null;

    // Playback state
    this.currentSong = null;
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.repeatMode = 'off'; // 'off' | 'all' | 'one'
    this.shuffle = false;

    const savedVol = parseFloat(localStorage.getItem(STORAGE_KEYS.VOLUME) || '0.85');
    this.volume = Number.isNaN(savedVol) ? 0.85 : Math.max(0, Math.min(1, savedVol));

    const savedFade = parseFloat(localStorage.getItem(STORAGE_KEYS.CROSSFADE) || '0');
    this.crossfadeSeconds = Number.isNaN(savedFade) ? 0 : Math.max(0, Math.min(12, savedFade));

    // Tracking for History & Last.fm scrobbling
    this.recordedHistoryForTrack = null;
    this.scrobbledForTrack = null;
    this.trackStartUnixSec = 0;

    this.bindDeckEvents('A', this.deckA);
    this.bindDeckEvents('B', this.deckB);
    this.setupMediaSession();
  }

  getActiveDeck() {
    return this.activeDeckKey === 'A' ? this.deckA : this.deckB;
  }

  getIdleDeck() {
    return this.activeDeckKey === 'A' ? this.deckB : this.deckA;
  }

  notify() {
    this.onStateChange();
  }

  bindDeckEvents(deckKey, audio) {
    audio.addEventListener('timeupdate', () => {
      if (deckKey !== this.activeDeckKey || this.isSeeking) return;
      const cur = audio.currentTime || 0;
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (this.currentSong?.duration || 0);

      this.currentTime = cur;
      if (dur > 0) this.duration = dur;

      // Record listening history after 30 seconds of playback
      if (this.currentSong && cur >= 30 && this.recordedHistoryForTrack !== this.currentSong.id) {
        this.recordedHistoryForTrack = this.currentSong.id;
        this.historyStore.recordPlay({
          songId: this.currentSong.id,
          artistId: this.currentSong.artistId || '',
          albumId: this.currentSong.albumId || '',
          playedAt: Date.now(),
          playDurationMs: Math.round(cur * 1000),
        });
      }

      // Scrobble to Last.fm after 50% of duration or 240s (for tracks >= 30s)
      if (
        this.currentSong &&
        dur >= 30 &&
        this.scrobbledForTrack !== this.currentSong.id &&
        cur >= Math.min(240, dur * 0.5)
      ) {
        this.scrobbledForTrack = this.currentSong.id;
        this.lastFm.scrobble(this.currentSong, this.trackStartUnixSec || Math.floor(Date.now() / 1000));
      }

      // Trigger crossfade when entering crossfade window
      if (
        this.crossfadeSeconds > 0 &&
        !this.isCrossfading &&
        dur > this.crossfadeSeconds + 2 &&
        dur - cur <= this.crossfadeSeconds
      ) {
        const nextIdx = this.getNextQueueIndex();
        if (nextIdx !== -1 && this.repeatMode !== 'one') {
          this.startCrossfadeTransition(nextIdx);
        }
      }

      this.notify();
    });

    audio.addEventListener('loadedmetadata', () => {
      if (deckKey !== this.activeDeckKey) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        this.duration = audio.duration;
        this.notify();
      }
    });

    audio.addEventListener('ended', () => {
      if (deckKey !== this.activeDeckKey) return;
      if (this.isCrossfading) return;

      // Also record history if shorter track finished cleanly
      if (this.currentSong && this.recordedHistoryForTrack !== this.currentSong.id && (audio.currentTime || 0) >= 10) {
        this.recordedHistoryForTrack = this.currentSong.id;
        this.historyStore.recordPlay({
          songId: this.currentSong.id,
          artistId: this.currentSong.artistId || '',
          albumId: this.currentSong.albumId || '',
          playedAt: Date.now(),
          playDurationMs: Math.round((audio.currentTime || this.duration || 15) * 1000),
        });
      }

      if (this.repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }

      const nextIdx = this.getNextQueueIndex();
      if (nextIdx !== -1) {
        this.transitionToNextTrack(nextIdx);
      } else {
        this.isPlaying = false;
        this.currentTime = 0;
        this.notify();
      }
    });
  }

  getNextQueueIndex() {
    if (this.queue.length === 0) return -1;
    if (this.currentIndex + 1 < this.queue.length) return this.currentIndex + 1;
    if (this.repeatMode === 'all') return 0;
    return -1;
  }

  preloadNextInIdleDeck() {
    if (this.isCrossfading) return;
    const nextIdx = this.getNextQueueIndex();
    const nextSong = nextIdx !== -1 ? this.queue[nextIdx] : null;
    if (!nextSong) {
      this.preloadedNextSongId = null;
      return;
    }
    if (this.preloadedNextSongId === nextSong.id) return;

    const idle = this.getIdleDeck();
    idle.src = this.client.getStreamUrl(nextSong.id);
    idle.preload = 'metadata';
    idle.load();
    this.preloadedNextSongId = nextSong.id;
  }

  clearFadeTimer() {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    this.isCrossfading = false;
  }

  onNewTrackStarted(song) {
    this.recordedHistoryForTrack = null;
    this.scrobbledForTrack = null;
    this.trackStartUnixSec = Math.floor(Date.now() / 1000);
    this.lastFm.updateNowPlaying(song);
    this.updateMediaSession(song);
    this.preloadNextInIdleDeck();
  }

  transitionToNextTrack(nextIdx) {
    const nextSong = this.queue[nextIdx];
    if (!nextSong) return;

    this.clearFadeTimer();
    const currentActive = this.getActiveDeck();
    const idle = this.getIdleDeck();

    if (this.preloadedNextSongId === nextSong.id && idle.src) {
      currentActive.pause();
      currentActive.currentTime = 0;

      this.activeDeckKey = this.activeDeckKey === 'A' ? 'B' : 'A';
      this.preloadedNextSongId = null;

      idle.volume = this.volume;
      idle.play().catch(() => {});

      this.currentSong = nextSong;
      this.currentIndex = nextIdx;
      this.currentTime = 0;
      this.duration = nextSong.duration || 0;
      this.isPlaying = true;
      this.onNewTrackStarted(nextSong);
      this.notify();
    } else {
      this.loadAndPlayOnActiveDeck(nextSong, nextIdx);
    }
  }

  startCrossfadeTransition(nextIdx) {
    const nextSong = this.queue[nextIdx];
    if (!nextSong) return;

    this.isCrossfading = true;
    const outgoing = this.getActiveDeck();
    const incoming = this.getIdleDeck();

    if (this.preloadedNextSongId !== nextSong.id || !incoming.src) {
      incoming.src = this.client.getStreamUrl(nextSong.id);
    }

    incoming.currentTime = 0;
    incoming.volume = 0;
    incoming.play().catch(() => {});

    this.activeDeckKey = this.activeDeckKey === 'A' ? 'B' : 'A';
    this.preloadedNextSongId = null;

    this.currentSong = nextSong;
    this.currentIndex = nextIdx;
    this.currentTime = 0;
    this.duration = nextSong.duration || 0;
    this.isPlaying = true;
    this.onNewTrackStarted(nextSong);
    this.notify();

    const fadeMs = Math.max(500, this.crossfadeSeconds * 1000);
    const steps = 25;
    const stepTime = fadeMs / steps;
    let step = 0;

    if (this.fadeInterval) clearInterval(this.fadeInterval);
    this.fadeInterval = setInterval(() => {
      step++;
      const ratio = Math.min(1, step / steps);
      const targetVol = this.volume;
      incoming.volume = Math.min(1, Math.max(0, targetVol * ratio));
      outgoing.volume = Math.min(1, Math.max(0, targetVol * (1 - ratio)));

      if (step >= steps) {
        this.clearFadeTimer();
        outgoing.pause();
        outgoing.currentTime = 0;
        outgoing.volume = targetVol;
        incoming.volume = targetVol;
        this.preloadNextInIdleDeck();
      }
    }, stepTime);
  }

  loadAndPlayOnActiveDeck(song, index) {
    this.clearFadeTimer();
    const active = this.getActiveDeck();
    const idle = this.getIdleDeck();
    idle.pause();

    active.src = this.client.getStreamUrl(song.id);
    active.currentTime = 0;
    active.volume = this.volume;
    active.play().catch(() => {});

    this.currentSong = song;
    this.currentIndex = index;
    this.currentTime = 0;
    this.duration = song.duration || 0;
    this.isPlaying = true;
    this.onNewTrackStarted(song);
    this.notify();
  }

  playSong(song, newQueue = null) {
    let targetQueue = newQueue ? [...newQueue] : [...this.queue];
    if (targetQueue.length === 0) targetQueue = [song];
    const original = [...targetQueue];

    if (this.shuffle && newQueue && newQueue.length > 1) {
      const rest = targetQueue.filter((s) => s.id !== song.id);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      targetQueue = [song, ...rest];
    }

    const idx = targetQueue.findIndex((s) => s.id === song.id);
    const resolvedIdx = idx >= 0 ? idx : 0;

    this.queue = targetQueue;
    this.originalQueue = original;
    this.loadAndPlayOnActiveDeck(song, resolvedIdx);
  }

  togglePlayPause() {
    if (!this.currentSong) {
      if (this.queue.length > 0) {
        this.playSong(this.queue[0], this.queue);
      }
      return;
    }
    const active = this.getActiveDeck();
    if (this.isPlaying) {
      active.pause();
      this.isPlaying = false;
    } else {
      active.play().catch(() => {});
      this.isPlaying = true;
    }
    this.notify();
  }

  next() {
    if (this.queue.length === 0) return;
    const nextIdx = this.getNextQueueIndex();
    if (nextIdx !== -1) {
      this.transitionToNextTrack(nextIdx);
    }
  }

  previous() {
    if (this.queue.length === 0) return;
    const active = this.getActiveDeck();
    if (active.currentTime > 3) {
      active.currentTime = 0;
      this.currentTime = 0;
      this.notify();
      return;
    }
    let prevIdx = this.currentIndex - 1;
    if (prevIdx < 0) {
      prevIdx = this.repeatMode === 'all' ? this.queue.length - 1 : 0;
    }
    const prevSong = this.queue[prevIdx];
    if (prevSong) {
      this.loadAndPlayOnActiveDeck(prevSong, prevIdx);
    }
  }

  seek(timeSeconds) {
    const active = this.getActiveDeck();
    const dur = Number.isFinite(active.duration) && active.duration > 0 ? active.duration : this.duration;
    const safeMax = dur > 1 ? dur - 0.5 : dur;
    const clamped = Math.max(0, Math.min(timeSeconds, safeMax > 0 ? safeMax : timeSeconds));

    this.isSeeking = true;
    active.currentTime = clamped;
    this.currentTime = clamped;
    this.notify();

    setTimeout(() => {
      this.isSeeking = false;
    }, 80);
  }

  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, vol));
    this.volume = clamped;
    localStorage.setItem(STORAGE_KEYS.VOLUME, String(clamped));
    if (!this.isCrossfading) {
      this.getActiveDeck().volume = clamped;
    }
    this.notify();
  }

  setCrossfadeSeconds(seconds) {
    const clamped = Math.max(0, Math.min(12, seconds));
    this.crossfadeSeconds = clamped;
    localStorage.setItem(STORAGE_KEYS.CROSSFADE, String(clamped));
    this.notify();
  }

  cycleRepeatMode() {
    const order = ['off', 'all', 'one'];
    const next = order[(order.indexOf(this.repeatMode) + 1) % order.length];
    this.repeatMode = next;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  toggleShuffle() {
    if (this.queue.length <= 1) {
      this.shuffle = !this.shuffle;
      this.notify();
      return;
    }

    if (!this.shuffle) {
      const current = this.currentSong;
      const remaining = this.queue.filter((_, idx) => idx !== this.currentIndex);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      const newQueue = current ? [current, ...remaining] : remaining;
      this.shuffle = true;
      this.queue = newQueue;
      this.currentIndex = current ? 0 : -1;
    } else {
      const current = this.currentSong;
      const restored = this.originalQueue.length > 0 ? [...this.originalQueue] : [...this.queue];
      const idx = current ? restored.findIndex((s) => s.id === current.id) : -1;
      this.shuffle = false;
      this.queue = restored;
      this.currentIndex = idx;
    }

    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  playNextInQueue(song) {
    if (!this.currentSong || this.queue.length === 0) {
      this.playSong(song, [song]);
      return;
    }
    const insertIdx = this.currentIndex + 1;
    this.queue.splice(insertIdx, 0, song);
    this.originalQueue.push(song);
    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  addToQueue(song) {
    if (!this.currentSong || this.queue.length === 0) {
      this.playSong(song, [song]);
      return;
    }
    this.queue.push(song);
    this.originalQueue.push(song);
    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.currentIndex) {
      if (this.queue.length === 1) {
        this.clearQueue();
        return;
      }
      this.queue.splice(index, 1);
      const nextIdx = index >= this.queue.length ? 0 : index;
      this.loadAndPlayOnActiveDeck(this.queue[nextIdx], nextIdx);
      return;
    }

    this.queue.splice(index, 1);
    if (index < this.currentIndex) {
      this.currentIndex -= 1;
    }
    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  moveQueueItem(fromIndex, toIndex) {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    if (this.currentSong) {
      this.currentIndex = this.queue.findIndex((s) => s.id === this.currentSong.id);
    }
    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  clearQueue() {
    this.clearFadeTimer();
    this.deckA.pause();
    this.deckB.pause();
    this.deckA.src = '';
    this.deckB.src = '';
    this.preloadedNextSongId = null;
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.currentSong = null;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.notify();
  }

  setupMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => this.togglePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') this.seek(details.seekTime);
      });
    } catch {
      // Ignore unsupported mediaSession actions
    }
  }

  updateMediaSession(song) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !song) return;
    try {
      const coverUrl = this.client.getCoverArtUrl(song.coverArt || song.albumId || song.id, 512);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || 'Unknown Title',
        artist: song.artist || 'Unknown Artist',
        album: song.album || '',
        artwork: coverUrl ? [{ src: coverUrl, sizes: '512x512', type: 'image/jpeg' }] : [],
      });
    } catch {
      // Ignore MediaMetadata errors
    }
  }
}

window.PlenripEngine = {
  STORAGE_KEYS,
  DEFAULT_CONFIG,
  LYRICS_PROVIDERS_META,
  DEFAULT_LYRICS_PRIORITY,
  SubsonicClient,
  LyricsManager,
  HistoryStore,
  LastFmManager,
  GaplessAudioEngine,
  parseLrc,
  findActiveLineIndex,
  generateDiscoveryCards,
  drawGenerativeThumbnail,
  generatePlaylistCollage,
};

