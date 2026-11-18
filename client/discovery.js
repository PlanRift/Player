// Plenrip Audio — Pure-JS Discovery, Radio, Smart Playlists, Search & Palette Engine
// Zero-build ES2022 module backed by IndexedDB ('century-discovery-v1').

window.PlenripDiscovery = (function () {
  const DISCOVERY_DB_NAME = 'century-discovery-v1';
  const DISCOVERY_DB_VERSION = 1;

  const DISCOVERY_STORES = {
    SCROBBLE_QUEUE: 'scrobble_queue',
    SCROBBLED_KEYS: 'scrobbled_keys',
    PLAY_EVENTS: 'play_events',
    TRACK_AGGREGATES: 'track_aggregates',
    SHELF_CACHE: 'shelf_cache',
    SMART_PLAYLISTS: 'smart_playlists',
    SEARCH_INDEX: 'search_index',
    ADAPTIVE_HISTORY: 'adaptive_history',
    COOCCURRENCE: 'cooccurrence',
    RADIO_STATE: 'radio_state',
  };

  const MS_PER_DAY = 86_400_000;
  const MAX_SCROBBLE_QUEUE = 250;
  const MAX_SCROBBLED_KEYS = 500;
  const SCROBBLE_CHANNEL_NAME = 'century-scrobble';
  const LEGACY_HISTORY_MIGRATED_KEY = 'century.discovery.migrated.v1';

  // ==========================================================================
  // 1. IndexedDB Core & Scrobble Queue (scrobbleQueue.ts)
  // ==========================================================================
  let dbPromise = null;
  const memoryStores = {
    scrobbleQueue: new Map(),
    scrobbledKeys: new Map(),
  };
  const memoryScrobbledSet = new Set();
  let broadcastChannel = null;

  function ensureBroadcastChannel() {
    if (broadcastChannel) return broadcastChannel;
    if (typeof BroadcastChannel === 'undefined') return null;
    try {
      const ch = new BroadcastChannel(SCROBBLE_CHANNEL_NAME);
      ch.onmessage = (event) => {
        const data = event?.data;
        if (data?.type === 'scrobbled' && typeof data.key === 'string') {
          memoryScrobbledSet.add(data.key);
        }
      };
      broadcastChannel = ch;
    } catch {
      broadcastChannel = null;
    }
    return broadcastChannel;
  }

  function openDiscoveryDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DISCOVERY_DB_NAME, DISCOVERY_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          const ensure = (name, keyPath) => {
            if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, { keyPath });
            }
          };
          ensure(DISCOVERY_STORES.SCROBBLE_QUEUE, 'key');
          ensure(DISCOVERY_STORES.SCROBBLED_KEYS, 'key');
          ensure(DISCOVERY_STORES.PLAY_EVENTS, 'id');
          ensure(DISCOVERY_STORES.TRACK_AGGREGATES, 'songId');
          ensure(DISCOVERY_STORES.SHELF_CACHE, 'id');
          ensure(DISCOVERY_STORES.SMART_PLAYLISTS, 'id');
          ensure(DISCOVERY_STORES.SEARCH_INDEX, 'id');
          ensure(DISCOVERY_STORES.ADAPTIVE_HISTORY, 'key');
          ensure(DISCOVERY_STORES.COOCCURRENCE, 'id');
          ensure(DISCOVERY_STORES.RADIO_STATE, 'id');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          dbPromise = null;
          resolve(null);
        };
        req.onblocked = () => {
          dbPromise = null;
          resolve(null);
        };
      } catch {
        dbPromise = null;
        resolve(null);
      }
    });
    return dbPromise;
  }

  function idbReq(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function makeScrobbleKey(songId, startedAt) {
    return `${songId}:${startedAt}`;
  }

  function getScrobbleThresholdMs(durationSec) {
    if (!Number.isFinite(durationSec) || durationSec <= 30) return null;
    return Math.min(durationSec * 500, 240_000);
  }

  function hasScrobbledKeySync(key) {
    ensureBroadcastChannel();
    return memoryScrobbledSet.has(key);
  }

  async function hasScrobbledKey(key) {
    if (hasScrobbledKeySync(key)) return true;
    const db = await openDiscoveryDb();
    if (!db) return memoryStores.scrobbledKeys.has(key);
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLED_KEYS, 'readonly');
      const existing = await idbReq(tx.objectStore(DISCOVERY_STORES.SCROBBLED_KEYS).get(key));
      if (existing) {
        memoryScrobbledSet.add(key);
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  async function markScrobbledKey(key) {
    memoryScrobbledSet.add(key);
    const ch = ensureBroadcastChannel();
    if (ch) {
      try {
        ch.postMessage({ type: 'scrobbled', key });
      } catch {
        // Ignore
      }
    }
    const record = { key, markedAt: Date.now() };
    const db = await openDiscoveryDb();
    if (!db) {
      memoryStores.scrobbledKeys.set(key, record);
      return;
    }
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLED_KEYS, 'readwrite');
      const store = tx.objectStore(DISCOVERY_STORES.SCROBBLED_KEYS);
      await idbReq(store.put(record));
      const all = await idbReq(store.getAll());
      if (all.length > MAX_SCROBBLED_KEYS) {
        all.sort((a, b) => a.markedAt - b.markedAt);
        const excess = all.length - MAX_SCROBBLED_KEYS;
        for (let i = 0; i < excess; i += 1) {
          await idbReq(store.delete(all[i].key));
          memoryScrobbledSet.delete(all[i].key);
        }
      }
    } catch {
      // Ignore
    }
  }

  async function enqueueFailedScrobble({ songId, startedAt }) {
    const key = makeScrobbleKey(songId, startedAt);
    const entry = { key, songId, startedAt, queuedAt: Date.now() };
    const db = await openDiscoveryDb();
    if (!db) {
      memoryStores.scrobbleQueue.set(key, entry);
      return entry;
    }
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLE_QUEUE, 'readwrite');
      const store = tx.objectStore(DISCOVERY_STORES.SCROBBLE_QUEUE);
      await idbReq(store.put(entry));
      const all = await idbReq(store.getAll());
      if (all.length > MAX_SCROBBLE_QUEUE) {
        all.sort((a, b) => a.queuedAt - b.queuedAt);
        const excess = all.length - MAX_SCROBBLE_QUEUE;
        for (let i = 0; i < excess; i += 1) {
          await idbReq(store.delete(all[i].key));
        }
      }
    } catch {
      // Ignore
    }
    return entry;
  }

  async function getQueuedScrobbles() {
    const db = await openDiscoveryDb();
    if (!db) {
      return Array.from(memoryStores.scrobbleQueue.values()).sort((a, b) => a.queuedAt - b.queuedAt);
    }
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLE_QUEUE, 'readonly');
      const all = await idbReq(tx.objectStore(DISCOVERY_STORES.SCROBBLE_QUEUE).getAll());
      return all.sort((a, b) => a.queuedAt - b.queuedAt);
    } catch {
      return [];
    }
  }

  async function getScrobbleQueueCount() {
    const db = await openDiscoveryDb();
    if (!db) return memoryStores.scrobbleQueue.size;
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLE_QUEUE, 'readonly');
      return await idbReq(tx.objectStore(DISCOVERY_STORES.SCROBBLE_QUEUE).count());
    } catch {
      return 0;
    }
  }

  async function removeQueuedScrobble(key) {
    const db = await openDiscoveryDb();
    if (!db) {
      memoryStores.scrobbleQueue.delete(key);
      return;
    }
    try {
      const tx = db.transaction(DISCOVERY_STORES.SCROBBLE_QUEUE, 'readwrite');
      await idbReq(tx.objectStore(DISCOVERY_STORES.SCROBBLE_QUEUE).delete(key));
    } catch {
      // Ignore
    }
  }

  let flushInFlight = null;
  async function flushScrobbleQueue(client) {
    if (!client || typeof client.scrobble !== 'function') return { flushed: 0, remaining: 0 };
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
      const items = await getQueuedScrobbles();
      let flushed = 0;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        try {
          await client.scrobble(item.songId, { submission: true, time: item.startedAt });
          await removeQueuedScrobble(item.key);
          await markScrobbledKey(item.key);
          flushed += 1;
        } catch {
          return { flushed, remaining: items.length - i };
        }
      }
      return { flushed, remaining: 0 };
    })();

    try {
      return await flushInFlight;
    } finally {
      flushInFlight = null;
    }
  }

  // ==========================================================================
  // 2. Play Event Log, Bayesian Skip Ratios & Legacy Migration (playEventLog.ts)
  // ==========================================================================
  const SKIP_DECAY_HALF_LIFE_DAYS = 90;
  const VALID_END_REASONS = new Set(['completed', 'next', 'prev', 'select', 'pause-abandon', 'error']);
  const VALID_SOURCES = new Set(['home', 'queue', 'search', 'album', 'playlist', 'artists', 'songs', 'radio', 'other']);

  const memoryEvents = new Map();
  const memoryAggregates = new Map();
  let hydrated = false;
  let hydrationPromise = null;

  function isThresholdCrossed(durationSec, listenedSec) {
    if (!Number.isFinite(durationSec) || durationSec <= 30) return false;
    if (!Number.isFinite(listenedSec) || listenedSec <= 0) return false;
    const thresholdSec = Math.min(durationSec * 0.5, 240);
    return listenedSec >= thresholdSec;
  }

  function sanitizePlayEvent(input) {
    const startedAt = Number.isFinite(input.startedAt) ? Math.round(input.startedAt) : Date.now();
    const id = input.id && input.id.length > 0 ? input.id : `${input.songId}:${startedAt}`;
    const row = {
      id,
      songId: String(input.songId),
      startedAt,
      listenedSeconds: Math.max(0, Number.isFinite(input.listenedSeconds) ? input.listenedSeconds : 0),
      endPosition: Math.max(0, Number.isFinite(input.endPosition) ? input.endPosition : 0),
      endReason: VALID_END_REASONS.has(input.endReason) ? input.endReason : 'select',
      source: VALID_SOURCES.has(input.source) ? input.source : 'other',
      starredAtStart: Boolean(input.starredAtStart),
      duration: Math.max(0, Number.isFinite(input.duration) ? input.duration : 0),
    };
    if (typeof input.artistId === 'string' && input.artistId.length > 0) row.artistId = input.artistId;
    if (typeof input.albumId === 'string' && input.albumId.length > 0) row.albumId = input.albumId;
    return row;
  }

  function computeTrackAggregates(events, now = Date.now()) {
    const buckets = new Map();
    for (const event of events) {
      let b = buckets.get(event.songId);
      if (!b) {
        b = {
          plays: 0,
          starts: 0,
          hardSkips: 0,
          softSkips: 0,
          completions: 0,
          decayedSkips: 0,
          decayedStarts: 0,
          lastPlayedLocal: null,
          lastSkippedAt: null,
        };
        buckets.set(event.songId, b);
      }

      const ageDays = Math.max(0, (now - event.startedAt) / MS_PER_DAY);
      const weight = Math.exp((-Math.LN2 * ageDays) / SKIP_DECAY_HALF_LIFE_DAYS);
      b.starts += 1;
      b.decayedStarts += weight;

      const crossed = isThresholdCrossed(event.duration, event.listenedSeconds);
      if (crossed) {
        b.plays += 1;
        if (b.lastPlayedLocal === null || event.startedAt > b.lastPlayedLocal) {
          b.lastPlayedLocal = event.startedAt;
        }
      } else if (event.endReason !== 'completed') {
        if (event.listenedSeconds < 30) {
          b.hardSkips += 1;
          b.decayedSkips += 1.0 * weight;
        } else {
          b.softSkips += 1;
          b.decayedSkips += 0.5 * weight;
        }
        if (b.lastSkippedAt === null || event.startedAt > b.lastSkippedAt) {
          b.lastSkippedAt = event.startedAt;
        }
      }

      if (event.endReason === 'completed' || crossed) {
        b.completions += 1;
      }
    }

    const out = new Map();
    for (const [songId, b] of buckets.entries()) {
      out.set(songId, {
        songId,
        plays: b.plays,
        starts: b.starts,
        hardSkips: b.hardSkips,
        softSkips: b.softSkips,
        completions: b.completions,
        skipRatio: (b.decayedSkips + 2) / (b.decayedStarts + 10),
        lastPlayedLocal: b.lastPlayedLocal,
        lastSkippedAt: b.lastSkippedAt,
      });
    }
    return out;
  }

  async function ensureHydrated() {
    if (hydrated) return;
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = (async () => {
      const db = await openDiscoveryDb();
      if (db) {
        try {
          const tx = db.transaction([DISCOVERY_STORES.PLAY_EVENTS], 'readonly');
          const events = await idbReq(tx.objectStore(DISCOVERY_STORES.PLAY_EVENTS).getAll());
          for (const ev of events) memoryEvents.set(ev.id, ev);
        } catch {
          // Ignore
        }
      }
      const rebuilt = computeTrackAggregates(Array.from(memoryEvents.values()));
      memoryAggregates.clear();
      for (const [k, v] of rebuilt.entries()) memoryAggregates.set(k, v);
      hydrated = true;
    })();
    return hydrationPromise;
  }

  // Migrate existing localStorage['century.history.v1'] into PLAY_EVENTS once on startup
  async function migrateLegacyHistory(legacyStorageKey = 'century.history.v1') {
    await ensureHydrated();
    try {
      const raw = localStorage.getItem(legacyStorageKey);
      if (!raw) {
        localStorage.setItem(LEGACY_HISTORY_MIGRATED_KEY, '1');
        return 0;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.setItem(LEGACY_HISTORY_MIGRATED_KEY, '1');
        return 0;
      }
      const newRows = [];
      for (const entry of parsed) {
        if (!entry || !entry.songId) continue;
        const playedAt = Number(entry.playedAt) || Date.now();
        const id = `legacy:${entry.id || `${entry.songId}:${playedAt}`}`;
        if (memoryEvents.has(id)) continue;
        const listenedSec = Math.max(45, Math.round((Number(entry.playDurationMs) || 180_000) / 1000));
        const durSec = Math.max(60, Math.round(listenedSec / 0.92));
        const row = sanitizePlayEvent({
          id,
          songId: String(entry.songId),
          artistId: entry.artistId || undefined,
          albumId: entry.albumId || undefined,
          startedAt: playedAt,
          listenedSeconds: listenedSec,
          endPosition: listenedSec,
          endReason: 'completed',
          source: 'other',
          starredAtStart: false,
          duration: durSec,
        });
        memoryEvents.set(row.id, row);
        newRows.push(row);
      }

      if (newRows.length > 0) {
        const rebuilt = computeTrackAggregates(Array.from(memoryEvents.values()));
        memoryAggregates.clear();
        for (const [k, v] of rebuilt.entries()) memoryAggregates.set(k, v);

        const db = await openDiscoveryDb();
        if (db) {
          try {
            const tx = db.transaction(
              [DISCOVERY_STORES.PLAY_EVENTS, DISCOVERY_STORES.TRACK_AGGREGATES],
              'readwrite'
            );
            const evStore = tx.objectStore(DISCOVERY_STORES.PLAY_EVENTS);
            const aggStore = tx.objectStore(DISCOVERY_STORES.TRACK_AGGREGATES);
            for (const row of newRows) evStore.put(row);
            for (const agg of memoryAggregates.values()) aggStore.put(agg);
            await new Promise((res) => {
              tx.oncomplete = res;
              tx.onerror = res;
            });
          } catch {
            // In-memory state stays valid
          }
        }
        await clearShelfCache();
        notePlayEventForCooccurrence(() => rebuildCooccurrenceIndex());
      }
      localStorage.setItem(LEGACY_HISTORY_MIGRATED_KEY, '1');
      return newRows.length;
    } catch {
      return 0;
    }
  }

  async function appendPlayEvent(input) {
    await ensureHydrated();
    const row = sanitizePlayEvent(input);
    memoryEvents.set(row.id, row);

    const songEvents = Array.from(memoryEvents.values()).filter((e) => e.songId === row.songId);
    const aggMap = computeTrackAggregates(songEvents);
    const agg = aggMap.get(row.songId);
    if (agg) memoryAggregates.set(row.songId, agg);

    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(
          [DISCOVERY_STORES.PLAY_EVENTS, DISCOVERY_STORES.TRACK_AGGREGATES],
          'readwrite'
        );
        await idbReq(tx.objectStore(DISCOVERY_STORES.PLAY_EVENTS).put(row));
        if (agg) await idbReq(tx.objectStore(DISCOVERY_STORES.TRACK_AGGREGATES).put(agg));
      } catch {
        // Ignore
      }
    }
    return row;
  }

  async function getTrackAggregate(songId) {
    await ensureHydrated();
    return memoryAggregates.get(songId) ?? null;
  }

  async function getAllTrackAggregates() {
    await ensureHydrated();
    return new Map(memoryAggregates);
  }

  async function getPlayEventLog() {
    await ensureHydrated();
    return Array.from(memoryEvents.values()).sort((a, b) => a.startedAt - b.startedAt);
  }

  async function getPlayEventCount() {
    await ensureHydrated();
    return memoryEvents.size;
  }

  async function exportPlayEventLogJson() {
    const events = await getPlayEventLog();
    const sessions = splitSessions(events);
    const excludedSessionIds = [...(await getExcludedSessionIds())];
    const cooccurrence = await loadCooccurrenceIndex();
    return JSON.stringify(
      {
        version: 1,
        exportedAt: Date.now(),
        events,
        sessions: sessions.map((s) => ({
          id: s.id,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          trackIds: s.trackIds,
        })),
        excludedSessionIds,
        cooccurrence: {
          builtAt: cooccurrence.builtAt,
          sessionCount: cooccurrence.sessionCount,
          trackItems: cooccurrence.tracks.size,
          albumItems: cooccurrence.albums.size,
          artistItems: cooccurrence.artists.size,
        },
      },
      null,
      2
    );
  }

  function isPlayEventLike(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return (
      typeof value.songId === 'string' &&
      value.songId.length > 0 &&
      typeof value.startedAt === 'number' &&
      Number.isFinite(value.startedAt)
    );
  }

  async function importPlayEventLogJson(json) {
    await ensureHydrated();
    const parsed = JSON.parse(json);
    const rawList = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray(parsed.events)
        ? parsed.events
        : [];

    const importedRows = [];
    for (const item of rawList) {
      if (!isPlayEventLike(item)) continue;
      const row = sanitizePlayEvent(item);
      memoryEvents.set(row.id, row);
      importedRows.push(row);
    }

    const rebuilt = computeTrackAggregates(Array.from(memoryEvents.values()));
    memoryAggregates.clear();
    for (const [k, v] of rebuilt.entries()) memoryAggregates.set(k, v);

    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(
          [DISCOVERY_STORES.PLAY_EVENTS, DISCOVERY_STORES.TRACK_AGGREGATES],
          'readwrite'
        );
        const evStore = tx.objectStore(DISCOVERY_STORES.PLAY_EVENTS);
        const aggStore = tx.objectStore(DISCOVERY_STORES.TRACK_AGGREGATES);
        for (const row of importedRows) evStore.put(row);
        aggStore.clear();
        for (const agg of memoryAggregates.values()) aggStore.put(agg);
        await new Promise((res) => {
          tx.oncomplete = res;
          tx.onerror = res;
        });
      } catch {
        // Ignore
      }
    }

    await clearShelfCache();
    await rebuildCooccurrenceIndex();
    return { imported: importedRows.length, total: memoryEvents.size };
  }

  async function clearPlayEventLog() {
    hydrated = true;
    memoryEvents.clear();
    memoryAggregates.clear();

    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(
          [DISCOVERY_STORES.PLAY_EVENTS, DISCOVERY_STORES.TRACK_AGGREGATES],
          'readwrite'
        );
        await idbReq(tx.objectStore(DISCOVERY_STORES.PLAY_EVENTS).clear());
        await idbReq(tx.objectStore(DISCOVERY_STORES.TRACK_AGGREGATES).clear());
      } catch {
        // Ignore
      }
    }
    await clearShelfCache();
    await clearCooccurrenceIndex();
    await clearRadioState();
  }

  // ==========================================================================
  // 3. Deterministic 5-Shelf Scorer & Smart Playlists (.nsp)
  // ==========================================================================
  const SHELF_ORDER = [
    'made-for-you',
    'continue-listening',
    'quick-pick',
    'forgotten-favourite',
    'recently-added',
  ];

  const DEFAULT_SHELF_LIMITS = {
    'made-for-you': 20,
    'continue-listening': 20,
    'quick-pick': 24,
    'forgotten-favourite': 20,
    'recently-added': 20,
  };

  const SHELF_CACHE_KEY = 'home_shelves';
  const memoryShelfCache = new Map();

  async function getCachedShelves() {
    const db = await openDiscoveryDb();
    if (!db) return memoryShelfCache.get(SHELF_CACHE_KEY) ?? null;
    try {
      const tx = db.transaction(DISCOVERY_STORES.SHELF_CACHE, 'readonly');
      return (await idbReq(tx.objectStore(DISCOVERY_STORES.SHELF_CACHE).get(SHELF_CACHE_KEY))) ?? null;
    } catch {
      return memoryShelfCache.get(SHELF_CACHE_KEY) ?? null;
    }
  }

  async function saveCachedShelves(entry) {
    memoryShelfCache.set(entry.id, entry);
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      const tx = db.transaction(DISCOVERY_STORES.SHELF_CACHE, 'readwrite');
      await idbReq(tx.objectStore(DISCOVERY_STORES.SHELF_CACHE).put(entry));
    } catch {
      // Ignore
    }
  }

  async function clearShelfCache() {
    memoryShelfCache.clear();
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      const tx = db.transaction(DISCOVERY_STORES.SHELF_CACHE, 'readwrite');
      await idbReq(tx.objectStore(DISCOVERY_STORES.SHELF_CACHE).clear());
    } catch {
      // Ignore
    }
  }

  function resolveAggregate(aggregates, songId) {
    if (!aggregates) return undefined;
    if (aggregates instanceof Map) return aggregates.get(songId);
    return aggregates[songId];
  }

  function clampSilenceTargetDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n)) return 90;
    return Math.max(30, Math.min(365, Math.round(n)));
  }

  function clampNewlyStarredCooldownDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n)) return 14;
    return Math.max(7, Math.min(30, Math.round(n)));
  }

  function clampQuickPickExclusionHours(hours) {
    const n = Number(hours);
    if (!Number.isFinite(n)) return 24;
    return Math.max(0, Math.min(48, Math.round(n)));
  }

  function clampMaxPerArtistPerShelf(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 2;
    return Math.max(0, Math.min(5, Math.round(v)));
  }

  function getEffectivePlayCount(song, aggregate) {
    return Math.max(song?.playCount ?? 0, aggregate?.plays ?? 0);
  }

  function getLastPlayedMs(song, aggregate) {
    const serverMs = song?.played ? Date.parse(song.played) : 0;
    const safeServerMs = Number.isFinite(serverMs) ? serverMs : 0;
    const localMs = aggregate?.lastPlayedLocal ?? 0;
    return Math.max(safeServerMs, localMs);
  }

  function getStarredAtMs(song) {
    if (!song?.starred) return null;
    if (typeof song.starred === 'boolean') return null;
    const parsed = Date.parse(song.starred);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function computeAffinity(playCount, maxPlayCount, starred) {
    const denom = Math.log1p(Math.max(1, maxPlayCount));
    const playTerm = 0.6 * (Math.log1p(Math.max(0, playCount)) / denom);
    const starTerm = 0.4 * (starred ? 1 : 0);
    return playTerm + starTerm;
  }

  function computeSkipBoost(starred, aggregate) {
    if (starred || !aggregate || aggregate.skipRatio <= 0.2) return 0;
    return -0.25 * Math.max(0, aggregate.skipRatio - 0.2);
  }

  function computeMetadataSimilarity(a, b) {
    if (a.artistId && b.artistId && a.artistId === b.artistId) return 1.0;
    if (a.albumId && b.albumId && a.albumId === b.albumId) return 0.9;
    if (a.genre && b.genre && a.genre.toLowerCase() === b.genre.toLowerCase()) return 0.5;
    return 0;
  }

  function createSeededRng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function getDailySeed(dateStr = new Date().toISOString().slice(0, 10)) {
    let hash = 0;
    for (let i = 0; i < dateStr.length; i++) {
      hash = (hash << 5) - hash + dateStr.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) || 1;
  }

  function selectWithMmr(scored, limit, seenTrackIds, homeArtistCounts, options = {}) {
    const lambda = options.lambda ?? 0.7;
    const maxPerArtistShelf = options.maxPerArtistShelf ?? 2;
    const maxPerArtistHome = options.maxPerArtistHome ?? 3;

    const available = scored.filter((item) => item.song.id && !seenTrackIds.has(item.song.id));
    if (available.length === 0 || limit <= 0) return [];

    const selected = [];
    const selectedIds = new Set();
    const shelfArtistCounts = new Map();

    const canSelectWithCaps = (song, strict) => {
      if (!strict) return true;
      const artistId = song.artistId;
      if (!artistId) return true;
      const shelfCount = shelfArtistCounts.get(artistId) ?? 0;
      const homeCount = homeArtistCounts.get(artistId) ?? 0;
      const shelfOk = maxPerArtistShelf <= 0 || shelfCount < maxPerArtistShelf;
      const homeOk = maxPerArtistHome <= 0 || homeCount < maxPerArtistHome;
      return shelfOk && homeOk;
    };

    const runPass = (strict) => {
      while (selected.length < limit) {
        let bestItem = null;
        let bestMmr = -Infinity;

        for (const item of available) {
          if (selectedIds.has(item.song.id)) continue;
          if (!canSelectWithCaps(item.song, strict)) continue;

          let maxSim = 0;
          for (const chosen of selected) {
            const sim = computeMetadataSimilarity(item.song, chosen);
            if (sim > maxSim) maxSim = sim;
            if (maxSim >= 1.0) break;
          }

          const mmr = lambda * item.shelfScore - (1 - lambda) * maxSim;
          if (mmr > bestMmr || (mmr === bestMmr && bestItem && item.song.id < bestItem.song.id)) {
            bestMmr = mmr;
            bestItem = item;
          }
        }

        if (!bestItem) break;
        selected.push(bestItem.song);
        selectedIds.add(bestItem.song.id);
        seenTrackIds.add(bestItem.song.id);
        if (bestItem.song.artistId) {
          shelfArtistCounts.set(
            bestItem.song.artistId,
            (shelfArtistCounts.get(bestItem.song.artistId) ?? 0) + 1
          );
          homeArtistCounts.set(
            bestItem.song.artistId,
            (homeArtistCounts.get(bestItem.song.artistId) ?? 0) + 1
          );
        }
      }
    };

    runPass(true);
    if (selected.length < limit && selected.length < available.length) {
      runPass(false);
    }
    return selected;
  }

  function scoreShelfCandidates(shelfId, options) {
    const {
      songs = [],
      aggregates,
      now = Date.now(),
      silenceTargetDays = 90,
      quickPickSeed = getDailySeed(),
      activeSongId = null,
      newlyStarredCooldownDays = 14,
      quickPickExclusionHours = 24,
      starredIdsSet = null,
    } = options || {};

    const targetSilence = clampSilenceTargetDays(silenceTargetDays);
    const cooldownMs = clampNewlyStarredCooldownDays(newlyStarredCooldownDays) * MS_PER_DAY;
    const exclusionHours = clampQuickPickExclusionHours(quickPickExclusionHours);

    let maxPlayCount = 1;
    for (const s of songs) {
      const pc = getEffectivePlayCount(s, resolveAggregate(aggregates, s.id));
      if (pc > maxPlayCount) maxPlayCount = pc;
    }

    if (shelfId === 'recently-added') {
      return songs
        .filter((s) => s.id && s.id !== activeSongId)
        .map((song) => {
          const createdMs = song.created ? Date.parse(song.created) : 0;
          return {
            song,
            shelfScore: Number.isFinite(createdMs) ? createdMs : 0,
            affinity: 0,
            boost: 0,
          };
        })
        .sort((a, b) => b.shelfScore - a.shelfScore || a.song.id.localeCompare(b.song.id));
    }

    const scored = [];
    for (const song of songs) {
      if (!song.id || song.id === activeSongId) continue;

      const agg = resolveAggregate(aggregates, song.id);
      const playCount = getEffectivePlayCount(song, agg);
      const starred = Boolean(song.starred) || Boolean(starredIdsSet && starredIdsSet.has(song.id));
      const lastPlayedMs = getLastPlayedMs(song, agg);
      const ageDays = lastPlayedMs > 0 ? Math.max(0, (now - lastPlayedMs) / MS_PER_DAY) : Infinity;

      const affinity = computeAffinity(playCount, maxPlayCount, starred);
      const boost = computeSkipBoost(starred, agg);

      if (shelfId === 'made-for-you') {
        if (!starred && playCount <= 0) continue;
        const createdMs = song.created ? Date.parse(song.created) : 0;
        const effectiveAgeDays = Number.isFinite(ageDays)
          ? ageDays
          : Number.isFinite(createdMs) && createdMs > 0
            ? Math.max(0, (now - createdMs) / MS_PER_DAY)
            : 365;
        const shelfScore = affinity * Math.exp((-Math.LN2 * effectiveAgeDays) / 21) + boost;
        scored.push({ song, shelfScore, affinity, boost });
        continue;
      }

      if (shelfId === 'continue-listening') {
        if (lastPlayedMs <= 0 || ageDays > 14) continue;
        const shelfScore = affinity * Math.exp((-Math.LN2 * ageDays) / 7) + boost;
        scored.push({ song, shelfScore, affinity, boost });
        continue;
      }

      if (shelfId === 'quick-pick') {
        if (exclusionHours > 0 && lastPlayedMs > 0 && ageDays * 24 < exclusionHours) continue;
        const weight = Math.max(0.05, affinity + 0.1 * Math.log1p(playCount) + boost);
        scored.push({ song, shelfScore: weight, affinity, boost });
        continue;
      }

      if (shelfId === 'forgotten-favourite') {
        if (!starred && playCount < 3) continue;
        const starredAtMs = getStarredAtMs(song);
        if (starredAtMs !== null && now - starredAtMs < cooldownMs) continue;
        const silenceDays = lastPlayedMs > 0 ? ageDays : 365;
        if (silenceDays < Math.max(30, targetSilence)) continue;
        const cappedSilence = Math.min(silenceDays, 365);
        const shelfScore = affinity * (1 - Math.exp((-Math.LN2 * cappedSilence) / 90)) + boost;
        scored.push({ song, shelfScore, affinity, boost });
      }
    }

    if (shelfId === 'quick-pick') {
      const rng = createSeededRng(quickPickSeed);
      scored.sort((a, b) => a.song.id.localeCompare(b.song.id));
      for (const item of scored) {
        const u = Math.max(1e-9, rng());
        const w = Math.max(0.05, item.shelfScore);
        item.shelfScore = Math.pow(u, 1 / w);
      }
    }

    scored.sort((a, b) => b.shelfScore - a.shelfScore || a.song.id.localeCompare(b.song.id));
    return scored;
  }

  function computeHomeShelves(options) {
    const limits = { ...DEFAULT_SHELF_LIMITS, ...(options.limits || {}) };
    const perArtistShelf = clampMaxPerArtistPerShelf(options.maxPerArtistPerShelf);

    const seenTrackIds = new Set();
    const homeArtistCounts = new Map();
    const result = {
      'made-for-you': [],
      'continue-listening': [],
      'quick-pick': [],
      'forgotten-favourite': [],
      'recently-added': [],
    };

    for (const shelfId of SHELF_ORDER) {
      const limit = limits[shelfId];
      const scored = scoreShelfCandidates(shelfId, options);
      if (shelfId === 'recently-added') {
        const available = scored.filter((item) => item.song.id && !seenTrackIds.has(item.song.id));
        const selected = [];
        const shelfArtistCounts = new Map();
        for (const item of available) {
          if (selected.length >= limit) break;
          const artistId = item.song.artistId;
          if (artistId && perArtistShelf > 0) {
            const sc = shelfArtistCounts.get(artistId) ?? 0;
            const hc = homeArtistCounts.get(artistId) ?? 0;
            if (sc >= perArtistShelf || hc >= 3) continue;
          }
          selected.push(item.song);
          seenTrackIds.add(item.song.id);
          if (artistId) {
            shelfArtistCounts.set(artistId, (shelfArtistCounts.get(artistId) ?? 0) + 1);
            homeArtistCounts.set(artistId, (homeArtistCounts.get(artistId) ?? 0) + 1);
          }
        }
        if (selected.length < limit && selected.length < available.length) {
          for (const item of available) {
            if (selected.length >= limit) break;
            if (seenTrackIds.has(item.song.id)) continue;
            selected.push(item.song);
            seenTrackIds.add(item.song.id);
          }
        }
        result[shelfId] = selected;
      } else {
        result[shelfId] = selectWithMmr(scored, limit, seenTrackIds, homeArtistCounts, {
          lambda: 0.7,
          maxPerArtistShelf: perArtistShelf,
          maxPerArtistHome: perArtistShelf === 0 ? 0 : 3,
        });
      }
    }
    return result;
  }

  async function getOrComputeHomeShelves(options) {
    const targetSilence = clampSilenceTargetDays(options.silenceTargetDays);
    const seed = options.quickPickSeed ?? getDailySeed();
    const cooldownDays = clampNewlyStarredCooldownDays(options.newlyStarredCooldownDays);
    const exclusionHours = clampQuickPickExclusionHours(options.quickPickExclusionHours);
    const perArtistShelf = clampMaxPerArtistPerShelf(options.maxPerArtistPerShelf);

    if (!options.forceRecompute) {
      const cached = await getCachedShelves();
      if (
        cached &&
        cached.silenceTargetDays === targetSilence &&
        cached.quickPickSeed === seed &&
        (cached.newlyStarredCooldownDays ?? 14) === cooldownDays &&
        (cached.quickPickExclusionHours ?? 24) === exclusionHours &&
        (cached.maxPerArtistPerShelf ?? 2) === perArtistShelf &&
        Array.isArray(cached.shelves?.['quick-pick']) &&
        cached.shelves['quick-pick'].length > 0
      ) {
        return cached;
      }
    }

    const aggregates = options.aggregates || (await getAllTrackAggregates());
    const shelves = computeHomeShelves({
      ...options,
      aggregates,
      silenceTargetDays: targetSilence,
      quickPickSeed: seed,
      newlyStarredCooldownDays: cooldownDays,
      quickPickExclusionHours: exclusionHours,
      maxPerArtistPerShelf: perArtistShelf,
    });

    const entry = {
      id: SHELF_CACHE_KEY,
      computedAt: Date.now(),
      silenceTargetDays: targetSilence,
      quickPickSeed: seed,
      newlyStarredCooldownDays: cooldownDays,
      quickPickExclusionHours: exclusionHours,
      maxPerArtistPerShelf: perArtistShelf,
      shelves,
    };

    await saveCachedShelves(entry);
    return entry;
  }

  // Smart Playlists (.nsp)
  const SMART_PLAYLIST_CARDS = [
    {
      id: 'smart:made-for-you',
      nspId: 'made-for-you',
      name: 'Made for You',
      blurb: 'Affinity + 21-day recency mix',
      description: 'Personalized mix weighted by affinity and 21-day recency decay.',
    },
    {
      id: 'smart:continue-listening',
      nspId: 'continue-listening',
      name: 'Continue Listening',
      blurb: 'Recent rotation · 14d window',
      description: 'Tracks played in the last 14 days with 7-day decay.',
    },
    {
      id: 'smart:quick-pick',
      nspId: 'quick-pick',
      name: 'Quick Pick',
      blurb: 'Daily seeded 24-track mix',
      description: 'Seeded selection excluding tracks played in your recent window.',
    },
    {
      id: 'smart:forgotten-favourite',
      nspId: 'forgotten-favourite',
      name: 'Forgotten Favourite',
      blurb: 'Rested gems ready for a spin',
      description: 'Starred or frequently played tracks unplayed beyond your silence target.',
    },
    {
      id: 'smart:recently-added',
      nspId: 'recently-added',
      name: 'Recently Added',
      blurb: 'Newest tracks in library',
      description: 'Newest additions to your music library.',
    },
  ];

  function createBuiltInHomeSmartPlaylists(silenceTargetDays = 90) {
    const silenceDays = clampSilenceTargetDays(silenceTargetDays);
    return [
      {
        id: 'made-for-you',
        name: 'Made for You',
        comment: 'Personalized mix weighted by affinity and 21-day recency decay.',
        builtIn: true,
        liveUpdating: true,
        any: [{ is: { loved: true } }, { gt: { playCount: 0 } }],
        sort: 'shelf:made-for-you',
        limit: 20,
        perArtistCap: 2,
      },
      {
        id: 'continue-listening',
        name: 'Continue Listening',
        comment: 'Tracks played in the last 14 days with 7-day decay.',
        builtIn: true,
        liveUpdating: true,
        all: [{ inTheLast: { lastPlayed: 14 } }],
        sort: 'shelf:continue-listening',
        limit: 20,
        perArtistCap: 2,
      },
      {
        id: 'quick-pick',
        name: 'Quick Pick',
        comment: 'Seeded 6x4 selection excluding tracks played in the last 24 hours.',
        builtIn: true,
        liveUpdating: true,
        all: [{ notInTheLast: { lastPlayed: 1 } }],
        sort: 'shelf:quick-pick',
        limit: 24,
        perArtistCap: 2,
      },
      {
        id: 'forgotten-favourite',
        name: 'Forgotten Favourite',
        comment: 'Starred or frequently played tracks unplayed beyond your silence target.',
        builtIn: true,
        liveUpdating: true,
        all: [
          { any: [{ is: { loved: true } }, { gte: { playCount: 3 } }] },
          { notInTheLast: { lastPlayed: silenceDays } },
          { notInTheLast: { dateLoved: 14 } },
        ],
        sort: 'shelf:forgotten-favourite',
        limit: 20,
        perArtistCap: 2,
      },
      {
        id: 'recently-added',
        name: 'Recently Added',
        comment: 'Newest additions to your music library.',
        builtIn: true,
        liveUpdating: true,
        sort: 'shelf:recently-added',
        order: 'desc',
        limit: 20,
        perArtistCap: 2,
      },
    ];
  }

  const memorySmartPlaylists = new Map();

  async function loadSmartPlaylistsFromDb() {
    const db = await openDiscoveryDb();
    let stored = [];
    if (db) {
      try {
        const tx = db.transaction(DISCOVERY_STORES.SMART_PLAYLISTS, 'readonly');
        stored = (await idbReq(tx.objectStore(DISCOVERY_STORES.SMART_PLAYLISTS).getAll())) ?? [];
      } catch {
        stored = Array.from(memorySmartPlaylists.values());
      }
    } else {
      stored = Array.from(memorySmartPlaylists.values());
    }
    const byId = new Map(stored.map((p) => [p.id, p]));
    for (const def of createBuiltInHomeSmartPlaylists()) {
      if (!byId.has(def.id)) byId.set(def.id, def);
    }
    for (const [k, v] of byId.entries()) memorySmartPlaylists.set(k, v);
    return Array.from(byId.values());
  }

  async function saveSmartPlaylistToDb(playlist) {
    memorySmartPlaylists.set(playlist.id, playlist);
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      const tx = db.transaction(DISCOVERY_STORES.SMART_PLAYLISTS, 'readwrite');
      await idbReq(tx.objectStore(DISCOVERY_STORES.SMART_PLAYLISTS).put(playlist));
    } catch {
      // Ignore
    }
  }

  function evaluateNspPlaylist(playlist, options) {
    const {
      songs = [],
      aggregates,
      now = Date.now(),
      silenceTargetDays = 90,
      quickPickSeed = getDailySeed(),
      starredIdsSet = null,
    } = options || {};

    if (!playlist.liveUpdating && Array.isArray(playlist.frozenSongIds)) {
      const byId = new Map(songs.map((s) => [s.id, s]));
      return playlist.frozenSongIds.map((id) => byId.get(id)).filter(Boolean);
    }

    if (playlist.sort && playlist.sort.startsWith('shelf:')) {
      const shelfId = playlist.sort.slice('shelf:'.length);
      const scored = scoreShelfCandidates(shelfId, {
        songs,
        aggregates,
        now,
        silenceTargetDays,
        quickPickSeed,
        starredIdsSet,
      });
      const limit = playlist.limit ?? 20;
      if (shelfId === 'recently-added') {
        const out = [];
        const counts = new Map();
        const cap = playlist.perArtistCap ?? 2;
        for (const item of scored) {
          if (out.length >= limit) break;
          const aid = item.song.artistId;
          if (aid && cap > 0 && (counts.get(aid) ?? 0) >= cap) continue;
          out.push(item.song);
          if (aid) counts.set(aid, (counts.get(aid) ?? 0) + 1);
        }
        return out;
      }
      return selectWithMmr(scored, limit, new Set(), new Map(), {
        lambda: 0.7,
        maxPerArtistShelf: playlist.perArtistCap ?? 2,
        maxPerArtistHome: Infinity,
      });
    }
    return songs.slice(0, playlist.limit ?? 25);
  }

  function serializeToNspJson(playlist) {
    const nspDoc = { name: playlist.name };
    if (playlist.comment) nspDoc.comment = playlist.comment;
    if (playlist.all && playlist.all.length > 0) nspDoc.all = playlist.all;
    if (playlist.any && playlist.any.length > 0) nspDoc.any = playlist.any;
    if (playlist.sort) {
      if (playlist.sort === 'shelf:made-for-you') nspDoc.sort = 'playCount';
      else if (playlist.sort === 'shelf:continue-listening') nspDoc.sort = 'lastPlayed';
      else if (playlist.sort === 'shelf:quick-pick') nspDoc.sort = 'random';
      else if (playlist.sort === 'shelf:forgotten-favourite') nspDoc.sort = 'lastPlayed';
      else if (playlist.sort === 'shelf:recently-added') nspDoc.sort = 'dateAdded';
      else nspDoc.sort = playlist.sort;
    }
    if (playlist.order) nspDoc.order = playlist.order;
    if (playlist.limit !== undefined) nspDoc.limit = playlist.limit;
    return JSON.stringify(nspDoc, null, 2);
  }

  function downloadNspFile(playlist) {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const json = serializeToNspJson(playlist);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const slug = String(playlist.name || 'smart-playlist')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'smart-playlist'}.nsp`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==========================================================================
  // 4. Sessions, ItemKNN Co-occurrence, 3-Window Taste & Radio Engine
  // ==========================================================================
  const SESSION_GAP_MS = 30 * 60 * 1000;

  function splitSessions(events) {
    const sorted = [...events].sort((a, b) => a.startedAt - b.startedAt);
    const sessions = [];
    let current = null;
    let prevEndMs = 0;

    for (const event of sorted) {
      const endMs = event.startedAt + Math.max(0, event.listenedSeconds) * 1000;
      const startsNew = current === null || event.startedAt - prevEndMs > SESSION_GAP_MS;
      if (startsNew) {
        current = {
          id: `s:${event.startedAt}`,
          startedAt: event.startedAt,
          endedAt: endMs,
          trackIds: [],
          uniqueTrackIds: [],
          artistIds: [],
          albumIds: [],
          eventCount: 0,
        };
        sessions.push(current);
      }
      current.trackIds.push(event.songId);
      if (!current.uniqueTrackIds.includes(event.songId)) current.uniqueTrackIds.push(event.songId);
      if (event.artistId && !current.artistIds.includes(event.artistId)) current.artistIds.push(event.artistId);
      if (event.albumId && !current.albumIds.includes(event.albumId)) current.albumIds.push(event.albumId);
      current.eventCount += 1;
      if (endMs > current.endedAt) current.endedAt = endMs;
      prevEndMs = Math.max(prevEndMs, endMs);
    }
    return sessions;
  }

  function lastSessionTrackIds(sessions, limit = 5) {
    if (sessions.length === 0) return [];
    const last = sessions[sessions.length - 1];
    const seen = new Set();
    const out = [];
    for (let i = last.trackIds.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const id = last.trackIds[i];
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  // Radio state (excluded sessions + server similarity probe)
  const RADIO_STATE_KEY = 'radio';
  const PROBE_TTL_MS = 30 * MS_PER_DAY;
  const EMPTY_RADIO_STATE = {
    id: RADIO_STATE_KEY,
    excludedSessionIds: [],
    blockedArtistIds: [],
    probe: null,
    lastFullRebuildAt: 0,
  };
  let memoryRadioState = null;

  async function getRadioState() {
    if (memoryRadioState) {
      return {
        ...memoryRadioState,
        excludedSessionIds: [...memoryRadioState.excludedSessionIds],
        blockedArtistIds: [...memoryRadioState.blockedArtistIds],
      };
    }
    const db = await openDiscoveryDb();
    if (db) {
      try {
        const raw = await idbReq(
          db.transaction(DISCOVERY_STORES.RADIO_STATE, 'readonly').objectStore(DISCOVERY_STORES.RADIO_STATE).get(RADIO_STATE_KEY)
        );
        if (raw) {
          memoryRadioState = { ...EMPTY_RADIO_STATE, ...raw };
          return { ...memoryRadioState };
        }
      } catch {
        // Ignore
      }
    }
    memoryRadioState = { ...EMPTY_RADIO_STATE };
    return { ...memoryRadioState };
  }

  async function saveRadioState(nextState) {
    memoryRadioState = { ...nextState };
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      await idbReq(
        db.transaction(DISCOVERY_STORES.RADIO_STATE, 'readwrite').objectStore(DISCOVERY_STORES.RADIO_STATE).put(nextState)
      );
    } catch {
      // Ignore
    }
  }

  async function getExcludedSessionIds() {
    const st = await getRadioState();
    return new Set(st.excludedSessionIds || []);
  }

  async function setSessionExcluded(sessionId, excluded) {
    const st = await getRadioState();
    const set = new Set(st.excludedSessionIds || []);
    if (excluded) set.add(sessionId);
    else set.delete(sessionId);
    st.excludedSessionIds = [...set];
    await saveRadioState(st);
    await rebuildCooccurrenceIndex();
    return set;
  }

  async function getBlockedArtistIds() {
    const st = await getRadioState();
    return new Set(st.blockedArtistIds || []);
  }

  async function clearRadioState() {
    memoryRadioState = { ...EMPTY_RADIO_STATE };
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      await idbReq(
        db.transaction(DISCOVERY_STORES.RADIO_STATE, 'readwrite').objectStore(DISCOVERY_STORES.RADIO_STATE).clear()
      );
    } catch {
      // Ignore
    }
  }

  async function ensureServerProbe(client) {
    const st = await getRadioState();
    if (st.probe && Date.now() - st.probe.probedAt <= PROBE_TTL_MS) {
      return st.probe;
    }
    if (!client || typeof client.getRandomSongs !== 'function' || typeof client.getSimilarSongs2 !== 'function') {
      return { probedAt: Date.now(), serverSimilarityAvailable: false, sonicAvailable: false, tracksProbed: 0, hits: 0 };
    }
    let random = [];
    try {
      random = await client.getRandomSongs(3);
    } catch {
      random = [];
    }
    let hits = 0;
    const probed = random.slice(0, 3);
    for (const t of probed) {
      try {
        const sim = await client.getSimilarSongs2(t.id, 5);
        if (Array.isArray(sim) && sim.length > 0) hits += 1;
      } catch {
        // Ignore
      }
    }
    const probe = {
      probedAt: Date.now(),
      serverSimilarityAvailable: hits > 0,
      sonicAvailable: false,
      tracksProbed: probed.length,
      hits,
    };
    st.probe = probe;
    await saveRadioState(st);
    return probe;
  }

  // Co-occurrence ItemKNN Matrix
  const COOCCURRENCE_TOP_K = 20;
  const COOCCURRENCE_EDGE_HALF_LIFE_DAYS = 120;
  const COOCCURRENCE_PRUNE_FLOOR = 0.02;
  const COOC_INDEX_KEY = 'index';

  function halfLifeDecay(ageDays, halfLifeDays) {
    return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
  }

  function buildCoocLevel(sessions, pickIds, pickOrderedIds, minSharedSessions, now) {
    const presence = new Map();
    const pairSessions = new Map();
    const pairWeight = new Map();
    const directed = new Map();

    for (const session of sessions) {
      const ageDays = Math.max(0, (now - session.startedAt) / MS_PER_DAY);
      const sessionWeight = halfLifeDecay(ageDays, COOCCURRENCE_EDGE_HALF_LIFE_DAYS);
      const unique = [...new Set(pickIds(session))];

      for (const id of unique) {
        presence.set(id, (presence.get(id) ?? 0) + sessionWeight);
      }
      for (let i = 0; i < unique.length; i += 1) {
        for (let j = i + 1; j < unique.length; j += 1) {
          const a = unique[i];
          const b = unique[j];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          pairSessions.set(key, (pairSessions.get(key) ?? 0) + 1);
          pairWeight.set(key, (pairWeight.get(key) ?? 0) + sessionWeight);
        }
      }

      const ordered = pickOrderedIds(session);
      const seenDirected = new Map();
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const a = ordered[i];
          const b = ordered[j];
          if (a === b) continue;
          const gap = j - i - 1;
          const key = `${a}>${b}`;
          const prev = seenDirected.get(key);
          if (prev === undefined || gap < prev) seenDirected.set(key, gap);
        }
      }
      for (const [key, gap] of seenDirected.entries()) {
        const w = Math.pow(2, -Math.max(0, gap)) * sessionWeight;
        if (w < COOCCURRENCE_PRUNE_FLOOR) continue;
        directed.set(key, (directed.get(key) ?? 0) + w);
      }
    }

    const byItem = new Map();
    for (const [key, shared] of pairSessions.entries()) {
      if (shared < minSharedSessions) continue;
      const [a, b] = key.split('|');
      const weight = pairWeight.get(key) ?? 0;
      const pa = presence.get(a) ?? 0;
      const pb = presence.get(b) ?? 0;
      if (pa <= 0 || pb <= 0) continue;
      const sim = weight / Math.sqrt(pa * pb);
      if (!(sim > 0)) continue;
      const dirAB = directed.get(`${a}>${b}`) ?? 0;
      const dirBA = directed.get(`${b}>${a}`) ?? 0;
      const push = (from, to, dir) => {
        const list = byItem.get(from) ?? [];
        list.push({ id: to, sim, sharedSessions: shared, directedWeight: dir });
        byItem.set(from, list);
      };
      push(a, b, dirAB);
      push(b, a, dirBA);
    }

    const neighbours = new Map();
    for (const [item, list] of byItem.entries()) {
      list.sort((x, y) => y.sim - x.sim || x.id.localeCompare(y.id));
      neighbours.set(item, list.slice(0, COOCCURRENCE_TOP_K));
    }
    return neighbours;
  }

  function buildCooccurrenceFromEvents(events, excludedSessionIds = new Set(), now = Date.now()) {
    const sessions = splitSessions(events).filter((s) => !excludedSessionIds.has(s.id));
    return {
      builtAt: now,
      sessionCount: sessions.length,
      eventCount: sessions.reduce((n, s) => n + s.eventCount, 0),
      tracks: buildCoocLevel(sessions, (s) => s.uniqueTrackIds, (s) => s.trackIds, 3, now),
      albums: buildCoocLevel(sessions, (s) => s.albumIds, (s) => s.albumIds, 2, now),
      artists: buildCoocLevel(sessions, (s) => s.artistIds, (s) => s.artistIds, 2, now),
    };
  }

  function emptyCooccurrenceIndex(now = Date.now()) {
    return {
      builtAt: now,
      sessionCount: 0,
      eventCount: 0,
      tracks: new Map(),
      albums: new Map(),
      artists: new Map(),
    };
  }

  let memoryCoocIndex = null;
  let coocRebuildTimer = null;

  async function loadCooccurrenceIndex() {
    if (memoryCoocIndex) return memoryCoocIndex;
    const db = await openDiscoveryDb();
    if (db) {
      try {
        const raw = await idbReq(
          db.transaction(DISCOVERY_STORES.COOCCURRENCE, 'readonly').objectStore(DISCOVERY_STORES.COOCCURRENCE).get(COOC_INDEX_KEY)
        );
        if (raw) {
          memoryCoocIndex = {
            builtAt: raw.builtAt || 0,
            sessionCount: raw.sessionCount || 0,
            eventCount: raw.eventCount || 0,
            tracks: new Map(Object.entries(raw.tracks || {})),
            albums: new Map(Object.entries(raw.albums || {})),
            artists: new Map(Object.entries(raw.artists || {})),
          };
          return memoryCoocIndex;
        }
      } catch {
        // Ignore
      }
    }
    memoryCoocIndex = emptyCooccurrenceIndex();
    return memoryCoocIndex;
  }

  async function saveCooccurrenceIndex(index) {
    memoryCoocIndex = index;
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      const serialized = {
        id: COOC_INDEX_KEY,
        builtAt: index.builtAt,
        sessionCount: index.sessionCount,
        eventCount: index.eventCount,
        tracks: Object.fromEntries(index.tracks.entries()),
        albums: Object.fromEntries(index.albums.entries()),
        artists: Object.fromEntries(index.artists.entries()),
      };
      await idbReq(
        db.transaction(DISCOVERY_STORES.COOCCURRENCE, 'readwrite').objectStore(DISCOVERY_STORES.COOCCURRENCE).put(serialized)
      );
    } catch {
      // Ignore
    }
  }

  async function clearCooccurrenceIndex() {
    memoryCoocIndex = emptyCooccurrenceIndex();
    const db = await openDiscoveryDb();
    if (!db) return;
    try {
      await idbReq(
        db.transaction(DISCOVERY_STORES.COOCCURRENCE, 'readwrite').objectStore(DISCOVERY_STORES.COOCCURRENCE).clear()
      );
    } catch {
      // Ignore
    }
  }

  async function rebuildCooccurrenceIndex() {
    const [events, excluded] = await Promise.all([getPlayEventLog(), getExcludedSessionIds()]);
    const built = buildCooccurrenceFromEvents(events, excluded, Date.now());
    await saveCooccurrenceIndex(built);
    return built;
  }

  function notePlayEventForCooccurrence(rebuild = rebuildCooccurrenceIndex) {
    if (coocRebuildTimer !== null) return;
    coocRebuildTimer = setTimeout(() => {
      coocRebuildTimer = null;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => void rebuild(), { timeout: 2000 });
      } else {
        void rebuild();
      }
    }, 5000);
  }

  function getNeighbours(index, level, id) {
    return index?.[level]?.get(id) ?? [];
  }

  // 3-Window Feedback-Safe Taste Scorer (taste.ts)
  const TASTE_SHORT_DAYS = 28;
  const TASTE_MEDIUM_DAYS = 182;
  const TASTE_LONG_DAYS = 365;
  const TASTE_HALF_LIFE_DAYS = 90;
  const TASTE_RADIO_WEIGHT = 0.5;
  const SKIP_PENALTY_PER_SKIP = 0.25;
  const SKIP_PENALTY_MAX = 0.5;
  const SKIP_MEMORY_HALF_LIFE_DAYS = 7;
  const STAR_BOOST = 0.15;
  const STAR_HALF_BOOST_AFTER_DAYS = 180;

  function isCompletedPlay(event) {
    if (!Number.isFinite(event.duration) || event.duration <= 0) return false;
    if (!Number.isFinite(event.listenedSeconds) || event.listenedSeconds <= 0) return false;
    if (event.listenedSeconds >= 0.9 * event.duration) return true;
    if (event.duration <= 40 && event.listenedSeconds >= 30) return true;
    return false;
  }

  function isSkip(event) {
    return !isCompletedPlay(event) && event.listenedSeconds < 30;
  }

  function windowComponent(decayedCompleted) {
    return Math.min(1, Math.log1p(Math.max(0, decayedCompleted)) / Math.log1p(20));
  }

  function computeTasteForTrack(songId, events, input = {}, now = Date.now()) {
    let shortDecayed = 0;
    let mediumDecayed = 0;
    let longDecayed = 0;
    let skipDecayed = 0;
    let completedPlays = 0;
    let lastPlayedAt = null;

    for (const event of events) {
      const ageDays = Math.max(0, (now - event.startedAt) / MS_PER_DAY);
      const originWeight = event.source === 'radio' ? TASTE_RADIO_WEIGHT : 1;
      if (isCompletedPlay(event)) {
        completedPlays += 1;
        if (lastPlayedAt === null || event.startedAt > lastPlayedAt) lastPlayedAt = event.startedAt;
        const w = halfLifeDecay(ageDays, TASTE_HALF_LIFE_DAYS) * originWeight;
        if (event.source !== 'radio' && ageDays <= TASTE_SHORT_DAYS) shortDecayed += w;
        if (ageDays <= TASTE_MEDIUM_DAYS) mediumDecayed += w;
        if (ageDays <= TASTE_LONG_DAYS) longDecayed += w;
      } else if (isSkip(event)) {
        skipDecayed += halfLifeDecay(ageDays, SKIP_MEMORY_HALF_LIFE_DAYS);
      }
    }

    const shortTerm = windowComponent(shortDecayed);
    const mediumTerm = windowComponent(mediumDecayed);
    const longTerm = windowComponent(longDecayed);
    let tasteOut = 0.5 * shortTerm + 0.3 * mediumTerm + 0.2 * longTerm;

    const recency = lastPlayedAt === null ? 0 : halfLifeDecay((now - lastPlayedAt) / MS_PER_DAY, TASTE_HALF_LIFE_DAYS);
    const skipPenalty = Math.min(SKIP_PENALTY_MAX, SKIP_PENALTY_PER_SKIP * skipDecayed);

    let starBoost = 0;
    if (input.starred) {
      const starredMs = typeof input.starred === 'string' ? Date.parse(input.starred) : NaN;
      if (Number.isFinite(starredMs)) {
        const starAgeDays = Math.max(0, (now - starredMs) / MS_PER_DAY);
        const playedRecently = lastPlayedAt !== null && now - lastPlayedAt <= STAR_HALF_BOOST_AFTER_DAYS * MS_PER_DAY;
        starBoost = starAgeDays > STAR_HALF_BOOST_AFTER_DAYS && !playedRecently ? STAR_BOOST / 2 : STAR_BOOST;
      } else {
        starBoost = STAR_BOOST;
      }
    }

    if (events.length === 0 && (input.playCount ?? 0) > 0) {
      tasteOut = Math.max(tasteOut, Math.min(0.5, Math.log1p(input.playCount ?? 0) / Math.log1p(50)));
    }

    return {
      songId,
      taste: tasteOut,
      shortTerm,
      mediumTerm,
      longTerm,
      recency,
      skipPenalty,
      starBoost,
      completedPlays,
      lastPlayedAt,
    };
  }

  function groupEventsBySong(events) {
    const out = new Map();
    for (const event of events) {
      const list = out.get(event.songId);
      if (list) list.push(event);
      else out.set(event.songId, [event]);
    }
    return out;
  }

  function computeTasteMap(eventsBySong, songs = [], starredIdsSet = null, now = Date.now()) {
    const out = new Map();
    const songMap = new Map(songs.map((s) => [s.id, s]));
    const ids = new Set([...eventsBySong.keys(), ...songMap.keys()]);
    for (const id of ids) {
      const s = songMap.get(id);
      const isStar = s?.starred || (starredIdsSet?.has(id) ? true : null);
      out.set(
        id,
        computeTasteForTrack(
          id,
          eventsBySong.get(id) ?? [],
          { starred: isStar, playCount: s?.playCount },
          now
        )
      );
    }
    return out;
  }

  // Directed Radio Queue Generator (radioQueue.ts + radioEngine.ts)
  const ADVENTUROUSNESS_COMFORT = {
    calm: 0.85,
    balanced: 0.7,
    adventurous: 0.55,
  };
  const SEED_WEIGHTS = [1.0, 0.8, 0.6, 0.4, 0.2];
  const RRF_K = 60;
  const MMR_LAMBDA = 0.7;
  const MMR_POOL_SIZE = 50;
  const COLD_START_THRESHOLD_PLAYS = 150;
  const SMALL_LIBRARY_TRACKS = 500;
  const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  const LATIN_RE = /[A-Za-z]/g;

  const radioReasonMap = new Map();

  function getRadioReason(songId) {
    return radioReasonMap.get(songId) || null;
  }

  function detectScript(song) {
    const title = song?.title ?? '';
    const artist = song?.artist ?? '';
    if ((title.match(CJK_RE) ?? []).length > 0) return 'cjk';
    if ((artist.match(CJK_RE) ?? []).length > 0) return 'cjk';
    if (((title + artist).match(LATIN_RE) ?? []).length > 0) return 'latin';
    return 'none';
  }

  function radioMetadataSimilarity(a, b) {
    if (a.artistId && b.artistId && a.artistId === b.artistId) return 1.0;
    if (a.albumId && b.albumId && a.albumId === b.albumId) return 0.9;
    if (
      a.genre &&
      b.genre &&
      a.genre.toLowerCase() === b.genre.toLowerCase() &&
      a.year !== undefined &&
      b.year !== undefined &&
      Math.floor(a.year / 10) === Math.floor(b.year / 10)
    ) {
      return 0.5;
    }
    return 0;
  }

  function isLateNight(now = Date.now()) {
    const hour = new Date(now).getHours();
    return hour >= 22 || hour < 6;
  }

  function comfortShareAt(position, baseComfort, now = Date.now()) {
    let share = baseComfort;
    if (isLateNight(now)) share = Math.min(0.9, share + 0.1);
    if (position < 5) share = Math.min(0.9, share + 0.2);
    else if (position >= 20) share = Math.max(0.5, share - 0.1);
    return share;
  }

  function planSlots(limit, options = {}) {
    const base = ADVENTUROUSNESS_COMFORT[options.adventurousness ?? 'balanced'] ?? 0.7;
    const now = options.now ?? Date.now();
    const slots = [];
    const target = { comfort: 0, 'deep-cut': 0, exploration: 0 };
    const actual = { comfort: 0, 'deep-cut': 0, exploration: 0 };

    for (let i = 0; i < limit; i += 1) {
      if ((options.consecutiveSkips ?? 0) >= 2 && i < 5) {
        slots.push('comfort');
        actual.comfort += 1;
        continue;
      }
      let comfort = comfortShareAt(i, base, now);
      if ((options.consecutiveDeepCutCompletions ?? 0) >= 2 && i < 10) {
        comfort = Math.max(0.4, comfort - 0.1);
      }
      const discovery = 1 - comfort;
      const deepShare = discovery * (2 / 3);
      const exploreShare = options.explorationSuppressed ? 0 : discovery * (1 / 3);
      const comfortShare = options.explorationSuppressed ? comfort + discovery * (1 / 3) : comfort;
      target.comfort += comfortShare;
      target['deep-cut'] += deepShare;
      target.exploration += exploreShare;

      let best = 'comfort';
      let bestDeficit = -Infinity;
      for (const slot of ['comfort', 'deep-cut', 'exploration']) {
        if (slot === 'exploration' && options.explorationSuppressed) continue;
        const deficit = target[slot] - actual[slot];
        if (deficit > bestDeficit) {
          bestDeficit = deficit;
          best = slot;
        }
      }
      slots.push(best);
      actual[best] += 1;
    }
    return slots;
  }

  function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function classifySlot(song, tasteEntry, comfortArtistIds, comfortAlbumIds, artistPlayed, bestSim) {
    const pc = Math.max(song.playCount ?? 0, tasteEntry?.completedPlays ?? 0);
    const starred = Boolean(song.starred);
    if (pc > 0 || starred || (tasteEntry?.taste ?? 0) >= 0.3) return 'comfort';
    const sameArtistOrAlbum =
      (song.artistId !== undefined && comfortArtistIds.has(song.artistId)) ||
      (song.albumId !== undefined && comfortAlbumIds.has(song.albumId));
    if (pc <= 1 && (sameArtistOrAlbum || bestSim >= 0.3)) return 'deep-cut';
    if (song.artistId !== undefined && !artistPlayed.has(song.artistId)) return 'exploration';
    return 'deep-cut';
  }

  function whyFor(candidate) {
    const seed = candidate.bestSeed;
    if (candidate.slot === 'deep-cut') {
      return `Deep cut · ${candidate.song.artist || 'Artist'}`;
    }
    if (candidate.slot === 'exploration') {
      return seed
        ? `Discovery · similar to ${seed.artist || seed.title}`
        : `Discovery · ${candidate.song.artist || 'New artist'}`;
    }
    if (candidate.bestSim >= 0.3 && seed) {
      return `Often played with ${seed.title}`;
    }
    if (candidate.song.starred) return 'Starred favourite';
    if (seed) return `Matches ${seed.title}`;
    return 'From your listening taste';
  }

  function generateRadio(options) {
    const {
      seeds = [],
      library = [],
      neighbours,
      taste,
      now = Date.now(),
      limit = 30,
      adventurousness = 'balanced',
      excludedIds = new Set(),
      blockedArtistIds = new Set(),
      completedPlays = 0,
      serverSimilarityAvailable = false,
      consecutiveSkips = 0,
      consecutiveDeepCutCompletions = 0,
      explorationSuppressed = false,
    } = options;

    const seedList = seeds.slice(0, 5);
    const seedIds = new Set(seedList.map((s) => s.id));
    const seedYears = seedList.map((s) => s.year).filter((y) => typeof y === 'number');
    const seedSpansEras = seedYears.length >= 2 && Math.max(...seedYears) - Math.min(...seedYears) > 20;

    const hasCoocEdges = seedList.some(
      (s) =>
        getNeighbours(neighbours, 'tracks', s.id).length > 0 ||
        (s.albumId !== undefined && getNeighbours(neighbours, 'albums', s.albumId).length > 0) ||
        (s.artistId !== undefined && getNeighbours(neighbours, 'artists', s.artistId).length > 0)
    );

    const ready =
      completedPlays >= COLD_START_THRESHOLD_PLAYS || hasCoocEdges || serverSimilarityAvailable;
    const coldStart = {
      ready,
      completedPlays,
      threshold: COLD_START_THRESHOLD_PLAYS,
      reason: ready
        ? ''
        : `Warming up (${completedPlays}/${COLD_START_THRESHOLD_PLAYS} completed plays) — using artist & metadata similarity.`,
    };

    const seedWeightSum = seedList.reduce((sum, _s, i) => sum + (SEED_WEIGHTS[i] ?? 0.2), 0);

    const seen = new Set();
    const pool = [];
    for (const song of library) {
      if (!song.id || seen.has(song.id)) continue;
      if (seedIds.has(song.id) || excludedIds.has(song.id)) continue;
      if (song.artistId !== undefined && blockedArtistIds.has(song.artistId)) continue;
      seen.add(song.id);
      pool.push(song);
    }

    if (pool.length === 0) {
      return { tracks: [], coldStart, totalCandidates: 0 };
    }

    const comfortArtistIds = new Set();
    const comfortAlbumIds = new Set();
    const artistPlayed = new Set();
    for (const song of pool) {
      const t = taste.get(song.id);
      const pc = Math.max(song.playCount ?? 0, t?.completedPlays ?? 0);
      if (pc > 0 || song.starred) {
        if (song.artistId) {
          comfortArtistIds.add(song.artistId);
          artistPlayed.add(song.artistId);
        }
        if (song.albumId) comfortAlbumIds.add(song.albumId);
      }
    }
    for (const seed of seedList) {
      if (seed.artistId) artistPlayed.add(seed.artistId);
    }

    const scored = [];
    for (const song of pool) {
      const t = taste.get(song.id);
      let cooc = 0;
      let bestSim = 0;
      let bestSeed = null;
      const neighbourRanks = [];

      seedList.forEach((seed, si) => {
        const weight = SEED_WEIGHTS[si] ?? 0.2;
        const trackList = getNeighbours(neighbours, 'tracks', seed.id);
        const rankIdx = trackList.findIndex((n) => n.id === song.id);
        let sim = 0;
        if (rankIdx >= 0) {
          const trackN = trackList[rankIdx];
          sim = Math.min(1, trackN.sim + 0.1 * trackN.directedWeight);
          neighbourRanks.push(rankIdx + 1);
        } else if (song.albumId && seed.albumId) {
          const albumN = getNeighbours(neighbours, 'albums', seed.albumId).find((n) => n.id === song.albumId);
          if (albumN) sim = 0.7 * albumN.sim;
        }
        if (sim === 0 && song.artistId && seed.artistId) {
          if (song.artistId === seed.artistId) {
            sim = 0.55;
          } else {
            const artistN = getNeighbours(neighbours, 'artists', seed.artistId).find((n) => n.id === song.artistId);
            if (artistN) sim = 0.5 * artistN.sim;
          }
        }
        if (sim === 0) {
          sim = 0.35 * radioMetadataSimilarity(song, seed);
        }
        cooc += weight * sim;
        if (sim > bestSim) {
          bestSim = sim;
          bestSeed = seed;
        }
      });

      cooc = seedWeightSum > 0 ? cooc / seedWeightSum : 0;
      let rrfBonus = 0;
      if (neighbourRanks.length >= 2) {
        rrfBonus = neighbourRanks.reduce((sum, r) => sum + 1 / (RRF_K + r), 0);
      }

      const slot = classifySlot(song, t, comfortArtistIds, comfortAlbumIds, artistPlayed, bestSim);
      scored.push({
        song,
        cooc,
        taste: t?.taste ?? 0,
        recency: t?.recency ?? 0,
        skipPenalty: t?.skipPenalty ?? 0,
        starBoost: t?.starBoost ?? 0,
        rrfBonus,
        score: 0,
        normScore: 0,
        slot,
        bestSeed,
        bestSim,
      });
    }

    const coocTasteSorted = [...scored].sort((a, b) => b.cooc + b.taste - (a.cooc + a.taste));
    const midIdx = Math.floor(coocTasteSorted.length / 2);
    const topHalfCutoff = coocTasteSorted.length > 0 ? coocTasteSorted[midIdx].cooc + coocTasteSorted[midIdx].taste : 0;
    for (const c of scored) {
      if (c.slot === 'exploration' && c.cooc + c.taste < topHalfCutoff) {
        c.slot = 'deep-cut';
      }
    }

    let maxCooc = 0;
    let maxTaste = 0;
    for (const c of scored) {
      if (c.cooc > maxCooc) maxCooc = c.cooc;
      if (c.taste > maxTaste) maxTaste = c.taste;
    }
    for (const c of scored) {
      const coocN = maxCooc > 0 ? c.cooc / maxCooc : 0;
      const tasteN = maxTaste > 0 ? c.taste / maxTaste : 0;
      c.score = 0.4 * coocN + 0.35 * tasteN + 0.1 * c.recency - c.skipPenalty + c.starBoost + c.rrfBonus;
    }

    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const minScore = ranked.length > 0 ? ranked[Math.min(ranked.length, MMR_POOL_SIZE) - 1]?.score ?? 0 : 0;
    const maxScore = ranked.length > 0 ? ranked[0].score : 0;
    for (const c of ranked) {
      c.normScore = maxScore > minScore ? (c.score - minScore) / (maxScore - minScore) : 1;
    }

    const topPool = [];
    const inTopPool = new Set();
    const addToTopPool = (c) => {
      if (!inTopPool.has(c.song.id)) {
        inTopPool.add(c.song.id);
        topPool.push(c);
      }
    };
    for (const c of ranked.slice(0, MMR_POOL_SIZE)) addToTopPool(c);
    for (const slot of ['comfort', 'deep-cut', 'exploration']) {
      let taken = 0;
      for (const c of ranked) {
        if (taken >= 20) break;
        if (c.slot === slot) {
          addToTopPool(c);
          taken += 1;
        }
      }
    }

    const bySlot = new Map();
    for (const c of topPool) {
      const list = bySlot.get(c.slot) ?? [];
      list.push(c);
      bySlot.set(c.slot, list);
    }
    const filler = ranked.filter((c) => !inTopPool.has(c.song.id));

    const smallLibrary = library.length < SMALL_LIBRARY_TRACKS;
    const maxConsecutiveArtist = smallLibrary ? 3 : 2;
    const maxPerBlockArtist = smallLibrary ? 4 : 3;
    const maxConsecutiveAlbum = 2;

    const slotPlan = planSlots(limit, {
      adventurousness,
      now,
      consecutiveSkips,
      consecutiveDeepCutCompletions,
      explorationSuppressed,
    });

    const selected = [];
    const used = new Set();
    const artistScript = new Map();
    for (const song of pool) {
      if (!song.artistId) continue;
      const set = artistScript.get(song.artistId) ?? new Set();
      set.add(detectScript(song));
      artistScript.set(song.artistId, set);
    }

    const violatesCaps = (song, strict) => {
      if (!strict) return false;
      if (song.artistId) {
        let run = 0;
        for (let i = selected.length - 1; i >= 0; i -= 1) {
          if (selected[i].song.artistId === song.artistId) run += 1;
          else break;
        }
        if (run >= maxConsecutiveArtist) return true;
        const block = selected.slice(-9);
        if (block.filter((c) => c.song.artistId === song.artistId).length >= maxPerBlockArtist) return true;
      }
      if (song.albumId) {
        let run = 0;
        for (let i = selected.length - 1; i >= 0; i -= 1) {
          if (selected[i].song.albumId === song.albumId) run += 1;
          else break;
        }
        if (run >= maxConsecutiveAlbum) return true;
      }
      return false;
    };

    const antiJarPenalty = (candidate, prevSong, blockSwitches) => {
      if (!prevSong) return { penalty: 0, hardBlocked: false };
      let penalty = 0;
      let hardBlocked = false;
      const a = candidate.song;
      const b = prevSong;
      if (typeof a.year === 'number' && typeof b.year === 'number' && a.year > 0 && b.year > 0) {
        const jump = Math.abs(a.year - b.year);
        if (jump > 40 && !seedSpansEras) hardBlocked = true;
        else if (jump > 20) penalty += 0.2;
      }
      const scriptA = detectScript(a);
      const scriptB = detectScript(b);
      if (scriptA !== 'none' && scriptB !== 'none' && scriptA !== scriptB) {
        const scripts = a.artistId ? artistScript.get(a.artistId) : undefined;
        const bilingual = scripts !== undefined && scripts.has('cjk') && scripts.has('latin');
        if (!bilingual) penalty += blockSwitches >= 1 ? 0.3 : 0.15;
      }
      const lastFive = selected.slice(-5).map((c) => c.song.duration ?? 0).filter((d) => d > 0);
      if (lastFive.length >= 3 && (a.duration ?? 0) > 2 * median(lastFive)) {
        penalty += 0.1;
      }
      return { penalty, hardBlocked };
    };

    const pickOne = (desired, strictCaps, allowHardBlocked) => {
      const prevSong = selected.length > 0 ? selected[selected.length - 1].song : seedList[0];
      const blockStart = Math.floor(selected.length / 5) * 5;
      let blockSwitches = 0;
      for (let i = blockStart + 1; i < selected.length; i += 1) {
        const sa = detectScript(selected[i].song);
        const sb = detectScript(selected[i - 1].song);
        if (sa !== 'none' && sb !== 'none' && sa !== sb) blockSwitches += 1;
      }
      const slotOrder =
        desired === 'comfort'
          ? ['comfort', 'deep-cut', 'exploration']
          : desired === 'deep-cut'
            ? ['deep-cut', 'comfort', 'exploration']
            : ['exploration', 'deep-cut', 'comfort'];

      for (const slot of slotOrder) {
        const poolForSlot = (bySlot.get(slot) ?? []).filter((c) => !used.has(c.song.id));
        let best = null;
        let bestValue = -Infinity;
        for (const c of poolForSlot) {
          if (violatesCaps(c.song, strictCaps)) continue;
          const { penalty, hardBlocked } = antiJarPenalty(c, prevSong, blockSwitches);
          if (hardBlocked && !allowHardBlocked) continue;
          let maxSim = 0;
          for (const chosen of selected) {
            const sim = radioMetadataSimilarity(c.song, chosen.song);
            if (sim > maxSim) maxSim = sim;
          }
          const value = MMR_LAMBDA * c.normScore - (1 - MMR_LAMBDA) * maxSim - penalty;
          if (value > bestValue) {
            bestValue = value;
            best = c;
          }
        }
        if (best) return best;
      }
      return null;
    };

    for (let i = 0; i < limit; i += 1) {
      const desired = slotPlan[i];
      let pick =
        pickOne(desired, true, false) ??
        pickOne(desired, false, false) ??
        pickOne(desired, false, true);
      if (!pick) {
        for (const c of filler) {
          if (used.has(c.song.id)) continue;
          pick = c;
          break;
        }
      }
      if (!pick) break;
      used.add(pick.song.id);
      selected.push(pick);
    }

    const tracks = selected.map((c) => {
      const why = whyFor(c);
      radioReasonMap.set(c.song.id, { why, slot: c.slot, score: c.score });
      return { song: c.song, slot: c.slot, why, score: c.score };
    });

    return { tracks, coldStart, totalCandidates: scored.length };
  }

  async function generateRadioQueue({
    seed,
    library = [],
    client = null,
    limit = 25,
    excludeIds = [],
    adventurousness = 'balanced',
    starredIdsSet = null,
    consecutiveSkips = 0,
    consecutiveDeepCutCompletions = 0,
    explorationSuppressed = false,
  }) {
    if (!seed) return { tracks: [], coldStart: { ready: false, completedPlays: 0, threshold: 150, reason: '' } };

    const [events, excludedSessions, blockedArtists, coocIndex, probe] = await Promise.all([
      getPlayEventLog(),
      getExcludedSessionIds(),
      getBlockedArtistIds(),
      loadCooccurrenceIndex(),
      ensureServerProbe(client),
    ]);

    const allSessions = splitSessions(events);
    const sessions = allSessions.filter((s) => !excludedSessions.has(s.id));
    const excludedRanges = allSessions
      .filter((s) => excludedSessions.has(s.id))
      .map((s) => [s.startedAt, s.endedAt]);
    const filteredEvents =
      excludedRanges.length === 0
        ? events
        : events.filter((e) => !excludedRanges.some(([start, end]) => e.startedAt >= start && e.startedAt <= end));
    const recentIds = lastSessionTrackIds(sessions, 5);
    const byId = new Map(library.map((s) => [s.id, s]));

    const seeds = [seed];
    for (const id of recentIds) {
      if (seeds.length >= 5) break;
      if (id === seed.id) continue;
      const found = byId.get(id);
      if (found) seeds.push(found);
    }

    const eventsBySong = groupEventsBySong(filteredEvents);
    const tasteMap = computeTasteMap(eventsBySong, library, starredIdsSet);
    let completedPlays = 0;
    for (const e of filteredEvents) {
      if (isCompletedPlay(e)) completedPlays += 1;
    }

    const excludedSet = new Set([seed.id, ...(excludeIds || [])]);

    // Server similarity supplement if available
    if (probe?.serverSimilarityAvailable && client && typeof client.getSimilarSongs2 === 'function') {
      try {
        const simSongs = await client.getSimilarSongs2(seed.id, 15);
        for (const sm of simSongs || []) {
          if (sm?.id && !byId.has(sm.id)) {
            library.push(sm);
            byId.set(sm.id, sm);
          }
        }
      } catch {
        // Ignore
      }
    }

    return generateRadio({
      seeds,
      library,
      neighbours: coocIndex,
      taste: tasteMap,
      limit,
      adventurousness,
      excludedIds: excludedSet,
      blockedArtistIds: blockedArtists,
      completedPlays,
      serverSimilarityAvailable: Boolean(probe?.serverSimilarityAvailable),
      consecutiveSkips,
      consecutiveDeepCutCompletions,
      explorationSuppressed,
    });
  }

  async function checkRadioReadiness(client = null) {
    const [events, excluded, cooc, probe] = await Promise.all([
      getPlayEventLog(),
      getExcludedSessionIds(),
      loadCooccurrenceIndex(),
      getRadioState().then((s) => s.probe),
    ]);
    const sessions = splitSessions(events).filter((s) => !excluded.has(s.id));
    let completedPlays = 0;
    for (const e of events) {
      if (isCompletedPlay(e)) completedPlays += 1;
    }
    const hasEdges = cooc.tracks.size > 0 || cooc.albums.size > 0 || cooc.artists.size > 0;
    const ready =
      completedPlays >= COLD_START_THRESHOLD_PLAYS ||
      hasEdges ||
      Boolean(probe?.serverSimilarityAvailable);
    void client;
    return {
      ready,
      completedPlays,
      threshold: COLD_START_THRESHOLD_PLAYS,
      sessionCount: sessions.length,
      excludedCount: excluded.size,
      trackEdges: cooc.tracks.size,
      albumEdges: cooc.albums.size,
      artistEdges: cooc.artists.size,
    };
  }

  // ==========================================================================
  // 5. Search Normalization, Index, Frecency, Adaptive History & BM25 Ranking
  // ==========================================================================
  const HIRAGANA_START = 0x3041;
  const HIRAGANA_END = 0x3096;
  const KATAKANA_SHIFT = 0x60;

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
    てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
    ちぇ: 'che', しぇ: 'she', じぇ: 'je',
    ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
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
    ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ー: '',
  };

  function foldSearchText(input) {
    if (!input) return '';
    return String(input)
      .normalize('NFKC')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .normalize('NFC')
      .replace(/\u3000/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function kanaFold(input) {
    if (!input) return '';
    let out = '';
    for (const ch of input) {
      const cp = ch.codePointAt(0) ?? 0;
      if (cp >= HIRAGANA_START && cp <= HIRAGANA_END) {
        out += String.fromCodePoint(cp + KATAKANA_SHIFT);
      } else {
        out += ch;
      }
    }
    return out;
  }

  function hasKana(input) {
    return /[\u3040-\u30ff]/.test(input);
  }

  function hasKanji(input) {
    return /[\u3400-\u4dbf\u4e00-\u9fff]/.test(input);
  }

  function pureKanaToRomaji(input) {
    if (!input || !hasKana(input) || hasKanji(input)) return '';
    const hira = String(input).replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
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
      if (KANA_MONOGRAPHS[ch] !== undefined) {
        out += KANA_MONOGRAPHS[ch];
        i += 1;
        continue;
      }
      out += hira[i];
      i += 1;
    }
    return out
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonicalRomaji(input) {
    if (!input) return '';
    return String(input)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/tsu/g, 'tu')
      .replace(/shi/g, 'si')
      .replace(/chi/g, 'ti')
      .replace(/ji/g, 'zi')
      .replace(/zu/g, 'du')
      .replace(/fu/g, 'hu')
      .replace(/ou/g, 'o')
      .replace(/oo/g, 'o')
      .replace(/uu/g, 'u')
      .replace(/ii/g, 'i')
      .replace(/ee/g, 'e')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collapseDoubleConsonants(input) {
    return input.replace(/([bcdfghjklmnpqrstvwxz])\1/g, '$1');
  }

  const ROMAJI_ONSET = /^(ky|gy|ny|hy|my|ry|by|py|sh|ch|ts|j|k|g|s|z|t|d|n|h|b|p|m|y|r|w|f)?([aeiou])|^(n)(?![aeiou])/;

  function segmentRomajiMorae(flat) {
    const morae = [];
    let rest = flat;
    while (rest.length > 0) {
      const m = ROMAJI_ONSET.exec(rest);
      if (!m || m[0].length === 0) {
        morae.push(rest[0]);
        rest = rest.slice(1);
        continue;
      }
      morae.push(m[0]);
      rest = rest.slice(m[0].length);
    }
    return morae;
  }

  function romajiInitials(romaji) {
    const flat = canonicalRomaji(romaji).replace(/\s+/g, '');
    if (!flat) return '';
    const morae = segmentRomajiMorae(flat);
    if (morae.length < 3) return '';
    let out = morae[0][0];
    for (let i = 1; i < morae.length; i += 1) {
      const onset = morae[i].replace(/[aeiou]+$/, '');
      if (onset) out += onset[0];
    }
    return out;
  }

  function buildSortKey(input) {
    return kanaFold(foldSearchText(input));
  }

  function buildSearchKeysForText(input, options = {}) {
    if (!input) return [];
    const keys = [];
    const seen = new Set();
    const push = (key) => {
      const k = String(key || '').trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    };
    const pushRomaji = (romaji) => {
      const raw = String(romaji || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!raw) return;
      push(raw);
      push(raw.replace(/\s+/g, ''));
      const canon = canonicalRomaji(raw);
      push(canon);
      push(canon.replace(/\s+/g, ''));
      push(canonicalRomaji(raw.replace(/\s+/g, '')));
      const initials = romajiInitials(raw);
      if (initials) push(initials);
      for (const form of [raw, canon]) {
        const collapsed = collapseDoubleConsonants(form);
        if (collapsed !== form) {
          push(collapsed);
          push(collapsed.replace(/\s+/g, ''));
        }
      }
    };

    const folded = foldSearchText(input);
    push(folded);
    push(kanaFold(folded));

    if (/^[a-z0-9\s]+$/.test(folded) && folded.length > 0) {
      pushRomaji(folded);
    }
    if (hasKana(input)) {
      pushRomaji(pureKanaToRomaji(input));
    }
    if (options.relayRomaji) {
      const foldedTrans = foldSearchText(options.relayRomaji);
      push(foldedTrans);
      pushRomaji(options.relayRomaji);
    }
    return keys;
  }

  // Frecency & Server Play Reconciliation (frecency.ts)
  const FRECENCY_LAMBDA = Math.LN2 / 30;
  const FRECENCY_VISIT_CAP = 10;
  const FRECENCY_MAX_SCORE = 15 * FRECENCY_VISIT_CAP;

  function visitWeight(event) {
    if (!isThresholdCrossed(event.duration, event.listenedSeconds)) return 0;
    if (event.starredAtStart) return 15;
    if (event.endReason === 'completed' || event.source === 'search') return 10;
    return 5;
  }

  function computeFrecencyForTrack(events, now = Date.now()) {
    if (events.length === 0) return null;
    const songId = events[0].songId;
    let decayedSum = 0;
    let count = 0;
    let lastVisit = null;
    for (const event of events) {
      const weight = visitWeight(event);
      if (weight === 0) continue;
      const ageDays = Math.max(0, (now - event.startedAt) / MS_PER_DAY);
      decayedSum += weight * Math.exp(-FRECENCY_LAMBDA * ageDays);
      count += 1;
      if (lastVisit === null || event.startedAt > lastVisit) lastVisit = event.startedAt;
    }
    if (count === 0) return null;
    return {
      songId,
      score: (decayedSum / count) * Math.min(count, FRECENCY_VISIT_CAP),
      visitCount: count,
      lastVisit,
    };
  }

  function computeFrecencyMap(events, now = Date.now()) {
    const buckets = groupEventsBySong(events);
    const out = new Map();
    for (const [songId, list] of buckets.entries()) {
      const score = computeFrecencyForTrack(list, now);
      if (score) out.set(songId, score);
    }
    return out;
  }

  function normalizeFrecency(score) {
    if (!Number.isFinite(score) || score <= 0) return 0;
    return Math.min(1, score / FRECENCY_MAX_SCORE);
  }

  async function getFrecencyMap(now = Date.now()) {
    const events = await getPlayEventLog();
    return computeFrecencyMap(events, now);
  }

  async function reconcileServerPlays(serverTracks = []) {
    const events = await getPlayEventLog();
    const crossedBySong = new Map();
    const existingIds = new Set();
    const now = Date.now();
    for (const ev of events) {
      existingIds.add(ev.id);
      if (isThresholdCrossed(ev.duration, ev.listenedSeconds)) {
        const list = crossedBySong.get(ev.songId) ?? [];
        list.push(ev);
        crossedBySong.set(ev.songId, list);
      }
    }
    let count = 0;
    for (const track of serverTracks) {
      if (!track?.played) continue;
      const playedMs = Date.parse(track.played);
      if (!Number.isFinite(playedMs) || playedMs > now) continue;
      const localCrossed = crossedBySong.get(track.id) ?? [];
      if ((track.playCount ?? 0) <= localCrossed.length) continue;
      const lastLocal = localCrossed.reduce((max, e) => (max === null || e.startedAt > max ? e.startedAt : max), null);
      if (lastLocal !== null && playedMs <= lastLocal) continue;
      const syncId = `${track.id}:${playedMs}:sync`;
      if (existingIds.has(syncId)) continue;
      await appendPlayEvent({
        id: syncId,
        songId: track.id,
        artistId: track.artistId,
        albumId: track.albumId,
        startedAt: playedMs,
        listenedSeconds: 240,
        endPosition: 240,
        endReason: 'completed',
        source: 'other',
        starredAtStart: false,
        duration: 480,
      });
      count += 1;
    }
    return count;
  }

  // Adaptive Input History (adaptiveHistory.ts)
  const ADAPTIVE_USE_COUNT_CAP = 10;
  const ADAPTIVE_DECAY_PER_DAY = 0.975;
  const ADAPTIVE_EXPIRY_THRESHOLD = 0.1;
  const ADAPTIVE_EXACT_MATCH_BONUS = 0.5;
  const memoryAdaptive = new Map();
  let adaptiveLoaded = false;

  function applyAdaptiveDecay(entry, now = Date.now()) {
    const days = Math.max(0, (now - entry.decayedAt) / MS_PER_DAY);
    if (days < 1) return entry;
    const useCount = entry.useCount * Math.pow(ADAPTIVE_DECAY_PER_DAY, days);
    if (useCount < ADAPTIVE_EXPIRY_THRESHOLD) return null;
    return { ...entry, useCount, decayedAt: now };
  }

  async function loadAdaptiveHistory() {
    if (adaptiveLoaded) return new Map(memoryAdaptive);
    adaptiveLoaded = true;
    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(DISCOVERY_STORES.ADAPTIVE_HISTORY, 'readonly');
        const all = await idbReq(tx.objectStore(DISCOVERY_STORES.ADAPTIVE_HISTORY).getAll());
        const now = Date.now();
        for (const entry of all) {
          const decayed = applyAdaptiveDecay(entry, now);
          if (decayed) memoryAdaptive.set(decayed.key, decayed);
        }
      } catch {
        // Ignore
      }
    }
    return new Map(memoryAdaptive);
  }

  async function recordAdaptivePick(query, itemId, kind) {
    const key = foldSearchText(query);
    if (!key || !itemId) return;
    const entries = await loadAdaptiveHistory();
    const now = Date.now();
    const next = new Map();
    for (const [k, entry] of entries.entries()) {
      const decayed = applyAdaptiveDecay(entry, now);
      if (decayed) next.set(k, decayed);
    }
    const existing = next.get(key);
    if (existing && existing.trackId === itemId) {
      next.set(key, {
        ...existing,
        useCount: Math.min(ADAPTIVE_USE_COUNT_CAP, existing.useCount * 0.9 + 1),
        lastUsed: now,
        decayedAt: now,
      });
    } else {
      next.set(key, { key, trackId: itemId, kind, useCount: 1, lastUsed: now, decayedAt: now });
    }
    memoryAdaptive.clear();
    for (const [k, v] of next.entries()) memoryAdaptive.set(k, v);
    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(DISCOVERY_STORES.ADAPTIVE_HISTORY, 'readwrite');
        const store = tx.objectStore(DISCOVERY_STORES.ADAPTIVE_HISTORY);
        store.clear();
        for (const entry of next.values()) store.put(entry);
      } catch {
        // Ignore
      }
    }
  }

  async function getAdaptivePicks(query) {
    const prefix = foldSearchText(query);
    if (!prefix) return [];
    const entries = await loadAdaptiveHistory();
    const now = Date.now();
    const best = new Map();
    for (const entry of entries.values()) {
      const decayed = applyAdaptiveDecay(entry, now);
      if (!decayed || !decayed.key.startsWith(prefix)) continue;
      const exact = decayed.key === prefix;
      const rank = decayed.useCount * (1 + (exact ? ADAPTIVE_EXACT_MATCH_BONUS : 0));
      const prev = best.get(decayed.trackId);
      if (!prev || rank > prev.rank) {
        best.set(decayed.trackId, { trackId: decayed.trackId, kind: decayed.kind, rank, useCount: decayed.useCount });
      }
    }
    return Array.from(best.values()).sort((a, b) => b.rank - a.rank);
  }

  // Search Index & BM25 Ranking (searchIndex.ts + ranking.ts)
  const SEARCH_INDEX_VERSION = 1;
  const SEARCH_INDEX_META_ID = '__meta__';
  const memorySearchDocs = new Map();
  let memorySearchMeta = null;

  function fingerprintLibrary(songs, albums, artists) {
    let hash = 0x811c9dc5;
    const feed = (s) => {
      for (let i = 0; i < s.length; i += 1) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
    };
    for (const s of songs) feed(`s${s.id};`);
    for (const a of albums) feed(`l${a.id};`);
    for (const a of artists) feed(`a${a.id};`);
    return (hash >>> 0).toString(16);
  }

  function docForSong(song, relayRomaji) {
    return {
      id: `song:${song.id}`,
      rawId: song.id,
      kind: 'song',
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      genre: song.genre || '',
      starred: Boolean(song.starred),
      keys: {
        title: buildSearchKeysForText(song.title, { relayRomaji: relayRomaji?.(song.title, song.artist || '') }),
        artist: buildSearchKeysForText(song.artist || '', { relayRomaji: relayRomaji?.(song.artist || '', '') }),
        album: buildSearchKeysForText(song.album || '', { relayRomaji: relayRomaji?.(song.album || '', song.artist || '') }),
        genre: buildSearchKeysForText(song.genre || ''),
      },
      sortKey: buildSortKey(song.title || ''),
    };
  }

  function docForAlbum(album, relayRomaji) {
    return {
      id: `album:${album.id}`,
      rawId: album.id,
      kind: 'album',
      title: album.name || '',
      artist: album.artist || '',
      album: album.name || '',
      genre: album.genre || '',
      starred: Boolean(album.starred),
      keys: {
        title: buildSearchKeysForText(album.name, { relayRomaji: relayRomaji?.(album.name, album.artist || '') }),
        artist: buildSearchKeysForText(album.artist || '', { relayRomaji: relayRomaji?.(album.artist || '', '') }),
        album: buildSearchKeysForText(album.name, { relayRomaji: relayRomaji?.(album.name, album.artist || '') }),
        genre: buildSearchKeysForText(album.genre || ''),
      },
      sortKey: buildSortKey(album.name || ''),
    };
  }

  function docForArtist(artist, relayRomaji) {
    return {
      id: `artist:${artist.id}`,
      rawId: artist.id,
      kind: 'artist',
      title: artist.name || '',
      artist: artist.name || '',
      album: '',
      genre: '',
      starred: Boolean(artist.starred),
      keys: {
        title: buildSearchKeysForText(artist.name, { relayRomaji: relayRomaji?.(artist.name, '') }),
        artist: buildSearchKeysForText(artist.name, { relayRomaji: relayRomaji?.(artist.name, '') }),
        album: [],
        genre: [],
      },
      sortKey: buildSortKey(artist.name || ''),
    };
  }

  function yieldToIdle() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: 100 });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  async function ensureSearchIndex(songs = [], albums = [], artists = [], relayRomaji = null) {
    if (songs.length === 0 && albums.length === 0 && artists.length === 0) return null;
    const fingerprint = fingerprintLibrary(songs, albums, artists);

    if (memorySearchMeta && memorySearchMeta.fingerprint === fingerprint) {
      return { meta: memorySearchMeta, docs: Array.from(memorySearchDocs.values()) };
    }

    const db = await openDiscoveryDb();
    if (db) {
      try {
        const tx = db.transaction(DISCOVERY_STORES.SEARCH_INDEX, 'readonly');
        const store = tx.objectStore(DISCOVERY_STORES.SEARCH_INDEX);
        const meta = await idbReq(store.get(SEARCH_INDEX_META_ID));
        if (meta && meta.version === SEARCH_INDEX_VERSION && meta.fingerprint === fingerprint) {
          const all = await idbReq(store.getAll());
          const realDocs = all.filter((d) => d.id !== SEARCH_INDEX_META_ID);
          if (realDocs.length === meta.docCount) {
            memorySearchDocs.clear();
            for (const d of realDocs) memorySearchDocs.set(d.id, d);
            memorySearchMeta = meta;
            return { meta, docs: realDocs };
          }
        }
      } catch {
        // Rebuild below
      }
    }

    const docs = [];
    const CHUNK = 500;
    const builders = [
      ...songs.map((s) => () => docForSong(s, relayRomaji)),
      ...albums.map((a) => () => docForAlbum(a, relayRomaji)),
      ...artists.map((a) => () => docForArtist(a, relayRomaji)),
    ];
    for (let i = 0; i < builders.length; i += CHUNK) {
      for (const b of builders.slice(i, i + CHUNK)) docs.push(b());
      if (i + CHUNK < builders.length) await yieldToIdle();
    }

    const meta = {
      id: SEARCH_INDEX_META_ID,
      version: SEARCH_INDEX_VERSION,
      fingerprint,
      builtAt: Date.now(),
      docCount: docs.length,
      songCount: songs.length,
      albumCount: albums.length,
      artistCount: artists.length,
    };

    memorySearchDocs.clear();
    for (const d of docs) memorySearchDocs.set(d.id, d);
    memorySearchMeta = meta;

    if (db) {
      try {
        const tx = db.transaction(DISCOVERY_STORES.SEARCH_INDEX, 'readwrite');
        const store = tx.objectStore(DISCOVERY_STORES.SEARCH_INDEX);
        store.clear();
        store.put(meta);
        for (const d of docs) store.put(d);
      } catch {
        // Ignore
      }
    }
    return { meta, docs };
  }

  function tokenizeSearchQuery(rawQuery) {
    const folded = foldSearchText(rawQuery);
    if (!folded) return [];
    return folded.split(/\s+/).filter(Boolean).map((t) => (/^[a-z0-9]+$/.test(t) ? canonicalRomaji(t) : kanaFold(t)));
  }

  const BM25_K1 = 1.2;
  const BM25_B = 0.75;
  const FIELD_WEIGHTS = { title: 3, artist: 2, album: 1, genre: 0.5 };
  const MATCH_LEVEL_SCORE = { exact: 1.0, prefix: 0.8, substring: 0.55, fuzzy: 0.35, none: 0 };
  const FUZZY_MIN_SIMILARITY = 0.65;

  function levenshtein(a, b, maxDist) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j += 1) prev[j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > maxDist) return maxDist + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }

  function fuzzyWordSimilarity(token, key) {
    const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(token);
    const minLen = cjk ? 2 : 3;
    if (token.length < minLen) return 0;
    const maxDist = Math.max(1, Math.floor(token.length * (1 - FUZZY_MIN_SIMILARITY)));
    const tokenBigrams =
      cjk || token.length < 3
        ? null
        : new Set(Array.from({ length: token.length - 1 }, (_, i) => token.slice(i, i + 2)));
    if (tokenBigrams) {
      let shares = false;
      for (const bg of tokenBigrams) {
        if (key.includes(bg)) {
          shares = true;
          break;
        }
      }
      if (!shares && key[0] !== token[0]) return 0;
    }
    let best = 0;
    for (const word of key.split(/\s+/)) {
      if (!word) continue;
      if (Math.abs(word.length - token.length) > maxDist && !word.includes(token)) {
        if (word.length < token.length) continue;
      }
      const dist = levenshtein(token, word, maxDist);
      if (dist <= maxDist) {
        const sim = 1 - dist / Math.max(token.length, word.length);
        if (sim > best) best = sim;
      }
    }
    return best >= FUZZY_MIN_SIMILARITY ? best : 0;
  }

  function fieldMatchLevel(keys, token, allowFuzzy = true) {
    let bestScore = 0;
    for (const key of keys) {
      if (!key) continue;
      if (key === token) return 'exact';
      if (key.startsWith(token)) {
        bestScore = Math.max(bestScore, MATCH_LEVEL_SCORE.prefix);
        continue;
      }
      if (key.includes(token)) {
        bestScore = Math.max(bestScore, MATCH_LEVEL_SCORE.substring);
        continue;
      }
      if (allowFuzzy && bestScore === 0 && fuzzyWordSimilarity(token, key) > 0) {
        bestScore = MATCH_LEVEL_SCORE.fuzzy;
      }
    }
    if (bestScore === MATCH_LEVEL_SCORE.prefix) return 'prefix';
    if (bestScore === MATCH_LEVEL_SCORE.substring) return 'substring';
    if (bestScore === MATCH_LEVEL_SCORE.fuzzy) return 'fuzzy';
    return 'none';
  }

  function fieldTokenCount(keys) {
    if (!keys || keys.length === 0) return 1;
    return Math.max(1, keys[0].split(/\s+/).filter(Boolean).length);
  }

  function bm25Term(idf, tf, fieldLen, avgFieldLen) {
    const norm = 1 - BM25_B + (BM25_B * fieldLen) / Math.max(1, avgFieldLen);
    return (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm);
  }

  function rankSearch(index, rawQuery, options = {}) {
    const tokens = tokenizeSearchQuery(rawQuery);
    const empty = { artists: [], albums: [], songs: [], top: null, totalCandidates: 0 };
    if (!index || tokens.length === 0 || index.docs.length === 0) return empty;

    const fullQuery = tokens.join(' ');
    const docs = index.docs;
    const N = Math.max(1, docs.length);
    const fields = ['title', 'artist', 'album', 'genre'];

    const df = new Map();
    for (const t of tokens) df.set(t, 0);
    const cheapLevels = [];
    const cheapFieldLevels = [];

    for (let d = 0; d < docs.length; d += 1) {
      const doc = docs[d];
      const perToken = [];
      const perField = [];
      for (let t = 0; t < tokens.length; t += 1) {
        const token = tokens[t];
        let best = 'none';
        const fieldLevels = [];
        for (const field of fields) {
          const level = fieldMatchLevel(doc.keys[field], token, false);
          fieldLevels.push(level);
          if (MATCH_LEVEL_SCORE[level] > MATCH_LEVEL_SCORE[best]) best = level;
        }
        perToken.push(best);
        perField.push(fieldLevels);
        if (best !== 'none') df.set(token, (df.get(token) ?? 0) + 1);
      }
      cheapLevels.push(perToken);
      cheapFieldLevels.push(perField);
    }

    const avgLen = new Map();
    for (const field of fields) {
      let total = 0;
      for (const doc of docs) total += fieldTokenCount(doc.keys[field]);
      avgLen.set(field, total / N);
    }

    const fuzzyLevels = docs.map(() => tokens.map(() => 'none'));
    const fuzzyFieldLevels = docs.map(() => tokens.map(() => fields.map(() => 'none')));
    for (let t = 0; t < tokens.length; t += 1) {
      const token = tokens[t];
      const fullScan = (df.get(token) ?? 0) === 0;
      for (let d = 0; d < docs.length; d += 1) {
        if (cheapLevels[d][t] !== 'none') continue;
        if (!fullScan && !cheapLevels[d].some((l) => l !== 'none')) continue;
        const doc = docs[d];
        let best = 'none';
        const fieldLevels = [];
        for (const field of fields) {
          const level = fieldMatchLevel(doc.keys[field], token, true);
          fieldLevels.push(level);
          if (MATCH_LEVEL_SCORE[level] > MATCH_LEVEL_SCORE[best]) best = level;
        }
        fuzzyLevels[d][t] = best;
        fuzzyFieldLevels[d][t] = fieldLevels;
      }
    }

    const scored = [];
    for (let d = 0; d < docs.length; d += 1) {
      const doc = docs[d];
      let qualifies = true;
      for (let t = 0; t < tokens.length; t += 1) {
        if (cheapLevels[d][t] === 'none' && fuzzyLevels[d][t] === 'none') {
          qualifies = false;
          break;
        }
      }
      if (!qualifies) continue;

      let textScore = 0;
      for (let t = 0; t < tokens.length; t += 1) {
        const token = tokens[t];
        const docFreq = df.get(token) ?? 0;
        const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
        for (let f = 0; f < fields.length; f += 1) {
          const field = fields[f];
          const level = cheapFieldLevels[d][t][f] !== 'none' ? cheapFieldLevels[d][t][f] : fuzzyFieldLevels[d][t][f];
          if (level === 'none') continue;
          const levelScore = MATCH_LEVEL_SCORE[level];
          const tf =
            level === 'fuzzy'
              ? 1
              : 1 + 0.5 * Math.max(0, doc.keys[field].filter((k) => k.includes(token) || k === token).length - 1);
          const term = bm25Term(idf, tf, fieldTokenCount(doc.keys[field]), avgLen.get(field) ?? 1);
          textScore += FIELD_WEIGHTS[field] * term * levelScore;
        }
      }
      if (textScore <= 0) continue;
      const exactTitle = doc.keys.title.some((k) => k === fullQuery);
      const exactOrPrefixTitle = exactTitle || doc.keys.title.some((k) => k.startsWith(fullQuery));
      scored.push({ doc, textScore, exactTitle, exactOrPrefixTitle });
    }

    const adaptiveRank = new Map();
    for (const pick of options.adaptive ?? []) adaptiveRank.set(`${pick.kind}:${pick.trackId}`, pick.rank);

    const byKind = new Map();
    for (const s of scored) {
      const list = byKind.get(s.doc.kind) ?? [];
      list.push(s);
      byKind.set(s.doc.kind, list);
    }

    const buildKind = (kind, cap) => {
      const list = (byKind.get(kind) ?? []).sort((a, b) => b.textScore - a.textScore).slice(0, 50);
      if (list.length === 0) return [];
      const maxText = Math.max(...list.map((s) => s.textScore));
      const maxFrecency = Math.max(0, ...list.map((s) => options.frecency?.get(s.doc.rawId)?.score ?? 0));
      const ranked = list.map((s) => {
        const textNorm = maxText > 0 ? s.textScore / maxText : 0;
        const rawFrec = options.frecency?.get(s.doc.rawId)?.score ?? 0;
        const frecencyNorm = maxFrecency > 0 ? rawFrec / maxFrecency : normalizeFrecency(rawFrec);
        const starredBonus = s.doc.starred || options.starredIdsSet?.has(s.doc.rawId) ? 1 : 0;
        return {
          doc: s.doc,
          textScore: s.textScore,
          finalScore: 0.65 * textNorm + 0.25 * frecencyNorm + 0.1 * starredBonus,
          exactTitle: s.exactTitle,
          exactOrPrefixTitle: s.exactOrPrefixTitle,
          adaptive: adaptiveRank.has(`${kind}:${s.doc.rawId}`),
          adaptiveScore: adaptiveRank.get(`${kind}:${s.doc.rawId}`) ?? 0,
        };
      });
      ranked.sort((a, b) => {
        if (a.exactTitle !== b.exactTitle) return a.exactTitle ? -1 : 1;
        if (a.exactOrPrefixTitle !== b.exactOrPrefixTitle) return a.exactOrPrefixTitle ? -1 : 1;
        if (a.adaptive !== b.adaptive) return a.adaptive ? -1 : 1;
        if (a.adaptive && b.adaptive && b.adaptiveScore !== a.adaptiveScore) return b.adaptiveScore - a.adaptiveScore;
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return a.doc.sortKey.localeCompare(b.doc.sortKey);
      });
      return ranked.slice(0, cap);
    };

    const artists = buildKind('artist', 5);
    const albums = buildKind('album', 5);
    const songs = buildKind('song', 8);

    const topCandidates = [...artists, ...albums, ...songs].sort((a, b) => {
      if (a.exactTitle !== b.exactTitle) return a.exactTitle ? -1 : 1;
      if (a.exactOrPrefixTitle !== b.exactOrPrefixTitle) return a.exactOrPrefixTitle ? -1 : 1;
      if (a.adaptive !== b.adaptive) return a.adaptive ? -1 : 1;
      return b.finalScore - a.finalScore;
    });

    return {
      artists,
      albums,
      songs,
      top: topCandidates[0] || null,
      totalCandidates: scored.length,
    };
  }

  // ==========================================================================
  // 6. Multi-Artist Split Album Merger (albumMerge.ts)
  // ==========================================================================
  function normalizeAlbumName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function mergeAlbums(albums = []) {
    if (!Array.isArray(albums) || albums.length <= 1) return albums || [];
    const groups = new Map();
    for (const album of albums) {
      const key = normalizeAlbumName(album.name || '');
      if (!key) continue;
      const group = groups.get(key);
      if (group) group.push(album);
      else groups.set(key, [album]);
    }

    const out = [];
    const placed = new Set();
    for (const album of albums) {
      const key = normalizeAlbumName(album.name || '');
      if (!key) {
        out.push(album);
        continue;
      }
      const group = groups.get(key);
      const rep = group[0];
      if (placed.has(rep)) continue;
      placed.add(rep);
      if (group.length === 1) {
        out.push(rep);
        continue;
      }
      const artists = new Set(group.map((a) => String(a.artist || '').trim()).filter(Boolean));
      const multiArtist = artists.size > 1;
      out.push({
        ...rep,
        artist: multiArtist ? 'Various Artists' : rep.artist,
        artistId: multiArtist ? undefined : rep.artistId,
        songCount: group.reduce((acc, a) => acc + (a.songCount ?? 0), 0),
        duration: group.reduce((acc, a) => acc + (a.duration ?? 0), 0) || undefined,
        playCount: group.reduce((acc, a) => acc + (a.playCount ?? 0), 0),
        starred: group.find((a) => a.starred)?.starred,
        coverArt: group.find((a) => a.coverArt)?.coverArt || rep.coverArt,
        mergedAlbumIds: group.map((a) => a.id),
      });
    }
    return out;
  }

  function mergeAlbumSongs(songGroups = []) {
    const seen = new Set();
    const all = [];
    for (const group of songGroups) {
      for (const song of group || []) {
        if (!song?.id || seen.has(song.id)) continue;
        seen.add(song.id);
        all.push(song);
      }
    }
    return all.sort(
      (a, b) =>
        (a.discNumber ?? 0) - (b.discNumber ?? 0) ||
        (a.track ?? 0) - (b.track ?? 0) ||
        String(a.title || '').localeCompare(String(b.title || ''))
    );
  }

  // ==========================================================================
  // 7. OKLCH Ambient Palette Extractor (palette.ts + Web Worker)
  // ==========================================================================
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    const v = clamp(c, 0, 1);
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function srgbToOklch(r, g, b) {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.4285922419 * m + 0.4505937095 * s;
    const b_ = 0.0259040371 * l + 0.7827717124 * m - 0.8086757549 * s;
    const c = Math.sqrt(a * a + b_ * b_);
    let h = (Math.atan2(b_, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c, h };
  }

  function oklchToRgb(o) {
    const a = o.c * Math.cos((o.h * Math.PI) / 180);
    const b = o.c * Math.sin((o.h * Math.PI) / 180);
    const l_ = o.l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = o.l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = o.l - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const b_ = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return [
      Math.round(clamp(linearToSrgb(r), 0, 1) * 255),
      Math.round(clamp(linearToSrgb(g), 0, 1) * 255),
      Math.round(clamp(linearToSrgb(b_), 0, 1) * 255),
    ];
  }

  function rgbToHex(r, g, b) {
    const to = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function oklchToCss(o) {
    return `oklch(${o.l.toFixed(3)} ${o.c.toFixed(3)} ${o.h.toFixed(1)})`;
  }

  function toRole(o) {
    const [r, g, b] = oklchToRgb(o);
    return { hex: rgbToHex(r, g, b), oklch: oklchToCss(o), l: o.l, c: o.c, h: o.h };
  }

  function classifyPalette(colors) {
    if (!Array.isArray(colors) || colors.length === 0) return null;
    const parsed = colors.map(([r, g, b]) => srgbToOklch(r, g, b)).filter((c) => c.l < 0.95);
    if (parsed.length === 0) return null;

    const darkCandidates = parsed.filter((c) => c.l >= 0.12 && c.l <= 0.38);
    let base;
    if (darkCandidates.length > 0) {
      const pick = [...darkCandidates].sort((a, b) => a.c - b.c || a.l - b.l)[0];
      base = { l: clamp(pick.l, 0.22, 0.3), c: Math.min(pick.c, 0.12), h: pick.h };
    } else {
      const darkest = [...parsed].sort((a, b) => a.l - b.l)[0];
      base = { l: 0.25, c: Math.min(darkest.c, 0.12), h: darkest.h };
    }

    const vividPool = parsed.filter((c) => c.l >= 0.35 && c.l <= 0.8);
    const vivid = vividPool.length > 0 ? vividPool : parsed;
    const vibrantPick = [...vivid].sort((a, b) => b.c - a.c)[0];
    const vibrant = {
      l: clamp(vibrantPick.l, 0.45, 0.75),
      c: Math.min(vibrantPick.c, 0.32),
      h: vibrantPick.h,
    };

    const rest = parsed.filter((c) => c !== vibrantPick);
    const secondaryPick = rest.length > 0 ? [...rest].sort((a, b) => b.c - a.c)[0] : vibrantPick;
    const secondary = {
      l: clamp(secondaryPick.l, 0.35, 0.7),
      c: Math.min(secondaryPick.c, 0.15),
      h: secondaryPick.h,
    };

    const mutedPick = [...parsed].sort((a, b) => a.c - b.c)[0];
    const muted = {
      l: clamp(mutedPick.l, 0.4, 0.65),
      c: Math.min(mutedPick.c, 0.1),
      h: mutedPick.h,
    };

    const accent = {
      l: clamp(vibrant.l, 0.5, 0.72),
      c: Math.min(vibrant.c * 1.25, 0.2),
      h: vibrant.h,
    };

    const darkerBase = { l: Math.max(0.1, base.l - 0.04), c: base.c, h: base.h };

    return {
      base: toRole(base),
      darkerBase: toRole(darkerBase),
      vibrant: toRole(vibrant),
      secondary: toRole(secondary),
      muted: toRole(muted),
      accent: toRole(accent),
      baseL: base.l,
    };
  }

  let paletteWorker = null;
  let paletteWorkerFailed = false;
  let paletteWorkerSeq = 0;
  const palettePending = new Map();
  const paletteCache = new Map();
  const paletteInflight = new Map();

  function getPaletteWorker() {
    if (paletteWorkerFailed) return null;
    if (paletteWorker) return paletteWorker;
    if (typeof Worker === 'undefined') {
      paletteWorkerFailed = true;
      return null;
    }
    try {
      paletteWorker = new Worker('./palette-worker.js');
    } catch {
      paletteWorkerFailed = true;
      return null;
    }
    paletteWorker.onmessage = (event) => {
      const { id, colors } = event.data || {};
      const pending = palettePending.get(id);
      if (!pending) return;
      palettePending.delete(id);
      clearTimeout(pending.timeout);
      pending.resolve(colors);
    };
    paletteWorker.onerror = () => {
      paletteWorkerFailed = true;
      for (const p of palettePending.values()) {
        clearTimeout(p.timeout);
        p.resolve(null);
      }
      palettePending.clear();
      paletteWorker?.terminate();
      paletteWorker = null;
    };
    return paletteWorker;
  }

  function extractViaWorker(url) {
    const worker = getPaletteWorker();
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++paletteWorkerSeq;
      const timeout = setTimeout(() => {
        palettePending.delete(id);
        resolve(null);
      }, 8000);
      palettePending.set(id, { resolve, timeout });
      worker.postMessage({ id, url });
    });
  }

  async function getAmbientPalette(cacheKey, url) {
    if (!cacheKey || !url) return null;
    if (paletteCache.has(cacheKey)) return paletteCache.get(cacheKey);
    if (paletteInflight.has(cacheKey)) return paletteInflight.get(cacheKey);

    const p = extractViaWorker(url).then((colors) => {
      const result = colors && colors.length > 0 ? classifyPalette(colors) : null;
      if (paletteCache.size >= 500) {
        const first = paletteCache.keys().next().value;
        if (first !== undefined) paletteCache.delete(first);
      }
      paletteCache.set(cacheKey, result);
      paletteInflight.delete(cacheKey);
      return result;
    });
    paletteInflight.set(cacheKey, p);
    return p;
  }

  return {
    DISCOVERY_DB_NAME,
    DISCOVERY_STORES,
    SHELF_ORDER,
    DEFAULT_SHELF_LIMITS,
    SMART_PLAYLIST_CARDS,
    COLD_START_THRESHOLD_PLAYS,
    openDiscoveryDb,
    makeScrobbleKey,
    getScrobbleThresholdMs,
    hasScrobbledKeySync,
    hasScrobbledKey,
    markScrobbledKey,
    enqueueFailedScrobble,
    getScrobbleQueueCount,
    flushScrobbleQueue,
    isThresholdCrossed,
    migrateLegacyHistory,
    appendPlayEvent,
    getTrackAggregate,
    getAllTrackAggregates,
    getPlayEventLog,
    getPlayEventCount,
    exportPlayEventLogJson,
    importPlayEventLogJson,
    clearPlayEventLog,
    getDailySeed,
    getEffectivePlayCount,
    getLastPlayedMs,
    computeHomeShelves,
    getOrComputeHomeShelves,
    clearShelfCache,
    createBuiltInHomeSmartPlaylists,
    loadSmartPlaylistsFromDb,
    saveSmartPlaylistToDb,
    evaluateNspPlaylist,
    serializeToNspJson,
    downloadNspFile,
    splitSessions,
    lastSessionTrackIds,
    getExcludedSessionIds,
    setSessionExcluded,
    getBlockedArtistIds,
    loadCooccurrenceIndex,
    rebuildCooccurrenceIndex,
    notePlayEventForCooccurrence,
    isCompletedPlay,
    isSkip,
    computeTasteMap,
    generateRadio,
    generateRadioQueue,
    getRadioReason,
    checkRadioReadiness,
    foldSearchText,
    kanaFold,
    canonicalRomaji,
    buildSortKey,
    buildSearchKeysForText,
    getFrecencyMap,
    reconcileServerPlays,
    recordAdaptivePick,
    getAdaptivePicks,
    ensureSearchIndex,
    tokenizeSearchQuery,
    rankSearch,
    normalizeAlbumName,
    mergeAlbums,
    mergeAlbumSongs,
    getAmbientPalette,
  };
})();
