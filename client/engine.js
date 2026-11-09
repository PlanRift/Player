// Century Audio — Core Engine (Subsonic API, Gapless Dual-Deck Web Audio + ReplayGain, Multi-Provider Lyrics + Word Sync + Romaji/EN, Title Translations, Honest History, Deezer Artist Art)
// Zero-framework Vanilla JS module.

const STORAGE_KEYS = {
  NAVIDROME_URL: 'century.navidrome.url',
  NAVIDROME_USER: 'century.navidrome.user',
  NAVIDROME_PASS: 'century.navidrome.pass',
  SIDEBAR_COLLAPSED: 'century.sidebar.collapsed',
  OUTPUT_DEVICE: 'century.settings.outputDevice',
  CROSSFADE: 'century.settings.crossfade',
  NORMALIZATION: 'century.settings.normalization',
  PREAMP: 'century.settings.preamp',
  STREAM_QUALITY: 'century.settings.streamQuality',
  SHOW_TRANSLATED_TITLES: 'century.settings.showTranslatedTitles',
  SPLIT_ALBUMS_SINGLES: 'century.settings.splitAlbumsSingles',
  AUTOPLAY: 'century.settings.autoplay',
  BALANCED_SHUFFLE: 'century.settings.balancedShuffle',
  VOLUME: 'century.settings.volume',
  HISTORY: 'century.history.v1',
  PLAYBACK_POSITIONS: 'century.playback_positions.v1',
  QUICKPICK_DATE: 'century.quickpick.date',
  QUICKPICK_SONGS: 'century.quickpick.songs',
  TITLE_TRANSLATIONS: 'century.title_translations.v2',
  DEEZER_ARTIST_PREFIX: 'century.deezer-artist.',
  LYRICS_PRIORITY: 'century.lyrics.priorityOrder',
  LYRICS_PROVIDER_PREFIX: 'century.lyrics.provider.',
  LYRICS_MODE_PREFIX: 'century.lyrics.mode.',
  LYRICS_PREF_ROMAJI: 'century.lyrics.pref.romaji',
  LYRICS_PREF_TRANSLATED: 'century.lyrics.pref.translated',
  LYRICS_OFFSET_PREFIX: 'century.lyrics.offset.',
  LYRICS_EN_PREFIX: 'century.lyrics.en.',
  LYRICS_ROMAJI_PREFIX: 'century.lyrics.romaji.',
  LYRICS_RELAY_URL: 'century.lyrics.relayUrl',
  LYRICS_DISPLAY_PREFIX: 'century.lyrics.display.',
};

const DEFAULT_CONFIG = {
  serverUrl: 'http://127.0.0.1:4533',
  username: '',
  password: '',
};

// Migrate legacy planrift.* and player.lyrics-offset.v1.* keys to century.*
function migrateStorageKeys() {
  try {
    const exactMigrations = [
      ['planrift.navidrome.url', STORAGE_KEYS.NAVIDROME_URL],
      ['planrift.navidrome.user', STORAGE_KEYS.NAVIDROME_USER],
      ['planrift.navidrome.pass', STORAGE_KEYS.NAVIDROME_PASS],
      ['planrift.sidebar.collapsed', STORAGE_KEYS.SIDEBAR_COLLAPSED],
      ['planrift.settings.outputDevice', STORAGE_KEYS.OUTPUT_DEVICE],
      ['planrift.settings.crossfade', STORAGE_KEYS.CROSSFADE],
      ['planrift.settings.normalization', STORAGE_KEYS.NORMALIZATION],
      ['planrift.settings.preamp', STORAGE_KEYS.PREAMP],
      ['planrift.settings.streamQuality', STORAGE_KEYS.STREAM_QUALITY],
      ['planrift.settings.showTranslatedTitles', STORAGE_KEYS.SHOW_TRANSLATED_TITLES],
      ['planrift.settings.volume', STORAGE_KEYS.VOLUME],
      ['planrift.history.v1', STORAGE_KEYS.HISTORY],
      ['planrift.playback_positions.v1', STORAGE_KEYS.PLAYBACK_POSITIONS],
      ['planrift.quickpick.date', STORAGE_KEYS.QUICKPICK_DATE],
      ['planrift.quickpick.songs', STORAGE_KEYS.QUICKPICK_SONGS],
      ['planrift.title_translations.v2', STORAGE_KEYS.TITLE_TRANSLATIONS],
      ['planrift.lyrics.priorityOrder', STORAGE_KEYS.LYRICS_PRIORITY],
    ];

    for (const [oldKey, newKey] of exactMigrations) {
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, oldVal);
      }
      // Migrate, then delete: the old key is removed once its value has
      // been copied (or the target already holds the canonical value).
      // This includes the Navidrome password under the old key — leaving
      // it in localStorage indefinitely is the leak this fixes.
      if (oldVal !== null) localStorage.removeItem(oldKey);
    }

    const prefixMigrations = [
      ['planrift.deezer-artist.', STORAGE_KEYS.DEEZER_ARTIST_PREFIX],
      ['planrift.lyrics.provider.', STORAGE_KEYS.LYRICS_PROVIDER_PREFIX],
      ['planrift.lyrics.mode.', STORAGE_KEYS.LYRICS_MODE_PREFIX],
      ['planrift.lyrics.offset.', STORAGE_KEYS.LYRICS_OFFSET_PREFIX],
      ['player.lyrics-offset.v1.', STORAGE_KEYS.LYRICS_OFFSET_PREFIX],
      ['planrift.lyrics.en.', STORAGE_KEYS.LYRICS_EN_PREFIX],
      ['planrift.lyrics.romaji.', STORAGE_KEYS.LYRICS_ROMAJI_PREFIX],
    ];

    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }

    for (const key of keys) {
      for (const [oldPrefix, newPrefix] of prefixMigrations) {
        if (key.startsWith(oldPrefix)) {
          const suffix = key.slice(oldPrefix.length);
          const targetKey = `${newPrefix}${suffix}`;
          const val = localStorage.getItem(key);
          if (val !== null && localStorage.getItem(targetKey) === null) {
            localStorage.setItem(targetKey, val);
          }
          // Migrate, then delete (see above).
          if (val !== null) localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // Ignore storage access errors
  }
}

migrateStorageKeys();

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

function escapeHtmlStr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Network helpers (lyrics go through the plenrip-relay on port 3005; everything else runs directly in the browser)
function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: options.signal || controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  if (!res.ok) return null;
  return res.json();
}

// JSONP loader for APIs without CORS headers (Deezer, iTunes)
function jsonp(url, paramName = 'callback', timeoutMs = 5000) {
  return new Promise((resolve) => {
    const cbName = `__centuryJsonp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement('script');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        delete window[cbName];
      } catch {
        window[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    window[cbName] = (data) => finish(data);
    script.onerror = () => finish(null);
    script.src = `${url}${url.includes('?') ? '&' : '?'}${paramName}=${cbName}`;
    document.head.appendChild(script);
  });
}

// Google Translate free endpoint (CORS enabled). Returns { english, romaji }.
async function googleTranslate(text, sourceLang = 'auto') {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=en&dt=t&dt=rm&q=${encodeURIComponent(text)}`;
    const data = await fetchJson(url, {}, 4500);
    if (!Array.isArray(data) || !Array.isArray(data[0])) return { english: null, romaji: null };
    const en = [];
    let romaji = null;
    for (const item of data[0]) {
      if (!Array.isArray(item)) continue;
      if (item[0]) en.push(String(item[0]));
      if (item.length > 3 && item[3]) romaji = String(item[3]);
    }
    return { english: en.join('').trim() || null, romaji: romaji ? romaji.trim() : null };
  } catch {
    return { english: null, romaji: null };
  }
}

async function runPool(items, concurrency, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

// ============================================================================
// 1. Subsonic API Client + Virtual Singles Resolver + Binary Cover Art Fallback
// ============================================================================
class SubsonicClient {
  constructor() {
    this.loadConfig();
    this.streamCoverCache = new Map();
    this.coverCacheBust = 0;
  }

  bustCoverCache() {
    this.coverCacheBust = Date.now();
    this.streamCoverCache.clear();
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
    const cleanPass = password !== undefined && password !== '' ? password : this.password;
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
    url.searchParams.set('c', 'CenturyStudio');
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

  async getArtistInfo2(id) {
    try {
      const res = await this.request('getArtistInfo2', { id });
      return res.artistInfo2 || {};
    } catch {
      return {};
    }
  }

  async getMusicDirectory(id) {
    const res = await this.request('getMusicDirectory', { id });
    if (!res.directory) throw new Error(`Directory not found: ${id}`);
    return {
      ...res.directory,
      child: res.directory.child || [],
    };
  }

  async getAlbumList2(params = { type: 'newest', size: 24, offset: 0 }) {
    const extra = {
      type: params.type || 'newest',
      size: params.size ?? 24,
      offset: params.offset ?? 0,
    };
    if (params.fromYear !== undefined) extra.fromYear = params.fromYear;
    if (params.toYear !== undefined) extra.toYear = params.toYear;
    if (params.genre !== undefined) extra.genre = params.genre;
    const res = await this.request('getAlbumList2', extra);
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
      query: query ?? '',
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
    const params = { id, size };
    if (this.coverCacheBust) params._cb = this.coverCacheBust;
    return this.buildUrl('getCoverArt', params);
  }

  getStreamUrl(id, streamQuality) {
    if (!id) return '';
    const quality =
      streamQuality ||
      localStorage.getItem(STORAGE_KEYS.STREAM_QUALITY) ||
      'auto';

    if (quality === 'mp3-320') {
      return this.buildUrl('stream', { id, format: 'mp3', maxBitRate: 320 });
    }
    if (quality === 'opus-192') {
      return this.buildUrl('stream', { id, format: 'opus', maxBitRate: 192 });
    }
    if (quality === 'opus-96') {
      return this.buildUrl('stream', { id, format: 'opus', maxBitRate: 96 });
    }
    if (quality === 'auto') {
      return this.buildUrl('stream', { id, format: 'opus', maxBitRate: 192 });
    }
    // 'original' (and anything unknown): the raw file, no transcode params.
    return this.buildUrl('stream', { id });
  }

  // Synthesize virtual Singles album when an artist has loose/unknown-album tracks
  async resolveArtistAlbums(artist) {
    if (!artist || !artist.id) return [];
    const rawAlbums = Array.isArray(artist.album) ? artist.album : [];
    const isUnknownAlbumName = (name) => {
      const n = String(name || '').trim().toLowerCase();
      return !n || n === '[unknown album]' || n === 'unknown album';
    };

    const regularAlbums = rawAlbums.filter((a) => !isUnknownAlbumName(a.name));
    const unknownAlbumStubs = rawAlbums.filter((a) => isUnknownAlbumName(a.name));

    let singleSongs = [];
    const seenIds = new Set();
    const addSong = (s) => {
      if (s && s.id && !seenIds.has(s.id)) {
        seenIds.add(s.id);
        singleSongs.push(s);
      }
    };

    try {
      for (const stub of unknownAlbumStubs) {
        const alb = await this.getAlbum(stub.id).catch(() => null);
        if (alb?.song) alb.song.forEach(addSong);
      }

      if (regularAlbums.length === 0 || unknownAlbumStubs.length > 0) {
        const sr = await this.search3(artist.name || '', {
          artistCount: 0,
          albumCount: 0,
          songCount: 200,
        }).catch(() => ({ song: [] }));
        const artistNameLower = String(artist.name || '').toLowerCase();
        for (const s of sr.song || []) {
          const matchesArtist =
            s.artistId === artist.id ||
            String(s.artist || '').toLowerCase() === artistNameLower;
          if (!matchesArtist) continue;
          const belongsToRegular = regularAlbums.some((a) => a.id === s.albumId);
          if (!belongsToRegular && (isUnknownAlbumName(s.album) || regularAlbums.length === 0)) {
            addSong(s);
          }
        }
      }

      if (regularAlbums.length === 0 && singleSongs.length === 0) {
        const dir = await this.getMusicDirectory(artist.id).catch(() => null);
        if (dir?.child) {
          for (const item of dir.child) {
            if (!item.isDir) addSong(item);
          }
        }
      }
    } catch {
      // Ignore fallback errors
    }

    if (singleSongs.length > 0) {
      const totalDur = singleSongs.reduce((acc, s) => acc + (s.duration || 0), 0);
      const firstWithCover = singleSongs.find((s) => s.coverArt);
      const virtualSingles = {
        id: `singles-${artist.id}`,
        name: 'Singles',
        artist: artist.name,
        artistId: artist.id,
        coverArt: firstWithCover?.coverArt || artist.coverArt,
        songCount: singleSongs.length,
        duration: totalDur,
        _virtualSongs: singleSongs,
      };
      return [...regularAlbums, virtualSingles];
    }

    return regularAlbums;
  }

  async resolveAlbumSongs(albumOrId) {
    const id = typeof albumOrId === 'string' ? albumOrId : albumOrId?.id;
    if (!id) throw new Error('Invalid album ID');

    if (typeof albumOrId === 'object' && Array.isArray(albumOrId._virtualSongs)) {
      return {
        ...albumOrId,
        song: albumOrId._virtualSongs,
      };
    }

    if (String(id).startsWith('singles-')) {
      const artistId = String(id).slice('singles-'.length);
      const artist = await this.getArtist(artistId);
      const resolvedAlbums = await this.resolveArtistAlbums(artist);
      const virtual = resolvedAlbums.find((a) => a.id === id);
      if (virtual) {
        return {
          ...virtual,
          song: virtual._virtualSongs || [],
        };
      }
      return {
        id,
        name: 'Singles',
        artist: artist.name,
        artistId: artist.id,
        songCount: 0,
        duration: 0,
        song: [],
      };
    }

    return this.getAlbum(id);
  }

  // Fallback cover art extractor from raw audio stream header bytes (ID3v2 / FLAC APIC JPEG or PNG)
  async extractCoverFromStream(songId) {
    if (!songId) return null;
    if (this.streamCoverCache.has(songId)) {
      return this.streamCoverCache.get(songId);
    }

    try {
      const streamUrl = this.getStreamUrl(songId, 'original');
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
// 2. Title Translation Store (bundled cache + Deezer / iTunes / Google, all in browser)
// ============================================================================
const NON_LATIN_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u0400-\u04ff]/;
const JAPANESE_CHAR_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;

function hasNonLatinScript(text) {
  if (!text || typeof text !== 'string') return false;
  return NON_LATIN_REGEX.test(text);
}

function normalizeForCompare(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/tsu/g, 'tu')
    .replace(/shi/g, 'si')
    .replace(/chi/g, 'ti')
    .replace(/fu/g, 'hu')
    .replace(/ou/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, '');
}

function doesArtistMatch(targetArtist, targetArtistRomaji, candidateArtist) {
  if (!targetArtist) return true;
  if (!candidateArtist) return false;
  const cand = normalizeForCompare(candidateArtist);
  const targ = normalizeForCompare(targetArtist);
  if (cand && targ && (cand.includes(targ) || targ.includes(cand))) return true;
  if (targetArtistRomaji) {
    const rom = normalizeForCompare(targetArtistRomaji);
    if (cand && rom && (cand.includes(rom) || rom.includes(cand))) return true;
  }
  return false;
}

async function lookupDeezerTitle(baseTitle, artist, artistRomaji) {
  if (!artist) return null;
  const data = await jsonp(
    `https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${baseTitle}`.trim())}&output=jsonp`
  );
  const list = Array.isArray(data?.data) ? data.data : [];
  const matched = list.filter((item) => doesArtistMatch(artist, artistRomaji, String(item.artist?.name || '')));
  if (matched.length === 0) return null;

  if (matched.length > 2) {
    const t0 = String(matched[0].title_short || matched[0].title || '').toLowerCase();
    const t1 = String(matched[1].title_short || matched[1].title || '').toLowerCase();
    if (t0 !== t1) {
      const alb1 = String(matched[1].album?.title || '').trim();
      const alb2 = String(matched[2].album?.title || '').trim();
      if (alb1 && alb1.toLowerCase() === alb2.toLowerCase() && !JAPANESE_CHAR_REGEX.test(alb1)) return alb1;
      return null;
    }
  }

  for (const item of matched) {
    const cand = String(item.title_short || item.title || '').trim();
    if (cand && cand.toLowerCase() !== baseTitle.toLowerCase() && !JAPANESE_CHAR_REGEX.test(cand)) return cand;
  }
  return null;
}

async function lookupItunesTitle(baseTitle, artist, artistRomaji) {
  if (!artist) {
    const data = await jsonp(
      `https://itunes.apple.com/search?term=${encodeURIComponent(baseTitle)}&entity=musicArtist&country=US&limit=3`
    );
    for (const r of data?.results || []) {
      const name = String(r.artistName || '').trim();
      if (name && !JAPANESE_CHAR_REGEX.test(name) && doesArtistMatch(baseTitle, artistRomaji, name)) return name;
    }
    return null;
  }

  const data = await jsonp(
    `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${baseTitle}`.trim())}&country=US&limit=5`
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  const matched = results.filter((r) => doesArtistMatch(artist, artistRomaji, String(r.artistName || '')));
  if (matched.length === 0) return null;

  if (matched.length >= 2) {
    const col0 = String(matched[0].collectionName || '').replace(/\s*-\s*(Single|EP)$/i, '').trim();
    const col1 = String(matched[1].collectionName || '').replace(/\s*-\s*(Single|EP)$/i, '').trim();
    const trk0 = String(matched[0].trackName || '').trim().toLowerCase();
    const trk1 = String(matched[1].trackName || '').trim().toLowerCase();
    if (col0 && col0.toLowerCase() === col1.toLowerCase() && trk0 !== trk1 && trk0 !== col0.toLowerCase() && !JAPANESE_CHAR_REGEX.test(col0)) {
      return col0;
    }
  }

  const wantsRemix = /remix|リミックス/i.test(baseTitle);
  const sorted = [...matched].sort((a, b) => {
    const aR = /remix/i.test(String(a.trackName || ''));
    const bR = /remix/i.test(String(b.trackName || ''));
    if (!wantsRemix && aR !== bR) return aR ? 1 : -1;
    return 0;
  });
  for (const item of sorted) {
    const cand = String(item.trackName || item.collectionName || '').trim();
    if (cand && cand.toLowerCase() !== baseTitle.toLowerCase() && !JAPANESE_CHAR_REGEX.test(cand)) return cand;
  }
  return null;
}

async function resolveTitleTranslation(title, artist) {
  const cleanTitle = String(title || '').trim();
  const cleanArtist = String(artist || '').trim();
  if (!cleanTitle) return null;

  const instMatch = cleanTitle.match(/^(.+?)\s*([-(](?:instrumental|off\s*vocal)[)-]|\((?:instrumental|off\s*vocal)[^)]*\))$/i);
  const baseTitle = instMatch ? instMatch[1].trim() : cleanTitle;
  const suffix = instMatch ? ` ${instMatch[2].trim()}` : '';
  const effectiveArtist = cleanArtist.toLowerCase() === baseTitle.toLowerCase() ? '' : cleanArtist;
  const withSuffix = (cand) =>
    !suffix || /instrumental|off vocal/i.test(cand) ? cand : `${cand}${suffix}`;

  const [googleTitle, googleArtist] = await Promise.all([
    googleTranslate(baseTitle),
    effectiveArtist && JAPANESE_CHAR_REGEX.test(effectiveArtist)
      ? googleTranslate(effectiveArtist)
      : Promise.resolve({ english: null, romaji: null }),
  ]);
  const artistRomaji = googleArtist.romaji || googleArtist.english;

  const deezerHit = await lookupDeezerTitle(baseTitle, effectiveArtist, artistRomaji);
  if (deezerHit) return withSuffix(deezerHit);

  const itunesHit = await lookupItunesTitle(baseTitle, effectiveArtist, artistRomaji);
  if (itunesHit) return withSuffix(itunesHit);

  const hasPinyinTones = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(googleTitle.romaji || '');
  const fallback = (
    (hasPinyinTones ? googleTitle.english || googleTitle.romaji : googleTitle.romaji || googleTitle.english) || ''
  ).trim();
  if (fallback && fallback.toLowerCase() !== baseTitle.toLowerCase() && !JAPANESE_CHAR_REGEX.test(fallback)) {
    return withSuffix(fallback);
  }
  return null;
}

class TitleTranslationStore {
  constructor() {
    // key: `${artist.toLowerCase()}:${title.toLowerCase()}` -> translated string ('' means "no translation exists")
    this.cache = new Map();
    this.pendingKeys = new Set();
    this.listeners = new Set();
    this.loadFromLocalStorage();
    this.seedFromBundledCache();
  }

  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyListeners() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // Ignore listener errors
      }
    }
  }

  isEnabled() {
    return localStorage.getItem(STORAGE_KEYS.SHOW_TRANSLATED_TITLES) !== 'false';
  }

  setEnabled(enabled) {
    localStorage.setItem(STORAGE_KEYS.SHOW_TRANSLATED_TITLES, enabled ? 'true' : 'false');
    this.notifyListeners();
  }

  makeKey(title, artist = '') {
    return `${String(artist || '').trim().toLowerCase()}:${String(title || '').trim().toLowerCase()}`;
  }

  loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.TITLE_TRANSLATIONS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') this.cache.set(k, v);
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  saveToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.TITLE_TRANSLATIONS, JSON.stringify(Object.fromEntries(this.cache)));
    } catch {
      // Ignore quota errors
    }
  }

  // Seed from the bundled ./title-translations.json (pre-resolved translations for the library)
  async seedFromBundledCache() {
    try {
      const res = await fetch('./title-translations.json');
      if (!res.ok) return;
      const data = await res.json();
      let added = false;
      for (const [k, entry] of Object.entries(data || {})) {
        const translated = typeof entry === 'string' ? entry : entry?.translatedTitle;
        if (translated && !this.cache.get(k)) {
          this.cache.set(k, String(translated).trim());
          added = true;
        }
      }
      if (added) {
        this.saveToLocalStorage();
        this.notifyListeners();
      }
    } catch {
      // Ignore if the file is not reachable
    }
  }

  getTranslatedTitle(title, artist = '') {
    if (!title || !hasNonLatinScript(title)) return null;
    const raw = String(title).trim();
    const exact = this.cache.get(this.makeKey(raw, artist));
    if (exact && exact.toLowerCase() !== raw.toLowerCase()) return exact;

    const suffix = `:${raw.toLowerCase()}`;
    for (const [k, v] of this.cache.entries()) {
      if (v && k.endsWith(suffix) && v.toLowerCase() !== raw.toLowerCase()) return v;
    }
    return null;
  }

  formatDisplayTitleText(title, artist = '') {
    const base = String(title || 'Untitled');
    if (!this.isEnabled()) return base;
    const tr = this.getTranslatedTitle(base, artist);
    return tr ? `${base} - ${tr}` : base;
  }

  formatDisplayTitleHtml(title, artist = '') {
    const base = String(title || 'Untitled');
    if (!this.isEnabled()) return escapeHtmlStr(base);
    const tr = this.getTranslatedTitle(base, artist);
    if (!tr) return escapeHtmlStr(base);
    return `${escapeHtmlStr(base)} <span class="text-emerald-400/90 font-mono text-[11px] font-normal">- ${escapeHtmlStr(tr)}</span>`;
  }

  async ensureTranslations(items = []) {
    if (!this.isEnabled()) return;
    const misses = [];
    for (const item of items) {
      if (!item) continue;
      const title = String(item.title || item.name || '').trim();
      const artist = String(item.artist || '').trim();
      if (!title || !hasNonLatinScript(title)) continue;
      const key = this.makeKey(title, artist);
      if (this.cache.has(key) || this.pendingKeys.has(key)) continue;
      if (this.getTranslatedTitle(title, artist)) continue;
      this.pendingKeys.add(key);
      misses.push({ title, artist, key });
    }
    if (misses.length === 0) return;

    // Items that have an artist first, so artist-less lookups can reuse them
    misses.sort((a, b) => (b.artist ? 1 : 0) - (a.artist ? 1 : 0));
    const limited = misses.slice(0, 60);
    for (const m of misses.slice(60)) this.pendingKeys.delete(m.key);

    let updated = false;
    await runPool(limited, 2, async (m) => {
      try {
        const translated = await resolveTitleTranslation(m.title, m.artist);
        this.cache.set(m.key, translated || '');
        if (translated) updated = true;
      } catch {
        // Leave uncached so it can be retried next session
      } finally {
        this.pendingKeys.delete(m.key);
      }
    });

    this.saveToLocalStorage();
    if (updated) this.notifyListeners();
  }

  // Tokenized match: split the query into tokens (whitespace-separated);
  // EVERY token must match the text or its translated title.
  // (Century: tokens must all match across title/artist/album + translations.)
  matchesSearchWithTranslation(text, artist, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const hay = String(text || '').toLowerCase();
    const tr = this.getTranslatedTitle(text, artist);
    const trHay = tr ? tr.toLowerCase() : '';
    return tokens.every((tok) => hay.includes(tok) || (trHay && trHay.includes(tok)));
  }

  // Tokenized match across several fields: every token must match at least
  // one field (or that field's translated title). Fields are { text, artist }.
  matchesAllTokens(fields, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const hays = (fields || []).flatMap((f) => {
      const hay = String(f.text || '').toLowerCase();
      const tr = this.getTranslatedTitle(f.text, f.artist);
      return tr ? [hay, tr.toLowerCase()] : [hay];
    });
    return tokens.every((tok) => hays.some((h) => h.includes(tok)));
  }

  async searchLibraryWithTranslation(client, query, counts = {}) {
    const q = String(query || '').trim();
    if (!q) return { artist: [], album: [], song: [] };

    const [directRes, broaderRes] = await Promise.all([
      client.search3(q, {
        artistCount: counts.artistCount ?? 20,
        albumCount: counts.albumCount ?? 20,
        songCount: counts.songCount ?? 50,
      }),
      client
        .search3('', { artistCount: 100, albumCount: 150, songCount: 400 })
        .catch(() => ({ artist: [], album: [], song: [] })),
    ]);

    const mergeUnique = (primary, secondary, matchFn) => {
      const map = new Map();
      for (const item of primary || []) if (item?.id) map.set(item.id, item);
      for (const item of secondary || []) if (item?.id && !map.has(item.id) && matchFn(item)) map.set(item.id, item);
      return Array.from(map.values());
    };

    return {
      artist: mergeUnique(directRes.artist, broaderRes.artist, (a) =>
        this.matchesAllTokens([{ text: a.name, artist: '' }], q)
      ),
      album: mergeUnique(directRes.album, broaderRes.album, (al) =>
        this.matchesAllTokens(
          [
            { text: al.name, artist: al.artist },
            { text: al.artist, artist: '' },
          ],
          q
        )
      ),
      song: mergeUnique(directRes.song, broaderRes.song, (s) =>
        this.matchesAllTokens(
          [
            { text: s.title, artist: s.artist },
            { text: s.album, artist: s.artist },
            { text: s.artist, artist: '' },
          ],
          q
        )
      ),
    };
  }
}

// ============================================================================
// 3. Monochrome SVG Aura Placeholder & 5-Tier Deezer Artist Image Resolver
// ============================================================================
const PLACEHOLDER_IMAGE_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

function generateAuraPlaceholder(seed = 'Century') {
  const s = String(seed || 'Century').trim();
  const initial = (s[0] || 'C').toUpperCase();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  const shades = ['#181818', '#1c1c1c', '#202020', '#242424', '#161616'];
  const bg = shades[Math.abs(hash) % shades.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
    <rect width="200" height="200" fill="${bg}"/>
    <circle cx="100" cy="100" r="64" fill="none" stroke="#2a2a2a" stroke-width="1"/>
    <circle cx="100" cy="100" r="38" fill="none" stroke="#242424" stroke-width="1"/>
    <text x="100" y="114" text-anchor="middle" fill="#686868" font-family="Geist Mono, monospace" font-size="42" font-weight="600">${escapeHtmlStr(initial)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const deezerMemoryCache = new Map();

function fetchDeezerArtistImageJsonp(artistName) {
  if (!artistName || typeof document === 'undefined') return Promise.resolve(null);
  const cleanName = String(artistName).trim();
  if (!cleanName) return Promise.resolve(null);

  const storageKey = `${STORAGE_KEYS.DEEZER_ARTIST_PREFIX}${cleanName.toLowerCase()}`;
  const cached = localStorage.getItem(storageKey);
  if (cached !== null) {
    return Promise.resolve(cached === 'none' ? null : cached);
  }
  if (deezerMemoryCache.has(cleanName.toLowerCase())) {
    return deezerMemoryCache.get(cleanName.toLowerCase());
  }

  const promise = new Promise((resolve) => {
    const cbName = `__centuryDeezerCb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      try {
        delete window[cbName];
      } catch {
        window[cbName] = undefined;
      }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    }, 4500);

    window[cbName] = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      const first = data?.data?.[0];
      const pic = first?.picture_xl || first?.picture_big || first?.picture_medium || null;
      if (pic && !pic.includes('/artist//')) {
        try {
          localStorage.setItem(storageKey, pic);
        } catch {}
        resolve(pic);
      } else {
        try {
          localStorage.setItem(storageKey, 'none');
        } catch {}
        resolve(null);
      }
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(null);
    };

    script.src = `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}&limit=1&output=jsonp&callback=${cbName}`;
    document.head.appendChild(script);
  });

  deezerMemoryCache.set(cleanName.toLowerCase(), promise);
  return promise;
}

// ============================================================================
// 4. Multi-Provider Lyrics Engine (runs in the browser) + Word Sync + Romaji/EN
// ============================================================================
const LYRICS_PROVIDERS_META = [
  { id: 'lrclib', name: 'LRCLIB', bestKind: 'synced' },
  { id: 'netease', name: 'NetEase Music', bestKind: 'word-synced' },
  { id: 'kugou', name: 'KuGou', bestKind: 'synced' },
  { id: 'qq', name: 'QQ Music', bestKind: 'synced' },
  { id: 'unison', name: 'Unison', bestKind: 'word-synced' },
  { id: 'lrcred', name: 'lrc.red', bestKind: 'word-synced' },
  { id: 'lyricsplus', name: 'LyricsPlus', bestKind: 'word-synced' },
  { id: 'amll', name: 'AMLL', bestKind: 'synced' },
];

const DEFAULT_LYRICS_PRIORITY = LYRICS_PROVIDERS_META.map((p) => p.id);
const PROVIDER_TIMEOUT_MS = 8000;

// ---- Parsers ---------------------------------------------------------------
function parseLrc(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const result = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  let offsetMs = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const offsetMatch = trimmed.match(/\[offset:\s*([+-]?\d+)\]/i);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }
    const matches = [...trimmed.matchAll(timeRegex)];
    if (matches.length === 0) continue;
    const text = trimmed.replace(timeRegex, '').trim();
    if (!text) continue;
    for (const match of matches) {
      const frac = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const t = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + frac / 1000 + offsetMs / 1000;
      result.push({ t: Math.max(0, Math.round(t * 1000) / 1000), text });
    }
  }
  return result.sort((a, b) => a.t - b.t);
}

// Fill in missing word end-times and expose both `t` and `timeSeconds` on every line
function normalizeLyricLines(rawLines) {
  if (!Array.isArray(rawLines)) return [];
  const lines = rawLines
    .map((line) => {
      const t = typeof line.t === 'number' ? line.t : typeof line.timeSeconds === 'number' ? line.timeSeconds : 0;
      const out = {
        t,
        timeSeconds: t,
        text: String(line.text ?? ''),
        words: Array.isArray(line.words) && line.words.length > 0
          ? line.words.map((w) => ({ t: w.t, end: w.end, text: String(w.text ?? '') }))
          : undefined,
      };
      // Preserve relay metadata (BG-vocal flag, duet agent, song part) — the relay
      // splits inline BG vocals and flags them; dropping isBG here would lose them.
      if (line.isBG) out.isBG = true;
      if (line.agent) out.agent = line.agent;
      if (line.part) out.part = line.part;
      return out;
    })
    .sort((a, b) => a.t - b.t);

  lines.forEach((line, idx) => {
    if (!line.words) return;
    const lineEnd = lines[idx + 1] ? lines[idx + 1].t : line.t + 5;
    line.words.forEach((w, wi) => {
      if (typeof w.end !== 'number' || w.end <= w.t) {
        const nextT = line.words[wi + 1] ? line.words[wi + 1].t : lineEnd;
        w.end = Math.max(w.t + 0.2, Math.min(nextT, w.t + 2));
      }
    });
  });
  return lines;
}

function findActiveLineIndex(lines, currentTimeSeconds) {
  if (!lines || lines.length === 0) return -1;
  if (currentTimeSeconds < (lines[0].timeSeconds ?? lines[0].t ?? 0)) return -1;
  let low = 0;
  let high = lines.length - 1;
  let best = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lines[mid].timeSeconds ?? lines[mid].t ?? 0) <= currentTimeSeconds) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

// Active LEAD line index: like findActiveLineIndex, but a background-vocal line
// never becomes the active line — its parent lead (scan backward) stays active.
// A BG line with no parent renders as a normal lead, so it IS the active line.
// Returns -1 when nothing has started yet.
function findActiveLeadIndex(lines, currentTimeSeconds) {
  let idx = findActiveLineIndex(lines, currentTimeSeconds);
  while (idx >= 0 && lines[idx] && lines[idx].isBG) {
    const parent = findBgParentIndex(lines, idx);
    if (parent < 0) break;
    idx = parent;
  }
  return idx;
}

// Parent lead index of a BG line: the nearest preceding non-BG line.
// Returns -1 when the BG line has no parent (e.g. it is the first line) —
// such a line renders as a normal lead line (defensive rule for a stray
// first-line isBG flag from the relay).
function findBgParentIndex(lines, bgIdx) {
  for (let i = bgIdx - 1; i >= 0; i--) {
    if (lines[i] && !lines[i].isBG) return i;
  }
  return -1;
}

// End time of a lyric line: the last word's START time.
// (Century's getLineEnd uses word start + duration, with duration defaulting
// to 0 — the relay's words carry no duration, so the start is the honest end.
// Using the normalizeLyricLines fill-in end (up to +2s) would overestimate
// the line end and shrink the outro gap below the 10s threshold.)
function lyricLineEnd(line) {
  if (!line) return 0;
  if (Array.isArray(line.words) && line.words.length > 0) {
    const last = line.words[line.words.length - 1];
    if (typeof last.t === 'number') return last.t;
  }
  return line.timeSeconds ?? line.t ?? 0;
}

// Instrumental gaps: stretches >= 10s with no lyric line. Three kinds:
// intro [0, firstLine.t], inter-line [prevLineEnd, nextLine.t], and outro
// [lastLineEnd, duration]. Returns [{ start, end, afterLineIndex }].
// afterLineIndex is -1 for the intro gap, else the line the gap follows.
const INSTRUMENTAL_GAP_THRESHOLD_SEC = 10;
function findInstrumentalGaps(lines, duration = 0) {
  const gaps = [];
  if (!Array.isArray(lines) || lines.length === 0) return gaps;

  const firstStart = lines[0].timeSeconds ?? lines[0].t ?? 0;
  if (firstStart >= INSTRUMENTAL_GAP_THRESHOLD_SEC) {
    gaps.push({ start: 0, end: firstStart, afterLineIndex: -1 });
  }

  for (let i = 0; i < lines.length - 1; i++) {
    const end = lyricLineEnd(lines[i]);
    const nextStart = lines[i + 1].timeSeconds ?? lines[i + 1].t ?? 0;
    if (nextStart - end >= INSTRUMENTAL_GAP_THRESHOLD_SEC) {
      gaps.push({ start: end, end: nextStart, afterLineIndex: i });
    }
  }

  const lastEnd = lyricLineEnd(lines[lines.length - 1]);
  if (duration > 0 && duration - lastEnd >= INSTRUMENTAL_GAP_THRESHOLD_SEC) {
    gaps.push({ start: lastEnd, end: duration, afterLineIndex: lines.length - 1 });
  }

  return gaps;
}

// ---- Built-in Hepburn kana-to-romaji (offline fallback) ----------------------
const KANA_DIGRAPHS = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
};

const KANA_MONOGRAPHS = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ー: '-',
};

function katakanaToHiragana(str) {
  return String(str || '').replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function kanaToRomaji(input) {
  const hira = katakanaToHiragana(input);
  let out = '';
  let i = 0;
  while (i < hira.length) {
    const ch = hira[i];
    if (ch === 'っ') {
      const nextRom = KANA_DIGRAPHS[hira.slice(i + 1, i + 3)] || KANA_MONOGRAPHS[hira[i + 1]] || '';
      if (nextRom && /^[a-z]/.test(nextRom)) out += nextRom[0];
      i += 1;
      continue;
    }
    const two = hira.slice(i, i + 2);
    if (KANA_DIGRAPHS[two]) {
      out += KANA_DIGRAPHS[two];
      i += 2;
      continue;
    }
    if (KANA_MONOGRAPHS[ch]) {
      out += KANA_MONOGRAPHS[ch];
      i += 1;
      continue;
    }
    out += input[i];
    i += 1;
  }
  return out;
}

const CREDIT_TAG_REGEX =
  /^\s*(作詞|作曲|編曲|歌|唄|VOCAL|LYRICS?|MUSIC|ARRANGEMENT|PRODUCED BY|COMPOSED BY|WRITTEN BY)\s*[:：]/i;

function cleanCreditTags(text) {
  const s = String(text || '').trim();
  if (!s || CREDIT_TAG_REGEX.test(s)) return '';
  return s;
}

function hasJapaneseScript(lines) {
  return Array.isArray(lines) && lines.some((l) => JAPANESE_CHAR_REGEX.test(String(l.text || '')));
}

// Builds romaji and English line arrays for Japanese lyrics (Google Translate + kana fallback), cached per song
async function processJapaneseLyrics(lines, songId) {
  if (!Array.isArray(lines) || lines.length === 0) return { romaji: null, en: null };

  const romajiKey = songId ? `${STORAGE_KEYS.LYRICS_ROMAJI_PREFIX}${songId}` : null;
  const enKey = songId ? `${STORAGE_KEYS.LYRICS_EN_PREFIX}${songId}` : null;

  if (romajiKey && enKey) {
    try {
      const r = JSON.parse(localStorage.getItem(romajiKey) || 'null');
      const e = JSON.parse(localStorage.getItem(enKey) || 'null');
      if (Array.isArray(r) && r.length === lines.length && Array.isArray(e) && e.length === lines.length) {
        return { romaji: r, en: e };
      }
    } catch {
      // Ignore parse error
    }
  }

  const romajiTexts = new Array(lines.length);
  const enTexts = new Array(lines.length);
  const indexes = lines.map((_, i) => i);

  await runPool(indexes, 4, async (i) => {
    const raw = cleanCreditTags(lines[i].text);
    if (!raw) {
      romajiTexts[i] = '';
      enTexts[i] = '';
      return;
    }
    if (!JAPANESE_CHAR_REGEX.test(raw)) {
      romajiTexts[i] = raw;
      enTexts[i] = raw;
      return;
    }
    const g = await googleTranslate(raw, 'ja');
    romajiTexts[i] = g.romaji || kanaToRomaji(raw);
    enTexts[i] = g.english || raw;
  });

  const romaji = lines.map((l, i) => ({ t: l.t, timeSeconds: l.timeSeconds ?? l.t, text: romajiTexts[i] }));
  const en = lines.map((l, i) => ({ t: l.t, timeSeconds: l.timeSeconds ?? l.t, text: enTexts[i] }));

  if (romajiKey && enKey) {
    try {
      localStorage.setItem(romajiKey, JSON.stringify(romaji));
      localStorage.setItem(enKey, JSON.stringify(en));
    } catch {
      // Ignore quota errors
    }
  }
  return { romaji, en };
}

class LyricsManager {
  constructor() {
    this.cache = new Map();
  }

  getPriorityOrder() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LYRICS_PRIORITY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = parsed.filter((id) => DEFAULT_LYRICS_PRIORITY.includes(id));
          for (const id of DEFAULT_LYRICS_PRIORITY) if (!merged.includes(id)) merged.push(id);
          return merged;
        }
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
    if (!providerId || providerId === 'auto') localStorage.removeItem(key);
    else localStorage.setItem(key, providerId);
  }

  getTrackMode(trackId) {
    const mode = trackId ? localStorage.getItem(`${STORAGE_KEYS.LYRICS_MODE_PREFIX}${trackId}`) : null;
    return mode === 'romaji' || mode === 'en' ? mode : 'original';
  }

  setTrackMode(trackId, mode) {
    if (!trackId) return;
    const key = `${STORAGE_KEYS.LYRICS_MODE_PREFIX}${trackId}`;
    if (!mode || mode === 'original') localStorage.removeItem(key);
    else localStorage.setItem(key, mode);
  }

  // --- Global lyrics display toggles (Century model, L-1) ---
  // The original line is ALWAYS shown. Romaji and Translated render as
  // sub-lines under it, controlled by these two global prefs (not a
  // per-track exclusive mode). Romaji defaults ON, Translated OFF.
  getShowRomaji() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LYRICS_PREF_ROMAJI);
      return raw === null ? true : raw === '1' || raw === 'true';
    } catch {
      return true;
    }
  }

  setShowRomaji(value) {
    try {
      localStorage.setItem(STORAGE_KEYS.LYRICS_PREF_ROMAJI, value ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }

  getShowTranslated() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LYRICS_PREF_TRANSLATED);
      return raw === null ? false : raw === '1' || raw === 'true';
    } catch {
      return false;
    }
  }

  setShowTranslated(value) {
    try {
      localStorage.setItem(STORAGE_KEYS.LYRICS_PREF_TRANSLATED, value ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }

  // One-time migration from the old per-track exclusive mode
  // (century.lyrics.mode.<trackId> = 'romaji' | 'en'). A legacy 'romaji'
  // mode turns the global Romaji pref on; 'en' turns Translated on.
  // The per-track key is deleted after migration.
  migrateLegacyTrackMode(trackId) {
    if (!trackId) return;
    const key = `${STORAGE_KEYS.LYRICS_MODE_PREFIX}${trackId}`;
    let legacy = null;
    try {
      legacy = localStorage.getItem(key);
    } catch {
      return;
    }
    if (legacy === 'romaji') this.setShowRomaji(true);
    else if (legacy === 'en') this.setShowTranslated(true);
    else return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage errors
    }
  }

  getTrackOffset(trackId) {
    if (!trackId) return 0;
    const num = parseFloat(localStorage.getItem(`${STORAGE_KEYS.LYRICS_OFFSET_PREFIX}${trackId}`) || '0');
    return Number.isNaN(num) ? 0 : Math.round(num * 10) / 10;
  }

  setTrackOffset(trackId, offsetSec) {
    if (!trackId) return;
    const clean = Math.round(offsetSec * 10) / 10;
    const key = `${STORAGE_KEYS.LYRICS_OFFSET_PREFIX}${trackId}`;
    if (Math.abs(clean) < 0.01) localStorage.removeItem(key);
    else localStorage.setItem(key, String(clean));
  }

  cacheKey(req, providerId) {
    return `${providerId}|${(req.title || '').toLowerCase()}|${(req.artist || '').toLowerCase()}|${Math.round(req.durationSeconds || 0)}`;
  }

  // Query one provider via the lyrics relay (plenrip-relay, port 3005).
  // The relay does provider fetching, parsing, scoring, QRC/KRC word sync,
  // BG split, and romaji/EN derivation. Result status: 'ok' | 'not_found' | 'unreachable'
  async fetchFromProvider(providerId, req, { force = false } = {}) {
    const meta = LYRICS_PROVIDERS_META.find((p) => p.id === providerId) || { id: providerId, name: providerId };
    const key = this.cacheKey(req, providerId);
    if (!force && this.cache.has(key)) return this.cache.get(key);

    const result = await this.fetchRelayLyrics(req, providerId, meta);
    if (result.status !== 'unreachable') this.cache.set(key, result);
    return result;
  }

  // Lyrics display settings (Settings > Lyrics). Defaults: word sweep on,
  // BG-vocal split on. Stored per key under century.lyrics.display.*.
  getLyricsDisplay(key, defaultValue) {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEYS.LYRICS_DISPLAY_PREFIX}${key}`);
      if (raw === null) return defaultValue;
      return raw === 'true';
    } catch {
      return defaultValue;
    }
  }

  setLyricsDisplay(key, value) {
    try {
      localStorage.setItem(`${STORAGE_KEYS.LYRICS_DISPLAY_PREFIX}${key}`, value ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }

  getWordSweep() {
    return this.getLyricsDisplay('wordSweep', true);
  }

  setWordSweep(value) {
    this.setLyricsDisplay('wordSweep', value);
  }

  getSplitBackground() {
    return this.getLyricsDisplay('splitBackground', true);
  }

  setSplitBackground(value) {
    this.setLyricsDisplay('splitBackground', value);
  }

  // Focus-mode display settings (Century lyricsStore defaults).
  getManualScrollPause() {
    return this.getLyricsDisplay('manualScrollPause', true);
  }

  setManualScrollPause(value) {
    this.setLyricsDisplay('manualScrollPause', value);
  }

  getHidePlayed() {
    return this.getLyricsDisplay('hidePlayed', false);
  }

  setHidePlayed(value) {
    this.setLyricsDisplay('hidePlayed', value);
  }

  getHideUpcoming() {
    return this.getLyricsDisplay('hideUpcoming', false);
  }

  setHideUpcoming(value) {
    this.setLyricsDisplay('hideUpcoming', value);
  }

  // Clear the lyrics cache + all derived romaji/EN readings (Settings).
  clearLyricsCache() {
    this.cache.clear();
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('century.lyrics.en.') || k.startsWith('century.lyrics.romaji.'))) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      // Ignore storage errors
    }
  }

  // Lyrics relay base URL (plenrip-relay, defaults to '' for relative paths like /api/lyrics).
  // Overridable via localStorage (STORAGE_KEYS.LYRICS_RELAY_URL).
  getRelayBaseUrl() {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.LYRICS_RELAY_URL);
      if (saved && saved.trim()) {
        const trimmed = saved.trim().replace(/\/+$/, '');
        // On HTTPS, strip plain http://localhost:3005 to prevent mixed content & macOS IPv6 drops
        if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
          return '';
        }
        // If explicitly saved as the old default http://localhost:3005, use relative path
        if (/^http:\/\/(localhost|127\.0\.0\.1):3005$/i.test(trimmed)) {
          return '';
        }
        return trimmed;
      }
    } catch {
      // Ignore storage errors
    }
    // Return empty string to swap to relative path (/api/lyrics?...)
    return '';
  }

  // One relay request. providerId null = auto (the relay picks the winner).
  // Returns a result in the same shape fetchFromProvider used to return,
  // plus romajiLines / translationLines when the relay provides them.
  async fetchRelayLyrics(req, providerId, meta) {
    const params = new URLSearchParams();
    if (req.title) params.set('title', req.title.trim());
    if (req.artist) params.set('artist', req.artist.trim());
    if (req.album) params.set('album', req.album.trim());
    if (req.durationSeconds) params.set('duration', String(Math.round(req.durationSeconds)));
    if (providerId) params.set('provider', providerId);

    const fallbackName = (meta && meta.name) || providerId || 'Auto';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.getRelayBaseUrl()}/api/lyrics?${params.toString()}`, { signal: controller.signal });
      // The relay returns 404 {"error":"not_found"} BY DESIGN when a
      // provider has no lyrics for the track — that is a clean miss, not
      // a dead relay. Only non-404 failures are 'unreachable'.
      if (res.status === 404) {
        return { providerId: providerId || 'lrclib', providerName: fallbackName, kind: 'plain', status: 'not_found' };
      }
      if (!res.ok) throw new Error(`relay ${res.status}`);
      const data = await res.json();
      if (data && Array.isArray(data.lines) && data.lines.length > 0) {
        const lines = normalizeLyricLines(data.lines);
        return {
          providerId: providerId || this.providerIdFromName(data.provider),
          providerName: data.provider || fallbackName,
          kind: data.synced ? 'synced' : 'plain',
          lines: data.synced ? lines : undefined,
          plainText: data.synced ? undefined : lines.map((l) => l.text).join('\n'),
          hasWordSync: Boolean(data.hasWordSync),
          romajiLines: Array.isArray(data.romajiLines) ? data.romajiLines : undefined,
          translationLines: Array.isArray(data.translationLines) ? data.translationLines : undefined,
          status: 'ok',
        };
      }
      return { providerId: providerId || 'lrclib', providerName: fallbackName, kind: 'plain', status: 'not_found' };
    } catch {
      // Relay down, timeout, or network failure
      return { providerId: providerId || 'lrclib', providerName: fallbackName, kind: 'plain', status: 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }

  // Map a relay provider display name (e.g. "QQ Music", "lrc.red") back to a provider id.
  providerIdFromName(name) {
    if (!name) return 'lrclib';
    const hit = LYRICS_PROVIDERS_META.find((p) => p.name === name || p.id === name);
    return hit ? hit.id : String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Query all providers in parallel; onUpdate(providerId, result) fires as each one settles
  async probeAll(req, onUpdate = null, options = {}) {
    const map = {};
    await Promise.all(
      LYRICS_PROVIDERS_META.map(async (p) => {
        const res = await this.fetchFromProvider(p.id, req, options);
        map[p.id] = res;
        if (onUpdate) onUpdate(p.id, res);
      })
    );
    return map;
  }

  // Derive romaji + EN readings via the relay (kuroshiro / Gemini / Google, server-side).
  // Returns { romaji, en } in the same shape as processJapaneseLyrics
  // (arrays of { t, timeSeconds, text }, one entry per input line), with a
  // side set to null when that derivation failed. The relay caches server-side.
  async deriveReadings(lines, songId) {
    if (!Array.isArray(lines) || lines.length === 0) return { romaji: null, en: null };
    const texts = lines.map((l) => l.text || '');
    const toItems = (arr) => lines.map((l, i) => ({ t: l.t, timeSeconds: l.timeSeconds ?? l.t, text: arr[i] ?? '' }));

    const [romajiRes, enRes] = await Promise.all([
      (async () => {
        try {
          const controller = new AbortController();
          // 30s, same as the EN endpoint: the relay's kuroshiro analyzer
          // (kuromoji dictionary) is slow to initialise on a cold relay,
          // and a 10s timeout aborted the first romaji derivation, leaving
          // the Romaji toggle with nothing to show.
          const timer = setTimeout(() => controller.abort(), 30000);
          const res = await fetch(`${this.getRelayBaseUrl()}/api/romaji`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines: texts, songId: songId || '' }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) return null;
          const data = await res.json();
          return Array.isArray(data?.lines) && data.lines.length === lines.length ? toItems(data.lines) : null;
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30000);
          const res = await fetch(`${this.getRelayBaseUrl()}/api/translate-en`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lines: texts, songId: songId || '' }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) return null;
          const data = await res.json();
          return Array.isArray(data?.lines) && data.lines.length === lines.length ? toItems(data.lines) : null;
        } catch {
          return null;
        }
      })(),
    ]);
    return { romaji: romajiRes, en: enRes };
  }

  // Turn a manual LRCLIB search hit into a lyrics result
  async searchLrcLibManual(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    try {
      const data = await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {}, 7000);
      if (!Array.isArray(data)) return [];
      return data.filter((item) => item.syncedLyrics || item.plainLyrics).slice(0, 20);
    } catch {
      return [];
    }
  }

  applyManualLrcLibCandidate(candidate) {
    const synced = candidate.syncedLyrics ? parseLrc(candidate.syncedLyrics) : [];
    const lines = synced.length > 0 ? normalizeLyricLines(synced) : undefined;
    return {
      providerId: 'lrclib',
      providerName: 'LRCLIB (Manual)',
      kind: lines ? 'synced' : 'plain',
      lines,
      plainText: lines ? undefined : candidate.plainLyrics || candidate.syncedLyrics,
      hasWordSync: false,
      status: 'ok',
    };
  }

  // Auto mode: one relay request — the relay picks the winner
  // (scoring + timing agreement, server-side). No browser-side probing.
  async resolveLyrics(req) {
    const override = this.getTrackProviderOverride(req.trackId);
    if (override && override !== 'auto') return this.fetchFromProvider(override, req);

    const key = this.cacheKey(req, 'auto');
    if (this.cache.has(key)) return this.cache.get(key);
    const result = await this.fetchRelayLyrics(req, null, null);
    if (result.status !== 'unreachable') this.cache.set(key, result);
    return result;
  }
}

// ============================================================================
// 5. Honest History Store & Resume Positions (Continue Listening, Forgotten Favourites, Listen Again, Quick Pick)
// ============================================================================
class HistoryStore {
  constructor() {
    this.maxEntries = 10000;
    this.entries = this.load();
    this.positions = this.loadPositions();
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

  loadPositions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PLAYBACK_POSITIONS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  savePositions() {
    try {
      localStorage.setItem(STORAGE_KEYS.PLAYBACK_POSITIONS, JSON.stringify(this.positions));
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

  savePlaybackPosition(song, positionSeconds, durationSeconds) {
    if (!song || !song.id) return;
    const dur = durationSeconds || song.duration || 0;
    if (dur <= 0) return;
    const ratio = positionSeconds / dur;
    if (positionSeconds > 15 && ratio < 0.9) {
      this.positions[song.id] = {
        song,
        positionSeconds: Math.floor(positionSeconds),
        durationSeconds: Math.floor(dur),
        updatedAt: Date.now(),
      };
      // Keep max 30 saved positions
      const keys = Object.keys(this.positions);
      if (keys.length > 30) {
        keys
          .sort((a, b) => (this.positions[a].updatedAt || 0) - (this.positions[b].updatedAt || 0))
          .slice(0, keys.length - 30)
          .forEach((k) => delete this.positions[k]);
      }
      this.savePositions();
    } else if (ratio >= 0.9 && this.positions[song.id]) {
      delete this.positions[song.id];
      this.savePositions();
    }
  }

  clearPlaybackPosition(songId) {
    if (!songId || !this.positions[songId]) return;
    delete this.positions[songId];
    this.savePositions();
  }

  getSavedPosition(songId) {
    return songId ? this.positions[songId] || null : null;
  }

  // Section 1: Continue Listening (in-progress tracks with >15s and <90% completion)
  getContinueListening(currentSongId = null, limit = 6) {
    return Object.values(this.positions)
      .filter((item) => item && item.song && item.song.id !== currentSongId)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, limit);
  }

  // Section 2: Forgotten Favourite? (starred tracks not played in 14+ days or never played)
  getForgottenFavourites(starredSongs = [], limit = 6) {
    if (!Array.isArray(starredSongs) || starredSongs.length === 0) return [];
    const lastPlayedMap = new Map();
    for (const e of this.entries) {
      const prev = lastPlayedMap.get(e.songId) || 0;
      if (e.playedAt > prev) lastPlayedMap.set(e.songId, e.playedAt);
    }

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const candidates = [];

    for (const song of starredSongs) {
      if (!song || !song.id) continue;
      const lastPlayed = lastPlayedMap.get(song.id) || 0;
      if (lastPlayed === 0 || now - lastPlayed >= thirtyDaysMs) {
        const daysAgo = lastPlayed === 0 ? null : Math.floor((now - lastPlayed) / (24 * 60 * 60 * 1000));
        candidates.push({
          song,
          lastPlayed,
          badge: daysAgo ? `last played ${daysAgo} days ago` : 'never played',
        });
      }
    }

    candidates.sort((a, b) => a.lastPlayed - b.lastPlayed);
    return candidates.slice(0, limit);
  }

  // Section 3: Listen Again (tracks with >= 2 recorded plays where most recent play was > 7 days ago)
  getListenAgain(songMap = new Map(), limit = 6) {
    const stats = new Map();
    for (const e of this.entries) {
      if (!e.songId) continue;
      const cur = stats.get(e.songId) || { count: 0, lastPlayed: 0 };
      cur.count += 1;
      if (e.playedAt > cur.lastPlayed) cur.lastPlayed = e.playedAt;
      stats.set(e.songId, cur);
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const results = [];

    for (const [songId, info] of stats.entries()) {
      if (info.count >= 2 && now - info.lastPlayed > sevenDaysMs) {
        const song = songMap.get(songId);
        if (song) {
          results.push({
            song,
            playCount: info.count,
            lastPlayed: info.lastPlayed,
          });
        }
      }
    }

    results.sort((a, b) => b.playCount - a.playCount || b.lastPlayed - a.lastPlayed);
    return results.slice(0, limit);
  }

  // Section 4: Quick Pick (deterministic daily selection from starred songs + history)
  getQuickPick(starredSongs = [], songMap = new Map(), limit = 9) {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const poolMap = new Map();
    for (const s of starredSongs || []) {
      if (s && s.id) poolMap.set(s.id, s);
    }
    for (const e of this.entries) {
      if (e.songId && songMap.has(e.songId)) {
        poolMap.set(e.songId, songMap.get(e.songId));
      }
    }

    const pool = Array.from(poolMap.values());
    if (pool.length === 0) return [];

    try {
      const savedDate = localStorage.getItem(STORAGE_KEYS.QUICKPICK_DATE);
      const savedSongsRaw = localStorage.getItem(STORAGE_KEYS.QUICKPICK_SONGS);
      if (savedDate === todayStr && savedSongsRaw) {
        const savedIds = JSON.parse(savedSongsRaw);
        if (Array.isArray(savedIds) && savedIds.length > 0) {
          const resolved = savedIds.map((id) => poolMap.get(id) || songMap.get(id)).filter(Boolean);
          if (resolved.length > 0) return resolved.slice(0, limit);
        }
      }
    } catch {
      // Ignore parse error
    }

    const shuffled = seededShuffle(pool, `century-quickpick-${todayStr}`).slice(0, limit);
    try {
      localStorage.setItem(STORAGE_KEYS.QUICKPICK_DATE, todayStr);
      localStorage.setItem(STORAGE_KEYS.QUICKPICK_SONGS, JSON.stringify(shuffled.map((s) => s.id)));
    } catch {}
    return shuffled;
  }

  clear() {
    this.entries = [];
    this.positions = {};
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
    localStorage.removeItem(STORAGE_KEYS.PLAYBACK_POSITIONS);
    localStorage.removeItem(STORAGE_KEYS.QUICKPICK_DATE);
    localStorage.removeItem(STORAGE_KEYS.QUICKPICK_SONGS);
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

// Balanced shuffle avoiding consecutive songs by the same artist
// Shuffle helper: balanced (spread same-artist tracks apart) only when
// the setting is on (Century default OFF); otherwise plain Fisher-Yates.
function getBalancedShuffle() {
  return localStorage.getItem(STORAGE_KEYS.BALANCED_SHUFFLE) === 'true';
}

function shuffleSongs(songs) {
  if (!Array.isArray(songs) || songs.length <= 2) return [...(songs || [])];
  if (getBalancedShuffle()) return balancedShuffle(songs);
  const copy = [...songs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function balancedShuffle(songs) {
  if (!Array.isArray(songs) || songs.length <= 2) return [...(songs || [])];
  const copy = [...songs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  // Spread out consecutive tracks by the same artist where possible
  for (let i = 1; i < copy.length; i++) {
    const prevArtist = copy[i - 1]?.artistId || copy[i - 1]?.artist;
    const curArtist = copy[i]?.artistId || copy[i]?.artist;
    if (prevArtist && curArtist && prevArtist === curArtist) {
      for (let swapIdx = i + 1; swapIdx < copy.length; swapIdx++) {
        const candArtist = copy[swapIdx]?.artistId || copy[swapIdx]?.artist;
        if (candArtist !== prevArtist) {
          [copy[i], copy[swapIdx]] = [copy[swapIdx], copy[i]];
          break;
        }
      }
    }
  }
  return copy;
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
    const cid = s.coverArt || s.albumId;
    if (cid && !uniqueCoverIds.includes(cid)) {
      uniqueCoverIds.push(cid);
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

    ctx.fillStyle = '#161616';
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
// 7. Dual-Deck Gapless + Web Audio ReplayGain Engine
// ============================================================================
function continuesAlbum(fromSong, toSong) {
  if (!fromSong || !toSong) return false;
  if (!fromSong.albumId || fromSong.albumId !== toSong.albumId) return false;
  const fromDisc = fromSong.discNumber || 1;
  const toDisc = toSong.discNumber || 1;
  if (fromDisc !== toDisc) return false;
  if (typeof fromSong.track === 'number' && typeof toSong.track === 'number') {
    return toSong.track === fromSong.track + 1;
  }
  return false;
}

class GaplessAudioEngine {
  constructor(client, historyStore, onStateChange, onPlaybackError) {
    this.client = client;
    this.historyStore = historyStore;
    this.onStateChange = onStateChange || (() => {});
    // Called when a deck fails to play a stream (network / decode / server
    // error). Century decks.ts: the 'error' event + play() rejections route
    // here; autoplay-policy DOMExceptions are NOT real failures.
    this.onPlaybackError = onPlaybackError || (() => {});
    this.lastPlaybackError = null;
    // Radio / autoplay (Century M1, default ON): when the queue runs out
    // and repeat is off, the app supplies similar tracks so playback
    // continues. Set by the app (it owns the library); the engine only
    // decides WHEN to ask.
    this.onAutoplayNeeded = null;
    this.autoplay = this.loadAutoplay();
    this._autoplayPending = false;

    this.deckA = new Audio();
    this.deckB = new Audio();
    this.deckA.crossOrigin = 'anonymous';
    this.deckB.crossOrigin = 'anonymous';
    this.deckA.preload = 'auto';
    this.deckB.preload = 'metadata';

    this.activeDeckKey = 'A';
    this.preloadedNextSongId = null;
    this.isCrossfading = false;
    this.isSeeking = false;
    this.fadeInterval = null;

    // Web Audio API graph for ReplayGain & Pre-amp (> 1.0 gain support)
    this.audioCtx = null;
    this.gainNodeA = null;
    this.gainNodeB = null;
    this.masterGainNode = null;
    this.webAudioReady = false;

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

    this.normalization = localStorage.getItem(STORAGE_KEYS.NORMALIZATION) || 'auto';
    const savedPreamp = parseFloat(localStorage.getItem(STORAGE_KEYS.PREAMP) || '0');
    this.preampDb = Number.isNaN(savedPreamp) ? 0 : Math.max(-12, Math.min(12, savedPreamp));
    this.streamQuality = localStorage.getItem(STORAGE_KEYS.STREAM_QUALITY) || 'auto';
    this.outputDeviceId = localStorage.getItem(STORAGE_KEYS.OUTPUT_DEVICE) || 'default';

    // Wall-clock listening accumulator & periodic position saving
    this.recordedHistoryForTrack = null;
    this.listenedMs = 0;
    this.lastTimeUpdatePerfMs = 0;
    this.lastSavedPositionSec = 0;

    this.bindDeckEvents('A', this.deckA);
    this.bindDeckEvents('B', this.deckB);
    this.setupMediaSession();

    if (this.outputDeviceId && this.outputDeviceId !== 'default') {
      this.setOutputDevice(this.outputDeviceId);
    }
  }

  ensureWebAudioGraph() {
    if (this.webAudioReady) {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioCtx = new AudioContextClass();
      const sourceA = this.audioCtx.createMediaElementSource(this.deckA);
      const sourceB = this.audioCtx.createMediaElementSource(this.deckB);
      this.gainNodeA = this.audioCtx.createGain();
      this.gainNodeB = this.audioCtx.createGain();
      this.masterGainNode = this.audioCtx.createGain();

      sourceA.connect(this.gainNodeA);
      sourceB.connect(this.gainNodeB);
      this.gainNodeA.connect(this.masterGainNode);
      this.gainNodeB.connect(this.masterGainNode);
      this.masterGainNode.connect(this.audioCtx.destination);

      this.deckA.volume = 1;
      this.deckB.volume = 1;
      this.masterGainNode.gain.value = this.volume;
      this.webAudioReady = true;
      this.applyActiveDeckGain();
    } catch {
      this.webAudioReady = false;
    }
  }

  computeGainFactor(song) {
    if (!song || this.normalization === 'off') return 1.0;

    const rg = song.replayGain || {};
    const trackGain = typeof rg.trackGain === 'number' ? rg.trackGain : typeof song.trackGain === 'number' ? song.trackGain : null;
    const albumGain = typeof rg.albumGain === 'number' ? rg.albumGain : typeof song.albumGain === 'number' ? song.albumGain : null;
    const trackPeak = typeof rg.trackPeak === 'number' ? rg.trackPeak : typeof song.trackPeak === 'number' ? song.trackPeak : 1.0;
    const albumPeak = typeof rg.albumPeak === 'number' ? rg.albumPeak : typeof song.albumPeak === 'number' ? song.albumPeak : 1.0;

    let gainDb = 0;
    let peak = 1.0;

    if (this.normalization === 'track') {
      gainDb = trackGain ?? albumGain ?? 0;
      peak = trackPeak || 1.0;
    } else if (this.normalization === 'album') {
      gainDb = albumGain ?? trackGain ?? 0;
      peak = albumPeak || trackPeak || 1.0;
    } else {
      // 'auto': use album gain when playing consecutive album tracks, otherwise track gain
      const nextIdx = this.getNextQueueIndex();
      const nextSong = nextIdx !== -1 ? this.queue[nextIdx] : null;
      const prevSong = this.currentIndex > 0 ? this.queue[this.currentIndex - 1] : null;
      const inAlbumRun = continuesAlbum(prevSong, song) || continuesAlbum(song, nextSong);
      if (inAlbumRun && albumGain !== null) {
        gainDb = albumGain;
        peak = albumPeak || 1.0;
      } else {
        gainDb = trackGain ?? albumGain ?? 0;
        peak = trackPeak || 1.0;
      }
    }

    const totalDb = gainDb + (this.preampDb || 0);
    let linear = Math.pow(10, totalDb / 20);
    if (peak > 0 && linear * peak > 1.0) {
      linear = 1.0 / peak;
    }
    return Math.max(0.05, Math.min(3.5, linear));
  }

  setDeckGain(deckKey, fadeMultiplier = 1.0, songOverride = null) {
    const song = songOverride || this.currentSong;
    const rgFactor = this.computeGainFactor(song);
    const deck = deckKey === 'A' ? this.deckA : this.deckB;
    const gainNode = deckKey === 'A' ? this.gainNodeA : this.gainNodeB;

    if (this.webAudioReady && gainNode && this.masterGainNode) {
      this.masterGainNode.gain.value = this.volume;
      gainNode.gain.value = rgFactor * fadeMultiplier;
      deck.volume = 1;
    } else {
      deck.volume = Math.max(0, Math.min(1, this.volume * Math.min(1, rgFactor) * fadeMultiplier));
    }
  }

  applyActiveDeckGain() {
    this.setDeckGain(this.activeDeckKey, 1.0, this.currentSong);
  }

  getActiveDeck() {
    return this.activeDeckKey === 'A' ? this.deckA : this.deckB;
  }

  getIdleDeck() {
    return this.activeDeckKey === 'A' ? this.deckB : this.deckA;
  }

  getIdleDeckKey() {
    return this.activeDeckKey === 'A' ? 'B' : 'A';
  }

  notify() {
    this.onStateChange();
  }

  // Play-failure handling (Century decks.ts `rejected`): a DOMException from
  // play() is an autoplay-policy / user-gesture rejection, NOT a real failure
  // — ignore it. A real stream error (element.error set) means the track
  // cannot play: stop the playing state and report it so the UI can tell
  // the user instead of showing a stuck "playing" bar.
  // Raw-stream retry (Century audioEngine): if a transcoded stream fails
  // (the URL carries format=), retry once with the raw stream URL (the
  // same URL with format/maxBitRate stripped) before giving up. Some
  // servers return 200 + a JSON error for transcoding params instead of a
  // stream — the raw URL is the fallback that actually plays. Returns
  // true when a retry was started.
  retryRawStream(audio) {
    if (!audio || !audio.src || !audio.src.includes('format=')) return false;
    const songId = this.currentSong?.id || '';
    if (this._rawRetrySongId === songId) return false;
    this._rawRetrySongId = songId;
    try {
      const url = new URL(audio.src);
      url.searchParams.delete('format');
      url.searchParams.delete('maxBitRate');
      audio.src = url.toString();
      audio.play().catch((err) => this.handlePlayRejection(err, audio));
      return true;
    } catch {
      return false;
    }
  }

  handlePlayRejection(err, audio) {
    if (err instanceof DOMException && err.name !== 'NotSupportedError') return;
    if (audio && audio.error) {
      // Try the raw stream once before reporting the failure.
      if (this.retryRawStream(audio)) return;
      this.lastPlaybackError = audio.error;
      this.isPlaying = false;
      this.notify();
      this.onPlaybackError(audio.error, this.currentSong);
    }
  }

  bindDeckEvents(deckKey, audio) {
    audio.addEventListener('error', () => {
      if (deckKey !== this.activeDeckKey) return;
      // The active deck failed to load/decode its stream. Try the raw
      // stream once before reporting the failure.
      if (this.retryRawStream(audio)) return;
      this.lastPlaybackError = audio.error;
      this.isPlaying = false;
      this.notify();
      this.onPlaybackError(audio.error, this.currentSong);
    });

    audio.addEventListener('timeupdate', () => {
      if (deckKey !== this.activeDeckKey || this.isSeeking) return;
      const cur = audio.currentTime || 0;
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (this.currentSong?.duration || 0);

      this.currentTime = cur;
      if (dur > 0) this.duration = dur;

      // Accumulate wall-clock listening time
      const nowPerf = performance.now();
      if (this.isPlaying && this.lastTimeUpdatePerfMs > 0) {
        const delta = nowPerf - this.lastTimeUpdatePerfMs;
        if (delta > 0 && delta < 2500) {
          this.listenedMs += delta;
        }
      }
      this.lastTimeUpdatePerfMs = nowPerf;

      // Save playback resume position every 10 seconds
      if (this.currentSong && Math.abs(cur - this.lastSavedPositionSec) >= 10) {
        this.lastSavedPositionSec = cur;
        this.historyStore.savePlaybackPosition(this.currentSong, cur, dur);
      }

      // Record listening history after 30 seconds of actual listening
      if (this.currentSong && this.listenedMs >= 30000 && this.recordedHistoryForTrack !== this.currentSong.id) {
        this.recordedHistoryForTrack = this.currentSong.id;
        this.historyStore.recordPlay({
          songId: this.currentSong.id,
          artistId: this.currentSong.artistId || '',
          albumId: this.currentSong.albumId || '',
          playedAt: Date.now(),
          playDurationMs: Math.round(this.listenedMs),
        });
      }

      // Trigger equal-power crossfade when entering crossfade window (suppressed on consecutive same-album tracks)
      if (
        this.crossfadeSeconds > 0 &&
        !this.isCrossfading &&
        dur > this.crossfadeSeconds + 2 &&
        dur - cur <= this.crossfadeSeconds
      ) {
        const nextIdx = this.getNextQueueIndex();
        const nextSong = nextIdx !== -1 ? this.queue[nextIdx] : null;
        if (
          nextIdx !== -1 &&
          this.repeatMode !== 'one' &&
          !continuesAlbum(this.currentSong, nextSong)
        ) {
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

      // Clear saved resume position on natural completion
      if (this.currentSong) {
        this.historyStore.clearPlaybackPosition(this.currentSong.id);
      }

      // Record history if track finished naturally
      if (this.currentSong && this.recordedHistoryForTrack !== this.currentSong.id && this.listenedMs >= 5000) {
        this.recordedHistoryForTrack = this.currentSong.id;
        this.historyStore.recordPlay({
          songId: this.currentSong.id,
          artistId: this.currentSong.artistId || '',
          albumId: this.currentSong.albumId || '',
          playedAt: Date.now(),
          playDurationMs: Math.round(this.listenedMs || (this.duration || 15) * 1000),
        });
      }

      if (this.repeatMode === 'one') {
        audio.currentTime = 0;
        this.listenedMs = 0;
        this.recordedHistoryForTrack = null;
        audio.play().catch((err) => this.handlePlayRejection(err, audio));
        return;
      }

      const nextIdx = this.getNextQueueIndex();
      if (nextIdx !== -1) {
        this.transitionToNextTrack(nextIdx);
      } else {
        // Queue ran out: radio / autoplay (Century M1) keeps playing with
        // similar tracks when enabled and repeat is off; otherwise stop.
        const lastSong = this.currentSong;
        this.maybeAutoplay(lastSong).then((continued) => {
          if (!continued && this.currentSong === lastSong) {
            this.isPlaying = false;
            this.currentTime = 0;
            this.notify();
          }
        });
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
    idle.src = this.client.getStreamUrl(nextSong.id, this.streamQuality);
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
    this.listenedMs = 0;
    this.lastTimeUpdatePerfMs = performance.now();
    this.lastSavedPositionSec = 0;
    this.updateMediaSession(song);
    this.preloadNextInIdleDeck();
  }

  transitionToNextTrack(nextIdx) {
    const nextSong = this.queue[nextIdx];
    if (!nextSong) return;

    this.clearFadeTimer();
    this.ensureWebAudioGraph();
    const currentActive = this.getActiveDeck();
    const idleKey = this.getIdleDeckKey();
    const idle = this.getIdleDeck();

    if (this.preloadedNextSongId === nextSong.id && idle.src) {
      currentActive.pause();
      currentActive.currentTime = 0;

      this.activeDeckKey = idleKey;
      this.preloadedNextSongId = null;

      this.currentSong = nextSong;
      this.currentIndex = nextIdx;
      this.currentTime = 0;
      this.duration = nextSong.duration || 0;
      this.isPlaying = true;
      this.applyActiveDeckGain();
      idle.play().catch((err) => this.handlePlayRejection(err, idle));

      this.onNewTrackStarted(nextSong);
      this.notify();
    } else {
      this.loadAndPlayOnActiveDeck(nextSong, nextIdx);
    }
  }

  startCrossfadeTransition(nextIdx) {
    const nextSong = this.queue[nextIdx];
    if (!nextSong) return;

    this.ensureWebAudioGraph();
    this.isCrossfading = true;
    const outgoingKey = this.activeDeckKey;
    const incomingKey = this.getIdleDeckKey();
    const outgoing = this.getActiveDeck();
    const incoming = this.getIdleDeck();
    const outgoingSong = this.currentSong;

    if (this.preloadedNextSongId !== nextSong.id || !incoming.src) {
      incoming.src = this.client.getStreamUrl(nextSong.id, this.streamQuality);
    }

    incoming.currentTime = 0;
    this.setDeckGain(incomingKey, 0, nextSong);
    incoming.play().catch((err) => this.handlePlayRejection(err, incoming));

    this.activeDeckKey = incomingKey;
    this.preloadedNextSongId = null;

    this.currentSong = nextSong;
    this.currentIndex = nextIdx;
    this.currentTime = 0;
    this.duration = nextSong.duration || 0;
    this.isPlaying = true;
    this.onNewTrackStarted(nextSong);
    this.notify();

    const fadeMs = Math.max(500, this.crossfadeSeconds * 1000);
    const steps = 30;
    const stepTime = fadeMs / steps;
    let step = 0;

    if (this.fadeInterval) clearInterval(this.fadeInterval);
    this.fadeInterval = setInterval(() => {
      step++;
      const t = Math.min(1, step / steps);
      // Equal-power crossfade curve
      const inMul = Math.sin(t * Math.PI * 0.5);
      const outMul = Math.cos(t * Math.PI * 0.5);
      this.setDeckGain(incomingKey, inMul, nextSong);
      this.setDeckGain(outgoingKey, outMul, outgoingSong);

      if (step >= steps) {
        this.clearFadeTimer();
        outgoing.pause();
        outgoing.currentTime = 0;
        this.setDeckGain(incomingKey, 1.0, nextSong);
        this.preloadNextInIdleDeck();
      }
    }, stepTime);
  }

  loadAndPlayOnActiveDeck(song, index, startTimeSeconds = 0) {
    this.clearFadeTimer();
    this.ensureWebAudioGraph();

    // Save current song's resume position before switching tracks
    if (this.currentSong && this.currentSong.id !== song.id && this.currentTime > 15) {
      this.historyStore.savePlaybackPosition(this.currentSong, this.currentTime, this.duration);
    }

    const active = this.getActiveDeck();
    const idle = this.getIdleDeck();
    idle.pause();

    active.src = this.client.getStreamUrl(song.id, this.streamQuality);
    active.currentTime = startTimeSeconds > 0 ? startTimeSeconds : 0;
    // A new track gets its own one raw-stream retry (see retryRawStream).
    this._rawRetrySongId = null;

    this.currentSong = song;
    this.currentIndex = index;
    this.currentTime = startTimeSeconds > 0 ? startTimeSeconds : 0;
    this.duration = song.duration || 0;
    this.isPlaying = true;
    this.applyActiveDeckGain();
    active.play().catch((err) => this.handlePlayRejection(err, active));

    this.onNewTrackStarted(song);
    if (startTimeSeconds > 0) {
      this.lastSavedPositionSec = startTimeSeconds;
    }
    this.notify();
  }

  playQueue(songs, startIndex = 0, options = {}) {
    if (!Array.isArray(songs) || songs.length === 0) return;
    const original = [...songs];
    let targetQueue = [...songs];
    let resolvedIdx = Math.max(0, Math.min(startIndex, targetQueue.length - 1));
    let targetSong = targetQueue[resolvedIdx];

    if (options.shuffle !== undefined) {
      this.shuffle = Boolean(options.shuffle);
    }

    if (this.shuffle && targetQueue.length > 1) {
      if (options.shuffle && startIndex === 0 && !options.keepFirstTrack) {
        targetQueue = shuffleSongs(targetQueue);
        targetSong = targetQueue[0];
        resolvedIdx = 0;
      } else {
        const rest = targetQueue.filter((s) => s.id !== targetSong.id);
        targetQueue = [targetSong, ...shuffleSongs(rest)];
        resolvedIdx = 0;
      }
    }

    this.queue = targetQueue;
    this.originalQueue = original;
    this.loadAndPlayOnActiveDeck(targetSong, resolvedIdx, options.startTime || 0);
  }

  playSong(song, newQueue = null, options = {}) {
    if (!song) return;
    let targetQueue = newQueue ? [...newQueue] : [...this.queue];
    if (targetQueue.length === 0) targetQueue = [song];
    const original = [...targetQueue];

    if (this.shuffle && newQueue && newQueue.length > 1) {
      const rest = targetQueue.filter((s) => s.id !== song.id);
      targetQueue = [song, ...shuffleSongs(rest)];
    }

    const idx = targetQueue.findIndex((s) => s.id === song.id);
    const resolvedIdx = idx >= 0 ? idx : 0;

    this.queue = targetQueue;
    this.originalQueue = original;
    this.loadAndPlayOnActiveDeck(song, resolvedIdx, options.startTime || 0);
  }

  togglePlayPause() {
    this.ensureWebAudioGraph();
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
      this.historyStore.savePlaybackPosition(this.currentSong, this.currentTime, this.duration);
    } else {
      this.lastTimeUpdatePerfMs = performance.now();
      active.play().catch((err) => this.handlePlayRejection(err, active));
      this.isPlaying = true;
    }
    this.notify();
  }

  next() {
    if (this.queue.length === 0) return;
    // Repeat-one: the Next button restarts the current track (Century).
    if (this.repeatMode === 'one') {
      this.seek(0);
      if (!this.isPlaying) this.togglePlayPause();
      return;
    }
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
    const safeMax = dur > 1 ? dur - 0.25 : dur;
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
      this.applyActiveDeckGain();
    } else if (this.webAudioReady && this.masterGainNode) {
      this.masterGainNode.gain.value = clamped;
    }
    this.notify();
  }

  setCrossfadeSeconds(seconds) {
    const clamped = Math.max(0, Math.min(12, seconds));
    this.crossfadeSeconds = clamped;
    localStorage.setItem(STORAGE_KEYS.CROSSFADE, String(clamped));
    this.notify();
  }

  // Radio / autoplay (Century M1, default ON). When the queue runs out and
  // repeat is off, the engine asks the app for similar tracks.
  loadAutoplay() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.AUTOPLAY);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  }

  setAutoplay(value) {
    this.autoplay = Boolean(value);
    try {
      localStorage.setItem(STORAGE_KEYS.AUTOPLAY, this.autoplay ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
    this.notify();
  }

  // Ask the app for radio tracks when the queue runs out. Returns true if
  // tracks were appended and playback continues.
  async maybeAutoplay(lastSong) {
    if (!this.autoplay || this.repeatMode !== 'off') return false;
    if (typeof this.onAutoplayNeeded !== 'function') return false;
    if (this._autoplayPending) return false;
    this._autoplayPending = true;
    try {
      const tracks = await this.onAutoplayNeeded(lastSong);
      if (!Array.isArray(tracks) || tracks.length === 0) return false;
      // Append after the current position and move to the first radio track.
      const insertAt = this.currentIndex + 1;
      this.queue.splice(insertAt, 0, ...tracks);
      this.originalQueue = [...this.queue];
      this.transitionToNextTrack(insertAt);
      return true;
    } catch {
      return false;
    } finally {
      this._autoplayPending = false;
    }
  }


  setNormalization(mode) {
    this.normalization = mode || 'auto';
    localStorage.setItem(STORAGE_KEYS.NORMALIZATION, this.normalization);
    this.applyActiveDeckGain();
    this.notify();
  }

  setPreampDb(db) {
    const clamped = Math.max(-12, Math.min(12, Number(db) || 0));
    this.preampDb = clamped;
    localStorage.setItem(STORAGE_KEYS.PREAMP, String(clamped));
    this.applyActiveDeckGain();
    this.notify();
  }

  setStreamQuality(quality) {
    this.streamQuality = quality || 'auto';
    localStorage.setItem(STORAGE_KEYS.STREAM_QUALITY, this.streamQuality);
    this.preloadedNextSongId = null;
    this.preloadNextInIdleDeck();
    this.notify();
  }

  async setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId || 'default';
    localStorage.setItem(STORAGE_KEYS.OUTPUT_DEVICE, this.outputDeviceId);
    const target = this.outputDeviceId === 'default' ? '' : this.outputDeviceId;
    try {
      if (typeof this.deckA.setSinkId === 'function') {
        await Promise.all([this.deckA.setSinkId(target), this.deckB.setSinkId(target)]);
      }
      if (this.audioCtx && typeof this.audioCtx.setSinkId === 'function') {
        await this.audioCtx.setSinkId(target);
      }
    } catch {
      // Ignore unsupported sink routing
    }
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
      const shuffledRemaining = shuffleSongs(remaining);
      const newQueue = current ? [current, ...shuffledRemaining] : shuffledRemaining;
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
  PLACEHOLDER_IMAGE_HASH,
  SubsonicClient,
  TitleTranslationStore,
  LyricsManager,
  HistoryStore,
  GaplessAudioEngine,
  parseLrc,
  findActiveLineIndex,
  findActiveLeadIndex,
  findBgParentIndex,
  findInstrumentalGaps,
  lyricLineEnd,
  hasNonLatinScript,
  hasJapaneseScript,
  processJapaneseLyrics,
  cleanCreditTags,
  generateAuraPlaceholder,
  fetchDeezerArtistImageJsonp,
  balancedShuffle,
  generatePlaylistCollage,
};
