// Plenrip Audio - Application UI, Views, Routing, Modals & Shortcuts
// Zero-framework vanilla JS controller. No build step: just serve this folder over HTTP.

(function () {
  const {
    STORAGE_KEYS,
    DEFAULT_CONFIG,
    LYRICS_PROVIDERS_META,
    DEFAULT_LYRICS_PRIORITY,
    PLACEHOLDER_IMAGE_HASH,
    SubsonicClient,
    SubsonicApiError,
    SubsonicRequestTimeoutError,
    normalizeServerUrlInput,
    isValidHttpUrl,
    isMixedContentRisk,
    formatServerHost,
    TitleTranslationStore,
    LyricsManager,
    HistoryStore,
    GaplessAudioEngine,
    findActiveLineIndex,
    findActiveLeadIndex,
    findBgParentIndex,
    findInstrumentalGaps,
    hasJapaneseScript,
    processJapaneseLyrics,
    generateAuraPlaceholder,
    fetchDeezerArtistImageJsonp,
    generatePlaylistCollage,
    balancedShuffle,
  } = window.PlenripEngine;

  // Core instances
  const client = new SubsonicClient();
  const lyricsManager = new LyricsManager();
  const historyStore = new HistoryStore();
  const titles = new TitleTranslationStore();
  let audioEngine = null;

  // ============================================================================
  // State & Appearance / Discovery Config
  // ============================================================================
  const PALETTE_VARIABLES = {
    'vela-blue': {
      '--background': '#0C0D10',
      '--sidebar': '#141414',
      '--foreground': '#EDEDED',
      '--card': '#1D1D1D',
      '--card-hover': '#262626',
      '--primary': '#7085FF',
      '--primary-foreground': '#0C0D10',
      '--primary-light': '#96A6FF',
      '--primary-hover': '#5C73F2',
      '--secondary': '#262626',
      '--muted': '#222328',
      '--muted-foreground': '#8C8E96',
      '--text-muted': '#C2C4CC',
      '--text-body': '#DCDDE3',
      '--border': '#262626',
      '--border-emphasis': '#35373E',
      '--border-strong': '#4C4F59',
      '--destructive': '#f0605a',
    },
    'plenrip-classic': {
      '--background': '#101010',
      '--sidebar': '#131313',
      '--foreground': '#ebebeb',
      '--card': '#161616',
      '--card-hover': '#1e1e1e',
      '--primary': '#8ab8a0',
      '--primary-foreground': '#101010',
      '--primary-light': '#a3d4b8',
      '--primary-hover': '#7aa892',
      '--secondary': '#1e1e1e',
      '--muted': '#1e1e1e',
      '--muted-foreground': '#939393',
      '--text-muted': '#c8c8c2',
      '--text-body': '#dcdcd6',
      '--border': '#2a2a2a',
      '--border-emphasis': '#3a3a3a',
      '--border-strong': '#525252',
      '--destructive': '#f0605a',
    },
    'crimson-rose': {
      '--background': '#0D0B0C',
      '--sidebar': '#131012',
      '--foreground': '#F2ECEE',
      '--card': '#1A1517',
      '--card-hover': '#251E21',
      '--primary': '#F43F5E',
      '--primary-foreground': '#0D0B0C',
      '--primary-light': '#FB7185',
      '--primary-hover': '#E11D48',
      '--secondary': '#251E21',
      '--muted': '#211A1D',
      '--muted-foreground': '#9A8C91',
      '--text-muted': '#CEC2C6',
      '--text-body': '#E4DCE0',
      '--border': '#2B2226',
      '--border-emphasis': '#3D3035',
      '--border-strong': '#57444C',
      '--destructive': '#f0605a',
    },
    'amber-gold': {
      '--background': '#0F0E0C',
      '--sidebar': '#151310',
      '--foreground': '#F2EFE9',
      '--card': '#1C1915',
      '--card-hover': '#27231D',
      '--primary': '#F59E0B',
      '--primary-foreground': '#0F0E0C',
      '--primary-light': '#FBBF24',
      '--primary-hover': '#D97706',
      '--secondary': '#27231D',
      '--muted': '#221E19',
      '--muted-foreground': '#9B9386',
      '--text-muted': '#CFC8BC',
      '--text-body': '#E5DFD5',
      '--border': '#2C2720',
      '--border-emphasis': '#3E372D',
      '--border-strong': '#594F41',
      '--destructive': '#f0605a',
    },
    'emerald-mint': {
      '--background': '#0B0F0E',
      '--sidebar': '#101614',
      '--foreground': '#EAF2EF',
      '--card': '#161E1C',
      '--card-hover': '#1F2A27',
      '--primary': '#10B981',
      '--primary-foreground': '#0B0F0E',
      '--primary-light': '#34D399',
      '--primary-hover': '#059669',
      '--secondary': '#1F2A27',
      '--muted': '#1B2522',
      '--muted-foreground': '#859992',
      '--text-muted': '#BDD0C9',
      '--text-body': '#D8E6E1',
      '--border': '#22302C',
      '--border-emphasis': '#31443F',
      '--border-strong': '#46615A',
      '--destructive': '#f0605a',
    },
  };

  const RADIUS_PRESETS = {
    sharp: { outer: '0px', inner: '0px' },
    subtle: { outer: '6px', inner: '4px' },
    vela: { outer: '12px', inner: '8px' },
    pill: { outer: '18px', inner: '12px' },
  };

  function readRecentSearches() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECENT_SEARCHES) || '[]');
      return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string' && s.trim()).slice(0, 12) : [];
    } catch {
      return [];
    }
  }

  const state = {
    route: 'home',
    previousRoute: 'home',
    sidebarCollapsed: localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true',
    queueOpen: false,
    lyricsDrawerOpen: false,
    signatureOpen: false,
    lyricsSourceModalOpen: false,
    shortcutsModalOpen: false,
    settingsOpen: false,
    npTab: 'queue',
    npMobileOverlay: null, // null | 'queue' | 'lyrics'
    npRailWidth: Math.max(280, Math.min(720, parseInt(localStorage.getItem(STORAGE_KEYS.NP_PANEL_WIDTH) || '360', 10) || 360)),

    // Appearance & Discovery Settings
    appearance: {
      palette: localStorage.getItem(STORAGE_KEYS.THEME_PALETTE) || 'vela-blue',
      radius: localStorage.getItem(STORAGE_KEYS.THEME_RADIUS) || 'vela',
      denseRows: localStorage.getItem(STORAGE_KEYS.DENSE_VARIANT) === 'true',
      pauseAnimations: localStorage.getItem(STORAGE_KEYS.PAUSE_ANIMATIONS) === 'true',
    },
    discoverySettings: {
      adventurousness: localStorage.getItem(STORAGE_KEYS.ADVENTUROUSNESS) || 'balanced',
      silenceDays: Math.max(14, Math.min(180, parseInt(localStorage.getItem(STORAGE_KEYS.SILENCE_DAYS) || '45', 10) || 45)),
      starredCooldownDays: Math.max(0, Math.min(30, parseInt(localStorage.getItem(STORAGE_KEYS.STARRED_COOLDOWN_DAYS) || '7', 10) || 7)),
      quickPickExclusionHours: Math.max(0, Math.min(24, parseInt(localStorage.getItem(STORAGE_KEYS.QUICKPICK_EXCLUSION_HOURS) || '6', 10) || 6)),
      maxPerArtist: Math.max(1, Math.min(5, parseInt(localStorage.getItem(STORAGE_KEYS.MAX_PER_ARTIST_SHELF) || '2', 10) || 2)),
    },

    // Library caches (loaded fully once, filtered/sorted/paginated on the client)
    artists: null,
    songs: null,
    songsPromise: null,
    albumsByType: {},
    mergedAlbums: null,
    searchIndex: null,
    artistInfoCache: new Map(),

    currentArtist: null,
    currentArtistAlbums: [],
    currentArtistSongsPromise: null,
    artistPopularSongs: [],
    artistPopularExpanded: false,
    currentAlbum: null,
    albumBackRoute: 'albums',
    currentPlaylist: null,
    deletePlaylistConfirm: false,
    smartPlaylists: [],
    playlistCoverTargetId: null,
    playlistCoverStagedDataUrl: null,

    playlists: [],
    playlistCollages: new Map(),
    starredSongIds: new Set(),
    starredAlbumIds: new Set(),
    starredArtistIds: new Set(),
    serverBookmarks: [],

    // Multi-select
    multiSelect: new Set(),
    multiSelectSongs: new Map(),
    multiSelectScope: null,
    favouriteSongs: [],
    starredArtists: [],
    starredAlbums: [],

    // Search
    searchQuery: '',
    searchTimer: null,
    searchResults: { artist: [], album: [], song: [], top: null },
    searchNavItems: [],
    searchSelectedIndex: -1,
    recentSearches: readRecentSearches(),

    // Lyrics for active track
    lyrics: {
      trackId: null,
      loading: false,
      result: null,
      romaji: null,
      en: null,
      preparing: false,
      activeIdx: -1,
    },
    providerProbes: {},

    // Ambient OKLCH mesh dual-buffer toggle
    npMeshUseB: false,
    sigMeshUseB: false,

    // Context menu + add-to-playlist
    ctxSong: null,
    ctxQueueIndex: null,
    addPlaylistSongs: [],

    scrubbing: false,
    lastNonZeroVolume: 0.85,
    connected: true,
  };

  // ============================================================================
  // Helpers & Appearance Engine
  // ============================================================================
  const $ = (id) => document.getElementById(id);

  function applyAppearanceTheme() {
    const palKey = PALETTE_VARIABLES[state.appearance.palette] ? state.appearance.palette : 'vela-blue';
    const radKey = RADIUS_PRESETS[state.appearance.radius] ? state.appearance.radius : 'vela';
    state.appearance.palette = palKey;
    state.appearance.radius = radKey;

    const root = document.documentElement;
    root.setAttribute('data-palette', palKey);
    root.setAttribute('data-radius', radKey);
    if (state.appearance.pauseAnimations) root.setAttribute('data-motion-paused', 'true');
    else root.removeAttribute('data-motion-paused');

    const vars = PALETTE_VARIABLES[palKey];
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    const rad = RADIUS_PRESETS[radKey];
    root.style.setProperty('--radius', rad.outer);
    root.style.setProperty('--radius-inner', rad.inner);

    if (document.body) {
      document.body.dataset.variant = state.appearance.denseRows ? 'dense' : 'comfortable';
    }
  }

  function updateViewportScale() {
    if (typeof window === 'undefined') return;
    const scale = Math.max(0.82, Math.min(1.18, window.innerWidth / 1920));
    document.documentElement.style.setProperty('--scale', scale.toFixed(3));
  }

  function triggerCoverFly(sourceEl, targetSelector = '#player-cover-btn') {
    if (!sourceEl || state.appearance.pauseAnimations) return;
    if (window.PlenripAnimations?.coverFly) {
      window.PlenripAnimations.coverFly(sourceEl, targetSelector);
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(seconds) {
    if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  function formatTotalDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 min';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.max(1, Math.round((seconds % 3600) / 60));
    return hours > 0 ? `${hours} hr ${mins} min` : `${mins} min`;
  }

  function formatRelativeDaysAgo(ms) {
    if (!ms || ms <= 0) return 'Never played';
    const days = Math.max(1, Math.floor((Date.now() - ms) / 86400000));
    if (days >= 365) return `${Math.floor(days / 365)}y ago`;
    if (days >= 30) return `${Math.floor(days / 30)}mo ago`;
    return `${days}d ago`;
  }

  let iconTimer = null;
  function refreshIcons() {
    if (iconTimer) return;
    iconTimer = requestAnimationFrame(() => {
      iconTimer = null;
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
      }
    });
  }

  function setIcon(el, name) {
    if (!el || el.getAttribute('data-lucide') === name) return;
    el.setAttribute('data-lucide', name);
    refreshIcons();
  }

  function show(el, visible = true) {
    if (el) el.classList.toggle('hidden', !visible);
  }

  let toastTimer = null;
  function showToast(message) {
    const el = $('toast-banner');
    if (!el) return;
    if (window.PlenripAnimations?.showToast) {
      window.PlenripAnimations.showToast(el, message);
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function titleHtml(title, artist = '') {
    return titles.formatDisplayTitleHtml(title, artist);
  }

  function queueTranslations(items) {
    titles.ensureTranslations(items);
  }

  const MODE_ACTIVE = ['bg-emerald-400', 'text-zinc-950', 'font-semibold'];
  function setModeButton(btn, active) {
    MODE_ACTIVE.forEach((c) => btn.classList.toggle(c, active));
    btn.classList.toggle('text-zinc-400', !active);
    btn.classList.toggle('text-zinc-300', false);
    btn.classList.toggle('bg-zinc-900', !active && (btn.classList.contains('norm-mode-btn') || btn.classList.contains('adv-mode-btn')));
    btn.classList.toggle('border-emerald-400', active && (btn.classList.contains('norm-mode-btn') || btn.classList.contains('adv-mode-btn')));
  }

  function setPressed(btn, pressed) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.classList.toggle('text-emerald-400', pressed);
    btn.classList.toggle('border-emerald-400', pressed);
    btn.classList.toggle('text-zinc-400', !pressed);
  }

  function getCustomPlaylistCover(playlistId) {
    if (!playlistId) return '';
    try {
      return localStorage.getItem(`century.playlist.cover.${playlistId}`) || '';
    } catch {
      return '';
    }
  }

  function setCustomPlaylistCover(playlistId, dataUrl) {
    if (!playlistId) return;
    try {
      if (dataUrl) localStorage.setItem(`century.playlist.cover.${playlistId}`, dataUrl);
      else localStorage.removeItem(`century.playlist.cover.${playlistId}`);
    } catch {
      showToast('Image too large for browser storage');
    }
  }

  function updateSidebarCounts() {
    const setCnt = (id, val) => {
      const el = $(id);
      if (el) el.textContent = typeof val === 'number' && val > 0 ? String(val) : '';
    };
    setCnt('nav-count-artists', state.artists?.length || 0);
    setCnt('nav-count-albums', state.mergedAlbums?.length || state.albumsByType?.newest?.length || 0);
    setCnt('nav-count-songs', state.songs?.length || 0);
    setCnt('nav-count-playlists', state.playlists?.length || 0);
    setCnt('nav-count-favourites', state.favouriteSongs?.length || state.starredSongIds?.size || 0);
  }

  function renderSidebarContinue() {
    const wrap = $('sidebar-continue-section');
    const list = $('sidebar-continue-list');
    if (!wrap || !list) return;
    const currentId = audioEngine?.currentSong?.id || null;
    const localItems = historyStore.getContinueListening(currentId, 3);
    const seen = new Set(localItems.map((i) => i.song?.id).filter(Boolean));
    const combined = [...localItems];
    for (const bm of state.serverBookmarks || []) {
      if (combined.length >= 3) break;
      if (!bm?.entry?.id || bm.entry.id === currentId || seen.has(bm.entry.id)) continue;
      seen.add(bm.entry.id);
      combined.push({
        song: bm.entry,
        positionSeconds: Math.round((bm.position || 0) / 1000),
        durationSeconds: bm.entry.duration || 180,
      });
    }
    show(wrap, combined.length > 0 && !state.sidebarCollapsed);
    list.innerHTML = '';
    combined.slice(0, 3).forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'sidebar-nav-btn w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors';
      const pct = Math.max(4, Math.min(98, Math.round((item.positionSeconds / Math.max(1, item.durationSeconds)) * 100)));
      btn.innerHTML = `
        <i data-lucide="play-circle" class="w-3.5 h-3.5 text-emerald-400 shrink-0"></i>
        <span class="flex-1 min-w-0 text-left">
          <span class="block truncate text-[11.5px] font-medium">${escapeHtml(item.song.title || 'Untitled')}</span>
          <span class="mt-0.5 block w-full h-0.5 bg-zinc-800 overflow-hidden"><span class="block h-full bg-emerald-400" style="width:${pct}%"></span></span>
        </span>`;
      btn.addEventListener('click', () => {
        audioEngine.playQueue([item.song], 0, {
          shuffle: false,
          startTime: item.positionSeconds,
          source: 'shelf',
          contextName: 'Continue Listening',
        });
      });
      list.appendChild(btn);
    });
    refreshIcons();
  }

  // Cache of verified album cover URLs loaded on the Artist Discography / Album views (keyed by album.id)
  const artistAlbumCoverCache = new Map();

  // Reference 16x16 pixel fingerprint for Navidrome's default blue vinyl placeholder image
  const navidromePlaceholderState = {
    probing: null,
    pixels: null,
  };

  function isPlaceholderCoverValue(val) {
    if (!val || typeof val !== 'string') return true;
    const clean = val.trim();
    if (!clean) return true;
    if (clean.includes(PLACEHOLDER_IMAGE_HASH)) return true;
    if (/placeholder|default[-_]?album|no[-_]?album|no[-_]?cover|default[-_]?cover/i.test(clean)) {
      return true;
    }
    // Navidrome emits "al-<albumId>_0" when an album has no indexed coverArt (zero timestamp)
    if (/^al-[^_]+_0(?:$|\?|&)/i.test(clean) || /[?&]id=al-[^&_]+_0(?:$|&)/i.test(clean)) {
      return true;
    }
    return false;
  }

  function sampleImagePixels16(url) {
    return new Promise((resolve) => {
      if (!url || typeof document === 'undefined') return resolve(null);
      const probeImg = new Image();
      probeImg.crossOrigin = 'anonymous';
      probeImg.onload = () => {
        try {
          if (probeImg.naturalWidth <= 2 || probeImg.naturalHeight <= 2) {
            return resolve(null);
          }
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 16;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(probeImg, 0, 0, 16, 16);
          const data = ctx.getImageData(0, 0, 16, 16).data;
          resolve(data);
        } catch {
          resolve(null);
        }
      };
      probeImg.onerror = () => resolve(null);
      probeImg.src = url;
    });
  }

  function getNavidromePlaceholderFingerprint() {
    if (navidromePlaceholderState.pixels) {
      return Promise.resolve(navidromePlaceholderState.pixels);
    }
    if (navidromePlaceholderState.probing) {
      return navidromePlaceholderState.probing;
    }
    const probeUrl = client.getCoverArtUrl('al-__navidrome_placeholder_probe___0', 64);
    navidromePlaceholderState.probing = sampleImagePixels16(probeUrl)
      .then((px) => {
        navidromePlaceholderState.pixels = px;
        return px;
      })
      .catch(() => null);
    return navidromePlaceholderState.probing;
  }

  function matchesBlueVinylPlaceholderGeometry(px) {
    if (!px || px.length < 16 * 16 * 4) return false;
    const getRgb = (x, y) => {
      const idx = (y * 16 + x) * 4;
      return [px[idx], px[idx + 1], px[idx + 2]];
    };
    const colorDiff = (a, b) =>
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

    // 1. All 4 outer background corners must be uniform solid dark/neutral gray
    const c1 = getRgb(1, 1);
    const c2 = getRgb(14, 1);
    const c3 = getRgb(1, 14);
    const c4 = getRgb(14, 14);
    if (colorDiff(c1, c2) > 8 || colorDiff(c1, c3) > 8 || colorDiff(c1, c4) > 8) {
      return false;
    }

    // 2. 4 cardinal points on the vinyl disc ring must be symmetrical and distinctly blue-dominant (B > R + 25)
    const rTop = getRgb(8, 4);
    const rBot = getRgb(8, 11);
    const rLeft = getRgb(4, 8);
    const rRight = getRgb(11, 8);
    const isBlueDisc =
      rTop[2] > rTop[0] + 25 &&
      rBot[2] > rBot[0] + 25 &&
      rLeft[2] > rLeft[0] + 25 &&
      rRight[2] > rRight[0] + 25;
    if (!isBlueDisc) return false;

    const ringSymmetric =
      colorDiff(rTop, rBot) < 24 &&
      colorDiff(rLeft, rRight) < 24 &&
      colorDiff(rTop, rLeft) < 28;
    const distinctFromBg = colorDiff(c1, rTop) > 35;

    return ringSymmetric && distinctFromBg;
  }

  async function isNavidromePlaceholderImageUrl(url) {
    if (isPlaceholderCoverValue(url)) return true;
    const px = await sampleImagePixels16(url);
    if (!px) return false;

    const refPx = await getNavidromePlaceholderFingerprint();
    if (refPx && refPx.length === px.length) {
      let totalDiff = 0;
      const channels = 16 * 16 * 3;
      for (let i = 0; i < px.length; i += 4) {
        totalDiff +=
          Math.abs(px[i] - refPx[i]) +
          Math.abs(px[i + 1] - refPx[i + 1]) +
          Math.abs(px[i + 2] - refPx[i + 2]);
      }
      if (totalDiff / channels < 4.5) {
        return true;
      }
    }

    return matchesBlueVinylPlaceholderGeometry(px);
  }

  /**
   * Build ordered fallback cover URLs from an album's tracks (/rest/getCoverArt?id=<track.coverArt>).
   */
  function resolveAlbumTrackFallbackUrls(album, size = 500) {
    const tracks = Array.isArray(album?.song)
      ? album.song
      : Array.isArray(album?._virtualSongs)
        ? album._virtualSongs
        : [];
    const urls = [];
    const pushCoverId = (cid) => {
      if (!cid || isPlaceholderCoverValue(cid)) return;
      const u = client.getCoverArtUrl(cid, size);
      if (u && !urls.includes(u)) urls.push(u);
    };

    // 1. Prefer the first track whose valid coverArt ID differs from the album-level coverArt ID
    const distinctTrack = tracks.find(
      (t) => t && t.coverArt && !isPlaceholderCoverValue(t.coverArt) && t.coverArt !== album?.coverArt
    );
    if (distinctTrack?.coverArt) {
      pushCoverId(distinctTrack.coverArt);
    }

    // 2. First track in album.song that has any valid coverArt ID (tracks[0].coverArt)
    const firstWithCover = tracks.find((t) => t && t.coverArt && !isPlaceholderCoverValue(t.coverArt));
    if (firstWithCover?.coverArt) {
      pushCoverId(firstWithCover.coverArt);
    }

    // 3. Direct Navidrome mediafile coverArt ID (mf-<track.id>) and raw track.id for the first track
    const firstTrack = firstWithCover || tracks[0];
    if (firstTrack?.id) {
      if (!String(firstTrack.id).startsWith('mf-')) {
        pushCoverId(`mf-${firstTrack.id}`);
      }
      pushCoverId(firstTrack.id);
    }

    return {
      trackFallbackUrls: urls,
      firstTrackCoverUrl: urls[0] || '',
      fallbackSongId: firstTrack?.id || null,
    };
  }

  /**
   * Dedicated Album Detail Page Header Cover Resolver:
   * 1. Check if a valid coverArt URL was already loaded/cached from the Artist page view for album.id.
   * 2. Otherwise, use album.coverArt via /rest/getCoverArt.
   * 3. Automatic Track Fallback: If album.coverArt is missing, null, fails to load (onerror), or resolves
   *    to Navidrome's placeholder image, automatically fall back to the first track's artwork
   *    (tracks[0].coverArt or first track in album.song with a valid coverArt ID) via /rest/getCoverArt?id=<track.coverArt>.
   */
  function attachAlbumDetailCover(imgEl, fallbackEl, album, size = 500) {
    if (!imgEl || !album) return;
    imgEl.classList.add('hidden');
    if (fallbackEl) fallbackEl.classList.remove('hidden');
    imgEl.onload = null;
    imgEl.onerror = null;
    imgEl.removeAttribute('src');
    imgEl.dataset.fallbackAttempted = 'false';
    imgEl.dataset.streamFallbackAttempted = 'false';

    const albumId = album.id || '';
    const { trackFallbackUrls, firstTrackCoverUrl, fallbackSongId } = resolveAlbumTrackFallbackUrls(album, size);

    // Priority 1: Valid coverArt URL already loaded/cached from the Artist page view for this album.id
    const artistViewAlbum =
      (Array.isArray(state.currentArtistAlbums) && albumId
        ? state.currentArtistAlbums.find((a) => a && a.id === albumId)
        : null) || null;
    const cachedUrl =
      (albumId && artistAlbumCoverCache.get(albumId)) ||
      album._cachedCoverUrl ||
      artistViewAlbum?._cachedCoverUrl ||
      '';

    // Priority 2: album.coverArt via /rest/getCoverArt (or artistViewAlbum.coverArt if present)
    const rawAlbumCoverId =
      (!isPlaceholderCoverValue(album.coverArt) ? album.coverArt : '') ||
      (!isPlaceholderCoverValue(artistViewAlbum?.coverArt) ? artistViewAlbum.coverArt : '');
    const albumCoverUrl = rawAlbumCoverId ? client.getCoverArtUrl(rawAlbumCoverId, size) : '';

    // Priority 3: Automatic Track Fallback when album.coverArt is missing, null, or a placeholder ID
    let primaryUrl = '';
    let usingTrackFallbackInitially = false;
    if (cachedUrl && !isPlaceholderCoverValue(cachedUrl)) {
      primaryUrl = cachedUrl;
    } else if (albumCoverUrl && !isPlaceholderCoverValue(albumCoverUrl)) {
      primaryUrl = albumCoverUrl;
    } else if (firstTrackCoverUrl) {
      primaryUrl = firstTrackCoverUrl;
      usingTrackFallbackInitially = true;
      imgEl.dataset.fallbackAttempted = 'true';
    }

    const remainingFallbacks = trackFallbackUrls.filter((u) => u && u !== primaryUrl);

    const swapToTrackFallback = async () => {
      // Guarded fallback swap: first swap to the first track's getCoverArt URL, then any remaining candidate
      if (imgEl.dataset.fallbackAttempted !== 'true' && firstTrackCoverUrl && firstTrackCoverUrl !== imgEl.src) {
        imgEl.dataset.fallbackAttempted = 'true';
        const idx = remainingFallbacks.indexOf(firstTrackCoverUrl);
        if (idx >= 0) remainingFallbacks.splice(idx, 1);
        imgEl.src = firstTrackCoverUrl;
        return;
      }

      if (remainingFallbacks.length > 0) {
        imgEl.dataset.fallbackAttempted = 'true';
        const nextUrl = remainingFallbacks.shift();
        if (nextUrl && nextUrl !== imgEl.src) {
          imgEl.src = nextUrl;
          return;
        }
      }

      if (fallbackSongId && imgEl.dataset.streamFallbackAttempted !== 'true') {
        imgEl.dataset.streamFallbackAttempted = 'true';
        const streamUrl = await client.extractCoverFromStream(fallbackSongId);
        if (streamUrl) {
          imgEl.onload = () => {
            imgEl.classList.remove('hidden');
            if (fallbackEl) fallbackEl.classList.add('hidden');
          };
          imgEl.onerror = null;
          imgEl.src = streamUrl;
          return;
        }
      }

      imgEl.onload = null;
      imgEl.onerror = null;
      imgEl.classList.add('hidden');
      if (fallbackEl) fallbackEl.classList.remove('hidden');
    };

    imgEl.onerror = () => {
      swapToTrackFallback();
    };

    imgEl.onload = async () => {
      const loadedSrc = imgEl.currentSrc || imgEl.src || '';
      if (imgEl.naturalWidth <= 2 || isPlaceholderCoverValue(loadedSrc)) {
        swapToTrackFallback();
        return;
      }

      imgEl.classList.remove('hidden');
      if (fallbackEl) fallbackEl.classList.add('hidden');

      // If we haven't fallen back to track art yet (or if additional fallbacks exist), verify Navidrome didn't return its blue vinyl placeholder
      if (
        (!usingTrackFallbackInitially || remainingFallbacks.length > 0) &&
        (firstTrackCoverUrl || remainingFallbacks.length > 0 || fallbackSongId)
      ) {
        const isPlaceholder = await isNavidromePlaceholderImageUrl(loadedSrc);
        if (isPlaceholder) {
          if (albumId && artistAlbumCoverCache.get(albumId) === loadedSrc) {
            artistAlbumCoverCache.delete(albumId);
          }
          swapToTrackFallback();
          return;
        }
      }

      if (albumId && loadedSrc) {
        artistAlbumCoverCache.set(albumId, loadedSrc);
        album._cachedCoverUrl = loadedSrc;
      }
    };

    if (primaryUrl) {
      imgEl.src = primaryUrl;
      if (imgEl.complete && imgEl.naturalWidth > 2) {
        imgEl.classList.remove('hidden');
        if (fallbackEl) fallbackEl.classList.add('hidden');
      }
    } else {
      swapToTrackFallback();
    }
  }

  // Cover art with optional track coverId & stream-header fallback
  function attachCoverImage(imgEl, fallbackEl, coverId, fallbackSongId, size = 300, extraOpts = {}) {
    if (!imgEl) return;
    const useFade = Boolean(extraOpts.animateFade);
    if (useFade) {
      window.PlenripAnimations?.prepareCoverCrossfade?.(imgEl);
    }
    imgEl.classList.add('hidden');
    if (fallbackEl) fallbackEl.classList.remove('hidden');
    imgEl.removeAttribute('src');
    imgEl.dataset.fallbackAttempted = 'false';

    const fallbackCoverId = extraOpts.fallbackCoverId || null;
    const cacheAlbumId = extraOpts.cacheAlbumId || null;
    const fallbackCoverUrl =
      fallbackCoverId && !isPlaceholderCoverValue(fallbackCoverId)
        ? client.getCoverArtUrl(fallbackCoverId, size)
        : '';

    const tryFallback = async () => {
      if (
        imgEl.dataset.fallbackAttempted !== 'true' &&
        fallbackCoverUrl &&
        imgEl.src !== fallbackCoverUrl
      ) {
        imgEl.dataset.fallbackAttempted = 'true';
        imgEl.src = fallbackCoverUrl;
        return;
      }
      imgEl.onload = null;
      imgEl.onerror = null;
      if (fallbackSongId) {
        const streamUrl = await client.extractCoverFromStream(fallbackSongId);
        if (streamUrl) {
          imgEl.src = streamUrl;
          imgEl.classList.remove('hidden');
          if (fallbackEl) fallbackEl.classList.add('hidden');
          if (useFade) window.PlenripAnimations?.finishCoverCrossfade?.(imgEl);
          if (cacheAlbumId) {
            artistAlbumCoverCache.set(cacheAlbumId, streamUrl);
          }
        }
      }
    };

    const showImg = (url) => {
      if (!url) return;
      let fadeFinished = false;
      const revealLoaded = () => {
        imgEl.classList.remove('hidden');
        if (fallbackEl) fallbackEl.classList.add('hidden');
        if (useFade && !fadeFinished) {
          fadeFinished = true;
          window.PlenripAnimations?.finishCoverCrossfade?.(imgEl);
        }
      };
      imgEl.onload = async () => {
        const loadedSrc = imgEl.currentSrc || imgEl.src || url;
        revealLoaded();

        if (cacheAlbumId) {
          const isPlaceholder = await isNavidromePlaceholderImageUrl(loadedSrc);
          if (isPlaceholder) {
            tryFallback();
            return;
          }
          artistAlbumCoverCache.set(cacheAlbumId, loadedSrc);
          if (extraOpts.albumRef) {
            extraOpts.albumRef._cachedCoverUrl = loadedSrc;
          }
        }
      };
      imgEl.onerror = () => {
        tryFallback();
      };
      imgEl.src = url;
      if (imgEl.complete && imgEl.naturalWidth > 0) {
        revealLoaded();
      }
    };

    const validPrimaryId = coverId && !isPlaceholderCoverValue(coverId) ? coverId : fallbackCoverId;
    if (extraOpts.cachedCoverUrl && !isPlaceholderCoverValue(extraOpts.cachedCoverUrl)) {
      showImg(extraOpts.cachedCoverUrl);
    } else if (validPrimaryId && !isPlaceholderCoverValue(validPrimaryId)) {
      showImg(client.getCoverArtUrl(validPrimaryId, size));
    } else if (fallbackSongId) {
      client.extractCoverFromStream(fallbackSongId).then((u) => u && showImg(u));
    }
  }

  // 5-tier artist image resolver: coverArt -> artistImageUrl -> Deezer -> first album cover -> aura placeholder
  const artistImageCache = new Map();

  function probeImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 2 ? url : null);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function resolveArtistImage(artist) {
    const key = artist.id || artist.name;
    if (artistImageCache.has(key)) return artistImageCache.get(key);
    const promise = (async () => {
      if (artist.coverArt) {
        const ok = await probeImage(client.getCoverArtUrl(artist.coverArt, 300));
        if (ok) return ok;
      }
      const remote = artist.artistImageUrl;
      if (remote && !String(remote).includes(PLACEHOLDER_IMAGE_HASH)) {
        const ok = await probeImage(remote);
        if (ok) return ok;
      }
      const deezer = await fetchDeezerArtistImageJsonp(artist.name);
      if (deezer) {
        const ok = await probeImage(deezer);
        if (ok) return ok;
      }
      if (artist.id) {
        try {
          const detail = await client.getArtist(artist.id);
          const cover = (detail.album || []).find((a) => a.coverArt)?.coverArt;
          if (cover) {
            const ok = await probeImage(client.getCoverArtUrl(cover, 300));
            if (ok) return ok;
          }
        } catch {
          // fall through to placeholder
        }
      }
      return generateAuraPlaceholder(artist.name || artist.id);
    })();
    artistImageCache.set(key, promise);
    return promise;
  }

  function attachArtistImage(imgEl, fallbackEl, artist) {
    if (!imgEl) return;
    imgEl.classList.add('hidden');
    if (fallbackEl) fallbackEl.classList.remove('hidden');
    resolveArtistImage(artist).then((url) => {
      imgEl.onload = () => {
        imgEl.classList.remove('hidden');
        if (fallbackEl) fallbackEl.classList.add('hidden');
      };
      imgEl.src = url;
    });
  }

  // Listening statistics derived from the local history
  function getPlayStats() {
    const bySong = new Map();
    const byArtist = new Map();
    const byAlbum = new Map();
    const bump = (map, id, at) => {
      if (!id) return;
      const cur = map.get(id) || { count: 0, last: 0 };
      cur.count += 1;
      if (at > cur.last) cur.last = at;
      map.set(id, cur);
    };
    for (const e of historyStore.entries) {
      bump(bySong, e.songId, e.playedAt);
      bump(byArtist, e.artistId, e.playedAt);
      bump(byAlbum, e.albumId, e.playedAt);
    }
    return { bySong, byArtist, byAlbum };
  }

  // ============================================================================
  // Sidebar, Mobile Chrome & Navigation
  // ============================================================================
  const MAIN_VIEWS = [
    'welcome',
    'home',
    'now-playing',
    'search',
    'artists',
    'artist-detail',
    'albums',
    'album-detail',
    'songs',
    'files',
    'playlists',
    'playlist-detail',
    'favourites',
  ];
  const DETAIL_ROUTES = ['artist-detail', 'album-detail', 'playlist-detail'];

  function readWalkthroughState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.WALKTHROUGH_STATE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        status: ['in_progress', 'completed', 'skipped'].includes(parsed.status) ? parsed.status : 'in_progress',
        skippedSteps: Array.isArray(parsed.skippedSteps) ? parsed.skippedSteps.filter((n) => Number.isInteger(n)) : [],
        completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : undefined,
      };
    } catch {
      return null;
    }
  }

  function writeWalkthroughState(next) {
    try {
      localStorage.setItem(STORAGE_KEYS.WALKTHROUGH_STATE, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }

  function needsFirstWalkthrough() {
    if (!client.hasSavedCredentials()) return true;
    const wt = readWalkthroughState();
    return wt?.status === 'in_progress';
  }

  function applySidebarState() {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    setIcon($('sidebar-toggle-icon'), state.sidebarCollapsed ? 'chevron-right' : 'chevron-left');
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, state.sidebarCollapsed ? 'true' : 'false');
    const sidebar = $('sidebar');
    if (window.PlenripAnimations?.animateSidebarWidth && sidebar) {
      window.PlenripAnimations.animateSidebarWidth(sidebar, state.sidebarCollapsed);
      setIcon($('sidebar-toggle-icon'), state.sidebarCollapsed ? 'chevron-right' : 'chevron-left');
    } else {
      applySidebarState();
    }
  }

  function setMobileSidebar(open) {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    if (window.PlenripAnimations?.setMobileSidebar) {
      window.PlenripAnimations.setMobileSidebar(sidebar, $('mobile-sidebar-backdrop'), open);
      return;
    }
    sidebar.classList.toggle('-translate-x-full', !open);
    sidebar.classList.toggle('translate-x-0', open);
    show($('mobile-sidebar-backdrop'), open);
  }

  function navigateTo(route, options = {}) {
    if (!MAIN_VIEWS.includes(route)) route = 'home';
    const fromRoute = state.route;
    const fromEl = $(`view-${fromRoute}`);
    const toEl = $(`view-${route}`);
    const wasWelcome = fromRoute === 'welcome';
    if (fromRoute !== route) {
      state.previousRoute = wasWelcome ? 'home' : fromRoute;
    }
    state.route = route;
    const isWelcome = route === 'welcome';
    setMobileSidebar(false);
    // Multi-select is scoped to one view; leaving it clears the selection
    // so the action bar never acts on songs from a view the user left.
    clearMultiSelect();

    // Hide app chrome during onboarding walkthrough (update chrome BEFORE route transition so shell reveal sees visible chrome)
    show($('sidebar'), !isWelcome);
    show($('bottom-player-bar'), !isWelcome);
    if (isWelcome) {
      show($('mobile-top-bar'), false);
      show($('mobile-sidebar-backdrop'), false);
      show($('error-banner'), false);
    }

    const main = $('main-content');
    const allViewEls = MAIN_VIEWS.map((v) => $(`view-${v}`));
    if (window.PlenripAnimations?.transitionRoute) {
      window.PlenripAnimations.transitionRoute({
        fromRoute,
        toRoute: route,
        fromEl,
        toEl,
        mainEl: main,
        allViewEls,
        trigger: options.trigger,
        preserveScroll: options.preserveScroll,
        immediate: options.immediate,
        animateSameRoute: options.animateSameRoute,
      });
    } else {
      for (const v of MAIN_VIEWS) {
        show($(`view-${v}`), v === route);
      }
      if (main && !options.preserveScroll) main.scrollTop = 0;
    }

    document.querySelectorAll('.sidebar-nav-btn[data-route]').forEach((btn) => {
      const r = btn.getAttribute('data-route');
      const match =
        r === route ||
        (r === 'artists' && route === 'artist-detail') ||
        (r === 'albums' && route === 'album-detail' && state.albumBackRoute === 'albums') ||
        (r === 'artists' && route === 'album-detail' && state.albumBackRoute === 'artist-detail') ||
        (r === 'playlists' && route === 'playlist-detail');
      btn.classList.toggle('nav-item-active', match);
    });
    // Mobile tab bar active state (same mapping as the sidebar)
    document.querySelectorAll('.mobile-tab-btn[data-route]').forEach((btn) => {
      const r = btn.getAttribute('data-route');
      const match =
        r === route ||
        (r === 'artists' && route === 'artist-detail') ||
        (r === 'albums' && route === 'album-detail' && state.albumBackRoute === 'albums') ||
        (r === 'artists' && route === 'album-detail' && state.albumBackRoute === 'artist-detail') ||
        (r === 'playlists' && route === 'playlist-detail');
      btn.classList.toggle('text-primary', match);
      btn.classList.toggle('text-zinc-400', !match);
      btn.setAttribute('aria-current', match ? 'page' : 'false');
    });
    highlightSidebarPlaylists();

    // Mobile chrome
    const isNp = route === 'now-playing';
    if (!isWelcome) {
      show($('mobile-top-bar'), !isNp);
      $('mobile-top-bar')?.classList.toggle('md:hidden', true);
      const isDetail = DETAIL_ROUTES.includes(route);
      show($('mobile-back-btn'), isDetail);
      show($('mobile-menu-btn'), !isDetail);
      $('bottom-player-bar')?.classList.toggle('max-md:hidden', isNp);
    }

    if (route === 'welcome') initWelcomeView();
    else if (route === 'home') loadHomeView();
    else if (route === 'search') setTimeout(() => $('search-input')?.focus({ preventScroll: true }), 40);
    else if (route === 'artists') libraryViews.artists.load();
    else if (route === 'albums') libraryViews.albums.load();
    else if (route === 'songs') libraryViews.songs.load();
    else if (route === 'files') loadFilesView();
    else if (route === 'playlists') loadPlaylistsView();
    else if (route === 'favourites') loadFavouritesView();
    else if (route === 'now-playing') renderNowPlaying();

    updateLyricsVisibilityDependents();
    refreshIcons();
  }

  function goBack() {
    const r = state.route;
    if (r === 'welcome') return;
    if (r === 'album-detail') navigateTo(state.albumBackRoute || 'albums', { preserveScroll: true });
    else if (r === 'artist-detail') navigateTo('artists', { preserveScroll: true });
    else if (r === 'playlist-detail') navigateTo('playlists', { preserveScroll: true });
    else navigateTo(state.previousRoute && state.previousRoute !== 'now-playing' && state.previousRoute !== 'welcome' ? state.previousRoute : 'home');
  }

  // ============================================================================
  // Reusable UI builders: track rows, media cards
  // ============================================================================
  function isCurrentSong(song) {
    return Boolean(audioEngine?.currentSong && audioEngine.currentSong.id === song.id);
  }

  function updateRowActiveState(row) {
    const id = row.getAttribute('data-song-id');
    const current = audioEngine?.currentSong?.id === id;
    row.setAttribute('data-active', current ? 'true' : 'false');
    row.classList.toggle('bg-zinc-800', current);
    const idx = row.querySelector('.row-index');
    if (idx) {
      const playing = current && audioEngine.isPlaying;
      const num = escapeHtml(idx.getAttribute('data-num'));
      idx.innerHTML = current
        ? `<span class="group-hover:hidden text-emerald-400"><i data-lucide="${playing ? 'volume-2' : 'pause'}" class="w-3.5 h-3.5"></i></span><i data-lucide="${playing ? 'pause' : 'play'}" class="hidden group-hover:block w-3.5 h-3.5 text-zinc-100"></i>`
        : `<span class="group-hover:hidden text-zinc-400">${num}</span><i data-lucide="play" class="hidden group-hover:block w-3.5 h-3.5 text-zinc-100"></i>`;
    }
    const titleEl = row.querySelector('.row-title');
    if (titleEl) {
      titleEl.classList.toggle('text-emerald-400', current);
      titleEl.classList.toggle('text-zinc-100', !current);
    }
  }

  function refreshRowHighlights() {
    document.querySelectorAll('[data-song-id]').forEach(updateRowActiveState);
    refreshIcons();
  }

  function refreshStarButtons() {
    document.querySelectorAll('[data-star-song-id]').forEach((btn) => {
      const starred = state.starredSongIds.has(btn.getAttribute('data-star-song-id'));
      btn.classList.toggle('text-emerald-400', starred);
      btn.classList.toggle('text-zinc-400', !starred);
      const icon = btn.querySelector('svg, i');
      if (icon) icon.classList.toggle('fill-current', starred);
    });
  }

  function createTrackRowElement(song, index, queueContext, options = {}) {
    if (song.starred) state.starredSongIds.add(song.id);
    const isStarred = state.starredSongIds.has(song.id);

    const row = document.createElement('div');
    row.setAttribute('data-song-id', song.id);
    row.__song = song;
    row.draggable = true;
    row.className =
      'song-row group flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-800/80 hover:bg-zinc-800/70 transition-colors';
    if (options.selectable && state.multiSelect.has(song.id)) {
      row.classList.add('song-row-selected');
    }

    row.addEventListener('dragstart', (e) => {
      const selectedIds =
        state.multiSelect.has(song.id) && state.multiSelect.size > 0
          ? [...state.multiSelect]
          : [song.id];
      e.dataTransfer?.setData('application/x-plenrip-songs', JSON.stringify(selectedIds));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
    });

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0 flex-1';

    if (options.selectable) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'multi-select-checkbox shrink-0 w-4 h-4 cursor-pointer';
      cb.setAttribute('data-multi-select-checkbox', 'true');
      cb.setAttribute('data-song-id', song.id);
      cb.setAttribute('aria-label', `Select ${song.title || 'track'}`);
      cb.checked = state.multiSelect.has(song.id);
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMultiSelect(song, options.selectScope || state.route);
      });
      left.appendChild(cb);
      row.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          toggleMultiSelect(song, options.selectScope || state.route);
        }
      });
    }

    const idxBtn = document.createElement('button');
    idxBtn.type = 'button';
    idxBtn.className = 'row-index w-7 h-7 flex items-center justify-center shrink-0 text-xs font-mono';
    idxBtn.setAttribute('aria-label', `Play ${song.title || 'track'}`);
    idxBtn.setAttribute('data-num', String(options.showTrackNumber && song.track ? song.track : index + 1));

    let coverWrap = null;
    if (options.showCover !== false) {
      coverWrap = document.createElement('div');
      coverWrap.className = 'song-row-cover w-9 h-9 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center radius-inner';
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'hidden w-full h-full object-cover';
      const fb = document.createElement('div');
      fb.className = 'text-zinc-400 flex items-center justify-center';
      fb.innerHTML = '<i data-lucide="music" class="w-3.5 h-3.5"></i>';
      coverWrap.appendChild(img);
      coverWrap.appendChild(fb);
      attachCoverImage(img, fb, song.coverArt || song.albumId, song.id, 100);
    }

    const handlePlayClick = () => {
      if (!isCurrentSong(song) && coverWrap) {
        triggerCoverFly(coverWrap, '#player-cover-btn');
      }
      if (typeof options.onActivated === 'function') options.onActivated(song);
      playOrToggle(song, queueContext, index, {
        contextName: options.contextName,
        source: options.source,
      });
    };

    idxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePlayClick();
    });
    left.appendChild(idxBtn);
    if (coverWrap) left.appendChild(coverWrap);

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0 flex-1';

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'row-title block max-w-full truncate text-sm text-left font-medium text-zinc-100 hover:underline';
    titleBtn.innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
    titleBtn.addEventListener('click', handlePlayClick);

    const subLine = document.createElement('div');
    subLine.className = 'flex items-center gap-1.5 text-xs text-zinc-400 truncate';
    const artistBtn = document.createElement('button');
    artistBtn.type = 'button';
    artistBtn.className = 'truncate hover:text-zinc-100 hover:underline';
    artistBtn.textContent = song.artist || 'Unknown Artist';
    artistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (song.artistId) openArtistDetail(song.artistId);
    });
    subLine.appendChild(artistBtn);

    if (options.showAlbum !== false && song.album) {
      const dot = document.createElement('span');
      dot.textContent = '·';
      subLine.appendChild(dot);
      const albumBtn = document.createElement('button');
      albumBtn.type = 'button';
      albumBtn.className = 'truncate hover:text-zinc-100 hover:underline';
      albumBtn.textContent = song.album;
      albumBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (song.albumId) openAlbumDetail(song.albumId, state.route);
      });
      subLine.appendChild(albumBtn);
    }

    textWrap.appendChild(titleBtn);
    textWrap.appendChild(subLine);
    left.appendChild(textWrap);

    const right = document.createElement('div');
    right.className = 'flex items-center gap-1.5 shrink-0';

    if (options.badgeText) {
      const badge = document.createElement('span');
      badge.className = 'hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-zinc-900 border border-zinc-700 text-zinc-400 radius-inner';
      badge.textContent = options.badgeText;
      right.appendChild(badge);
    }

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.setAttribute('data-star-song-id', song.id);
    starBtn.setAttribute('aria-label', 'Star track');
    starBtn.title = 'Star track';
    starBtn.className = `p-1.5 transition-colors ${isStarred ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-100'}`;
    starBtn.innerHTML = `<i data-lucide="star" class="w-3.5 h-3.5 ${isStarred ? 'fill-current' : ''}"></i>`;
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarTrack(song);
    });
    right.appendChild(starBtn);

    const durSpan = document.createElement('span');
    durSpan.className = 'w-11 text-right text-xs font-mono text-zinc-400';
    durSpan.textContent = formatDuration(song.duration);
    right.appendChild(durSpan);

    const qBtn = document.createElement('button');
    qBtn.type = 'button';
    qBtn.title = 'Add to queue';
    qBtn.setAttribute('aria-label', 'Add to queue');
    qBtn.className = 'px-1.5 py-1 text-[10px] font-mono text-zinc-400 hover:text-emerald-400 border border-zinc-700 hover:border-emerald-400 transition-colors';
    qBtn.textContent = '+Q';
    qBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (coverWrap) triggerCoverFly(coverWrap, '#btn-queue');
      audioEngine.addToQueue(song);
      showToast(`Added "${song.title}" to queue`);
    });
    right.appendChild(qBtn);

    if (typeof options.onRemoveFromPlaylist === 'function') {
      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.title = 'Remove from playlist';
      remBtn.className = 'p-1.5 text-zinc-400 hover:text-[#f0605a]';
      remBtn.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onRemoveFromPlaylist(index);
      });
      right.appendChild(remBtn);
    }

    if (typeof options.onMoveTrack === 'function') {
      const total = Array.isArray(queueContext) ? queueContext.length : 0;
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.title = 'Move up (Alt+Up)';
      upBtn.setAttribute('aria-label', 'Move track up');
      upBtn.disabled = index <= 0;
      upBtn.className = `p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:pointer-events-none ${index <= 0 ? 'opacity-30' : ''}`;
      upBtn.innerHTML = '<i data-lucide="chevron-up" class="w-4 h-4"></i>';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onMoveTrack(index, index - 1);
      });
      right.appendChild(upBtn);
      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.title = 'Move down (Alt+Down)';
      downBtn.setAttribute('aria-label', 'Move track down');
      downBtn.disabled = index >= total - 1;
      downBtn.className = `p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:pointer-events-none ${index >= total - 1 ? 'opacity-30' : ''}`;
      downBtn.innerHTML = '<i data-lucide="chevron-down" class="w-4 h-4"></i>';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onMoveTrack(index, index + 1);
      });
      right.appendChild(downBtn);
      row.setAttribute('tabindex', '0');
      row.addEventListener('keydown', (e) => {
        if (!e.altKey) return;
        if (e.key === 'ArrowUp' && index > 0) {
          e.preventDefault();
          options.onMoveTrack(index, index - 1);
        } else if (e.key === 'ArrowDown' && index < total - 1) {
          e.preventDefault();
          options.onMoveTrack(index, index + 1);
        }
      });
    }

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.title = 'Track options';
    menuBtn.setAttribute('aria-label', 'More actions for track');
    menuBtn.className = 'p-1.5 text-zinc-400 hover:text-zinc-100';
    menuBtn.innerHTML = '<i data-lucide="more-vertical" class="w-4 h-4"></i>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTrackContextMenu(e, song, null);
    });
    right.appendChild(menuBtn);

    row.appendChild(left);
    row.appendChild(right);
    updateRowActiveState(row);
    return row;
  }

  function inferRouteContext() {
    if (state.route === 'album-detail' && state.currentAlbum) {
      return { contextName: state.currentAlbum.name || 'Album', source: 'album' };
    }
    if (state.route === 'playlist-detail' && state.currentPlaylist) {
      return { contextName: state.currentPlaylist.name || 'Playlist', source: 'playlist' };
    }
    if (state.route === 'artist-detail' && state.currentArtist) {
      return { contextName: state.currentArtist.name || 'Artist', source: 'artist' };
    }
    if (state.route === 'favourites') {
      return { contextName: 'Favourite Songs', source: 'playlist' };
    }
    if (state.route === 'songs') {
      return { contextName: 'Songs', source: 'other' };
    }
    if (state.route === 'search') {
      return { contextName: 'Search Results', source: 'search' };
    }
    if (state.route === 'home') {
      return { contextName: 'Home Mix', source: 'shelf' };
    }
    return { contextName: '', source: 'other' };
  }

  function playOrToggle(song, queueContext, index, extraOptions = {}) {
    if (isCurrentSong(song)) {
      audioEngine.togglePlayPause();
      return;
    }
    const queue = queueContext && queueContext.length > 0 ? queueContext : [song];
    const idx = typeof index === 'number' && queue[index]?.id === song.id ? index : queue.findIndex((s) => s.id === song.id);
    const inferred = inferRouteContext();
    audioEngine.playQueue(queue, Math.max(0, idx), {
      shuffle: false,
      contextName: extraOptions.contextName ?? inferred.contextName,
      source: extraOptions.source ?? inferred.source,
    });
  }

  function playSongs(songs, { shuffle = false, contextName, source } = {}) {
    if (!songs || songs.length === 0) {
      showToast('Nothing to play');
      return;
    }
    const inferred = inferRouteContext();
    audioEngine.playQueue(songs, 0, {
      shuffle,
      contextName: contextName ?? inferred.contextName,
      source: source ?? inferred.source,
    });
  }

  // ============================================================================
  // Photon Discovery Radio Engine + Fallback
  // ============================================================================
  async function generateRadioTracks(seed, limit = 25, excludeIds = []) {
    if (!seed) return [];
    const D = window.PlenripDiscovery;

    // Primary: Photon 3-window taste + ItemKNN co-occurrence + Subsonic similarity + RRF + MMR
    if (D?.generateRadioQueue) {
      try {
        const lib = state.songs || (await loadAllSongs().catch(() => []));
        if (lib.length > 0) {
          const radioRes = await D.generateRadioQueue({
            seed,
            library: [...lib],
            client,
            limit,
            excludeIds,
            adventurousness: state.discoverySettings.adventurousness || 'balanced',
            starredIdsSet: state.starredSongIds,
            consecutiveSkips: audioEngine?.sessionSkipStreak || 0,
            consecutiveDeepCutCompletions: audioEngine?.sessionDeepCutStreak || 0,
            explorationSuppressed: Boolean(audioEngine?.explorationSuppressed),
          });
          if (Array.isArray(radioRes?.tracks) && radioRes.tracks.length > 0) {
            return radioRes.tracks;
          }
        }
      } catch {
        // Fall through to Subsonic artist/discography fallback
      }
    }

    // Fallback: Seed artist discography + similar artists in library
    const exclude = new Set([seed.id, ...(excludeIds || [])]);
    const out = [];
    const seen = new Set();
    const pushAll = (songs) => {
      for (const s of songs || []) {
        if (!s?.id || exclude.has(s.id) || seen.has(s.id)) continue;
        seen.add(s.id);
        out.push(s);
      }
    };
    const artistSongs = async (artistId) => {
      try {
        const artist = await client.getArtist(artistId);
        const songs = [];
        for (const alb of artist.album || []) {
          const detail = await client.resolveAlbumSongs(alb).catch(() => null);
          songs.push(...(detail?.song || []));
        }
        return songs;
      } catch {
        return [];
      }
    };

    const seedArtistId = seed.artistId || '';
    if (seedArtistId) {
      pushAll(await artistSongs(seedArtistId));
    }

    const similarBefore = out.length;
    if (seedArtistId && out.length < limit) {
      try {
        const info = await client.getArtistInfo2(seedArtistId);
        const similars = (info?.similarArtist || []).filter((a) => a?.id).slice(0, 5);
        const libraryArtists = await loadAllArtists().catch(() => []);
        const byName = new Map(libraryArtists.map((a) => [String(a.name || '').toLowerCase(), a]));
        for (const sim of similars) {
          if (out.length >= limit) break;
          const local = byName.get(String(sim.name || '').toLowerCase());
          const simId = local?.id || sim.id;
          if (!simId) continue;
          pushAll((await artistSongs(simId)).slice(0, 4));
        }
      } catch {
        // Ignore
      }
    }
    const similarAdded = out.length - similarBefore;

    if (similarAdded === 0 && out.length < limit) {
      try {
        const allSongs = await loadAllSongs();
        const byId = new Map(allSongs.map((s) => [s.id, s]));
        const top = historyStore.getListenAgain(byId, limit) || [];
        pushAll(top.map((t) => t.song).filter(Boolean));
      } catch {
        // Ignore
      }
    }

    const shuffled = out.length > 1 ? [out[0], ...balancedShuffle(out.slice(1))] : out;
    return shuffled.slice(0, limit);
  }

  async function startRadio(seed, labelOverride = '') {
    if (!seed) return;
    const label = labelOverride || seed.title || 'Radio';
    showToast(`Starting radio from "${label}"...`);
    const tracks = await generateRadioTracks(seed, 25);
    if (tracks.length === 0) {
      showToast('No similar tracks found for radio');
      return;
    }
    audioEngine.playQueue([seed, ...tracks], 0, {
      shuffle: false,
      source: 'radio',
      origin: 'autoplay',
      seedFirstTrack: true,
      contextName: `${label} Radio`,
    });
    renderQueueViews(true);
  }

  async function startPersonalRadio() {
    try {
      const songs = state.songs || (await loadAllSongs().catch(() => []));
      let seed = audioEngine?.currentSong || null;
      if (!seed && state.favouriteSongs.length > 0) {
        seed = state.favouriteSongs[Math.floor(Math.random() * state.favouriteSongs.length)];
      }
      if (!seed && songs.length > 0) {
        const withPlays = songs.filter((s) => (s.playCount || 0) > 0);
        const pool = withPlays.length > 0 ? withPlays : songs;
        seed = pool[Math.floor(Math.random() * pool.length)];
      }
      if (!seed) {
        const rand = await client.getRandomSongs(5).catch(() => []);
        seed = rand[0] || null;
      }
      if (!seed) {
        showToast('Add tracks to your library to start Personal Radio');
        return;
      }
      await startRadio(seed, 'Personal');
    } catch (err) {
      showToast(`Could not start radio: ${err.message}`);
    }
  }

  // Generic media card (album, artist, playlist, song)
  function createMediaCard(opts) {
    const card = document.createElement('div');
    card.className =
      'group studio-panel hover:border-zinc-500 p-3 flex flex-col cursor-pointer transition-colors min-w-0';

    const cover = document.createElement('div');
    cover.className = `w-full aspect-square bg-zinc-950 border border-zinc-700 overflow-hidden relative flex items-center justify-center mb-2.5 ${
      opts.roundCover ? 'artist-avatar-round' : 'radius-inner'
    }`;
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'hidden w-full h-full object-cover';
    const fb = document.createElement('div');
    fb.className = 'flex flex-col items-center justify-center text-zinc-400';
    fb.innerHTML = `<i data-lucide="${opts.fallbackIcon || 'disc'}" class="w-8 h-8"></i>`;
    cover.appendChild(img);
    cover.appendChild(fb);

    if (opts.artist) attachArtistImage(img, fb, opts.artist);
    else if (opts.coverUrl) {
      img.onload = () => {
        img.classList.remove('hidden');
        fb.classList.add('hidden');
      };
      img.src = opts.coverUrl;
    } else {
      attachCoverImage(img, fb, opts.coverId, opts.fallbackSongId, 300, {
        fallbackCoverId: opts.fallbackCoverId,
        cacheAlbumId: opts.cacheAlbumId,
        cachedCoverUrl: opts.cachedCoverUrl,
        albumRef: opts.albumRef,
      });
    }

    if (typeof opts.onPlay === 'function') {
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('aria-label', `Play ${opts.title || ''}`);
      playBtn.title = `Play ${opts.title || ''}`;
      playBtn.className =
        'pill-round absolute bottom-2 right-2 h-9 w-9 flex items-center justify-center bg-emerald-400 text-zinc-950 shadow-xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 focus-visible:opacity-100 transition-all duration-200 cursor-pointer';
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerCoverFly(cover, '#player-cover-btn');
        opts.onPlay();
      });
      cover.appendChild(playBtn);
    } else {
      const hint = document.createElement('span');
      hint.setAttribute('aria-hidden', 'true');
      hint.className =
        'absolute inset-0 flex items-center justify-center bg-black/40 text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none';
      hint.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
      cover.appendChild(hint);
    }

    if (typeof opts.progressPercent === 'number') {
      const bar = document.createElement('div');
      bar.className = 'absolute left-0 right-0 bottom-0 h-1 bg-zinc-700';
      bar.innerHTML = `<div class="h-full bg-emerald-400" style="width:${Math.max(2, Math.min(100, opts.progressPercent))}%"></div>`;
      cover.appendChild(bar);
    }

    const title = document.createElement('div');
    title.className = 'text-sm font-medium text-zinc-100 group-hover:text-emerald-400 truncate';
    title.innerHTML = opts.titleHtml || escapeHtml(opts.title || '');

    card.appendChild(cover);
    card.appendChild(title);

    if (opts.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'text-xs text-zinc-400 truncate mt-0.5';
      sub.textContent = opts.subtitle;
      card.appendChild(sub);
    }
    if (opts.meta) {
      const meta = document.createElement('div');
      meta.className = 'mt-1.5 text-[11px] font-mono text-zinc-400 truncate';
      meta.textContent = opts.meta;
      card.appendChild(meta);
    }

    card.addEventListener('click', () => opts.onClick && opts.onClick());
    return card;
  }

  function createAlbumCard(album, backRoute = 'albums', withPlay = true) {
    const tracks = album?.song || album?._virtualSongs || [];
    const firstTrackWithCover =
      tracks.find((t) => t && t.coverArt && !isPlaceholderCoverValue(t.coverArt)) || tracks[0];
    const cachedUrl =
      (album?.id && artistAlbumCoverCache.get(album.id)) || album?._cachedCoverUrl || '';

    return createMediaCard({
      coverId: !isPlaceholderCoverValue(album?.coverArt)
        ? album.coverArt
        : firstTrackWithCover?.coverArt || (String(album?.id).startsWith('singles-') ? null : album?.id),
      fallbackCoverId: firstTrackWithCover?.coverArt || null,
      fallbackSongId: firstTrackWithCover?.id || album?._virtualSongs?.[0]?.id,
      cacheAlbumId: album?.id || null,
      cachedCoverUrl: cachedUrl,
      albumRef: album,
      fallbackIcon: String(album.id).startsWith('singles-') ? 'music-2' : 'disc',
      titleHtml: titleHtml(album.name || 'Untitled Album', album.artist),
      subtitle: album.artist || 'Unknown Artist',
      meta: `${album.year ? album.year + ' · ' : ''}${album.songCount ? album.songCount + ' trk' : 'Album'}`,
      onClick: () => openAlbumDetail(album, backRoute),
      onPlay: withPlay
        ? async () => {
            try {
              const detail = await client.resolveAlbumSongs(album);
              playSongs(detail.song, { shuffle: false, contextName: album.name, source: 'album' });
            } catch (err) {
              showToast(`Failed to play album: ${err.message}`);
            }
          }
        : undefined,
    });
  }

  function createSongCard(song, queueContext, extra = {}) {
    return createMediaCard({
      coverId: song.coverArt || song.albumId,
      fallbackSongId: song.id,
      fallbackIcon: 'music',
      titleHtml: titleHtml(song.title || 'Untitled', song.artist),
      subtitle: song.artist || 'Unknown Artist',
      meta: extra.meta,
      progressPercent: extra.progressPercent,
      onClick: () =>
        extra.onClick
          ? extra.onClick()
          : playOrToggle(song, queueContext, undefined, { contextName: extra.contextName || 'Home Mix', source: 'shelf' }),
      onPlay: () =>
        extra.onClick
          ? extra.onClick()
          : playOrToggle(song, queueContext, undefined, { contextName: extra.contextName || 'Home Mix', source: 'shelf' }),
    });
  }

  function createArtistCard(artist) {
    return createMediaCard({
      artist,
      roundCover: true,
      titleHtml: titleHtml(artist.name || 'Unknown Artist', ''),
      meta: `${artist.albumCount ?? 0} ${artist.albumCount === 1 ? 'album' : 'albums'}`,
      onClick: () => openArtistDetail(artist.id),
    });
  }

  // ============================================================================
  // Star / Unstar & Multi-select
  // ============================================================================
  async function syncStarredFromServer() {
    try {
      const starred = await client.getStarred2();
      state.starredSongIds = new Set((starred.song || []).map((s) => s.id));
      state.starredAlbumIds = new Set((starred.album || []).map((a) => a.id));
      state.starredArtistIds = new Set((starred.artist || []).map((a) => a.id));
      state.favouriteSongs = starred.song || [];
      state.starredArtists = starred.artist || [];
      state.starredAlbums = starred.album || [];
      updateSidebarCounts();
    } catch {
      // Ignore if offline
    }
  }

  function getMultiSelectSongs() {
    return [...state.multiSelectSongs.values()].filter(Boolean);
  }

  function updateMultiSelectBar() {
    const bar = $('multi-select-bar');
    if (!bar) return;
    const n = state.multiSelect.size;
    show(bar, n > 0);
    const count = $('multi-select-count');
    if (count) count.textContent = `${n} selected`;
    document.querySelectorAll('[data-multi-select-checkbox]').forEach((cb) => {
      const id = cb.getAttribute('data-song-id');
      const checked = state.multiSelect.has(id);
      cb.checked = checked;
      cb.closest('.song-row')?.classList.toggle('song-row-selected', checked);
    });
  }

  function toggleMultiSelect(song, scope) {
    if (!song?.id) return;
    if (state.multiSelectScope !== null && state.multiSelectScope !== scope) {
      clearMultiSelect();
    }
    state.multiSelectScope = scope;
    if (state.multiSelect.has(song.id)) {
      state.multiSelect.delete(song.id);
      state.multiSelectSongs.delete(song.id);
    } else {
      state.multiSelect.add(song.id);
      state.multiSelectSongs.set(song.id, song);
    }
    if (state.multiSelect.size === 0) state.multiSelectScope = null;
    updateMultiSelectBar();
  }

  function clearMultiSelect() {
    state.multiSelect.clear();
    state.multiSelectSongs.clear();
    state.multiSelectScope = null;
    updateMultiSelectBar();
  }

  function multiSelectPlay() {
    const songs = getMultiSelectSongs();
    if (songs.length === 0) return;
    audioEngine.playQueue(songs, 0, { contextName: 'Selection', source: 'other' });
    clearMultiSelect();
  }

  function multiSelectAddToQueue() {
    const songs = getMultiSelectSongs();
    if (songs.length === 0) return;
    songs.forEach((s) => audioEngine.addToQueue(s));
    showToast(`Added ${songs.length} track${songs.length === 1 ? '' : 's'} to queue`);
    clearMultiSelect();
  }

  async function multiSelectStar() {
    const songs = getMultiSelectSongs().filter((s) => !state.starredSongIds.has(s.id));
    if (songs.length === 0) {
      clearMultiSelect();
      return;
    }
    for (const s of songs) {
      try {
        await client.star({ id: s.id });
        state.starredSongIds.add(s.id);
        state.favouriteSongs = [s, ...state.favouriteSongs];
        s.starred = new Date().toISOString();
      } catch {
        // Ignore per-song failures
      }
    }
    updateSidebarCounts();
    showToast(`Starred ${songs.length} track${songs.length === 1 ? '' : 's'}`);
    refreshRowHighlights();
    clearMultiSelect();
  }

  function multiSelectAddToPlaylist() {
    const songs = getMultiSelectSongs();
    if (songs.length === 0) return;
    openAddToPlaylistModal(songs);
    clearMultiSelect();
  }

  async function toggleStarTrack(song) {
    if (!song?.id) return;
    const was = state.starredSongIds.has(song.id);
    try {
      if (was) {
        await client.unstar({ id: song.id });
        state.starredSongIds.delete(song.id);
        state.favouriteSongs = state.favouriteSongs.filter((s) => s.id !== song.id);
        song.starred = undefined;
        showToast(`Removed "${song.title}" from Favourites`);
      } else {
        await client.star({ id: song.id });
        state.starredSongIds.add(song.id);
        state.favouriteSongs = [song, ...state.favouriteSongs];
        song.starred = new Date().toISOString();
        showToast(`Added "${song.title}" to Favourites`);
      }
      window.PlenripDiscovery?.clearShelfCache?.();
      updateSidebarCounts();
      refreshStarButtons();
      updatePlayerBarUI();
      if (state.route === 'favourites') loadFavouritesView();
    } catch (err) {
      showToast(`Star action failed: ${err.message}`);
    }
  }

  function setAlbumStarred(albumId, starred) {
    if (!albumId) return;
    const stamp = starred ? new Date().toISOString() : undefined;
    const apply = (list) => {
      if (!Array.isArray(list)) return;
      for (const a of list) {
        if (a && a.id === albumId) a.starred = stamp;
      }
    };
    for (const type of Object.keys(state.albumsByType || {})) {
      apply(state.albumsByType[type]);
    }
    apply(state.currentArtistAlbums);
  }

  async function toggleStarAlbum(album) {
    if (!album?.id || String(album.id).startsWith('singles-')) return;
    const was = state.starredAlbumIds.has(album.id);
    try {
      if (was) {
        await client.unstar({ albumId: album.id });
        state.starredAlbumIds.delete(album.id);
        album.starred = undefined;
        setAlbumStarred(album.id, false);
      } else {
        await client.star({ albumId: album.id });
        state.starredAlbumIds.add(album.id);
        album.starred = new Date().toISOString();
        setAlbumStarred(album.id, true);
      }
      renderAlbumStarButton();
    } catch (err) {
      showToast(`Album star failed: ${err.message}`);
    }
  }

  async function toggleStarArtist(artist) {
    if (!artist?.id) return;
    const was = state.starredArtistIds.has(artist.id);
    try {
      if (was) {
        await client.unstar({ artistId: artist.id });
        state.starredArtistIds.delete(artist.id);
      } else {
        await client.star({ artistId: artist.id });
        state.starredArtistIds.add(artist.id);
      }
      renderArtistStarButton();
    } catch (err) {
      showToast(`Artist star failed: ${err.message}`);
    }
  }

  // ============================================================================
  // Library Data Loading + Search Index + Album Merging
  // ============================================================================
  async function ensureLocalSearchIndex() {
    const D = window.PlenripDiscovery;
    if (!D?.ensureSearchIndex) return null;
    const [songs, albums, artists] = await Promise.all([
      loadAllSongs().catch(() => []),
      loadAllAlbums('newest').catch(() => []),
      loadAllArtists().catch(() => []),
    ]);
    state.searchIndex = await D.ensureSearchIndex(songs, albums, artists, null);
    return state.searchIndex;
  }

  async function loadAllSongs() {
    if (state.songs) return state.songs;
    if (state.songsPromise) return state.songsPromise;
    state.songsPromise = (async () => {
      const all = [];
      const BATCH = 500;
      for (let offset = 0; offset < 40000; offset += BATCH) {
        const res = await client.search3('', { songCount: BATCH, songOffset: offset, albumCount: 0, artistCount: 0 });
        const batch = res.song || [];
        all.push(...batch);
        if (batch.length < BATCH) break;
      }
      state.songs = all;
      updateSidebarCounts();
      if (window.PlenripDiscovery?.reconcileServerPlays) {
        void window.PlenripDiscovery.reconcileServerPlays(all);
      }
      return all;
    })().catch((err) => {
      state.songsPromise = null;
      throw err;
    });
    return state.songsPromise;
  }

  async function loadAllArtists() {
    if (state.artists) return state.artists;
    state.artists = await client.getArtists();
    updateSidebarCounts();
    return state.artists;
  }

  async function loadAllAlbums(type = 'newest') {
    const serverType = type === 'year-desc' || type === 'year-asc' ? 'newest' : type;
    if (!state.albumsByType[serverType]) {
      const all = [];
      const BATCH = 500;
      for (let offset = 0; offset < 20000; offset += BATCH) {
        const batch = await client.getAlbumList2({ type: serverType, size: BATCH, offset });
        all.push(...batch);
        if (batch.length < BATCH) break;
      }
      const merged = window.PlenripDiscovery?.mergeAlbums ? window.PlenripDiscovery.mergeAlbums(all) : all;
      state.albumsByType[serverType] = merged;
      if (serverType === 'newest') {
        state.mergedAlbums = merged;
        updateSidebarCounts();
      }
    }
    const base = [...state.albumsByType[serverType]];
    if (type === 'year-desc') {
      base.sort((a, b) => (b.year || 0) - (a.year || 0) || String(a.name || '').localeCompare(String(b.name || '')));
    } else if (type === 'year-asc') {
      base.sort((a, b) => (a.year || 9999) - (b.year || 9999) || String(a.name || '').localeCompare(String(b.name || '')));
    }
    return base;
  }

  function cjkMatches(text, artist, rawQuery) {
    if (titles.matchesSearchWithTranslation(text, artist, rawQuery)) return true;
    const D = window.PlenripDiscovery;
    if (!D?.buildSearchKeysForText) return false;
    const qKeys = D.buildSearchKeysForText(rawQuery);
    if (qKeys.length === 0) return false;
    const tKeys = D.buildSearchKeysForText(text || '');
    return qKeys.some((qk) => qk && tKeys.some((tk) => tk.includes(qk)));
  }

  function getArtistLetterBucket(name) {
    const D = window.PlenripDiscovery;
    const key = D?.buildSortKey ? D.buildSortKey(name || '') : String(name || '').trim().toUpperCase();
    const first = (key[0] || '').toUpperCase();
    if (first >= 'A' && first <= 'Z') return first;
    if (D?.buildSearchKeysForText) {
      const latinKey = D.buildSearchKeysForText(name || '').find((k) => /^[a-z]/i.test(k));
      if (latinKey) return latinKey[0].toUpperCase();
    }
    return '#';
  }

  // ============================================================================
  // Library Toolbar + Pagination Controller (Artists, Albums, Songs)
  // ============================================================================
  function createLibraryView(cfg) {
    const ui = {
      filterInput: $(`${cfg.prefix}-filter-input`),
      filterClear: $(`${cfg.prefix}-filter-clear`),
      sortBtn: $(`${cfg.prefix}-sort-btn`),
      sortLabel: $(`${cfg.prefix}-sort-label`),
      sortMenu: $(`${cfg.prefix}-sort-menu`),
      starredBtn: $(`${cfg.prefix}-starred-btn`),
      resetBtn: $(`${cfg.prefix}-reset-btn`),
      toolbarCount: $(`${cfg.prefix}-toolbar-count`),
      countLabel: $(`${cfg.prefix}-count-label`),
      container: $(cfg.containerId),
      pagination: $(`${cfg.prefix}-pagination`),
      prev: $(`${cfg.prefix}-prev-page`),
      next: $(`${cfg.prefix}-next-page`),
      indicator: $(`${cfg.prefix}-page-indicator`),
    };
    const view = {
      query: '',
      letter: '',
      sort: cfg.defaultSort,
      starredOnly: false,
      page: 0,
      items: null,
      loading: false,
    };

    function sortLabelFor(key) {
      const btn = ui.sortMenu?.querySelector(`[data-sort="${key}"] span`);
      return btn ? btn.textContent : key;
    }

    function updateControls(filteredCount) {
      if (ui.filterClear) show(ui.filterClear, view.query.length > 0);
      if (ui.sortLabel) ui.sortLabel.textContent = `Sort: ${sortLabelFor(view.sort)}`;
      ui.sortMenu?.querySelectorAll('[data-sort]').forEach((btn) => {
        const active = btn.getAttribute('data-sort') === view.sort;
        btn.querySelector('.sort-check')?.classList.toggle('hidden', !active);
        btn.classList.toggle('text-zinc-100', active);
        btn.classList.toggle('text-zinc-300', !active);
      });
      setPressed(ui.starredBtn, view.starredOnly);
      const dirty = view.query || view.letter || view.starredOnly || view.sort !== cfg.defaultSort;
      show(ui.resetBtn, Boolean(dirty));
      if (ui.toolbarCount) ui.toolbarCount.textContent = `${filteredCount} ${filteredCount === 1 ? cfg.noun : cfg.nounPlural}`;
    }

    function getFiltered() {
      let items = view.items || [];
      if (view.starredOnly) items = items.filter(cfg.isStarred);
      if (view.letter && typeof cfg.matchesLetter === 'function') {
        items = items.filter((it) => cfg.matchesLetter(it, view.letter));
      }
      const q = view.query.trim().toLowerCase();
      if (q) items = items.filter((it) => cfg.matches(it, q));
      return cfg.sorters[view.sort] ? cfg.sorters[view.sort]([...items]) : items;
    }

    function render() {
      if (!ui.container) return;
      if (!view.items) return;
      const filtered = getFiltered();
      const isFiltering = Boolean(view.query.trim() || view.starredOnly || view.letter);
      const pageSize = !isFiltering && cfg.fullListInBrowse
        ? Math.max(1, filtered.length)
        : (isFiltering && cfg.searchPageSize ? cfg.searchPageSize : cfg.pageSize);
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (view.page >= pages) view.page = pages - 1;
      const slice = filtered.slice(view.page * pageSize, (view.page + 1) * pageSize);

      updateControls(filtered.length);
      if (ui.countLabel) ui.countLabel.textContent = `${(view.items || []).length} ${cfg.nounPlural} in library`;
      if (typeof cfg.afterFilterRender === 'function') {
        cfg.afterFilterRender(view, view.items || []);
      }

      ui.container.innerHTML = '';
      if (slice.length === 0) {
        ui.container.innerHTML = `<div class="col-span-full p-8 text-center text-xs font-mono text-zinc-400">${
          isFiltering ? `No matching ${cfg.nounPlural}.` : `No ${cfg.nounPlural} found.`
        }</div>`;
      } else {
        cfg.renderPage(ui.container, slice, view, filtered);
      }

      if (ui.pagination) show(ui.pagination, pages > 1);
      if (ui.prev) ui.prev.disabled = view.page <= 0;
      if (ui.next) ui.next.disabled = view.page >= pages - 1;
      if (ui.indicator) ui.indicator.textContent = `PAGE ${view.page + 1} OF ${pages}`;

      queueTranslations(slice.map(cfg.translationItem));
      refreshIcons();
    }

    async function load(force = false) {
      if (view.items && !force) {
        render();
        return;
      }
      if (view.loading) return;
      view.loading = true;
      if (ui.container && !view.items) {
        ui.container.innerHTML = `<div class="col-span-full p-6 text-xs font-mono text-zinc-400">Loading ${cfg.nounPlural}...</div>`;
      }
      try {
        view.items = await cfg.fetchItems(view);
        setConnectionError(null);
        render();
      } catch (err) {
        setConnectionError(err.message);
      } finally {
        view.loading = false;
      }
    }

    async function reset() {
      view.query = '';
      view.letter = '';
      view.sort = cfg.defaultSort;
      view.starredOnly = false;
      view.page = 0;
      if (ui.filterInput) ui.filterInput.value = '';
      if (cfg.onSortChange) await cfg.onSortChange(view, true);
      render();
    }

    ui.filterInput?.addEventListener('input', () => {
      view.query = ui.filterInput.value;
      view.page = 0;
      render();
    });
    ui.filterClear?.addEventListener('click', () => {
      ui.filterInput.value = '';
      view.query = '';
      view.page = 0;
      render();
    });
    ui.sortBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      ui.sortMenu.classList.toggle('hidden');
    });
    ui.sortMenu?.querySelectorAll('[data-sort]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        view.sort = btn.getAttribute('data-sort');
        view.page = 0;
        ui.sortMenu.classList.add('hidden');
        if (cfg.onSortChange) await cfg.onSortChange(view, false);
        render();
      });
    });
    ui.starredBtn?.addEventListener('click', () => {
      view.starredOnly = !view.starredOnly;
      view.page = 0;
      render();
    });
    ui.resetBtn?.addEventListener('click', reset);
    ui.prev?.addEventListener('click', () => {
      if (view.page > 0) {
        view.page -= 1;
        render();
        $('main-content').scrollTop = 0;
      }
    });
    ui.next?.addEventListener('click', () => {
      view.page += 1;
      render();
      $('main-content').scrollTop = 0;
    });

    return { load, render, view };
  }

  const libraryViews = {};

  const SINGLE_EP_MAX_TRACKS = 6;
  function getSplitAlbumsSingles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SPLIT_ALBUMS_SINGLES);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  }
  function setSplitAlbumsSingles(value) {
    try {
      localStorage.setItem(STORAGE_KEYS.SPLIT_ALBUMS_SINGLES, value ? 'true' : 'false');
    } catch {
      // Ignore
    }
  }
  function isSingleOrEp(album) {
    if (!album) return false;
    if (typeof album.songCount === 'number') return album.songCount <= SINGLE_EP_MAX_TRACKS;
    return false;
  }

  function renderArtistsAzBar(view, allArtists) {
    const bar = $('artists-az-bar');
    if (!bar) return;
    const available = new Set((allArtists || []).map((a) => getArtistLetterBucket(a.name)));
    const letters = ['ALL', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];
    bar.innerHTML = '';
    letters.forEach((ltr) => {
      const isAll = ltr === 'ALL';
      const hasAny = isAll || available.has(ltr);
      const active = isAll ? !view.letter : view.letter === ltr;
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !hasAny;
      b.textContent = ltr;
      b.className = `px-2 py-0.5 shrink-0 transition-colors ${
        active
          ? 'bg-emerald-400 text-zinc-950 font-semibold'
          : hasAny
            ? 'text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800'
            : 'text-zinc-600 opacity-40 cursor-not-allowed'
      }`;
      b.addEventListener('click', () => {
        view.letter = isAll || view.letter === ltr ? '' : ltr;
        view.page = 0;
        libraryViews.artists.render();
      });
      bar.appendChild(b);
    });
  }

  function initLibraryViews() {
    const byName = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
    const stats = () => getPlayStats();

    const getArtistSongStats = () => {
      const trackCounts = new Map();
      const newestCreated = new Map();
      for (const s of state.songs || []) {
        if (!s.artistId) continue;
        trackCounts.set(s.artistId, (trackCounts.get(s.artistId) || 0) + 1);
        const cr = String(s.created || '');
        if (cr > (newestCreated.get(s.artistId) || '')) newestCreated.set(s.artistId, cr);
      }
      return { trackCounts, newestCreated };
    };

    libraryViews.artists = createLibraryView({
      prefix: 'artists',
      containerId: 'artists-grid',
      noun: 'artist',
      nounPlural: 'artists',
      defaultSort: 'name-asc',
      pageSize: 48,
      fetchItems: () => loadAllArtists(),
      isStarred: (a) => state.starredArtistIds.has(a.id),
      matchesLetter: (a, ltr) => getArtistLetterBucket(a.name) === ltr,
      matches: (a, q) => cjkMatches(a.name, '', q),
      translationItem: (a) => ({ title: a.name, artist: '' }),
      afterFilterRender: (view, all) => renderArtistsAzBar(view, all),
      onSortChange: async (view) => {
        if ((view.sort === 'track-count' || view.sort === 'recently-added') && !state.songs) {
          await loadAllSongs().catch(() => {});
        }
      },
      sorters: {
        'name-asc': (l) => l.sort((a, b) => byName(a.name, b.name)),
        'name-desc': (l) => l.sort((a, b) => byName(b.name, a.name)),
        'most-played': (l) => {
          const s = stats().byArtist;
          return l.sort((a, b) => (s.get(b.id)?.count || 0) - (s.get(a.id)?.count || 0) || byName(a.name, b.name));
        },
        'recently-played': (l) => {
          const s = stats().byArtist;
          return l.sort((a, b) => (s.get(b.id)?.last || 0) - (s.get(a.id)?.last || 0) || byName(a.name, b.name));
        },
        'album-count': (l) => l.sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0) || byName(a.name, b.name)),
        'track-count': (l) => {
          const { trackCounts } = getArtistSongStats();
          return l.sort(
            (a, b) =>
              (trackCounts.get(b.id) || b.songCount || b.albumCount || 0) -
                (trackCounts.get(a.id) || a.songCount || a.albumCount || 0) ||
              byName(a.name, b.name)
          );
        },
        'recently-added': (l) => {
          const { newestCreated } = getArtistSongStats();
          return l.sort(
            (a, b) =>
              String(newestCreated.get(b.id) || '').localeCompare(String(newestCreated.get(a.id) || '')) ||
              byName(a.name, b.name)
          );
        },
      },
      renderPage: (container, items) => {
        items.forEach((a) => container.appendChild(createArtistCard(a)));
      },
    });

    libraryViews.albums = createLibraryView({
      prefix: 'albums',
      containerId: 'albums-grid',
      noun: 'album',
      nounPlural: 'albums',
      defaultSort: 'newest',
      pageSize: 48,
      fullListInBrowse: true,
      searchPageSize: 36,
      fetchItems: (view) => loadAllAlbums(view.sort),
      isStarred: (a) => state.starredAlbumIds.has(a.id),
      matches: (a, q) => cjkMatches(a.name, a.artist, q) || cjkMatches(a.artist, '', q),
      translationItem: (a) => ({ title: a.name, artist: a.artist }),
      sorters: {
        newest: (l) => l,
        alphabeticalByName: (l) => l,
        alphabeticalByArtist: (l) => l,
        frequent: (l) => l,
        recent: (l) => l,
        'year-desc': (l) => l,
        'year-asc': (l) => l,
      },
      onSortChange: async (view) => {
        view.items = null;
        try {
          view.items = await loadAllAlbums(view.sort);
        } catch (err) {
          setConnectionError(err.message);
        }
      },
      renderPage: (container, items, view, all) => {
        if (!getSplitAlbumsSingles()) {
          items.forEach((a) => container.appendChild(createAlbumCard(a, 'albums')));
          return;
        }
        const allAlbums = (all || []).filter((a) => !isSingleOrEp(a));
        const allSingles = (all || []).filter((a) => isSingleOrEp(a));
        const pageAlbums = items.filter((a) => !isSingleOrEp(a));
        const pageSingles = items.filter((a) => isSingleOrEp(a));
        const section = (title, count, cards) => {
          if (cards.length === 0) return;
          const head = document.createElement('div');
          head.className = 'col-span-full flex items-baseline justify-between gap-2 pb-2 border-b border-zinc-800';
          head.innerHTML = `<h2 class="font-display font-normal text-lg text-zinc-100 tracking-tight">${title}</h2><span class="font-mono text-xs text-zinc-400">${count} ${count === 1 ? 'album' : 'albums'}</span>`;
          container.appendChild(head);
          cards.forEach((a) => container.appendChild(createAlbumCard(a, 'albums')));
        };
        section('Albums', allAlbums.length, pageAlbums);
        section('Singles & EPs', allSingles.length, pageSingles);
      },
    });

    libraryViews.songs = createLibraryView({
      prefix: 'songs',
      containerId: 'songs-list',
      noun: 'song',
      nounPlural: 'songs',
      defaultSort: 'title-asc',
      pageSize: 100,
      fetchItems: () => loadAllSongs(),
      isStarred: (s) => state.starredSongIds.has(s.id),
      matches: (s, q) =>
        cjkMatches(s.title, s.artist, q) || cjkMatches(s.album, s.artist, q) || cjkMatches(s.artist, '', q),
      translationItem: (s) => ({ title: s.title, artist: s.artist }),
      sorters: {
        'title-asc': (l) => l.sort((a, b) => byName(a.title, b.title)),
        'artist-asc': (l) => l.sort((a, b) => byName(a.artist, b.artist) || byName(a.title, b.title)),
        'most-played': (l) => {
          const s = stats().bySong;
          return l.sort(
            (a, b) =>
              ((s.get(b.id)?.count || 0) + (b.playCount || 0)) -
                ((s.get(a.id)?.count || 0) + (a.playCount || 0)) ||
              byName(a.title, b.title)
          );
        },
        'recently-played': (l) => {
          const s = stats().bySong;
          return l.sort((a, b) => (s.get(b.id)?.last || 0) - (s.get(a.id)?.last || 0) || byName(a.title, b.title));
        },
        'recently-added': (l) => l.sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))),
      },
      renderPage: (container, items, view, all) => {
        items.forEach((song, idx) => {
          container.appendChild(
            createTrackRowElement(song, view.page * 100 + idx, all, {
              selectable: true,
              selectScope: 'songs',
              contextName: 'Songs',
              source: 'other',
            })
          );
        });
      },
    });
  }

  // ============================================================================
  // Home (Greeting, Remote Now Playing, Made For You, Quick Pick 4-Row, Shelves)
  // ============================================================================
  function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Late night session';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function createMadeForYouCard(cardDef, songs) {
    const card = document.createElement('div');
    card.className =
      'mfy-card group studio-panel hover:border-emerald-400/60 w-full sm:w-[260px] h-[61px] px-2.5 flex items-center gap-3 cursor-pointer transition-colors shrink-0';

    const thumb = document.createElement('div');
    thumb.className = 'w-11 h-11 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center relative radius-inner';
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'hidden w-full h-full object-cover';
    const fb = document.createElement('div');
    fb.className = 'text-emerald-400 flex items-center justify-center';
    fb.innerHTML = '<i data-lucide="sparkles" class="w-4 h-4"></i>';
    thumb.appendChild(img);
    thumb.appendChild(fb);

    generatePlaylistCollage(songs.slice(0, 8), (id, sz) => client.getCoverArtUrl(id, sz))
      .then((url) => {
        if (!url) return;
        img.onload = () => {
          img.classList.remove('hidden');
          fb.classList.add('hidden');
        };
        img.src = url;
      })
      .catch(() => {});

    const text = document.createElement('div');
    text.className = 'min-w-0 flex-1';
    text.innerHTML = `
      <div class="text-xs font-semibold text-zinc-100 group-hover:text-emerald-400 truncate">${escapeHtml(cardDef.name)}</div>
      <div class="text-[10.5px] font-mono text-zinc-400 truncate mt-0.5">${escapeHtml(cardDef.blurb)}</div>`;

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.title = `Play ${cardDef.name}`;
    playBtn.className =
      'pill-round w-7 h-7 bg-emerald-400 text-zinc-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0';
    playBtn.innerHTML = '<i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerCoverFly(thumb, '#player-cover-btn');
      playSongs(songs, { shuffle: false, contextName: cardDef.name, source: 'shelf' });
    });

    card.appendChild(thumb);
    card.appendChild(text);
    card.appendChild(playBtn);
    card.addEventListener('click', () => openSmartPlaylistDetail(cardDef.nspId));
    return card;
  }

  function renderQuickPickFourRowGrid(quickSongs) {
    const section = $('home-section-quick-pick');
    const grid = $('home-quick-pick-grid');
    if (!section || !grid) return;
    show(section, quickSongs.length > 0);
    grid.innerHTML = '';
    if (quickSongs.length === 0) return;

    if ($('home-quick-pick-meta')) {
      $('home-quick-pick-meta').textContent = `${quickSongs.length} tracks · 4-row quick deck`;
    }

    const COLS = Math.ceil(quickSongs.length / 4);
    for (let c = 0; c < COLS; c += 1) {
      const col = document.createElement('div');
      col.className = 'min-w-[275px] sm:min-w-[310px] flex-1 max-w-[360px] shrink-0 space-y-1.5';
      const slice = quickSongs.slice(c * 4, c * 4 + 4);
      slice.forEach((song, rIdx) => {
        const globalIdx = c * 4 + rIdx;
        const row = document.createElement('div');
        row.setAttribute('data-song-id', song.id);
        row.__song = song;
        row.className =
          'song-row group studio-panel px-2.5 py-2 flex items-center justify-between gap-2.5 hover:border-zinc-500 cursor-pointer transition-colors';

        const coverBox = document.createElement('div');
        coverBox.className = 'w-10 h-10 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center relative radius-inner';
        const img = document.createElement('img');
        img.alt = '';
        img.className = 'hidden w-full h-full object-cover';
        const fb = document.createElement('div');
        fb.className = 'text-zinc-400 flex items-center justify-center';
        fb.innerHTML = '<i data-lucide="music" class="w-4 h-4"></i>';
        coverBox.appendChild(img);
        coverBox.appendChild(fb);
        attachCoverImage(img, fb, song.coverArt || song.albumId, song.id, 120);

        const info = document.createElement('div');
        info.className = 'min-w-0 flex-1';
        info.innerHTML = `
          <div class="row-title text-xs font-medium text-zinc-100 group-hover:text-emerald-400 truncate">${titleHtml(song.title || 'Untitled', song.artist)}</div>
          <div class="text-[11px] text-zinc-400 truncate">${escapeHtml(song.artist || 'Unknown Artist')}</div>`;

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'p-1 text-zinc-400 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity shrink-0';
        menuBtn.innerHTML = '<i data-lucide="more-vertical" class="w-3.5 h-3.5"></i>';
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openTrackContextMenu(e, song, null);
        });

        row.appendChild(coverBox);
        row.appendChild(info);
        row.appendChild(menuBtn);
        row.addEventListener('click', () => {
          triggerCoverFly(coverBox, '#player-cover-btn');
          playOrToggle(song, quickSongs, globalIdx, { contextName: 'Quick Pick', source: 'shelf' });
        });
        updateRowActiveState(row);
        col.appendChild(row);
      });
      grid.appendChild(col);
    }
  }

  async function loadHomeView() {
    if ($('home-greeting')) $('home-greeting').textContent = getTimeGreeting();
    const recentGrid = $('home-recent-grid');
    if (!recentGrid) return;
    if (!recentGrid.hasChildNodes()) {
      recentGrid.innerHTML = '<div class="col-span-full py-6 text-xs font-mono text-zinc-400">Loading recently added albums...</div>';
    }

    // Fetch Subsonic bookmarks & remote now-playing in background (non-blocking)
    client.getBookmarks?.().then((bms) => {
      state.serverBookmarks = Array.isArray(bms) ? bms : [];
      renderSidebarContinue();
      if (state.route === 'home') void renderHomeHistorySections();
    }).catch(() => {});

    client.getNowPlaying?.().then((entries) => {
      const banner = $('home-remote-banner');
      if (!banner) return;
      const curId = audioEngine?.currentSong?.id;
      const remote = (entries || []).filter((e) => e?.id && e.id !== curId);
      if (remote.length === 0) {
        show(banner, false);
        return;
      }
      const top = remote[0];
      show(banner, true);
      banner.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-2 h-2 bg-emerald-400 pill-round animate-pulse shrink-0"></span>
          <div class="min-w-0 text-xs">
            <span class="font-mono text-emerald-400 uppercase mr-1.5">${escapeHtml(top.username || 'Session')} listening:</span>
            <span class="font-medium text-zinc-100">${escapeHtml(top.title || 'Untitled')}</span>
            <span class="text-zinc-400"> · ${escapeHtml(top.artist || '')}</span>
          </div>
        </div>
        <button id="home-remote-play-btn" type="button" class="h-7 px-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-[11px] font-mono text-zinc-100 shrink-0">
          Listen Along
        </button>`;
      $('home-remote-play-btn')?.addEventListener('click', () => {
        playOrToggle(top, [top], 0, { contextName: 'Remote Session', source: 'other' });
      });
    }).catch(() => {});

    try {
      const rawRecent = await client.getAlbumList2({ type: 'newest', size: 24, offset: 0 });
      const recent = (window.PlenripDiscovery?.mergeAlbums ? window.PlenripDiscovery.mergeAlbums(rawRecent) : rawRecent).slice(0, 18);
      setConnectionError(null);
      recentGrid.innerHTML = '';
      if (recent.length === 0) {
        recentGrid.innerHTML = '<div class="col-span-full py-6 text-xs font-mono text-zinc-400">No albums found on server.</div>';
      } else {
        recent.forEach((alb) => recentGrid.appendChild(createAlbumCard(alb, 'home', true)));
        queueTranslations(recent.map((a) => ({ title: a.name, artist: a.artist })));
      }
      refreshIcons();
    } catch (err) {
      setConnectionError(err.message);
      return;
    }

    await renderHomeHistorySections();
    loadAllSongs()
      .then(() => {
        if (state.route === 'home') void renderHomeHistorySections();
      })
      .catch(() => {});
  }

  function fillSection(sectionId, gridId, cards, metaId, metaText) {
    const section = $(sectionId);
    const grid = $(gridId);
    if (!section || !grid) return;
    show(section, cards.length > 0);
    grid.innerHTML = '';
    cards.forEach((c) => grid.appendChild(c));
    if (metaId && metaText && $(metaId)) $(metaId).textContent = metaText;
  }

  let currentQuickPickSongs = [];

  async function renderHomeHistorySections() {
    const allSongs = state.songs || [];
    const songMap = new Map(allSongs.map((s) => [s.id, s]));
    const currentId = audioEngine?.currentSong?.id || null;
    const translationItems = [];
    const note = (s) => s && translationItems.push({ title: s.title, artist: s.artist });
    const D = window.PlenripDiscovery;

    // 1. Continue Listening (local in-progress + server getBookmarks)
    const localCont = historyStore.getContinueListening(currentId, 6);
    const seenCont = new Set(localCont.map((i) => i.song?.id).filter(Boolean));
    const cont = [...localCont];
    for (const bm of state.serverBookmarks || []) {
      if (cont.length >= 6) break;
      if (!bm?.entry?.id || bm.entry.id === currentId || seenCont.has(bm.entry.id)) continue;
      seenCont.add(bm.entry.id);
      cont.push({
        song: bm.entry,
        positionSeconds: Math.round((bm.position || 0) / 1000),
        durationSeconds: bm.entry.duration || 180,
      });
    }
    fillSection(
      'home-section-continue',
      'home-continue-grid',
      cont.map((item) => {
        note(item.song);
        const remaining = Math.max(0, item.durationSeconds - item.positionSeconds);
        return createSongCard(item.song, [item.song], {
          meta: `${formatDuration(remaining)} left`,
          progressPercent: (item.positionSeconds / Math.max(1, item.durationSeconds)) * 100,
          contextName: 'Continue Listening',
          onClick: () =>
            audioEngine.playQueue([item.song], 0, {
              shuffle: false,
              startTime: item.positionSeconds,
              contextName: 'Continue Listening',
              source: 'shelf',
            }),
        });
      }),
      'home-continue-meta',
      `${cont.length} in progress`
    );
    renderSidebarContinue();

    // Compute Photon Discovery Shelves if library songs are loaded
    let shelves = null;
    let aggregates = null;
    if (D?.getOrComputeHomeShelves && allSongs.length > 0) {
      try {
        aggregates = await D.getAllTrackAggregates();
        const computed = await D.getOrComputeHomeShelves({
          songs: allSongs,
          aggregates,
          starredIdsSet: state.starredSongIds,
          silenceTargetDays: state.discoverySettings.silenceDays,
          newlyStarredCooldownDays: state.discoverySettings.starredCooldownDays,
          quickPickExclusionHours: state.discoverySettings.quickPickExclusionHours,
          maxPerArtistPerShelf: state.discoverySettings.maxPerArtist,
        });
        shelves = computed?.shelves || null;
      } catch {
        shelves = null;
      }
    }

    // 2. Made For You (260x61 Compact Mix Cards)
    const mfySection = $('home-section-mfy');
    const mfyGrid = $('home-mfy-grid');
    if (mfySection && mfyGrid && D?.SMART_PLAYLIST_CARDS && shelves) {
      mfyGrid.innerHTML = '';
      let renderedCards = 0;
      for (const cardDef of D.SMART_PLAYLIST_CARDS) {
        const list = (shelves[cardDef.nspId] || []).map((x) => x.song || x).filter(Boolean);
        if (list.length >= 3) {
          mfyGrid.appendChild(createMadeForYouCard(cardDef, list));
          renderedCards += 1;
        }
      }
      show(mfySection, renderedCards > 0);
    }

    // 3. Quick Pick (4-row horizontal column grid)
    let quickSongs = [];
    if (shelves?.['quick-pick']?.length > 0) {
      quickSongs = shelves['quick-pick'].map((x) => x.song || x).filter(Boolean);
    } else {
      quickSongs = historyStore.getQuickPick(state.favouriteSongs, songMap, 16);
    }
    currentQuickPickSongs = quickSongs;
    quickSongs.forEach(note);
    renderQuickPickFourRowGrid(quickSongs);

    // 4. Listen Again
    const again = historyStore.getListenAgain(songMap, 6);
    const againSongs = again.map((a) => a.song);
    fillSection(
      'home-section-listen-again',
      'home-listen-again-grid',
      again.map((a) => {
        note(a.song);
        return createSongCard(a.song, againSongs, { meta: `${a.playCount} plays`, contextName: 'Listen Again' });
      })
    );

    // 5. Forgotten Favourite?
    if ($('home-forgotten-meta')) {
      $('home-forgotten-meta').textContent = `Starred & loved · Unplayed for ${state.discoverySettings.silenceDays}+ days`;
    }
    let forgottenItems = [];
    if (shelves?.['forgotten-favourite']?.length > 0) {
      forgottenItems = shelves['forgotten-favourite'].slice(0, 6).map((entry) => {
        const s = entry.song || entry;
        const agg = aggregates?.get?.(s.id) || null;
        const lastMs = D.getLastPlayedMs ? D.getLastPlayedMs(s, agg) : 0;
        return { song: s, badge: formatRelativeDaysAgo(lastMs) };
      });
    } else {
      forgottenItems = historyStore.getForgottenFavourites(state.favouriteSongs, 6);
    }
    const forgottenSongs = forgottenItems.map((f) => f.song);
    fillSection(
      'home-section-forgotten',
      'home-forgotten-grid',
      forgottenItems.map((f) => {
        note(f.song);
        return createSongCard(f.song, forgottenSongs, { meta: f.badge, contextName: 'Forgotten Favourite' });
      })
    );

    queueTranslations(translationItems);
    refreshIcons();
  }

  // ============================================================================
  // Search (BM25 + Frecency + Adaptive History + Top Result Hero + Recent Pills)
  // ============================================================================
  function saveRecentSearch(q) {
    const clean = String(q || '').trim();
    if (clean.length < 2) return;
    state.recentSearches = [clean, ...state.recentSearches.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 10);
    try {
      localStorage.setItem(STORAGE_KEYS.RECENT_SEARCHES, JSON.stringify(state.recentSearches));
    } catch {
      // Ignore
    }
    renderRecentSearches();
  }

  function removeRecentSearch(q) {
    state.recentSearches = state.recentSearches.filter((x) => x !== q);
    try {
      localStorage.setItem(STORAGE_KEYS.RECENT_SEARCHES, JSON.stringify(state.recentSearches));
    } catch {
      // Ignore
    }
    renderRecentSearches();
  }

  function renderRecentSearches() {
    const wrap = $('search-recent-wrap');
    const list = $('search-recent-list');
    if (!wrap || !list) return;
    const shouldShow = !state.searchQuery && state.recentSearches.length > 0;
    show(wrap, shouldShow);
    list.innerHTML = '';
    if (!shouldShow) return;

    state.recentSearches.forEach((term) => {
      const chip = document.createElement('div');
      chip.className = 'inline-flex items-center bg-zinc-900 border border-zinc-700 hover:border-zinc-500 text-xs font-mono text-zinc-200 radius-inner overflow-hidden';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'px-2.5 py-1 hover:text-emerald-400';
      btn.textContent = term;
      btn.addEventListener('click', () => {
        const input = $('search-input');
        if (input) {
          input.value = term;
          input.dispatchEvent(new Event('input'));
          input.focus();
        }
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'px-1.5 py-1 text-zinc-500 hover:text-[#f0605a] border-l border-zinc-800';
      del.innerHTML = '<i data-lucide="x" class="w-3 h-3"></i>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRecentSearch(term);
      });
      chip.appendChild(btn);
      chip.appendChild(del);
      list.appendChild(chip);
    });
    refreshIcons();
  }

  function clearSearchState(clearInput = false) {
    const input = $('search-input');
    if (clearInput && input) input.value = '';
    state.searchQuery = '';
    show($('search-clear-btn'), false);
    state.searchResults = { artist: [], album: [], song: [], top: null };
    state.searchSelectedIndex = -1;
    renderRecentSearches();
    renderSearchResults();
  }

  async function executeSmartSearch(q) {
    const D = window.PlenripDiscovery;
    let localArtists = [];
    let localAlbums = [];
    let localSongs = [];
    let topHit = null;

    if (D?.rankSearch) {
      try {
        const idx = state.searchIndex || (await ensureLocalSearchIndex());
        if (idx) {
          const [frecency, adaptive] = await Promise.all([
            D.getFrecencyMap ? D.getFrecencyMap() : new Map(),
            D.getAdaptivePicks ? D.getAdaptivePicks(q) : [],
          ]);
          const ranked = D.rankSearch(idx, q, {
            frecency,
            adaptive,
            starredIdsSet: state.starredSongIds,
          });
          const songById = new Map((state.songs || []).map((s) => [s.id, s]));
          const albumById = new Map((state.mergedAlbums || state.albumsByType.newest || []).map((a) => [a.id, a]));
          const artistById = new Map((state.artists || []).map((a) => [a.id, a]));

          localArtists = ranked.artists.map((r) => artistById.get(r.doc.rawId)).filter(Boolean);
          localAlbums = ranked.albums.map((r) => albumById.get(r.doc.rawId)).filter(Boolean);
          localSongs = ranked.songs.map((r) => songById.get(r.doc.rawId)).filter(Boolean);
          if (ranked.top) {
            const kd = ranked.top.doc.kind;
            const rid = ranked.top.doc.rawId;
            const entity = kd === 'artist' ? artistById.get(rid) : kd === 'album' ? albumById.get(rid) : songById.get(rid);
            if (entity) topHit = { kind: kd, item: entity };
          }
        }
      } catch {
        // Fallback to server search below
      }
    }

    // Supplement with server + translation search when local index is sparse
    if (localArtists.length + localAlbums.length + localSongs.length < 6) {
      try {
        const srv = await titles.searchLibraryWithTranslation(client, q, { artistCount: 12, albumCount: 18, songCount: 40 });
        const mergeUnique = (a, b) => {
          const seen = new Set(a.map((x) => x.id));
          return [...a, ...(b || []).filter((x) => x?.id && !seen.has(x.id))];
        };
        localArtists = mergeUnique(localArtists, srv.artist);
        localAlbums = mergeUnique(localAlbums, srv.album);
        localSongs = mergeUnique(localSongs, srv.song);
        if (!topHit) {
          if (localArtists[0]) topHit = { kind: 'artist', item: localArtists[0] };
          else if (localAlbums[0]) topHit = { kind: 'album', item: localAlbums[0] };
          else if (localSongs[0]) topHit = { kind: 'song', item: localSongs[0] };
        }
      } catch {
        // Ignore
      }
    }

    return { artist: localArtists, album: localAlbums, song: localSongs, top: topHit };
  }

  function setupSearchHandlers() {
    const input = $('search-input');
    if (!input) return;

    input.addEventListener('focus', () => {
      if (!state.songs) void ensureLocalSearchIndex();
      renderRecentSearches();
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      state.searchQuery = q;
      show($('search-clear-btn'), q.length > 0);
      renderRecentSearches();
      if (state.searchTimer) clearTimeout(state.searchTimer);
      if (!q) {
        clearSearchState();
        return;
      }
      state.searchTimer = setTimeout(async () => {
        const res = await executeSmartSearch(q);
        if (state.searchQuery !== q) return;
        state.searchResults = res;
        state.searchSelectedIndex = -1;
        renderSearchResults();
      }, 120);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (input.value) {
          e.preventDefault();
          e.stopPropagation();
          clearSearchState(true);
        } else {
          e.preventDefault();
          input.blur();
          goBack();
        }
        return;
      }
      if (state.searchNavItems.length === 0) return;
      const n = state.searchNavItems.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.searchSelectedIndex = (state.searchSelectedIndex + 1) % n;
        highlightSearchNavItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.searchSelectedIndex = (state.searchSelectedIndex - 1 + n) % n;
        highlightSearchNavItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const target = state.searchSelectedIndex >= 0 ? state.searchNavItems[state.searchSelectedIndex] : state.searchNavItems[0];
        target?.trigger();
      }
    });

    $('search-clear-btn')?.addEventListener('click', () => {
      clearSearchState(true);
      input.focus();
    });

    $('search-recent-clear-btn')?.addEventListener('click', () => {
      state.recentSearches = [];
      localStorage.removeItem(STORAGE_KEYS.RECENT_SEARCHES);
      renderRecentSearches();
    });

    document.querySelectorAll('[data-search-nav]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-search-nav')));
    });

    renderRecentSearches();
  }

  function highlightSearchNavItem() {
    state.searchNavItems.forEach((item, idx) => {
      const active = idx === state.searchSelectedIndex;
      item.el.classList.toggle('ring-2', active);
      item.el.classList.toggle('ring-emerald-400', active);
      if (active) item.el.scrollIntoView({ block: 'nearest' });
    });
  }

  function noteSearchPick(kind, id) {
    if (!state.searchQuery || !id) return;
    saveRecentSearch(state.searchQuery);
    window.PlenripDiscovery?.recordAdaptivePick?.(state.searchQuery, id, kind);
  }

  function createTopResultHero(top, songList) {
    if (!top?.item) return null;
    const { kind, item } = top;
    const card = document.createElement('div');
    card.className =
      'group studio-panel p-5 bg-zinc-900/70 hover:border-emerald-400/60 flex items-center justify-between gap-4 cursor-pointer transition-colors';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-4 min-w-0';
    const art = document.createElement('div');
    art.className = `w-20 h-20 sm:w-24 sm:h-24 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center ${
      kind === 'artist' ? 'artist-avatar-round' : 'radius-card'
    }`;
    const img = document.createElement('img');
    img.alt = '';
    img.className = 'hidden w-full h-full object-cover';
    const fb = document.createElement('div');
    fb.className = 'text-zinc-400 flex items-center justify-center';
    fb.innerHTML = `<i data-lucide="${kind === 'artist' ? 'user' : kind === 'album' ? 'disc' : 'music'}" class="w-8 h-8"></i>`;
    art.appendChild(img);
    art.appendChild(fb);

    if (kind === 'artist') attachArtistImage(img, fb, item);
    else attachCoverImage(img, fb, item.coverArt || item.albumId || item.id, kind === 'song' ? item.id : null, 300);

    const titleText = kind === 'song' ? item.title : item.name;
    const subText =
      kind === 'artist'
        ? `${item.albumCount ?? 0} albums`
        : `${item.artist || 'Unknown Artist'}${item.year ? ' · ' + item.year : ''}`;

    const meta = document.createElement('div');
    meta.className = 'min-w-0 space-y-1';
    meta.innerHTML = `
      <span class="inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-emerald-400/15 border border-emerald-400/40 text-emerald-300 radius-inner">TOP ${escapeHtml(kind)}</span>
      <div class="text-lg sm:text-2xl font-display text-zinc-100 truncate">${titleHtml(titleText || 'Untitled', item.artist || '')}</div>
      <div class="text-xs font-mono text-zinc-400 truncate">${escapeHtml(subText)}</div>`;

    left.appendChild(art);
    left.appendChild(meta);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.title = 'Play Top Result';
    playBtn.className =
      'pill-round w-12 h-12 bg-emerald-400 hover:bg-emerald-300 text-zinc-950 flex items-center justify-center shadow-xl shrink-0 transition-transform group-hover:scale-105';
    playBtn.innerHTML = '<i data-lucide="play" class="w-5 h-5 fill-current"></i>';
    playBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      noteSearchPick(kind, item.id);
      triggerCoverFly(art, '#player-cover-btn');
      if (kind === 'song') {
        playOrToggle(item, songList?.length ? songList : [item], 0, { contextName: 'Search', source: 'search' });
      } else if (kind === 'album') {
        const detail = await client.resolveAlbumSongs(item).catch(() => null);
        if (detail?.song?.length) playSongs(detail.song, { contextName: item.name, source: 'album' });
      } else if (kind === 'artist') {
        const detail = await client.getArtist(item.id).catch(() => null);
        const firstAlb = detail?.album?.[0];
        if (firstAlb) {
          const albSongs = await client.resolveAlbumSongs(firstAlb).catch(() => null);
          if (albSongs?.song?.length) playSongs(albSongs.song, { contextName: item.name, source: 'artist' });
        }
      }
    });

    const openPrimary = () => {
      noteSearchPick(kind, item.id);
      if (kind === 'artist') openArtistDetail(item.id);
      else if (kind === 'album') openAlbumDetail(item, 'search');
      else playOrToggle(item, songList?.length ? songList : [item], 0, { contextName: 'Search', source: 'search' });
    };
    card.addEventListener('click', openPrimary);
    card.appendChild(left);
    card.appendChild(playBtn);
    return { el: card, trigger: openPrimary };
  }

  function renderSearchResults() {
    const container = $('search-results');
    if (!container) return;
    state.searchNavItems = [];
    const label = $('search-summary-label');

    if (!state.searchQuery) {
      container.innerHTML = `
        <div class="py-12 text-center text-sm font-mono text-zinc-400">
          Type above to search across original, kana, romaji, and translated titles.
        </div>`;
      return;
    }

    const { artist = [], album = [], song = [], top = null } = state.searchResults;
    if (label) label.textContent = `${artist.length} artists · ${album.length} albums · ${song.length} songs`;

    if (artist.length + album.length + song.length === 0) {
      container.innerHTML = `<div class="py-12 text-center text-sm font-mono text-zinc-400">No matches found for "${escapeHtml(state.searchQuery)}".</div>`;
      return;
    }

    container.innerHTML = '';
    const section = (name, count) => {
      const sec = document.createElement('div');
      sec.className = 'space-y-3 mb-8';
      sec.innerHTML = `<h2 class="text-xs font-mono uppercase tracking-wider text-emerald-400">${name} (${count})</h2>`;
      return sec;
    };

    if (top?.item) {
      const hero = createTopResultHero(top, song);
      if (hero) {
        const wrap = document.createElement('div');
        wrap.className = 'space-y-2.5 mb-8';
        wrap.innerHTML = '<h2 class="text-xs font-mono uppercase tracking-wider text-emerald-400">Top Result</h2>';
        wrap.appendChild(hero.el);
        container.appendChild(wrap);
        state.searchNavItems.push(hero);
      }
    }

    if (song.length > 0) {
      const sec = section('Tracks', song.length);
      const list = document.createElement('div');
      list.className = 'studio-panel overflow-hidden';
      song.forEach((s, idx) => {
        const row = createTrackRowElement(s, idx, song, {
          contextName: 'Search',
          source: 'search',
          onActivated: () => noteSearchPick('song', s.id),
        });
        list.appendChild(row);
        state.searchNavItems.push({
          el: row,
          trigger: () => {
            noteSearchPick('song', s.id);
            playOrToggle(s, song, idx, { contextName: 'Search', source: 'search' });
          },
        });
      });
      sec.appendChild(list);
      container.appendChild(sec);
    }

    if (artist.length > 0) {
      const sec = section('Artists', artist.length);
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
      artist.forEach((ar) => {
        const card = createArtistCard(ar);
        card.addEventListener('click', () => noteSearchPick('artist', ar.id), true);
        grid.appendChild(card);
        state.searchNavItems.push({
          el: card,
          trigger: () => {
            noteSearchPick('artist', ar.id);
            openArtistDetail(ar.id);
          },
        });
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    if (album.length > 0) {
      const sec = section('Albums', album.length);
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
      album.forEach((al) => {
        const card = createAlbumCard(al, 'search', true);
        card.addEventListener('click', () => noteSearchPick('album', al.id), true);
        grid.appendChild(card);
        state.searchNavItems.push({
          el: card,
          trigger: () => {
            noteSearchPick('album', al.id);
            openAlbumDetail(al, 'search');
          },
        });
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    queueTranslations([
      ...artist.map((a) => ({ title: a.name, artist: '' })),
      ...album.map((a) => ({ title: a.name, artist: a.artist })),
      ...song.map((s) => ({ title: s.title, artist: s.artist })),
    ]);
    refreshIcons();
  }

  // ============================================================================
  // Artist Detail (Popular Top-10, Bio, Library Similar Artists, Discography)
  // ============================================================================
  function renderArtistStarButton() {
    const btn = $('artist-star-btn');
    if (!btn || !state.currentArtist) return;
    const starred = state.starredArtistIds.has(state.currentArtist.id);
    btn.classList.toggle('text-emerald-400', starred);
    btn.classList.toggle('border-emerald-400', starred);
    btn.querySelector('svg, i')?.classList.toggle('fill-current', starred);
  }

  async function fetchWikipediaBio(name) {
    if (!name) return null;
    for (const lang of ['en', 'ja']) {
      try {
        const res = await fetchWithTimeout(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
          { timeout: 5000 }
        );
        if (!res.ok) continue;
        const data = await res.json();
        const text = String(data?.extract || '').trim();
        if (text) return { text, lang };
      } catch {
        // Ignore
      }
    }
    return null;
  }

  function renderArtistPopularList() {
    const wrap = $('artist-popular-wrap');
    const list = $('artist-popular-list');
    const toggleBtn = $('artist-popular-toggle-btn');
    if (!wrap || !list) return;
    const songs = state.artistPopularSongs || [];
    show(wrap, songs.length > 0);
    if (songs.length === 0) return;

    const visible = state.artistPopularExpanded ? songs.slice(0, 10) : songs.slice(0, 5);
    if (toggleBtn) {
      show(toggleBtn, songs.length > 5);
      toggleBtn.textContent = state.artistPopularExpanded ? 'SHOW TOP 5' : `SHOW TOP ${Math.min(10, songs.length)}`;
    }
    list.innerHTML = '';
    const playStats = getPlayStats().bySong;
    visible.forEach((song, idx) => {
      const plays = (playStats.get(song.id)?.count || 0) + (song.playCount || 0);
      list.appendChild(
        createTrackRowElement(song, idx, songs, {
          contextName: `${state.currentArtist?.name || 'Artist'} · Popular`,
          source: 'artist',
          badgeText: plays > 0 ? `${plays} plays` : '',
        })
      );
    });
    queueTranslations(visible.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
  }

  async function openArtistDetail(artistId) {
    if (!artistId) return;
    navigateTo('artist-detail', { animateSameRoute: true });
    const grid = $('artist-albums-grid');
    $('artist-detail-name').textContent = 'Loading...';
    $('artist-detail-meta').textContent = '';
    show($('artist-bio-wrap'), false);
    show($('artist-similar-wrap'), false);
    show($('artist-popular-wrap'), false);
    state.artistPopularSongs = [];
    state.artistPopularExpanded = false;
    if (grid) grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">Loading artist catalog...</div>';

    try {
      const artist = await client.getArtist(artistId);
      state.currentArtist = artist;
      const rawAlbums = await client.resolveArtistAlbums(artist);
      const albums = window.PlenripDiscovery?.mergeAlbums ? window.PlenripDiscovery.mergeAlbums(rawAlbums) : rawAlbums;
      state.currentArtistAlbums = albums;

      $('artist-detail-name').innerHTML = titleHtml(artist.name, '');
      const singles = albums.find((a) => String(a.id).startsWith('singles-'));
      const regularCount = albums.length - (singles ? 1 : 0);
      $('artist-detail-meta').textContent = `${regularCount} ${regularCount === 1 ? 'album' : 'albums'}${
        singles ? ` · ${singles.songCount} singles` : ''
      }`;
      attachArtistImage($('artist-detail-thumb'), null, artist);
      $('artist-detail-thumb').classList.remove('hidden');
      renderArtistStarButton();

      grid.innerHTML = '';
      if (albums.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">No releases found for this artist.</div>';
      } else if (!getSplitAlbumsSingles()) {
        albums.forEach((alb) => grid.appendChild(createAlbumCard(alb, 'artist-detail')));
      } else {
        const isDiscSingle = (a) => String(a.id).startsWith('singles-') || isSingleOrEp(a);
        const discAlbums = albums.filter((a) => !isDiscSingle(a));
        const discSingles = albums.filter((a) => isDiscSingle(a));
        const discSection = (title, count, cards) => {
          if (cards.length === 0) return;
          const head = document.createElement('div');
          head.className = 'col-span-full flex items-baseline justify-between gap-2 pb-2 border-b border-zinc-800';
          head.innerHTML = `<h2 class="font-display font-normal text-lg text-zinc-100 tracking-tight">${title}</h2><span class="font-mono text-xs text-zinc-400">${count} ${count === 1 ? 'release' : 'releases'}</span>`;
          grid.appendChild(head);
          cards.forEach((alb) => grid.appendChild(createAlbumCard(alb, 'artist-detail')));
        };
        discSection('Albums', discAlbums.length, discAlbums);
        discSection('Singles & EPs', discSingles.length, discSingles);
      }
      queueTranslations([{ title: artist.name, artist: '' }, ...albums.map((a) => ({ title: a.name, artist: a.artist }))]);
      refreshIcons();

      // Load Popular Top-10 Tracks (Subsonic getTopSongs + local play stats + discography)
      (async () => {
        let topSongs = await client.getTopSongs(artist.name, 10).catch(() => []);
        if (!Array.isArray(topSongs) || topSongs.length < 5) {
          const discSongs = await collectArtistSongs();
          const playMap = getPlayStats().bySong;
          const seen = new Set((topSongs || []).map((s) => s.id));
          const ranked = [...discSongs]
            .filter((s) => s?.id && !seen.has(s.id))
            .sort((a, b) => {
              const pa = (playMap.get(a.id)?.count || 0) + (a.playCount || 0) + (state.starredSongIds.has(a.id) ? 2 : 0);
              const pb = (playMap.get(b.id)?.count || 0) + (b.playCount || 0) + (state.starredSongIds.has(b.id) ? 2 : 0);
              return pb - pa;
            });
          topSongs = [...(topSongs || []), ...ranked].slice(0, 10);
        }
        if (state.currentArtist?.id !== artistId) return;
        state.artistPopularSongs = topSongs.slice(0, 10);
        renderArtistPopularList();
      })();

      // Biography + similar artists matched to local library
      client.getArtistInfo2(artistId).then(async (info) => {
        if (state.currentArtist?.id !== artistId) return;
        let bio = String(info.biography || '').replace(/<a [^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
        let bioSource = bio ? 'Server' : '';
        if (!bio) {
          const wiki = await fetchWikipediaBio(artist.name);
          if (wiki) {
            bio = wiki.text;
            bioSource = `Wikipedia (${wiki.lang.toUpperCase()})`;
          }
        }
        if (bio && state.currentArtist?.id === artistId) {
          $('artist-bio-text').textContent = bio.length > 600 ? `${bio.slice(0, 600)}...` : bio;
          const src = $('artist-bio-source');
          if (src) src.textContent = `Biography · ${bioSource}`;
          show($('artist-bio-wrap'), true);
        }

        const libArtists = await loadAllArtists().catch(() => []);
        const byFold = new Map(libArtists.map((a) => [String(a.name || '').toLowerCase(), a]));
        const similar = (info.similarArtist || [])
          .map((s) => byFold.get(String(s.name || '').toLowerCase()) || (s.id ? s : null))
          .filter(Boolean)
          .slice(0, 12);
        if (similar.length > 0 && state.currentArtist?.id === artistId) {
          const list = $('artist-similar-list');
          list.innerHTML = '';
          similar.forEach((a) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'px-2.5 py-1 border border-zinc-700 bg-zinc-900 hover:border-emerald-400 hover:text-emerald-400 text-xs font-mono text-zinc-300';
            b.textContent = a.name;
            b.addEventListener('click', () => openArtistDetail(a.id));
            list.appendChild(b);
          });
          show($('artist-similar-wrap'), true);
        }
      });
    } catch (err) {
      showToast(`Failed to load artist: ${err.message}`);
    }
  }

  async function collectArtistSongs() {
    const albums = state.currentArtistAlbums || [];
    const details = await Promise.all(albums.map((a) => client.resolveAlbumSongs(a).catch(() => null)));
    return details.flatMap((d) => d?.song || []);
  }

  // ============================================================================
  // Album Detail (Preserving attachAlbumDetailCover + Multi-Disc Headers)
  // ============================================================================
  async function openAlbumDetail(albumOrId, backRoute = 'albums') {
    if (!albumOrId) return;
    state.albumBackRoute = backRoute;
    state.currentAlbum = null;
    navigateTo('album-detail', { animateSameRoute: true });
    $('album-detail-title').textContent = 'Loading...';
    $('album-tracks-list').innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">Loading tracklist...</div>';
    show($('album-more-menu'), false);

    try {
      const album = await client.resolveAlbumSongs(albumOrId);
      state.currentAlbum = album;
      if (album.starred) state.starredAlbumIds.add(album.id);
      renderAlbumDetailView();
    } catch (err) {
      showToast(`Failed to load album: ${err.message}`);
    }
  }

  function isVirtualAlbum(album) {
    return Boolean(album && String(album.id).startsWith('singles-'));
  }

  function renderAlbumStarButton() {
    const btn = $('album-star-btn');
    if (!btn || !state.currentAlbum) return;
    if (isVirtualAlbum(state.currentAlbum)) {
      show(btn, false);
      return;
    }
    show(btn, true);
    const starred = state.starredAlbumIds.has(state.currentAlbum.id);
    $('album-star-label').textContent = starred ? 'STARRED' : 'STAR';
    btn.classList.toggle('text-emerald-400', starred);
    btn.classList.toggle('border-emerald-400', starred);
  }

  function renderAlbumDetailView() {
    const album = state.currentAlbum;
    if (!album) return;
    const virtual = isVirtualAlbum(album);

    const backLabels = {
      'artist-detail': `BACK TO ${(album.artist || 'ARTIST').toUpperCase()}`,
      home: 'BACK TO HOME',
      search: 'BACK TO SEARCH',
    };
    $('album-back-label').textContent = backLabels[state.albumBackRoute] || 'ALL ALBUMS';
    $('album-detail-badge').textContent = virtual ? 'Singles Collection' : 'Album Release';
    $('album-detail-title').innerHTML = titleHtml(album.name || 'Untitled Album', album.artist);

    const artistBtn = $('album-detail-artist-btn');
    artistBtn.textContent = album.artist || 'Unknown Artist';
    artistBtn.onclick = () => album.artistId && openArtistDetail(album.artistId);

    const songs = album.song || [];
    const totalSec = album.duration || songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    const meta = [];
    if (album.year) meta.push(album.year);
    meta.push(`${songs.length} tracks`, formatTotalDuration(totalSec));
    $('album-detail-meta').textContent = `· ${meta.join(' · ')}`;

    attachAlbumDetailCover(
      $('album-detail-cover'),
      $('album-detail-cover-fallback'),
      album,
      500
    );

    renderAlbumStarButton();
    renderAlbumTracks();
  }

  function renderAlbumTracks() {
    const album = state.currentAlbum;
    const list = $('album-tracks-list');
    if (!album || !list) return;
    const songs = album.song || [];
    const virtual = isVirtualAlbum(album);
    list.innerHTML = '';
    if (songs.length === 0) {
      list.innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">No tracks found in this album.</div>';
      return;
    }
    const discs = new Set(songs.map((s) => s.discNumber || 1));
    const hasMultiDisc = !virtual && discs.size > 1;
    let currentDisc = null;

    songs.forEach((song, idx) => {
      const disc = song.discNumber || 1;
      if (hasMultiDisc && disc !== currentDisc) {
        currentDisc = disc;
        const discHead = document.createElement('div');
        discHead.className = 'px-4 py-2 bg-zinc-950/60 text-[11px] font-mono uppercase tracking-wider text-emerald-400 border-b border-zinc-800';
        discHead.textContent = `Disc ${disc}`;
        list.appendChild(discHead);
      }
      list.appendChild(
        createTrackRowElement(song, idx, songs, {
          showCover: virtual,
          showAlbum: virtual,
          showTrackNumber: !virtual,
          selectable: true,
          selectScope: 'album',
          contextName: album.name || 'Album',
          source: 'album',
        })
      );
    });
    queueTranslations(songs.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
  }

  function enqueueNext(songs) {
    if (!songs || songs.length === 0) return;
    if (!audioEngine.currentSong) {
      playSongs(songs);
      return;
    }
    [...songs].reverse().forEach((s) => audioEngine.playNextInQueue(s));
    showToast(`Playing ${songs.length} tracks next`);
  }

  function enqueueEnd(songs) {
    if (!songs || songs.length === 0) return;
    if (!audioEngine.currentSong) {
      playSongs(songs);
      return;
    }
    songs.forEach((s) => audioEngine.addToQueue(s));
    showToast(`Added ${songs.length} tracks to queue`);
  }

  // ============================================================================
  // Playlists (Smart Playlists .nsp + Custom Cover Picker + Sidebar Drag-Drop)
  // ============================================================================
  async function getPlaylistCollage(pl) {
    const custom = getCustomPlaylistCover(pl.id);
    if (custom) return custom;
    if (state.playlistCollages.has(pl.id)) return state.playlistCollages.get(pl.id);
    const promise = client
      .getPlaylist(pl.id)
      .then((detail) => generatePlaylistCollage(detail.entry || [], (id, sz) => client.getCoverArtUrl(id, sz)))
      .catch(() => null);
    state.playlistCollages.set(pl.id, promise);
    return promise;
  }

  function invalidatePlaylistCollage(id) {
    state.playlistCollages.delete(id);
  }

  async function refreshPlaylistsSidebarAndCache() {
    try {
      state.playlists = await client.getPlaylists();
      updateSidebarCounts();
      renderSidebarPlaylists();
    } catch {
      // Ignore if offline
    }
  }

  function highlightSidebarPlaylists() {
    document.querySelectorAll('.sidebar-playlist-item').forEach((btn) => {
      const active = state.route === 'playlist-detail' && state.currentPlaylist?.id === btn.getAttribute('data-playlist-id');
      btn.classList.toggle('nav-item-active', active);
    });
  }

  function renderSidebarPlaylists() {
    const container = $('sidebar-custom-playlists');
    if (!container) return;
    container.innerHTML = '';
    for (const pl of state.playlists) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-playlist-id', pl.id);
      btn.title = `${pl.name} (drop tracks here to add)`;
      btn.className =
        'sidebar-playlist-item sidebar-nav-btn w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors';
      btn.innerHTML = `
        <span class="w-5 h-5 shrink-0 bg-zinc-950 border border-zinc-700 overflow-hidden flex items-center justify-center radius-inner">
          <img alt="" class="hidden w-full h-full object-cover" />
          <i data-lucide="disc-3" class="nav-icon w-3 h-3"></i>
        </span>
        <span class="sidebar-label flex-1 text-left truncate">${escapeHtml(pl.name)}</span>
        <span class="sidebar-shortcut text-[10px] font-mono text-zinc-400">${pl.songCount ?? 0}</span>`;
      btn.addEventListener('click', () => openPlaylistDetail(pl.id));

      // HTML5 Drag-and-drop tracks onto sidebar playlist
      btn.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types?.includes('application/x-plenrip-songs')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          btn.classList.add('playlist-drop-target');
        }
      });
      btn.addEventListener('dragleave', () => btn.classList.remove('playlist-drop-target'));
      btn.addEventListener('drop', async (e) => {
        btn.classList.remove('playlist-drop-target');
        const raw = e.dataTransfer?.getData('application/x-plenrip-songs');
        if (!raw) return;
        e.preventDefault();
        try {
          const songIds = JSON.parse(raw);
          if (!Array.isArray(songIds) || songIds.length === 0) return;
          await client.updatePlaylist({ playlistId: pl.id, songIdToAdd: songIds });
          invalidatePlaylistCollage(pl.id);
          showToast(`Added ${songIds.length} track${songIds.length === 1 ? '' : 's'} to "${pl.name}"`);
          await refreshPlaylistsSidebarAndCache();
          if (state.route === 'playlist-detail' && state.currentPlaylist?.id === pl.id) {
            await openPlaylistDetail(pl.id);
          }
        } catch (err) {
          showToast(`Drop failed: ${err.message}`);
        }
      });

      container.appendChild(btn);

      const img = btn.querySelector('img');
      const icon = btn.querySelector('[data-lucide]');
      getPlaylistCollage(pl).then((url) => {
        if (!url) return;
        img.onload = () => {
          img.classList.remove('hidden');
          icon.classList.add('hidden');
        };
        img.src = url;
      });
    }
    highlightSidebarPlaylists();
    refreshIcons();
  }

  async function resolveSmartPlaylistsWithTracks() {
    const D = window.PlenripDiscovery;
    if (!D?.loadSmartPlaylistsFromDb) return [];
    const [defs, songs, aggregates] = await Promise.all([
      D.loadSmartPlaylistsFromDb(),
      loadAllSongs().catch(() => []),
      D.getAllTrackAggregates(),
    ]);
    state.smartPlaylists = defs;
    return defs.map((def) => {
      const tracks = D.evaluateNspPlaylist(def, {
        songs,
        aggregates,
        silenceTargetDays: state.discoverySettings.silenceDays,
        starredIdsSet: state.starredSongIds,
      });
      return { def, tracks };
    });
  }

  async function renderSmartPlaylistsSection() {
    const grid = $('smart-playlists-grid');
    const sec = $('smart-playlists-section');
    if (!grid || !sec) return;
    const items = await resolveSmartPlaylistsWithTracks().catch(() => []);
    show(sec, items.length > 0);
    grid.innerHTML = '';
    for (const { def, tracks } of items) {
      const card = document.createElement('div');
      card.className =
        'smart-playlist-card group studio-panel hover:border-emerald-400/60 p-3.5 flex items-center gap-3.5 cursor-pointer transition-colors';

      const art = document.createElement('div');
      art.className = 'w-16 h-16 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center relative radius-inner';
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'hidden w-full h-full object-cover';
      const fb = document.createElement('div');
      fb.className = 'text-emerald-400 flex items-center justify-center';
      fb.innerHTML = '<i data-lucide="sparkles" class="w-6 h-6"></i>';
      art.appendChild(img);
      art.appendChild(fb);

      const customCover = getCustomPlaylistCover(`smart:${def.id}`);
      if (customCover) {
        img.onload = () => {
          img.classList.remove('hidden');
          fb.classList.add('hidden');
        };
        img.src = customCover;
      } else {
        generatePlaylistCollage(tracks.slice(0, 8), (id, sz) => client.getCoverArtUrl(id, sz)).then((url) => {
          if (!url) return;
          img.onload = () => {
            img.classList.remove('hidden');
            fb.classList.add('hidden');
          };
          img.src = url;
        });
      }

      const body = document.createElement('div');
      body.className = 'min-w-0 flex-1 space-y-1';
      body.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-medium text-zinc-100 group-hover:text-emerald-400 truncate">${escapeHtml(def.name)}</span>
          <span class="px-1.5 py-0.5 text-[9.5px] font-mono ${
            def.liveUpdating !== false
              ? 'bg-emerald-400/15 text-emerald-300 border border-emerald-400/30'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
          } radius-inner">${def.liveUpdating !== false ? 'LIVE' : 'FROZEN'}</span>
        </div>
        <p class="text-[11px] text-zinc-400 line-clamp-1">${escapeHtml(def.comment || '')}</p>
        <div class="text-[10.5px] font-mono text-zinc-500">${tracks.length} tracks</div>`;

      const actions = document.createElement('div');
      actions.className = 'flex items-center gap-1 shrink-0';
      const nspBtn = document.createElement('button');
      nspBtn.type = 'button';
      nspBtn.title = 'Export Navidrome .nsp';
      nspBtn.className = 'w-8 h-8 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-emerald-400';
      nspBtn.innerHTML = '<i data-lucide="download" class="w-3.5 h-3.5"></i>';
      nspBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.PlenripDiscovery?.downloadNspFile?.(def);
        showToast(`Exported ${def.id}.nsp`);
      });

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.title = `Play ${def.name}`;
      playBtn.className = 'pill-round w-9 h-9 bg-emerald-400 hover:bg-emerald-300 text-zinc-950 flex items-center justify-center shadow-lg';
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerCoverFly(art, '#player-cover-btn');
        playSongs(tracks, { shuffle: false, contextName: def.name, source: 'playlist' });
      });

      actions.appendChild(nspBtn);
      actions.appendChild(playBtn);
      card.appendChild(art);
      card.appendChild(body);
      card.appendChild(actions);
      card.addEventListener('click', () => openSmartPlaylistDetail(def.id));
      grid.appendChild(card);
    }
    refreshIcons();
  }

  async function openSmartPlaylistDetail(smartId) {
    const D = window.PlenripDiscovery;
    if (!D || !smartId) return;
    state.deletePlaylistConfirm = false;
    navigateTo('playlist-detail', { animateSameRoute: true });
    $('playlist-detail-title').textContent = 'Loading...';
    $('playlist-tracks-list').innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">Evaluating smart rules...</div>';
    show($('playlist-more-menu'), false);

    const items = await resolveSmartPlaylistsWithTracks();
    const match = items.find((x) => x.def.id === smartId);
    if (!match) {
      showToast('Smart playlist not found');
      return;
    }
    state.currentPlaylist = {
      id: `smart:${match.def.id}`,
      isSmart: true,
      smartDef: match.def,
      name: match.def.name,
      entry: match.tracks,
      duration: match.tracks.reduce((acc, s) => acc + (s.duration || 0), 0),
    };
    highlightSidebarPlaylists();
    renderPlaylistDetailView();
  }

  async function loadPlaylistsView() {
    const grid = $('playlists-grid');
    if (!grid) return;
    if (!grid.hasChildNodes()) grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">Loading playlists...</div>';
    void renderSmartPlaylistsSection();
    try {
      state.playlists = await client.getPlaylists();
      updateSidebarCounts();
      renderSidebarPlaylists();
      $('playlists-count-label').textContent = `${state.playlists.length} custom playlists · 5 smart playlists`;
      grid.innerHTML = '';
      if (state.playlists.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">No custom playlists yet. Create one to get started.</div>';
        return;
      }
      for (const pl of state.playlists) {
        const card = createMediaCard({
          fallbackIcon: 'list-music',
          title: pl.name,
          meta: `${pl.songCount ?? 0} tracks · ${formatTotalDuration(pl.duration || 0)}`,
          onClick: () => openPlaylistDetail(pl.id),
          onPlay: async () => {
            const detail = await client.getPlaylist(pl.id).catch(() => null);
            playSongs(detail?.entry || [], { contextName: pl.name, source: 'playlist' });
          },
        });
        const img = card.querySelector('img');
        const fb = img.nextElementSibling;
        getPlaylistCollage(pl).then((url) => {
          if (!url) return;
          img.onload = () => {
            img.classList.remove('hidden');
            fb.classList.add('hidden');
          };
          img.src = url;
        });
        grid.appendChild(card);
      }
      refreshIcons();
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  async function openPlaylistDetail(playlistId) {
    if (!playlistId) return;
    if (String(playlistId).startsWith('smart:')) {
      await openSmartPlaylistDetail(String(playlistId).slice('smart:'.length));
      return;
    }
    state.deletePlaylistConfirm = false;
    navigateTo('playlist-detail', { animateSameRoute: true });
    $('playlist-detail-title').textContent = 'Loading...';
    $('playlist-tracks-list').innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">Loading playlist...</div>';
    show($('playlist-more-menu'), false);
    try {
      state.currentPlaylist = await client.getPlaylist(playlistId);
      highlightSidebarPlaylists();
      renderPlaylistDetailView();
    } catch (err) {
      showToast(`Failed to load playlist: ${err.message}`);
    }
  }

  function renderPlaylistDetailView() {
    const pl = state.currentPlaylist;
    if (!pl) return;
    const isSmart = Boolean(pl.isSmart);
    if ($('playlist-detail-badge')) {
      $('playlist-detail-badge').textContent = isSmart ? 'Smart Playlist (.nsp)' : 'Playlist';
    }
    $('playlist-detail-title').textContent = pl.name;
    const entries = pl.entry || [];
    const totalSec = pl.duration || entries.reduce((acc, s) => acc + (s.duration || 0), 0);
    $('playlist-detail-meta').textContent = `${entries.length} tracks · ${formatTotalDuration(totalSec)}${
      isSmart && pl.smartDef?.comment ? ` · ${pl.smartDef.comment}` : ''
    }`;

    show($('playlist-rename-toggle-btn'), !isSmart);
    show($('playlist-delete-btn'), !isSmart);
    show($('playlist-freeze-toggle-btn'), isSmart);
    show($('playlist-export-nsp-btn'), isSmart);
    if (isSmart && $('playlist-freeze-label')) {
      $('playlist-freeze-label').textContent = pl.smartDef?.liveUpdating !== false ? 'LIVE' : 'FROZEN';
    }
    if ($('playlist-delete-label')) {
      $('playlist-delete-label').textContent = state.deletePlaylistConfirm ? 'Confirm delete?' : 'Delete playlist';
    }

    const img = $('playlist-detail-cover');
    const fb = $('playlist-detail-cover-fallback');
    img.classList.add('hidden');
    fb.classList.remove('hidden');

    const custom = getCustomPlaylistCover(pl.id);
    if (custom) {
      img.onload = () => {
        img.classList.remove('hidden');
        fb.classList.add('hidden');
      };
      img.src = custom;
    } else {
      generatePlaylistCollage(entries, (id, sz) => client.getCoverArtUrl(id, sz)).then((url) => {
        if (!url) return;
        img.onload = () => {
          img.classList.remove('hidden');
          fb.classList.add('hidden');
        };
        img.src = url;
      });
    }
    renderPlaylistDetailTracks();
  }

  function renderPlaylistDetailTracks() {
    const pl = state.currentPlaylist;
    const list = $('playlist-tracks-list');
    if (!pl || !list) return;
    const isSmart = Boolean(pl.isSmart);
    const entries = pl.entry || [];
    list.innerHTML = '';
    if (entries.length === 0) {
      list.innerHTML = `<div class="p-8 text-center text-xs font-mono text-zinc-400">${
        isSmart
          ? 'No tracks match these smart rules yet. Listen to a few tracks first!'
          : 'This playlist is empty. Drag tracks onto the sidebar playlist or use the 3-dot menu.'
      }</div>`;
      return;
    }
    entries.forEach((song, idx) => {
      list.appendChild(
        createTrackRowElement(song, idx, entries, {
          selectable: true,
          selectScope: 'playlist',
          contextName: pl.name || 'Playlist',
          source: 'playlist',
          onRemoveFromPlaylist: isSmart
            ? undefined
            : async (removeIdx) => {
                try {
                  await client.updatePlaylist({ playlistId: pl.id, songIndexToRemove: removeIdx });
                  showToast(`Removed "${song.title}" from playlist`);
                  invalidatePlaylistCollage(pl.id);
                  await openPlaylistDetail(pl.id);
                  await refreshPlaylistsSidebarAndCache();
                } catch (err) {
                  showToast(`Failed to remove track: ${err.message}`);
                }
              },
          onMoveTrack: isSmart ? undefined : (fromIdx, toIdx) => movePlaylistTrack(fromIdx, toIdx),
        })
      );
    });
    queueTranslations(entries.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
  }

  async function movePlaylistTrack(fromIdx, toIdx) {
    const pl = state.currentPlaylist;
    if (!pl || pl.isSmart || !Array.isArray(pl.entry)) return;
    const entries = [...pl.entry];
    if (fromIdx < 0 || fromIdx >= entries.length || toIdx < 0 || toIdx >= entries.length) return;
    if (fromIdx === toIdx) return;
    const [moved] = entries.splice(fromIdx, 1);
    entries.splice(toIdx, 0, moved);
    try {
      await client.updatePlaylist({
        playlistId: pl.id,
        songIdToAdd: entries.map((s) => s.id),
        songIndexToRemove: pl.entry.map((_, i) => i),
      });
      invalidatePlaylistCollage(pl.id);
      await openPlaylistDetail(pl.id);
      await refreshPlaylistsSidebarAndCache();
    } catch (err) {
      showToast(`Failed to reorder playlist: ${err.message}`);
    }
  }

  function openPlaylistCoverPicker() {
    const pl = state.currentPlaylist;
    if (!pl) return;
    state.playlistCoverTargetId = pl.id;
    state.playlistCoverStagedDataUrl = getCustomPlaylistCover(pl.id) || null;
    const prev = $('playlist-cover-preview');
    const fb = $('playlist-cover-preview-fallback');
    if (prev && fb) {
      if (state.playlistCoverStagedDataUrl) {
        prev.src = state.playlistCoverStagedDataUrl;
        prev.classList.remove('hidden');
        fb.classList.add('hidden');
      } else {
        prev.removeAttribute('src');
        prev.classList.add('hidden');
        fb.classList.remove('hidden');
      }
    }
    openModal('playlist-cover-modal');
  }

  function openModal(id) {
    const el = $(id);
    if (window.PlenripAnimations?.openModal) {
      window.PlenripAnimations.openModal(el);
    } else {
      show(el, true);
    }
    refreshIcons();
  }
  function closeModal(id) {
    const el = $(id);
    if (window.PlenripAnimations?.closeModal) {
      window.PlenripAnimations.closeModal(el);
    } else {
      show(el, false);
    }
  }

  async function createPlaylistWithSongs(name, songs) {
    const created = await client.createPlaylist(name, songs.map((s) => s.id));
    await refreshPlaylistsSidebarAndCache();
    if (state.route === 'playlists') loadPlaylistsView();
    return created;
  }

  function openAddToPlaylistModal(songs) {
    const list = (songs || []).filter(Boolean);
    if (list.length === 0) return;
    state.addPlaylistSongs = list;
    $('add-to-playlist-subtitle').textContent =
      list.length === 1 ? `Adding "${list[0].title}"` : `Adding ${list.length} tracks`;

    const container = $('add-to-playlist-list');
    container.innerHTML = '';
    if (state.playlists.length === 0) {
      container.innerHTML = '<div class="px-3 py-3 text-xs font-mono text-zinc-400">No custom playlists yet</div>';
    }
    for (const pl of state.playlists) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full px-3 py-2 text-left hover:bg-zinc-800 flex items-center justify-between gap-2 border-b border-zinc-700 text-xs font-mono';
      btn.innerHTML = `<span class="truncate text-zinc-100">${escapeHtml(pl.name)}</span><span class="text-zinc-400">${pl.songCount ?? 0} trk</span>`;
      btn.addEventListener('click', async () => {
        closeModal('add-to-playlist-modal');
        try {
          await client.updatePlaylist({ playlistId: pl.id, songIdToAdd: state.addPlaylistSongs.map((s) => s.id) });
          invalidatePlaylistCollage(pl.id);
          showToast(`Added ${state.addPlaylistSongs.length} track(s) to ${pl.name}`);
          await refreshPlaylistsSidebarAndCache();
        } catch (err) {
          showToast(`Failed to add to playlist: ${err.message}`);
        }
      });
      container.appendChild(btn);
    }
    openModal('add-to-playlist-modal');
  }

  // ============================================================================
  // Favourites
  // ============================================================================
  const FAVOURITES_PAGE_SIZE = 50;
  let favouritesPage = 0;

  async function loadFavouritesView() {
    const list = $('favourites-list');
    if (!list) return;
    if (!list.hasChildNodes()) list.innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">Loading starred tracks...</div>';
    try {
      await syncStarredFromServer();
      const songs = state.favouriteSongs;
      const total = songs.reduce((acc, s) => acc + (s.duration || 0), 0);
      $('favourites-count-label').textContent = `${songs.length} starred tracks · ${formatDuration(total)} total`;
      const pages = Math.max(1, Math.ceil(songs.length / FAVOURITES_PAGE_SIZE));
      if (favouritesPage >= pages) favouritesPage = pages - 1;
      const pageSongs = songs.slice(favouritesPage * FAVOURITES_PAGE_SIZE, (favouritesPage + 1) * FAVOURITES_PAGE_SIZE);
      list.innerHTML = '';
      if (songs.length === 0) {
        list.innerHTML = '<div class="p-8 text-center text-xs font-mono text-zinc-400">No favourite songs yet. Click the star on any track to add it.</div>';
        show($('favourites-pagination'), false);
        return;
      }
      pageSongs.forEach((song, idx) =>
        list.appendChild(
          createTrackRowElement(song, favouritesPage * FAVOURITES_PAGE_SIZE + idx, songs, {
            contextName: 'Favourite Songs',
            source: 'playlist',
          })
        )
      );
      queueTranslations(pageSongs.map((s) => ({ title: s.title, artist: s.artist })));
      refreshIcons();
      show($('favourites-pagination'), pages > 1);
      if ($('favourites-prev-page')) $('favourites-prev-page').disabled = favouritesPage <= 0;
      if ($('favourites-next-page')) $('favourites-next-page').disabled = favouritesPage >= pages - 1;
      if ($('favourites-page-indicator')) $('favourites-page-indicator').textContent = `PAGE ${favouritesPage + 1} OF ${pages}`;
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  // ============================================================================
  // Lightweight File Manager (Local Storage Explorer)
  // ============================================================================
  // Local storage file manager (Lightweight File Bridge on port 3001)
  // ============================================================================
  const filesState = {
    currentPath: '',
    items: [],
    filterQuery: '',
    // Incremental reveal: show 100 rows at a time.
    visibleCount: 100,
    // Recursive search results (when a filter query is set): items from
    // every subdirectory, each with its relative path.
    searchResults: null,
    searchRunning: false,
    bridgeUrl: localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url') || '',
    apiKey: localStorage.getItem('century.nas_api_key') || '',
    isOnline: false,
    initialized: false,
  };

  function getFileBridgeBase() {
    const saved = localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url');
    if (saved && saved.trim()) {
      const trimmed = saved.trim().replace(/\/+$/, '');
      // On HTTPS, strip plain http://localhost:3001 or 127.0.0.1:3001 to prevent mixed content & macOS IPv6 drops
      if (typeof window !== 'undefined' && window.location?.protocol === 'https:' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(trimmed)) {
        return '/bridge';
      }
      // If explicitly saved as the old default http://localhost:3001, use relative path
      if (/^http:\/\/(localhost|127\.0\.0\.1):3001$/i.test(trimmed)) {
        return '/bridge';
      }
      return trimmed;
    }
    return '/bridge';
  }

  function getFileBridgeApiKey() {
    return (
      localStorage.getItem('century.nas_api_key') ||
      localStorage.getItem('nas_api_key') ||
      filesState.apiKey ||
      ''
    ).trim();
  }

  function getFileBridgeHeaders(customHeaders = {}) {
    const headers = { ...customHeaders };
    const key = getFileBridgeApiKey();
    if (key) {
      headers['x-api-key'] = key;
    }
    return headers;
  }

  function formatFileSize(bytes) {
    if (bytes === undefined || bytes === null || bytes === 0) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  function formatFileDate(ms) {
    if (!ms) return '-';
    try {
      const d = new Date(ms);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '-';
    }
  }

  function formatLastEdited(ms) {
    if (!ms || isNaN(ms)) return '-';
    const now = Date.now();
    const diff = Math.max(0, now - Number(ms));
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min === 1) return '1 minute ago';
    if (min < 60) return `${min} minutes ago`;
    const hours = Math.floor(min / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    if (months === 1) return '1 month ago';
    if (months < 12) return `${months} months ago`;
    const years = Math.floor(days / 365);
    if (years === 1) return '1 year ago';
    return `${years} years ago`;
  }

  function isImageFile(name) {
    if (!name || typeof name !== 'string') return false;
    const ext = name.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'].includes(ext);
  }

  function isAudioFile(name) {
    if (!name || typeof name !== 'string') return false;
    const ext = name.split('.').pop().toLowerCase();
    return ['mp3', 'flac', 'm4a', 'mp4', 'wav', 'ogg', 'aac', 'opus', 'aiff'].includes(ext);
  }

  function getFileIcon(name, isDir) {
    if (isDir) return 'folder';
    if (isImageFile(name)) return 'image';
    const ext = name.split('.').pop().toLowerCase();
    if (['mp3', 'flac', 'm4a', 'wav', 'ogg', 'aac', 'opus', 'wma', 'alac', 'aiff'].includes(ext)) return 'music';
    if (['lrc', 'txt', 'cue', 'log'].includes(ext)) return 'file-text';
    return 'file';
  }

  function updateBridgeStatusBadge(online, text) {
    const badge = $('files-bridge-status');
    filesState.isOnline = online;
    if (badge) {
      if (online) {
        badge.textContent = text || 'ONLINE';
        badge.className = 'px-2 py-0.5 text-[10px] font-mono border border-emerald-500/40 bg-emerald-950/30 text-emerald-400';
        $('files-offline-panel')?.classList.add('hidden');
      } else {
        badge.textContent = text || 'OFFLINE';
        badge.className = 'px-2 py-0.5 text-[10px] font-mono border border-[#f0605a]/40 bg-[#f0605a]/10 text-[#f0605a]';
        $('files-offline-panel')?.classList.remove('hidden');
      }
    }
    updateSettingsNasBadge(online, text);
    if (typeof updateYtmAuthVisibility === 'function') {
      updateYtmAuthVisibility(online);
    }
  }

  function updateSettingsNasBadge(online, text) {
    const dot = $('settings-nas-status-dot');
    const tabDot = $('settings-tab-nas-dot');
    const badge = $('settings-nas-ping-badge');
    if (dot) {
      dot.className = `w-2.5 h-2.5 shrink-0 ${online ? 'bg-emerald-400' : 'bg-[#f0605a]'}`;
    }
    if (tabDot) {
      tabDot.className = `w-2 h-2 inline-block ${online ? 'bg-emerald-400' : 'bg-[#f0605a]'}`;
    }
    if (badge) {
      badge.textContent = text || (online ? 'Connected to NAS File Bridge' : 'NAS Bridge Disconnected');
    }
  }

  async function checkFilesBridge() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(`${getFileBridgeBase()}/api/files?path=`, {
        signal: ctrl.signal,
        headers: getFileBridgeHeaders(),
      });
      clearTimeout(timer);
      if (res.ok) {
        updateBridgeStatusBadge(true, 'ONLINE');
        return true;
      }
      if (res.status === 401) {
        updateBridgeStatusBadge(false, '401 UNAUTHORIZED');
        return false;
      }
    } catch (_) {}
    updateBridgeStatusBadge(false, 'OFFLINE');
    return false;
  }

  // Recursive search (Century FilesView): BFS-walk the current folder and
  // every subdirectory, collecting items whose name matches the query.
  // Capped (500 results, 200 directories) so a huge library cannot hammer
  // the bridge. Each result carries relPath (its path from the search root)
  // so open/download/delete work from the results list.
  async function searchFilesRecursive(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) {
      filesState.searchResults = null;
      filesState.visibleCount = 100;
      renderFilesList();
      return;
    }
    // Race guard: each search gets a token; if a newer search starts while
    // this one is still fetching, this one is stale and must not overwrite
    // the newer results when it finishes.
    const token = (filesState.searchToken || 0) + 1;
    filesState.searchToken = token;
    const base = getFileBridgeBase();
    const root = filesState.currentPath || '';
    const results = [];
    const queue = [root];
    const seenDirs = new Set([root]);
    const MAX_RESULTS = 500;
    const MAX_DIRS = 200;
    filesState.searchRunning = true;
    try {
      while (queue.length > 0 && results.length < MAX_RESULTS && seenDirs.size <= MAX_DIRS) {
        // Stop early if a newer search superseded this one.
        if (filesState.searchToken !== token) return;
        const dir = queue.shift();
        let data;
        try {
          const res = await fetch(`${base}/api/files?path=${encodeURIComponent(dir)}`, {
            headers: getFileBridgeHeaders(),
          });
          if (!res.ok) continue;
          data = await res.json();
        } catch {
          continue;
        }
        for (const item of data.items || []) {
          const rel = dir ? `${dir}/${item.name}` : item.name;
          if (item.isDirectory) {
            if (!seenDirs.has(rel)) {
              seenDirs.add(rel);
              queue.push(rel);
            }
          }
          if (item.name.toLowerCase().includes(q)) {
            results.push({ ...item, relPath: rel });
            if (results.length >= MAX_RESULTS) break;
          }
        }
      }
    } finally {
      filesState.searchRunning = false;
    }
    // Only apply the results if no newer search started while we ran.
    if (filesState.searchToken !== token) return;
    filesState.searchResults = results;
    filesState.visibleCount = 100;
    renderFilesList();
  }

  async function loadFilesView(targetPath) {
    initFilesEvents();
    if (typeof targetPath === 'string') {
      filesState.currentPath = targetPath;
    }
    // Reset the search + reveal count on every (re)load, not only on
    // navigation: after an upload / delete / folder-create / refresh the
    // old result list is stale (a new file would stay invisible behind
    // the filter) and the filter text no longer matches the listing.
    filesState.searchResults = null;
    filesState.filterQuery = '';
    filesState.visibleCount = 100;
    const filterInput = $('files-filter-input');
    if (filterInput) filterInput.value = '';
    $('files-filter-clear')?.classList.add('hidden');
    const tbody = $('files-table-body');
    if (tbody && !tbody.hasChildNodes()) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs font-mono text-zinc-400">Loading files...</td></tr>`;
    }

    const base = getFileBridgeBase();
    try {
      const res = await fetch(`${base}/api/files?path=${encodeURIComponent(filesState.currentPath)}`, {
        headers: getFileBridgeHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('401 Unauthorized: Invalid or missing NAS API Key. Update in Settings.');
        }
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      filesState.currentPath = data.path || '';
      filesState.items = Array.isArray(data.items) ? data.items : [];
      updateBridgeStatusBadge(true, 'ONLINE');
      renderFilesBreadcrumbs();
      renderFilesList();
      if (typeof syncYtmDestinationUI === 'function') syncYtmDestinationUI();
    } catch (err) {
      updateBridgeStatusBadge(false, err.message.includes('401') ? '401 UNAUTHORIZED' : 'OFFLINE');
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="5" class="py-8 text-center text-xs font-mono text-zinc-400">
              Cannot load directory from <code class="text-emerald-400">${escapeHtml(base)}</code>.<br/>
              ${escapeHtml(err.message)}<br/>
              Ensure the backend bridge is running and your NAS URL/API Key are set in Settings.
            </td>
          </tr>`;
      }
      $('files-empty-state')?.classList.add('hidden');
    }
  }

  function renderFilesBreadcrumbs() {
    const container = $('files-breadcrumbs');
    const upBtn = $('files-up-btn');
    if (upBtn) {
      upBtn.disabled = !filesState.currentPath;
    }
    if (!container) return;
    container.innerHTML = '';

    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'hover:text-emerald-400 font-bold transition-colors inline-flex items-center gap-1';
    rootBtn.innerHTML = `<i data-lucide="hard-drive" class="w-3 h-3 text-emerald-400"></i><span>ROOT</span>`;
    rootBtn.onclick = () => loadFilesView('');
    container.appendChild(rootBtn);

    if (!filesState.currentPath) {
      refreshIcons();
      return;
    }

    const segments = filesState.currentPath.split('/').filter(Boolean);
    let accum = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      accum = accum ? `${accum}/${seg}` : seg;
      const target = accum;

      const sep = document.createElement('span');
      sep.className = 'text-zinc-600 select-none';
      sep.textContent = '/';
      container.appendChild(sep);

      const btn = document.createElement('button');
      btn.type = 'button';
      const isLast = i === segments.length - 1;
      btn.className = isLast ? 'text-zinc-100 font-semibold' : 'hover:text-emerald-400 transition-colors';
      btn.textContent = seg;
      btn.onclick = () => loadFilesView(target);
      container.appendChild(btn);
    }
    refreshIcons();
  }

  function renderFilesList() {
    const tbody = $('files-table-body');
    const emptyState = $('files-empty-state');
    const countLabel = $('files-count-label');
    const showMoreBtn = $('files-show-more-btn');
    if (!tbody) return;
    tbody.innerHTML = '';

    const q = (filesState.filterQuery || '').trim().toLowerCase();
    // Recursive search results (when filtering) carry their own list;
    // otherwise filter the current folder's items.
    const source = filesState.searchResults || filesState.items;
    const filtered = filesState.searchResults
      ? source
      : filesState.items.filter((item) => !q || item.name.toLowerCase().includes(q));

    const foldersCount = filesState.items.filter((i) => i.isDirectory).length;
    const filesCount = filesState.items.length - foldersCount;
    const audioItems = filesState.items.filter((i) => !i.isDirectory && isAudioFile(i.name));

    const folderAlbumBar = $('files-folder-album-bar');
    const folderAlbumName = $('files-folder-album-name');
    const folderAlbumSub = $('files-folder-album-sub');
    const folderAlbumTagBtn = $('files-folder-album-tag-btn');

    if (folderAlbumBar) {
      if (audioItems.length > 0 && filesState.currentPath) {
        const currentFolderName = filesState.currentPath.split('/').filter(Boolean).pop() || 'Album Folder';
        if (folderAlbumName) folderAlbumName.textContent = currentFolderName;
        if (folderAlbumSub) {
          folderAlbumSub.textContent = `${audioItems.length} audio track(s) in this folder · Sync album tags & high-res cover art across all songs`;
        }
        if (folderAlbumTagBtn) {
          folderAlbumTagBtn.onclick = () => {
            openMetadataEditor(
              {
                name: currentFolderName,
                isDirectory: true,
                type: 'folder',
                relPath: filesState.currentPath,
                filePaths: audioItems.map((a) => a.relPath || `${filesState.currentPath}/${a.name}`),
              },
              'album'
            );
          };
        }
        folderAlbumBar.classList.remove('hidden');
      } else {
        folderAlbumBar.classList.add('hidden');
      }
    }

    if (countLabel) {
      countLabel.textContent = filesState.searchResults
        ? `${filtered.length} result${filtered.length === 1 ? '' : 's'} for "${filesState.filterQuery}" (recursive, from /${filesState.currentPath || 'root'})`
        : `${foldersCount} folder${foldersCount === 1 ? '' : 's'}, ${filesCount} file${filesCount === 1 ? '' : 's'}${
            filesState.currentPath ? ` in /${filesState.currentPath}` : ' (root storage)'
          }`;
    }

    if (filtered.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (showMoreBtn) showMoreBtn.classList.add('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    // Incremental reveal: 100 rows at a time.
    const visible = filtered.slice(0, filesState.visibleCount);
    if (showMoreBtn) {
      const remaining = filtered.length - visible.length;
      showMoreBtn.classList.toggle('hidden', remaining <= 0);
      if (remaining > 0) showMoreBtn.textContent = `Show more (${remaining} remaining)`;
    }

    visible.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'group hover:bg-zinc-800/50 transition-colors';

      const iconName = getFileIcon(item.name, item.isDirectory);
      const iconColor = item.isDirectory ? 'text-emerald-400' : 'text-zinc-400';
      const isImg = !item.isDirectory && isImageFile(item.name);
      const isAudio = !item.isDirectory && isAudioFile(item.name);
      const targetRel = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);

      // Timestamps & relative "last edited ... ago" calculations
      const mtime = Number(item.mtime) || 0;
      const latestMtime = Number(item.latestMtime) || mtime;
      const effectiveMtime = item.isDirectory ? latestMtime : mtime;
      const relTime = formatLastEdited(effectiveMtime);
      const exactTime = formatFileDate(effectiveMtime);

      // Folder recent activity badge (e.g. edited within 14 days)
      const now = Date.now();
      const diffMs = Math.max(0, now - effectiveMtime);
      const isRecentFolder = item.isDirectory && effectiveMtime > 0 && diffMs <= 14 * 86400 * 1000;
      const isVeryRecentFolder = isRecentFolder && diffMs <= 24 * 3600 * 1000;

      const folderBadgeHtml = isRecentFolder
        ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] font-mono font-medium ${
            isVeryRecentFolder
              ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40'
              : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
          } shrink-0" title="Recent activity: edited ${relTime} (${exactTime})">
            <i data-lucide="clock" class="w-3 h-3"></i>
            <span>Edited ${relTime}</span>
          </span>`
        : '';

      tr.innerHTML = `
        <td class="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-500">${idx + 1}</td>
        <td class="py-2.5 px-4">
          <div class="flex items-center gap-2.5 min-w-0 flex-wrap">
            <div class="flex items-center gap-2.5 min-w-0">
              <i data-lucide="${iconName}" class="w-4 h-4 shrink-0 ${iconColor}"></i>
              <button
                type="button"
                class="file-item-btn text-left truncate font-sans text-xs ${
                  item.isDirectory || isImg || isAudio
                    ? 'font-medium text-zinc-100 hover:text-emerald-400 hover:underline cursor-pointer'
                    : 'text-zinc-200 select-text cursor-default'
                }"
                title="${escapeHtml(item.name)}"
              >
                ${escapeHtml(item.name)}
              </button>
            </div>
            ${folderBadgeHtml}
          </div>
        </td>
        <td class="py-2.5 px-4 text-right font-mono text-[11px] text-zinc-400">${formatFileSize(item.size)}</td>
        <td class="py-2.5 px-4 text-right font-mono text-[11px] whitespace-nowrap" title="${exactTime}">
          ${effectiveMtime ? `
            <div class="${isAudio ? 'text-emerald-300 font-medium' : 'text-zinc-300'}">${relTime}</div>
            <div class="text-[10px] text-zinc-400">${exactTime}</div>
          ` : '-'}
        </td>
        <td class="py-2.5 px-4 text-center">
          <div class="inline-flex items-center justify-center gap-1">
            ${item.isDirectory || isAudio ? `
              <button
                type="button"
                title="${item.isDirectory ? 'Edit album folder metadata & cover art' : 'Edit track metadata & cover art'}"
                class="file-meta-btn w-7 h-7 inline-flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
              >
                <i data-lucide="tags" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
            <button
              type="button"
              title="Rename ${item.isDirectory ? 'folder' : 'file'}"
              class="file-rename-btn w-7 h-7 inline-flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
            >
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
            </button>
            ${isImg ? `
              <button
                type="button"
                title="Preview image ${escapeHtml(item.name)}"
                class="file-view-btn w-7 h-7 inline-flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
              >
                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
            ${!item.isDirectory ? `
              <button
                type="button"
                title="Download ${escapeHtml(item.name)}"
                class="file-download-btn w-7 h-7 inline-flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
              >
                <i data-lucide="download" class="w-3.5 h-3.5"></i>
              </button>
            ` : ''}
            <button
              type="button"
              title="Delete ${item.isDirectory ? 'folder' : 'file'}"
              class="file-delete-btn w-7 h-7 inline-flex items-center justify-center text-zinc-500 hover:text-[#f0605a] hover:bg-zinc-800 transition-colors"
            >
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
      `;

      if (item.isDirectory) {
        tr.querySelector('.file-item-btn').onclick = () => {
          const next = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
          loadFilesView(next);
        };
      } else if (isImg) {
        tr.querySelector('.file-item-btn').onclick = () => {
          openImageViewer(item);
        };
      } else if (isAudio) {
        tr.querySelector('.file-item-btn').onclick = () => {
          const targetRel = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
          openMetadataEditor({
            ...item,
            relPath: targetRel,
            type: 'file',
            isDirectory: false,
          }, 'single');
        };
      }

      const metaBtn = tr.querySelector('.file-meta-btn');
      if (metaBtn) {
        metaBtn.onclick = (e) => {
          e.stopPropagation();
          const targetRel = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
          openMetadataEditor({
            ...item,
            relPath: targetRel,
            type: item.isDirectory ? 'folder' : 'file',
            isDirectory: Boolean(item.isDirectory),
          }, item.isDirectory ? 'album' : 'single');
        };
      }

      const renameBtn = tr.querySelector('.file-rename-btn');
      if (renameBtn) {
        renameBtn.onclick = (e) => {
          e.stopPropagation();
          renameFileItem(item);
        };
      }

      const viewBtn = tr.querySelector('.file-view-btn');
      if (viewBtn) {
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          openImageViewer(item);
        };
      }

      const downloadBtn = tr.querySelector('.file-download-btn');
      if (downloadBtn) {
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          const target = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
          downloadFile(target, item.name);
        };
      }

      tr.querySelector('.file-delete-btn').onclick = (e) => {
        e.stopPropagation();
        deleteFileItem(item);
      };

      tbody.appendChild(tr);
    });

    refreshIcons();
  }

  async function createNewFolderPrompt() {
    const name = window.prompt('Enter new folder name:');
    if (!name || !name.trim()) return;
    const cleanName = name.trim();
    const base = getFileBridgeBase();
    try {
      const res = await fetch(`${base}/api/files/folder`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: filesState.currentPath, name: cleanName }),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('401 Unauthorized: Invalid or missing NAS API Key.');
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      showToast(`Created folder "${cleanName}"`);
      loadFilesView();
    } catch (err) {
      showToast(`Failed to create folder: ${err.message}`, 'error');
    }
  }

  // Recursive directory crawler for Drag and Drop (FileSystemEntry API).
  // Traverses dropped directories of any depth, preserving the relative path
  // (e.g. "/Artist/Album/Track.mp3") on each file object as `file.preservePath`.
  async function readAllEntriesFromReader(reader) {
    const entries = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch || batch.length === 0) break;
      entries.push(...batch);
    }
    return entries;
  }

  const CLIENT_IGNORED_UPLOAD_NAMES = new Set([
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

  function isClientIgnoredUploadPath(rawPath) {
    if (!rawPath) return false;
    const norm = String(rawPath).normalize('NFC').replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    for (const seg of parts) {
      const clean = seg.trim();
      const lower = clean.toLowerCase();
      if (CLIENT_IGNORED_UPLOAD_NAMES.has(lower)) return true;
      if (clean.startsWith('._')) return true;
      if (lower.startsWith('.trash-')) return true;
    }
    return false;
  }

  async function crawlFileSystemEntry(entry) {
    const files = [];
    if (!entry) return files;
    if (isClientIgnoredUploadPath(entry.fullPath || entry.name)) return files;

    if (entry.isFile) {
      try {
        const file = await new Promise((resolve, reject) => {
          entry.file(resolve, reject);
        });
        const relPath = String(entry.fullPath || file.name).replace(/^[/\\]+/, '').normalize('NFC');
        files.push({ file, relativePath: relPath });
      } catch (err) {
        console.warn(`[FileBridge] Could not read file "${entry.fullPath}":`, err);
      }
    } else if (entry.isDirectory) {
      try {
        const reader = entry.createReader();
        const childEntries = await readAllEntriesFromReader(reader);
        for (const child of childEntries) {
          const subFiles = await crawlFileSystemEntry(child);
          files.push(...subFiles);
        }
      } catch (err) {
        console.warn(`[FileBridge] Could not read directory "${entry.fullPath}":`, err);
      }
    }

    return files;
  }

  async function getFilesFromDataTransfer(dataTransfer) {
    const items = dataTransfer?.items;
    if (items && items.length > 0) {
      const entryPromises = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file') continue;
        const entry = typeof item.webkitGetAsEntry === 'function'
          ? item.webkitGetAsEntry()
          : (typeof item.getAsEntry === 'function' ? item.getAsEntry() : null);

        if (entry) {
          entryPromises.push(crawlFileSystemEntry(entry));
        } else {
          const file = item.getAsFile();
          if (file) {
            entryPromises.push(Promise.resolve([{ file, relativePath: file.name }]));
          }
        }
      }

      if (entryPromises.length > 0) {
        const nestedArrays = await Promise.all(entryPromises);
        const allFiles = [];
        for (const arr of nestedArrays) {
          allFiles.push(...arr);
        }
        if (allFiles.length > 0) return allFiles;
      }
    }

    // Fallback if dataTransfer.items / webkitGetAsEntry is unavailable
    const fallbackList = [];
    if (dataTransfer?.files?.length) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const f = dataTransfer.files[i];
        fallbackList.push({
          file: f,
          relativePath: f.webkitRelativePath || f.name,
        });
      }
    }
    return fallbackList;
  }

  // Upload files and folders in sequential batches (U1 + U2)
  // Max 8 files AND max 40MB per batch (single file > 40MB uploaded alone; > 100MB rejected up front)
  async function uploadFiles(files) {
    if (!files) return;
    const rawList = Array.isArray(files) ? files : Array.from(files);
    if (rawList.length === 0) return;

    const base = getFileBridgeBase();
    let unsafeCount = 0;
    const validItems = [];

    for (const item of rawList) {
      let file = null;
      let relPath = '';

      if (item && item.file instanceof File) {
        file = item.file;
        relPath = item.relativePath || file.webkitRelativePath || file.name || '';
      } else if (item instanceof File) {
        file = item;
        relPath = item.webkitRelativePath || item.preservePath || item.name || '';
      } else {
        continue;
      }

      relPath = String(relPath).replace(/^[/\\]+/, '').normalize('NFC');

      if (isClientIgnoredUploadPath(relPath)) {
        continue;
      }

      const segments = relPath.split(/[/\\]/).map((s) => s.trim());
      const isUnsafe =
        relPath.startsWith('/') ||
        relPath.startsWith('\\') ||
        /^[a-zA-Z]:/.test(relPath) ||
        segments.some((seg) => seg === '..');

      if (isUnsafe) {
        unsafeCount++;
        continue;
      }

      validItems.push({ file, relativePath: relPath });
    }

    if (unsafeCount > 0) {
      showToast(`Skipped ${unsafeCount} file${unsafeCount === 1 ? '' : 's'} with unsafe path(s)`, 'error');
    }

    if (validItems.length === 0) {
      if (unsafeCount === 0) {
        showToast('No uploadable files found (system metadata ignored)', 'error');
      }
      return;
    }

    // U2: Reject single files over 100MB up front (Cloudflare limit)
    const MAX_SINGLE_FILE = 100 * 1024 * 1024;
    for (const item of validItems) {
      if ((item.file.size || 0) > MAX_SINGLE_FILE) {
        showToast(`Cannot upload "${item.file.name}": exceeds Cloudflare 100MB limit (${formatFileSize(item.file.size)})`, 'error');
        return;
      }
    }

    // U2: Split into sequential batches (at most 8 files AND at most 40MB per batch)
    const MAX_BATCH_FILES = 8;
    const MAX_BATCH_BYTES = 40 * 1024 * 1024;

    const batches = [];
    let currentBatch = [];
    let currentBatchBytes = 0;

    for (const item of validItems) {
      const size = item.file.size || 0;

      if (size > MAX_BATCH_BYTES) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchBytes = 0;
        }
        batches.push([item]);
        continue;
      }

      if (currentBatch.length >= MAX_BATCH_FILES || (currentBatchBytes + size) > MAX_BATCH_BYTES) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchBytes = 0;
      }

      currentBatch.push(item);
      currentBatchBytes += size;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const totalFiles = validItems.length;
    const totalBytes = validItems.reduce((acc, it) => acc + (it.file.size || 0), 0);
    const isFolder = validItems.some((it) => it.relativePath && it.relativePath.includes('/'));

    let bytesSentSoFar = 0;
    let filesUploadedSoFar = 0;

    const formatBytes = (b) => {
      if (!b || b <= 0) return '0 B';
      return formatFileSize(b);
    };

    const destPath = filesState.currentPath || '';
    let currentBatchIndex = 0;

    try {
      for (let bIndex = 0; bIndex < batches.length; bIndex++) {
        currentBatchIndex = bIndex + 1;
        const batch = batches[bIndex];
        const batchBytes = batch.reduce((acc, it) => acc + (it.file.size || 0), 0);

        // Build FormData: paths field appended BEFORE files field (bridge requires paths-first ordering)
        const formData = new FormData();
        for (const item of batch) {
          const p = item.relativePath || item.file.webkitRelativePath || item.file.name || '';
          formData.append('paths', p);
          formData.append('preservePaths', p);
        }
        for (const item of batch) {
          formData.append('files', item.file);
        }

        const getBatchLabel = (batchLoaded = 0) => {
          const curTotal = bytesSentSoFar + batchLoaded;
          const baseLabel = isFolder
            ? `Uploading folder (${totalFiles} files, batch ${currentBatchIndex} of ${batches.length})...`
            : `Uploading ${totalFiles} file${totalFiles === 1 ? '' : 's'} (batch ${currentBatchIndex} of ${batches.length})...`;
          return `${baseLabel} (${formatBytes(curTotal)} / ${formatBytes(totalBytes)})`;
        };

        const pctStart = totalBytes > 0 ? Math.min(99, Math.round((bytesSentSoFar / totalBytes) * 100)) : 0;
        showUploadProgress(pctStart, getBatchLabel(0));

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${base}/api/files/upload?path=${encodeURIComponent(destPath)}`);
          const headers = getFileBridgeHeaders();
          for (const [k, v] of Object.entries(headers)) {
            xhr.setRequestHeader(k, v);
          }

          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const curTotal = bytesSentSoFar + e.loaded;
              const pct = totalBytes > 0 ? Math.min(99, Math.round((curTotal / totalBytes) * 100)) : 0;
              showUploadProgress(pct, getBatchLabel(e.loaded));
            }
          });

          xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else if (xhr.status === 401) {
              reject(new Error('401 Unauthorized: Invalid or missing NAS API Key.'));
            } else {
              try {
                const err = JSON.parse(xhr.responseText || '{}');
                reject(new Error(err.error || `HTTP ${xhr.status}`));
              } catch {
                reject(new Error(`HTTP ${xhr.status}`));
              }
            }
          });

          xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
          xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
          xhr.send(formData);
        });

        bytesSentSoFar += batchBytes;
        filesUploadedSoFar += batch.length;
      }

      showUploadProgress(100, `Completed ${totalFiles} file${totalFiles === 1 ? '' : 's'}`);
      setTimeout(() => hideUploadProgress(), 1200);
      showToast(`Successfully uploaded ${totalFiles} file${totalFiles === 1 ? '' : 's'}`);
      client.request('startScan').catch(() => {});
      loadFilesView();
    } catch (err) {
      hideUploadProgress();
      showToast(
        `Upload failed at batch ${currentBatchIndex} of ${batches.length} (${filesUploadedSoFar} of ${totalFiles} files uploaded): ${err.message}`,
        'error'
      );
    }
  }

  // Upload progress bar (shown above the files list while uploading).
  function showUploadProgress(percent, label) {
    let bar = $('files-upload-progress');
    if (!bar) return;
    bar.classList.remove('hidden');
    const fill = $('files-upload-progress-fill');
    const text = $('files-upload-progress-text');
    if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (text) text.textContent = `${label} ${percent}%`;
  }
  function hideUploadProgress() {
    const bar = $('files-upload-progress');
    if (bar) bar.classList.add('hidden');
  }

  async function renameFileItem(item) {
    if (!item || !item.name) return;
    const isDir = Boolean(item.isDirectory);
    const targetRel = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
    const currentName = item.name;
    const promptMsg = isDir ? `Enter new name for folder "${currentName}":` : `Enter new name for file "${currentName}":`;
    const entered = window.prompt(promptMsg, currentName);
    if (!entered) return;
    const newName = entered.trim();
    if (!newName || newName === currentName) return;

    const base = getFileBridgeBase();
    try {
      const res = await fetch(`${base}/api/files/rename`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: targetRel, newName }),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('401 Unauthorized: Invalid or missing NAS API Key.');
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      showToast(`Renamed to "${data.newName || newName}"`);

      // If a folder that is part of current path was renamed, update currentPath
      if (isDir && filesState.currentPath) {
        const normalizedOld = targetRel.replace(/\\/g, '/');
        const normalizedCurrent = filesState.currentPath.replace(/\\/g, '/');
        if (normalizedCurrent === normalizedOld) {
          filesState.currentPath = data.newPath || normalizedOld;
        } else if (normalizedCurrent.startsWith(normalizedOld + '/')) {
          filesState.currentPath = (data.newPath || normalizedOld) + normalizedCurrent.slice(normalizedOld.length);
        }
      }

      // If metadata editor is active and points to this item, update its paths
      if (metaEditorState.active) {
        const normalizedOld = targetRel.replace(/\\/g, '/');
        const normalizedNew = (data.newPath || '').replace(/\\/g, '/');
        if (normalizedNew) {
          if (metaEditorState.targetPath === normalizedOld) metaEditorState.targetPath = normalizedNew;
          if (metaEditorState.filePath === normalizedOld) metaEditorState.filePath = normalizedNew;
          if (metaEditorState.folderPath === normalizedOld) metaEditorState.folderPath = normalizedNew;
          updateMetaScopeUI();
        }
      }

      client.request('startScan').catch(() => {});
      await loadFilesView();
    } catch (err) {
      showToast(`Failed to rename: ${err.message}`, 'error');
    }
  }

  async function deleteFileItem(item) {
    const isDir = item.isDirectory;
    const confirmed = window.confirm(
      `Are you sure you want to delete ${isDir ? 'folder' : 'file'} "${item.name}"?${
        isDir ? '\nWarning: All contents inside will be permanently deleted!' : ''
      }`
    );
    if (!confirmed) return;

    const base = getFileBridgeBase();
    const target = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
    try {
      const res = await fetch(`${base}/api/files?path=${encodeURIComponent(target)}`, {
        method: 'DELETE',
        headers: getFileBridgeHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('401 Unauthorized: Invalid or missing NAS API Key.');
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      showToast(`Deleted "${item.name}"`);
      client.request('startScan').catch(() => {});
      loadFilesView();
    } catch (err) {
      showToast(`Failed to delete: ${err.message}`, 'error');
    }
  }

  function downloadFile(relativeFilePath, fileName) {
    if (!relativeFilePath) return;
    const base = getFileBridgeBase();
    const apiKey = getFileBridgeApiKey();

    if (!apiKey) {
      showToast('NAS API Key is missing. Please set your API key in Settings.', 'error');
      return;
    }

    try {
      const downloadUrl = new URL(`${base}/api/files/download`);
      downloadUrl.searchParams.set('path', relativeFilePath);
      if (apiKey) {
        downloadUrl.searchParams.set('apiKey', apiKey);
      }

      const link = document.createElement('a');
      link.href = downloadUrl.toString();
      if (fileName) {
        link.download = fileName;
      }
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      showToast(`Failed to download: ${err.message}`, 'error');
    }
  }

  // ============================================================================
  // Image Viewer Modal Lightbox
  // ============================================================================
  const imageViewerState = {
    images: [],
    currentIndex: 0,
    zoom: 1,
    active: false,
    initialized: false,
  };

  function openImageViewer(targetItem) {
    // Use the list the user is actually looking at: the recursive search
    // results when a search is active, otherwise the current folder.
    // Match by relPath first (a search result lives in a subdirectory and
    // may share its name with an image in the current folder), falling
    // back to name for items without one.
    const source = filesState.searchResults || filesState.items;
    const images = source.filter((i) => !i.isDirectory && isImageFile(i.name));
    if (!images.length) return;

    const targetRel = targetItem.relPath || null;
    let idx = targetRel
      ? images.findIndex((i) => (i.relPath || null) === targetRel)
      : -1;
    if (idx === -1) idx = images.findIndex((i) => i.name === targetItem.name);
    if (idx === -1) idx = 0;

    imageViewerState.images = images;
    imageViewerState.currentIndex = idx;
    imageViewerState.zoom = 1;
    imageViewerState.active = true;

    const modal = $('files-image-modal');
    if (modal) {
      modal.classList.remove('hidden');
    }

    renderImageViewer();
    refreshIcons();
  }

  function closeImageViewer() {
    imageViewerState.active = false;
    const modal = $('files-image-modal');
    if (modal) {
      modal.classList.add('hidden');
    }
    const img = $('files-image-element');
    if (img) {
      img.src = '';
    }
  }

  function renderImageViewer() {
    const { images, currentIndex, zoom } = imageViewerState;
    if (!images.length || currentIndex < 0 || currentIndex >= images.length) return;

    const item = images[currentIndex];
    const titleEl = $('files-image-title');
    const metaEl = $('files-image-meta');
    const counterEl = $('files-image-counter');
    const img = $('files-image-element');
    const spinner = $('files-image-spinner');
    const resetBtn = $('files-image-zoom-reset');
    const prevBtn = $('files-image-prev-btn');
    const nextBtn = $('files-image-next-btn');

    if (titleEl) titleEl.textContent = item.name;
    if (counterEl) counterEl.textContent = `${currentIndex + 1} of ${images.length}`;
    if (metaEl) metaEl.textContent = `Loading · ${formatFileSize(item.size)}`;
    if (resetBtn) resetBtn.textContent = `${Math.round(zoom * 100)}%`;

    if (prevBtn) prevBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';
    if (nextBtn) nextBtn.style.visibility = images.length > 1 ? 'visible' : 'hidden';

    if (spinner) spinner.classList.remove('hidden');

    const relativePath = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
    const base = getFileBridgeBase();

    // Fetch the image as a blob with the x-api-key header (Century
    // downloadEndpointUrl). This keeps the key out of the DOM, unlike an
    // <img> src with ?apiKey. The native download link still uses ?apiKey
    // (an anchor cannot set headers).
    if (img) {
      if (img._blobUrl) {
        URL.revokeObjectURL(img._blobUrl);
        img._blobUrl = null;
      }
      img.onload = () => {
        if (spinner) spinner.classList.add('hidden');
        if (metaEl) {
          metaEl.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatFileSize(item.size)}`;
        }
      };
      img.onerror = () => {
        if (spinner) spinner.classList.add('hidden');
        if (metaEl) {
          metaEl.textContent = `Failed to load preview · ${formatFileSize(item.size)}`;
        }
      };
      fetch(`${base}/api/files/download?path=${encodeURIComponent(relativePath)}`, {
        headers: getFileBridgeHeaders(),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          img._blobUrl = URL.createObjectURL(blob);
          img.src = img._blobUrl;
        })
        .catch(() => {
          if (spinner) spinner.classList.add('hidden');
          if (metaEl) {
            metaEl.textContent = `Failed to load preview · ${formatFileSize(item.size)}`;
          }
        });
      img.style.transform = `scale(${zoom})`;
    }
  }

  function navigateImageViewer(step) {
    const { images } = imageViewerState;
    if (!images.length) return;
    imageViewerState.currentIndex = (imageViewerState.currentIndex + step + images.length) % images.length;
    imageViewerState.zoom = 1;
    renderImageViewer();
  }

  function setImageViewerZoom(delta, absolute = null) {
    if (absolute !== null) {
      imageViewerState.zoom = absolute;
    } else {
      const next = Math.round((imageViewerState.zoom + delta) * 100) / 100;
      imageViewerState.zoom = Math.max(0.25, Math.min(4.0, next));
    }
    const img = $('files-image-element');
    if (img) {
      img.style.transform = `scale(${imageViewerState.zoom})`;
    }
    const resetBtn = $('files-image-zoom-reset');
    if (resetBtn) {
      resetBtn.textContent = `${Math.round(imageViewerState.zoom * 100)}%`;
    }
  }

  function downloadCurrentViewerImage() {
    const { images, currentIndex } = imageViewerState;
    if (!images.length) return;
    const item = images[currentIndex];
    const target = item.relPath || (filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name);
    downloadFile(target, item.name);
  }

  function initImageViewerEvents() {
    if (imageViewerState.initialized) return;
    imageViewerState.initialized = true;

    on('files-image-close-btn', 'click', closeImageViewer);
    on('files-image-prev-btn', 'click', () => navigateImageViewer(-1));
    on('files-image-next-btn', 'click', () => navigateImageViewer(1));
    on('files-image-zoom-in', 'click', () => setImageViewerZoom(0.25));
    on('files-image-zoom-out', 'click', () => setImageViewerZoom(-0.25));
    on('files-image-zoom-reset', 'click', () => setImageViewerZoom(0, 1));
    on('files-image-download-btn', 'click', downloadCurrentViewerImage);

    const modal = $('files-image-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.id === 'files-image-viewport') {
          closeImageViewer();
        }
      });
    }

    const viewport = $('files-image-viewport');
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        if (!imageViewerState.active) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.2 : -0.2;
        setImageViewerZoom(delta);
      }, { passive: false });
    }

    window.addEventListener('keydown', (e) => {
      if (!imageViewerState.active) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeImageViewer();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateImageViewer(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateImageViewer(1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setImageViewerZoom(0.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setImageViewerZoom(-0.25);
      } else if (e.key === '0') {
        e.preventDefault();
        setImageViewerZoom(0, 1);
      }
    });
  }

  // ============================================================================
  // Full Metadata & Embedded Cover Art Editor (Local + Online JP Auto-Tagging)
  // ============================================================================
  const metaEditorState = {
    active: false,
    isYtmStaging: false,
    ytmStagedJob: null,
    onlineAlbumTracks: [],
    scope: 'single', // 'single' | 'album'
    filePath: '',
    folderPath: '',
    filePaths: [],
    audioTrackCount: null,
    hints: { title: '', artist: '', album: '', year: '', coverUrl: '' },
    selectedCoverFile: null,
    selectedCoverUrl: '',
    previewObjectUrl: null,
    onlineResults: [],
    sourceFilter: 'all',
    selectedResultId: null,
    searchMode: 'album',
    artistMode: localStorage.getItem('century.meta_artist_mode') === 'source' ? 'source' : 'db',
    originalArtist: '',
    sourceArtist: '',
    lockedDbArtist: '',
    matchedDbArtist: '',
    dbArtists: [],
    dbPickerOpen: false,
    busy: false,
    initialized: false,
  };

  function normArtistKey(str) {
    return String(str || '')
      .normalize('NFKC')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  function stripArtistExtras(str) {
    let s = String(str || '').normalize('NFKC').trim();
    s = s.replace(/\s*[\(\[]?\b(feat\.?|ft\.?|featuring)\b.*$/i, '').trim();
    const parts = s.split(/\s*(?:,|、|\/|×|✕|\bwith\b|\b&\b)\s*/i);
    return (parts[0] || s).trim();
  }

  function findExactOrBaseDbArtist(candidate, dbArtists) {
    const clean = String(candidate || '').trim();
    if (!clean || !Array.isArray(dbArtists) || dbArtists.length === 0) return null;

    const exactKey = normArtistKey(clean);
    const exactMatch = dbArtists.find((a) => normArtistKey(a.name) === exactKey);
    if (exactMatch) return exactMatch;

    const baseKey = normArtistKey(stripArtistExtras(clean));
    if (baseKey) {
      const baseMatch = dbArtists.find((a) => normArtistKey(a.name) === baseKey);
      if (baseMatch) return baseMatch;
    }

    const parenMatch = clean.match(/\(([^)]+)\)/);
    if (parenMatch && parenMatch[1]) {
      const parenKey = normArtistKey(parenMatch[1]);
      const m = dbArtists.find((a) => normArtistKey(a.name) === parenKey);
      if (m) return m;
    }

    return null;
  }

  function resolveDbArtistCandidate(sourceArtist = '') {
    const dbArtists = metaEditorState.dbArtists || [];
    if (metaEditorState.lockedDbArtist) {
      return { name: metaEditorState.lockedDbArtist, reason: 'chosen' };
    }

    if (sourceArtist) {
      const mSource = findExactOrBaseDbArtist(sourceArtist, dbArtists);
      if (mSource) return { name: mSource.name, reason: 'source-db' };
    }

    const orig = metaEditorState.originalArtist || metaEditorState.hints?.artist || '';
    if (orig) {
      const mOrig = findExactOrBaseDbArtist(orig, dbArtists);
      if (mOrig) return { name: mOrig.name, reason: 'existing-db' };
    }

    const relPath = metaEditorState.folderPath || metaEditorState.filePath || '';
    const segments = relPath.split('/').filter(Boolean).reverse();
    for (const seg of segments) {
      if (['music', 'storage', 'flac', 'mp3', 'opus'].includes(seg.toLowerCase())) continue;
      const mSeg = findExactOrBaseDbArtist(seg, dbArtists);
      if (mSeg) return { name: mSeg.name, reason: 'folder-db' };
    }

    return null;
  }

  function refreshMatchedDbArtist() {
    const resolved = resolveDbArtistCandidate(metaEditorState.sourceArtist);
    metaEditorState.matchedDbArtist = resolved ? resolved.name : '';
    return resolved;
  }

  function updateMetaArtistModeUI() {
    const isDb = metaEditorState.artistMode !== 'source';
    const dbBtn = $('meta-artist-mode-db-btn');
    const srcBtn = $('meta-artist-mode-source-btn');

    if (dbBtn) {
      dbBtn.className = `px-2 py-0.5 transition-colors ${
        isDb ? 'bg-emerald-400 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-100'
      }`;
    }
    if (srcBtn) {
      srcBtn.className = `px-2 py-0.5 transition-colors ${
        !isDb ? 'bg-emerald-400 text-zinc-950 font-semibold' : 'text-zinc-400 hover:text-zinc-100'
      }`;
    }

    const altBar = $('meta-artist-alt-bar');
    if (!altBar) return;

    const currentInput = $('meta-input-artist')?.value?.trim() || '';
    const dbName = metaEditorState.lockedDbArtist || metaEditorState.matchedDbArtist || '';
    const srcName = metaEditorState.sourceArtist || '';
    const hasAlt = (dbName && dbName !== currentInput) || (srcName && srcName !== currentInput) || Boolean(metaEditorState.lockedDbArtist);

    if (!hasAlt) {
      altBar.classList.add('hidden');
      altBar.innerHTML = '';
      return;
    }

    const parts = [];
    if (dbName && dbName !== currentInput) {
      parts.push(
        `<button type="button" data-meta-pick-artist="${escapeHtml(dbName)}" data-meta-pick-mode="db" class="px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-emerald-500/40 text-emerald-300 transition-colors">Use DB: ${escapeHtml(dbName)}</button>`
      );
    } else if (metaEditorState.lockedDbArtist && metaEditorState.lockedDbArtist === currentInput) {
      parts.push(`<span class="text-emerald-400">Locked DB: ${escapeHtml(metaEditorState.lockedDbArtist)}</span>`);
    } else if (dbName && dbName === currentInput && srcName && srcName !== dbName) {
      parts.push(`<span class="text-emerald-400">Matched DB: ${escapeHtml(dbName)}</span>`);
    }

    if (srcName && srcName !== currentInput) {
      parts.push(
        `<button type="button" data-meta-pick-artist="${escapeHtml(srcName)}" data-meta-pick-mode="source" class="px-1.5 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors">Use Source: ${escapeHtml(srcName)}</button>`
      );
    }

    altBar.innerHTML = parts.join('');
    altBar.classList.toggle('hidden', parts.length === 0);

    altBar.querySelectorAll('[data-meta-pick-artist]').forEach((btn) => {
      btn.onclick = () => {
        const chosenName = btn.getAttribute('data-meta-pick-artist') || '';
        const chosenMode = btn.getAttribute('data-meta-pick-mode') || 'db';
        if ($('meta-input-artist')) $('meta-input-artist').value = chosenName;
        if (chosenMode === 'db') {
          metaEditorState.lockedDbArtist = chosenName;
          setMetaArtistMode('db', { skipApply: true });
        } else {
          metaEditorState.lockedDbArtist = '';
          setMetaArtistMode('source', { skipApply: true });
        }
        updateMetaArtistModeUI();
      };
    });
  }

  function setMetaArtistMode(mode, { skipApply = false } = {}) {
    metaEditorState.artistMode = mode === 'source' ? 'source' : 'db';
    localStorage.setItem('century.meta_artist_mode', metaEditorState.artistMode);

    if (!skipApply) {
      refreshMatchedDbArtist();
      const inputEl = $('meta-input-artist');
      if (metaEditorState.artistMode === 'source') {
        if (inputEl && metaEditorState.sourceArtist) {
          inputEl.value = metaEditorState.sourceArtist;
        }
      } else {
        const targetDb = metaEditorState.lockedDbArtist || metaEditorState.matchedDbArtist;
        if (inputEl && targetDb) {
          inputEl.value = targetDb;
        } else if (inputEl && metaEditorState.sourceArtist) {
          inputEl.value = metaEditorState.sourceArtist;
        }
      }
    }

    updateMetaArtistModeUI();
  }

  function renderMetaDbArtistsList(query = '') {
    const listEl = $('meta-artist-db-list');
    const countEl = $('meta-artist-db-count');
    if (!listEl) return;

    const all = Array.isArray(metaEditorState.dbArtists) ? [...metaEditorState.dbArtists] : [];
    all.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    const qNorm = normArtistKey(query);
    const filtered = qNorm ? all.filter((a) => normArtistKey(a.name).includes(qNorm)) : all;

    if (countEl) {
      countEl.textContent = `${filtered.length}/${all.length}`;
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="p-3 text-center text-[11px] font-mono text-zinc-500">${
        all.length === 0 ? 'No artists loaded from database' : 'No matching DB artists'
      }</div>`;
      return;
    }

    const currentVal = normArtistKey($('meta-input-artist')?.value || '');
    listEl.innerHTML = '';
    for (const artist of filtered.slice(0, 150)) {
      const isCurrent = normArtistKey(artist.name) === currentVal;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-xs transition-colors ${
        isCurrent ? 'bg-emerald-950/40 text-emerald-300' : 'text-zinc-200 hover:bg-zinc-900'
      }`;
      const albums = typeof artist.albumCount === 'number' ? `${artist.albumCount} alb` : '';
      btn.innerHTML = `
        <span class="truncate">${escapeHtml(artist.name)}</span>
        <span class="text-[10px] font-mono text-zinc-500 shrink-0">${escapeHtml(albums)}</span>
      `;
      btn.onclick = () => {
        metaEditorState.lockedDbArtist = artist.name;
        metaEditorState.matchedDbArtist = artist.name;
        if ($('meta-input-artist')) $('meta-input-artist').value = artist.name;
        setMetaArtistMode('db', { skipApply: true });
        toggleMetaDbDropdown(false);
        setMetaEditorStatus(`Locked artist to existing database entry: "${artist.name}"`);
      };
      listEl.appendChild(btn);
    }
  }

  function toggleMetaDbDropdown(forceOpen = null) {
    const dropdown = $('meta-artist-db-dropdown');
    if (!dropdown) return;
    const nextOpen = forceOpen !== null ? Boolean(forceOpen) : dropdown.classList.contains('hidden');
    metaEditorState.dbPickerOpen = nextOpen;
    dropdown.classList.toggle('hidden', !nextOpen);

    if (nextOpen) {
      const searchInput = $('meta-artist-db-search');
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      if ((!metaEditorState.dbArtists || metaEditorState.dbArtists.length === 0) && typeof loadAllArtists === 'function') {
        const listEl = $('meta-artist-db-list');
        if (listEl) listEl.innerHTML = '<div class="p-3 text-center text-[11px] font-mono text-zinc-400">Loading DB artists...</div>';
        loadAllArtists()
          .then((list) => {
            metaEditorState.dbArtists = Array.isArray(list) ? list : [];
            renderMetaDbArtistsList($('meta-artist-db-search')?.value || '');
          })
          .catch(() => {
            renderMetaDbArtistsList('');
          });
      } else {
        renderMetaDbArtistsList('');
      }
    }
  }

  async function ensureMetaDbArtistsLoaded() {
    if (Array.isArray(state.artists) && state.artists.length > 0) {
      metaEditorState.dbArtists = state.artists;
      refreshMatchedDbArtist();
      updateMetaArtistModeUI();
      return state.artists;
    }
    try {
      const list = await loadAllArtists();
      metaEditorState.dbArtists = Array.isArray(list) ? list : [];
      refreshMatchedDbArtist();
      updateMetaArtistModeUI();
      return metaEditorState.dbArtists;
    } catch {
      return [];
    }
  }

  function normalizeSubsonicPath(rawPath) {
    return String(rawPath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
  }

  function setMetaEditorStatus(text, isError = false) {
    const el = $('meta-editor-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('text-[#f0605a]', Boolean(isError));
    el.classList.toggle('text-zinc-400', !isError);
  }

  function setMetaCoverPreview(srcUrl, badgeLabel = 'NO CHANGE') {
    const img = $('meta-cover-preview-img');
    const fallback = $('meta-cover-preview-fallback');
    const badge = $('meta-cover-source-badge');

    if (badge) {
      badge.textContent = badgeLabel;
    }

    if (img && fallback) {
      if (srcUrl) {
        img.src = srcUrl;
        img.classList.remove('hidden');
        fallback.classList.add('hidden');
      } else {
        img.src = '';
        img.classList.add('hidden');
        fallback.classList.remove('hidden');
      }
    }
  }

  function setMetaSearchMode(mode) {
    const isAlbumSearch = mode === 'album';
    metaEditorState.searchMode = isAlbumSearch ? 'album' : 'track';

    const albumBtn = $('meta-search-type-album-btn');
    const trackBtn = $('meta-search-type-track-btn');
    const hintEl = $('meta-search-type-hint');
    const searchInput = $('meta-online-search-input');

    if (albumBtn) {
      albumBtn.className = `px-3 py-1 inline-flex items-center gap-1.5 transition-colors ${
        isAlbumSearch
          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      }`;
    }
    if (trackBtn) {
      trackBtn.className = `px-3 py-1 inline-flex items-center gap-1.5 transition-colors ${
        !isAlbumSearch
          ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      }`;
    }
    if (hintEl) {
      hintEl.textContent = isAlbumSearch
        ? 'Queries albums with high-res covers from Deezer, iTunes JP, Spotify JP & MusicBrainz'
        : 'Queries individual song tracks from iTunes JP, Spotify JP, MusicBrainz & Deezer';
    }
    if (searchInput) {
      searchInput.placeholder = isAlbumSearch
        ? 'Search Japanese or global albums (e.g. Alea jacta est, Ave Mujica)...'
        : 'Search song title or artist (e.g. 審美眼, Ave Mujica)...';
    }
  }

  function updateMetaScopeUI() {
    const isAlbum = metaEditorState.scope === 'album';
    const isStaging = Boolean(metaEditorState.isYtmStaging);
    const badge = $('meta-scope-badge');
    const targetLabel = $('meta-editor-target-label');
    const scopeHint = $('meta-scope-hint');
    const saveLabel = $('meta-save-all-label');
    const overrideWrap = $('meta-override-album-titles-wrap');
    const titleInput = $('meta-input-title');
    const singleTabBtn = $('meta-scope-btn-single');
    const albumTabBtn = $('meta-scope-btn-album');
    const coverOnlyBtn = $('meta-apply-cover-only-btn');
    const stagedTracksSection = $('meta-staged-tracks-section');

    const count =
      typeof metaEditorState.audioTrackCount === 'number'
        ? metaEditorState.audioTrackCount
        : isStaging && Array.isArray(metaEditorState.ytmStagedJob?.tracks)
          ? metaEditorState.ytmStagedJob.tracks.length
          : metaEditorState.filePaths?.length || null;

    if (badge) {
      if (isStaging) {
        badge.textContent = isAlbum
          ? 'PRE-DOWNLOAD STAGING · ALBUM'
          : 'PRE-DOWNLOAD STAGING · TRACK';
        badge.className =
          'px-2 py-0.5 text-[10px] font-mono font-semibold shrink-0 bg-emerald-400/20 border border-emerald-400/50 text-emerald-300';
      } else {
        badge.textContent = isAlbum ? 'ALBUM FOLDER' : 'SINGLE TRACK';
        badge.className = `px-2 py-0.5 text-[10px] font-mono font-semibold shrink-0 ${
          isAlbum
            ? 'bg-amber-400/15 border border-amber-400/40 text-amber-300'
            : 'bg-emerald-400/15 border border-emerald-400/40 text-emerald-300'
        }`;
      }
    }

    const countBadge = $('meta-track-count-badge');
    if (countBadge) {
      if (isStaging || isAlbum) {
        countBadge.classList.remove('hidden');
        if (count !== null) {
          countBadge.textContent = count === 1 ? '1 track found' : `${count} tracks found`;
          countBadge.className =
            'px-2 py-0.5 text-[10px] font-mono font-semibold bg-amber-400/15 border border-amber-400/40 text-amber-300 shrink-0';
        } else {
          countBadge.textContent = 'Scanning tracks...';
          countBadge.className =
            'px-2 py-0.5 text-[10px] font-mono font-semibold bg-zinc-800 border border-zinc-700 text-zinc-400 shrink-0 animate-pulse';
        }
      } else {
        countBadge.classList.add('hidden');
      }
    }

    if (coverOnlyBtn) {
      coverOnlyBtn.classList.toggle('hidden', isStaging);
    }
    if (stagedTracksSection) {
      stagedTracksSection.classList.toggle('hidden', !isStaging);
    }

    if (singleTabBtn) {
      singleTabBtn.disabled = isStaging;
      singleTabBtn.className = `px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${
        !isAlbum
          ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      } ${isStaging ? 'opacity-50 cursor-not-allowed' : ''}`;
    }
    if (albumTabBtn) {
      albumTabBtn.disabled = isStaging;
      albumTabBtn.className = `px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${
        isAlbum
          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      } ${isStaging ? 'opacity-50 cursor-not-allowed' : ''}`;
    }

    if (targetLabel) {
      if (isStaging && metaEditorState.ytmStagedJob) {
        const sj = metaEditorState.ytmStagedJob;
        targetLabel.textContent = `Pre-Download Staging (.${sj.format || 'opus'}) · ${sj.url || ''}`;
      } else {
        const displayTarget = isAlbum
          ? metaEditorState.folderPath || metaEditorState.targetPath || metaEditorState.hints?.album || '(album folder)'
          : metaEditorState.filePath || metaEditorState.targetPath || metaEditorState.hints?.title || '-';
        targetLabel.textContent = `${isAlbum ? 'Album Folder' : 'Single Track'}: ${
          displayTarget.startsWith('(') ? displayTarget : `/${displayTarget}`
        }`;
      }
    }

    if (scopeHint) {
      const trackCount = count || 0;
      if (isStaging) {
        scopeHint.textContent =
          trackCount > 1
            ? `Staging ${trackCount} tracks (skipping YT thumbnails)`
            : 'Staging 1 track (skipping YT thumbnail)';
      } else {
        scopeHint.textContent = isAlbum
          ? trackCount > 0
            ? `Batch-updating all ${trackCount} track(s) in album folder`
            : 'Batch-updating all audio tracks in album folder'
          : 'Editing single audio file';
      }
    }

    if (saveLabel) {
      const trackCount = count || 0;
      if (isStaging) {
        saveLabel.textContent =
          trackCount > 1
            ? `CONFIRM & START DOWNLOAD (${trackCount} TRACKS)`
            : 'CONFIRM & START DOWNLOAD';
      } else {
        saveLabel.textContent = isAlbum
          ? trackCount > 0
            ? `SAVE TO ALBUM FOLDER (${trackCount} TRACKS)`
            : 'SAVE TO ALBUM FOLDER'
          : 'SAVE TO TRACK';
      }
    }

    if (overrideWrap) {
      overrideWrap.classList.toggle('hidden', !isAlbum || isStaging);
      overrideWrap.classList.toggle('inline-flex', isAlbum && !isStaging);
    }

    if (titleInput) {
      const overrideChecked = Boolean($('meta-override-album-titles')?.checked);
      titleInput.disabled = isAlbum && !overrideChecked;
      titleInput.classList.toggle('opacity-50', isAlbum && !overrideChecked);
    }
  }

  function setMetaEditorScope(newScope) {
    const isAlbum = newScope === 'album';
    metaEditorState.scope = isAlbum ? 'album' : 'single';
    metaEditorState.targetType = isAlbum ? 'folder' : 'file';

    if (isAlbum) {
      if (!metaEditorState.folderPath && metaEditorState.filePath) {
        const parts = metaEditorState.filePath.split('/').filter(Boolean);
        parts.pop();
        metaEditorState.folderPath = parts.join('/');
      }
      metaEditorState.targetPath = metaEditorState.folderPath || metaEditorState.targetPath;
      setMetaSearchMode('album');

      // If switching to album and we have an album or artist, suggest it in search
      const curAlbum = $('meta-input-album')?.value?.trim() || '';
      const curArtist = $('meta-input-artist')?.value?.trim() || '';
      if ((curAlbum || curArtist) && $('meta-online-search-input')) {
        $('meta-online-search-input').value = [curArtist, curAlbum].filter(Boolean).join(' ');
      }
    } else {
      metaEditorState.targetPath = metaEditorState.filePath || metaEditorState.targetPath;
    }

    updateMetaScopeUI();
  }

  async function openMetadataEditor(item, initialScope = null) {
    // Ensure modal listeners are always bound even if opened before visiting Files tab
    initMetadataEditorEvents();

    metaEditorState.isYtmStaging = false;
    metaEditorState.ytmStagedJob = null;
    metaEditorState.onlineAlbumTracks = [];

    const relPath = normalizeSubsonicPath(
      item?.relPath ?? (filesState.currentPath ? `${filesState.currentPath}/${item?.name || ''}` : item?.name || '')
    );
    const isDir = Boolean(
      item?.isDirectory ||
      item?.type === 'folder' ||
      initialScope === 'album'
    );
    const hints = item?.hints || {};

    metaEditorState.hints = {
      title: String(hints.title || '').trim(),
      artist: String(hints.artist || '').trim(),
      album: String(hints.album || '').trim(),
      year: String(hints.year || '').trim(),
      coverUrl: String(hints.coverUrl || '').trim(),
    };
    metaEditorState.filePaths = Array.isArray(item?.filePaths)
      ? item.filePaths.map(normalizeSubsonicPath).filter(Boolean)
      : [];
    metaEditorState.audioTrackCount = isDir && Array.isArray(item?.filePaths) ? item.filePaths.length : null;

    metaEditorState.scope = isDir ? 'album' : 'single';
    metaEditorState.targetType = isDir ? 'folder' : 'file';
    metaEditorState.targetPath = relPath;
    setMetaSearchMode('album');

    if (isDir) {
      metaEditorState.filePath = normalizeSubsonicPath(item?.firstFilePath || metaEditorState.filePaths[0] || '');
      metaEditorState.folderPath = relPath;
    } else {
      metaEditorState.filePath = relPath;
      const parts = relPath.split('/').filter(Boolean);
      parts.pop();
      metaEditorState.folderPath = normalizeSubsonicPath(item?.folderPath ?? parts.join('/'));
    }

    if (metaEditorState.previewObjectUrl) {
      URL.revokeObjectURL(metaEditorState.previewObjectUrl);
      metaEditorState.previewObjectUrl = null;
    }
    metaEditorState.selectedCoverFile = null;
    metaEditorState.selectedCoverUrl = '';
    metaEditorState.onlineResults = [];
    metaEditorState.selectedResultId = null;
    metaEditorState.sourceFilter = 'all';
    metaEditorState.sourceArtist = '';
    metaEditorState.lockedDbArtist = '';
    metaEditorState.matchedDbArtist = '';
    metaEditorState.dbPickerOpen = false;
    metaEditorState.active = true;

    const dbDropdown = $('meta-artist-db-dropdown');
    if (dbDropdown) dbDropdown.classList.add('hidden');

    const fileInput = $('meta-cover-file-input');
    if (fileInput) fileInput.value = '';
    if ($('meta-override-album-titles')) $('meta-override-album-titles').checked = false;

    const cleanGuess = String(item?.name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/^\d+[\s._-]+/, '')
      .trim();

    const initialTitle = metaEditorState.hints.title || (isDir ? '' : cleanGuess);
    const initialArtist = metaEditorState.hints.artist || '';
    const initialAlbum = metaEditorState.hints.album || (isDir ? item?.name || '' : '');
    const initialYear = metaEditorState.hints.year || '';

    metaEditorState.originalArtist = initialArtist;

    if ($('meta-input-title')) $('meta-input-title').value = initialTitle;
    if ($('meta-input-artist')) $('meta-input-artist').value = initialArtist;
    if ($('meta-input-album')) $('meta-input-album').value = initialAlbum;
    if ($('meta-input-year')) $('meta-input-year').value = initialYear;

    updateMetaArtistModeUI();
    ensureMetaDbArtistsLoaded();

    const initialSearchParts = [
      initialArtist,
      metaEditorState.scope === 'album' ? initialAlbum : initialTitle || initialAlbum || cleanGuess,
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    if ($('meta-online-search-input')) {
      $('meta-online-search-input').value = initialSearchParts.join(' ') || cleanGuess;
    }
    if ($('meta-search-summary')) $('meta-search-summary').textContent = '';

    if (metaEditorState.hints.coverUrl) {
      setMetaCoverPreview(metaEditorState.hints.coverUrl, 'CURRENT LIBRARY COVER');
    } else {
      setMetaCoverPreview('', 'LOADING...');
    }
    updateMetaScopeUI();
    renderOnlineMetadataResults();

    const modal = $('files-metadata-modal');
    if (modal) modal.classList.remove('hidden');
    refreshIcons();

    // Read current embedded tags & cover art from backend bridge
    const base = getFileBridgeBase();
    const targetToRead =
      metaEditorState.scope === 'album'
        ? metaEditorState.folderPath || metaEditorState.filePath
        : metaEditorState.filePath || metaEditorState.folderPath;

    const queryParams = new URLSearchParams({
      path: targetToRead || '',
      scope: metaEditorState.scope,
      title: initialTitle,
      artist: initialArtist,
      album: initialAlbum,
    });

    setMetaEditorStatus('Reading current embedded tags from file bridge...');
    try {
      const res = await fetch(`${base}/api/metadata/read?${queryParams.toString()}`, {
        headers: getFileBridgeHeaders(),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const meta = data.metadata || {};

      if (typeof data.audioTrackCount === 'number') {
        metaEditorState.audioTrackCount = data.audioTrackCount;
      }
      if (Array.isArray(data.audioFiles)) {
        metaEditorState.filePaths = data.audioFiles;
      }

      if (data.path) {
        if (metaEditorState.scope === 'album' && !metaEditorState.folderPath) {
          metaEditorState.folderPath = data.path;
        } else if (metaEditorState.scope === 'single' && !metaEditorState.filePath) {
          metaEditorState.filePath = data.path;
        }
        updateMetaScopeUI();
      }

      if ($('meta-input-title') && meta.title) $('meta-input-title').value = meta.title;
      if ($('meta-input-artist') && meta.artist) {
        $('meta-input-artist').value = meta.artist;
        metaEditorState.originalArtist = meta.artist;
      }
      if ($('meta-input-album') && meta.album) $('meta-input-album').value = meta.album;
      if ($('meta-input-year') && meta.year) $('meta-input-year').value = meta.year;
      refreshMatchedDbArtist();
      updateMetaArtistModeUI();

      const smartQueryParts = [
        meta.artist || initialArtist,
        metaEditorState.searchMode === 'album' || metaEditorState.scope === 'album'
          ? meta.album || initialAlbum
          : meta.title || initialTitle || meta.album || initialAlbum,
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean);
      if (smartQueryParts.length > 0 && $('meta-online-search-input')) {
        $('meta-online-search-input').value = smartQueryParts.join(' ');
      }

      if (meta.coverDataUrl) {
        setMetaCoverPreview(meta.coverDataUrl, 'CURRENT EMBEDDED');
      } else if (metaEditorState.hints.coverUrl) {
        setMetaCoverPreview(metaEditorState.hints.coverUrl, 'CURRENT LIBRARY COVER');
      } else {
        setMetaCoverPreview('', 'NO EMBEDDED COVER');
      }

      const trackCountNote =
        typeof data.audioTrackCount === 'number' ? ` (${data.audioTrackCount} audio tracks in folder)` : '';
      setMetaEditorStatus(`Loaded current metadata${trackCountNote}.`);
    } catch (err) {
      if (!metaEditorState.hints.coverUrl) {
        setMetaCoverPreview('', 'NO COVER');
      }
      setMetaEditorStatus(`Ready (${err.message})`);
    }
  }

  /**
   * Open the Metadata & Cover Art Editor directly for any Subsonic song object
   * in the Music UI (Track Row, Album Detail tracklist, Songs view, Now Playing, etc.).
   */
  async function openMetadataEditorForSong(song, initialScope = 'single') {
    if (!song) {
      showToast('No track selected', 'error');
      return;
    }
    const songPath = normalizeSubsonicPath(song.path || '');
    const folderPath = songPath.includes('/') ? songPath.split('/').slice(0, -1).join('/') : '';
    const coverId = song.coverArt || song.albumId || song.id;
    const coverUrl = coverId ? client.getCoverArtUrl(coverId, 500) : '';

    await openMetadataEditor(
      {
        name: song.title || songPath.split('/').pop() || 'Track',
        isDirectory: initialScope === 'album' && !songPath,
        relPath: songPath,
        folderPath,
        filePaths: songPath ? [songPath] : [],
        hints: {
          title: song.title || '',
          artist: song.artist || '',
          album: song.album || '',
          year: song.year ? String(song.year) : '',
          coverUrl,
        },
      },
      initialScope
    );
  }

  /**
   * Open the Metadata & Cover Art Editor directly for any Subsonic album object
   * in the Album Detail UI or Albums grid.
   */
  async function openMetadataEditorForAlbum(album) {
    if (!album) {
      showToast('No album loaded', 'error');
      return;
    }
    let detail = album;
    if (!Array.isArray(detail.song) || detail.song.length === 0) {
      try {
        detail = await client.resolveAlbumSongs(album);
      } catch (_) {
        detail = album;
      }
    }
    const songs = Array.isArray(detail?.song) ? detail.song : [];
    const filePaths = songs.map((s) => normalizeSubsonicPath(s?.path || '')).filter(Boolean);
    const firstFilePath = filePaths[0] || '';
    const folderPath = firstFilePath.includes('/')
      ? firstFilePath.split('/').slice(0, -1).join('/')
      : '';
    const virtual = isVirtualAlbum(detail);
    const trackCoverId = songs.find((s) => s && s.coverArt && !isPlaceholderCoverValue(s.coverArt))?.coverArt;
    const coverId =
      (!isPlaceholderCoverValue(detail.coverArt) ? detail.coverArt : null) ||
      trackCoverId ||
      (!virtual ? detail.id : null) ||
      songs[0]?.id;
    const coverUrl =
      (detail.id && artistAlbumCoverCache.get(detail.id)) ||
      (coverId ? client.getCoverArtUrl(coverId, 500) : '');

    await openMetadataEditor(
      {
        name: detail.name || album.name || 'Album',
        isDirectory: true,
        relPath: folderPath,
        firstFilePath,
        filePaths,
        hints: {
          title: songs[0]?.title || '',
          artist: detail.artist || album.artist || songs[0]?.artist || '',
          album: detail.name || album.name || '',
          year: detail.year || album.year ? String(detail.year || album.year) : '',
          coverUrl,
        },
      },
      'album'
    );
  }

  function closeMetadataEditor() {
    metaEditorState.active = false;
    metaEditorState.isYtmStaging = false;
    metaEditorState.ytmStagedJob = null;
    metaEditorState.onlineAlbumTracks = [];
    metaEditorState.dbPickerOpen = false;
    const dbDropdown = $('meta-artist-db-dropdown');
    if (dbDropdown) dbDropdown.classList.add('hidden');
    if (metaEditorState.previewObjectUrl) {
      URL.revokeObjectURL(metaEditorState.previewObjectUrl);
      metaEditorState.previewObjectUrl = null;
    }
    const modal = $('files-metadata-modal');
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Render the Pre-Download Staged Tracklist (editable individual track titles + track numbers).
   */
  function renderStagedTracksList() {
    const listEl = $('meta-staged-tracks-list');
    const syncBtn = $('meta-staged-sync-online-titles-btn');
    const resetBtn = $('meta-staged-reset-yt-titles-btn');
    if (!listEl) return;

    const tracks = metaEditorState.ytmStagedJob?.tracks || [];
    const hasOnlineTracks = Array.isArray(metaEditorState.onlineAlbumTracks) && metaEditorState.onlineAlbumTracks.length > 0;
    const hasModifiedTitles = tracks.some((t) => t.title !== t.ytTitle);

    if (syncBtn) {
      syncBtn.classList.toggle('hidden', !hasOnlineTracks);
      if (hasOnlineTracks) {
        syncBtn.textContent = `USE ONLINE TRACKLIST (${metaEditorState.onlineAlbumTracks.length})`;
      }
    }
    if (resetBtn) {
      resetBtn.classList.toggle('hidden', !hasModifiedTitles);
    }

    listEl.innerHTML = '';
    tracks.forEach((trk, idx) => {
      const row = document.createElement('div');
      row.className = 'px-2.5 py-1.5 flex items-center gap-2 bg-zinc-950/80';
      const numStr = String(trk.trackNumber || idx + 1).padStart(2, '0');
      row.innerHTML = `
        <span class="w-6 text-[10px] font-mono text-emerald-400 shrink-0">#${escapeHtml(numStr)}</span>
        <input
          type="text"
          data-staged-track-idx="${idx}"
          value="${escapeHtml(trk.title || '')}"
          placeholder="Track ${idx + 1} title..."
          class="flex-1 min-w-0 h-7 px-2 bg-zinc-900 border border-zinc-800 focus:border-emerald-400 text-xs text-zinc-100 font-sans select-text outline-none"
        />
      `;
      const input = row.querySelector('input');
      if (input) {
        input.addEventListener('input', (e) => {
          trk.title = e.target.value;
          if (tracks.length === 1 && $('meta-input-title')) {
            $('meta-input-title').value = trk.title;
          }
          const anyDiff = tracks.some((t) => t.title !== t.ytTitle);
          if (resetBtn) resetBtn.classList.toggle('hidden', !anyDiff);
        });
      }
      listEl.appendChild(row);
    });
  }

  function applyOnlineAlbumTracksToStaged() {
    const tracks = metaEditorState.ytmStagedJob?.tracks || [];
    const online = metaEditorState.onlineAlbumTracks || [];
    if (!tracks.length || !online.length) return;

    let applied = 0;
    for (let i = 0; i < tracks.length; i++) {
      if (online[i]?.title) {
        tracks[i].title = String(online[i].title).trim();
        applied++;
      }
    }
    if (tracks.length === 1 && tracks[0]?.title && $('meta-input-title')) {
      $('meta-input-title').value = tracks[0].title;
    }
    renderStagedTracksList();
    if (applied > 0) {
      showToast(`Applied ${applied} official track title(s) to staged tracklist`);
    }
  }

  function resetStagedTracksToYoutubeTitles() {
    const tracks = metaEditorState.ytmStagedJob?.tracks || [];
    for (const trk of tracks) {
      if (trk.ytTitle) {
        trk.title = trk.ytTitle;
      }
    }
    if (tracks.length === 1 && tracks[0]?.title && $('meta-input-title')) {
      $('meta-input-title').value = tracks[0].title;
    }
    renderStagedTracksList();
    showToast('Restored YouTube Music track titles');
  }

  async function fetchOnlineAlbumTracksForStaging(albumItem) {
    if (!metaEditorState.isYtmStaging || !albumItem?.sourceId) return;
    try {
      const base = getFileBridgeBase();
      const res = await fetch(
        `${base}/api/metadata/album-tracks?sourceId=${encodeURIComponent(albumItem.sourceId)}`,
        { headers: getFileBridgeHeaders(getSpotifyHeaders()) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      if (tracks.length > 0) {
        metaEditorState.onlineAlbumTracks = tracks;
        applyOnlineAlbumTracksToStaged();
      }
    } catch (_) {}
  }

  /**
   * Open the Metadata & Cover Art Editor Modal in "Pre-Download Staging Mode"
   * after fetching link metadata via yt-dlp --dump-single-json --flat-playlist.
   */
  async function openMetadataEditorForYtmStaging(staged, downloadParams = {}) {
    initMetadataEditorEvents();

    const rawTracks = Array.isArray(staged?.tracks) ? staged.tracks : [];
    const isAlbum = Boolean(staged?.isPlaylist || rawTracks.length > 1 || staged?.scope === 'album');

    metaEditorState.isYtmStaging = true;
    metaEditorState.onlineAlbumTracks = [];
    metaEditorState.scope = isAlbum ? 'album' : 'single';
    metaEditorState.targetType = isAlbum ? 'folder' : 'file';
    metaEditorState.audioTrackCount = rawTracks.length || 1;
    metaEditorState.filePaths = [];
    metaEditorState.filePath = '';
    metaEditorState.folderPath = '';
    metaEditorState.targetPath = '';

    metaEditorState.ytmStagedJob = {
      url: staged?.url || downloadParams.url || '',
      format: downloadParams.format || 'opus',
      destMode: downloadParams.destMode || 'auto',
      targetDir: downloadParams.targetDir || '',
      isPlaylist: isAlbum,
      tracks: rawTracks.map((t, idx) => {
        const cleanTitle = String(t.title || `Track ${idx + 1}`).trim();
        return {
          index: idx + 1,
          trackNumber: Number(t.trackNumber) || idx + 1,
          id: String(t.id || ''),
          url: String(t.url || ''),
          title: cleanTitle,
          ytTitle: cleanTitle,
          artist: String(t.artist || staged?.artist || '').trim(),
          album: String(t.album || staged?.album || '').trim(),
          duration: Number(t.duration) || 0,
        };
      }),
    };

    const initialTitle = isAlbum
      ? ''
      : String(staged?.title || rawTracks[0]?.title || '').trim();
    const initialArtist = String(staged?.artist || rawTracks[0]?.artist || '').trim();
    const initialAlbum = String(staged?.album || staged?.collectionTitle || '').trim();
    const initialYear = String(staged?.year || '').trim();

    metaEditorState.hints = {
      title: initialTitle,
      artist: initialArtist,
      album: initialAlbum,
      year: initialYear,
      coverUrl: '',
    };
    metaEditorState.originalArtist = initialArtist;

    if (metaEditorState.previewObjectUrl) {
      URL.revokeObjectURL(metaEditorState.previewObjectUrl);
      metaEditorState.previewObjectUrl = null;
    }
    metaEditorState.selectedCoverFile = null;
    metaEditorState.selectedCoverUrl = '';
    metaEditorState.onlineResults = [];
    metaEditorState.selectedResultId = null;
    metaEditorState.sourceFilter = 'all';
    metaEditorState.sourceArtist = initialArtist;
    metaEditorState.lockedDbArtist = '';
    metaEditorState.matchedDbArtist = '';
    metaEditorState.dbPickerOpen = false;
    metaEditorState.active = true;

    const dbDropdown = $('meta-artist-db-dropdown');
    if (dbDropdown) dbDropdown.classList.add('hidden');
    const fileInput = $('meta-cover-file-input');
    if (fileInput) fileInput.value = '';
    if ($('meta-override-album-titles')) $('meta-override-album-titles').checked = false;

    if ($('meta-input-title')) $('meta-input-title').value = initialTitle;
    if ($('meta-input-artist')) $('meta-input-artist').value = initialArtist;
    if ($('meta-input-album')) $('meta-input-album').value = initialAlbum;
    if ($('meta-input-year')) $('meta-input-year').value = initialYear;

    await ensureMetaDbArtistsLoaded();
    const dbMatch = refreshMatchedDbArtist();
    if (metaEditorState.artistMode !== 'source' && dbMatch?.name && $('meta-input-artist')) {
      $('meta-input-artist').value = dbMatch.name;
    }
    updateMetaArtistModeUI();

    setMetaSearchMode(isAlbum ? 'album' : 'track');
    const searchQuery = [
      initialArtist,
      isAlbum ? initialAlbum || rawTracks[0]?.title : initialTitle || initialAlbum,
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(' ');
    if ($('meta-online-search-input')) {
      $('meta-online-search-input').value = searchQuery;
    }
    if ($('meta-search-summary')) $('meta-search-summary').textContent = '';

    setMetaCoverPreview('', 'NO COVER (SKIPPING YT THUMB)');
    updateMetaScopeUI();
    renderStagedTracksList();
    renderOnlineMetadataResults();

    const modal = $('files-metadata-modal');
    if (modal) modal.classList.remove('hidden');
    refreshIcons();

    setMetaEditorStatus(
      `Staged ${rawTracks.length} track(s) from YouTube Music. Choose online metadata/cover or upload local art, then click Confirm & Start Download.`
    );

    if (searchQuery) {
      runOnlineMetadataSearch();
    }
  }

  function getSpotifyHeaders() {
    const id = localStorage.getItem('century.spotify_client_id') || '';
    const secret = localStorage.getItem('century.spotify_client_secret') || '';
    const extra = {};
    if (id) extra['x-spotify-client-id'] = id;
    if (secret) extra['x-spotify-client-secret'] = secret;
    return extra;
  }

  /**
   * Direct browser-side fallback search (iTunes JP + MusicBrainz) used when the remote
   * File Bridge has not yet been updated/restarted with `/api/metadata/search` (HTTP 404).
   */
  async function searchOnlineMetadataBrowserFallback(query, options = {}) {
    const isAlbum = String(options.scope || metaEditorState.searchMode || metaEditorState.scope || '').toLowerCase() === 'album';

    const itunesTask = (async () => {
      try {
        const entity = isAlbum ? 'album' : 'song';
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=jp&media=music&entity=${entity}&limit=12`;
        let res = await fetch(url);
        if (!res.ok) return [];
        let data = await res.json();
        let results = data.results || [];
        if (isAlbum && results.length === 0) {
          const fallbackUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&country=jp&media=music&entity=song&limit=15`;
          res = await fetch(fallbackUrl);
          if (res.ok) {
            const fbData = await res.json();
            results = fbData.results || [];
          }
        }

        if (isAlbum) {
          const seen = new Set();
          const albums = [];
          for (const item of results) {
            const colId = item.collectionId || item.collectionName;
            if (!colId || seen.has(colId)) continue;
            seen.add(colId);

            const thumb = item.artworkUrl100 || item.artworkUrl60 || '';
            const highRes = thumb ? thumb.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/1000x1000bb.$1') : '';
            const albTitle = item.collectionName || item.trackName || 'Untitled Album';
            albums.push({
              source: 'iTunes JP',
              sourceId: `itunes-album-${colId}`,
              type: 'album',
              title: albTitle,
              artist: item.artistName || '',
              album: albTitle,
              year: item.releaseDate ? String(item.releaseDate).slice(0, 4) : '',
              trackCount: item.trackCount || 0,
              coverUrl: highRes || thumb,
              thumbnailUrl: thumb ? thumb.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/300x300bb.$1') : '',
              resolution: highRes ? '1000×1000' : '100×100',
            });
          }
          return albums;
        }

        return results.map((item) => {
          const thumb = item.artworkUrl100 || item.artworkUrl60 || '';
          const highRes = thumb ? thumb.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/1000x1000bb.$1') : '';
          return {
            source: 'iTunes JP',
            sourceId: `itunes-${item.trackId || item.collectionId || Math.random()}`,
            type: 'track',
            title: item.trackName || item.collectionName || '',
            artist: item.artistName || '',
            album: item.collectionName || '',
            year: item.releaseDate ? String(item.releaseDate).slice(0, 4) : '',
            trackCount: item.trackCount || 0,
            coverUrl: highRes || thumb,
            thumbnailUrl: thumb,
            resolution: highRes ? '1000×1000' : '100×100',
          };
        });
      } catch (_) {
        return [];
      }
    })();

    const mbTask = (async () => {
      try {
        const cleanMbQuery = String(query || '').replace(/[+\-!(){}[\]^"~*?:\\\/]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanMbQuery) return [];

        const endpoint = isAlbum
          ? `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(cleanMbQuery)}&fmt=json&limit=12`
          : `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(cleanMbQuery)}&fmt=json&limit=8`;
        const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
        if (!res.ok) return [];
        const data = await res.json();
        if (isAlbum) {
          const seen = new Set();
          const albums = [];
          for (const rel of (data.releases || [])) {
            const releaseId = rel.id || '';
            const artist = (rel['artist-credit'] || [])
              .map((c) => c.name || c.artist?.name || '')
              .filter(Boolean)
              .join(', ');
            const title = rel.title || '';
            const dedupeKey = `${title.toLowerCase()}|${artist.toLowerCase()}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const dateStr = rel.date || '';
            albums.push({
              source: 'MusicBrainz',
              sourceId: `mb-rel-${rel.id}`,
              type: 'album',
              title,
              artist,
              album: title,
              year: dateStr ? String(dateStr).slice(0, 4) : '',
              trackCount: rel['track-count'] || 0,
              coverUrl: releaseId ? `https://coverartarchive.org/release/${releaseId}/front-1200` : '',
              thumbnailUrl: releaseId ? `https://coverartarchive.org/release/${releaseId}/front-250` : '',
              resolution: releaseId ? '1200×1200' : '',
            });
          }
          return albums;
        }
        return (data.recordings || []).map((rec) => {
          const artistCredit = Array.isArray(rec['artist-credit'])
            ? rec['artist-credit'].map((c) => c.name || c.artist?.name || '').join('')
            : '';
          const firstRelease = Array.isArray(rec.releases) && rec.releases.length > 0 ? rec.releases[0] : null;
          const releaseId = firstRelease?.id || '';
          const dateStr = firstRelease?.date || rec['first-release-date'] || '';
          return {
            source: 'MusicBrainz',
            sourceId: `mb-${rec.id}`,
            type: 'track',
            title: rec.title || '',
            artist: artistCredit,
            album: firstRelease?.title || '',
            year: dateStr ? String(dateStr).slice(0, 4) : '',
            coverUrl: releaseId ? `https://coverartarchive.org/release/${releaseId}/front-1200` : '',
            thumbnailUrl: releaseId ? `https://coverartarchive.org/release/${releaseId}/front-250` : '',
            resolution: releaseId ? '1200×1200' : '',
          };
        });
      } catch (_) {
        return [];
      }
    })();

    const [itunes, mb] = await Promise.all([itunesTask, mbTask]);
    return [...itunes, ...mb];
  }

  async function runOnlineMetadataSearch() {
    const query = $('meta-online-search-input')?.value?.trim() || '';
    if (!query) {
      showToast('Enter a song, artist, or album to search', 'error');
      return;
    }

    const base = getFileBridgeBase();
    const listEl = $('meta-online-results-list');
    const summaryEl = $('meta-search-summary');
    const searchBtn = $('meta-online-search-btn');
    const scope = metaEditorState.searchMode || metaEditorState.scope || 'single';

    if (searchBtn) searchBtn.disabled = true;
    setMetaEditorStatus(
      scope === 'album'
        ? `Searching Deezer, iTunes JP, Spotify JP & MusicBrainz for album "${query}"...`
        : `Searching Deezer, iTunes JP, Spotify JP & MusicBrainz for "${query}"...`
    );
    if (listEl) {
      listEl.innerHTML = `
        <div class="p-8 flex flex-col items-center justify-center gap-2 text-xs font-mono text-zinc-400">
          <i data-lucide="loader-2" class="w-5 h-5 text-emerald-400 animate-spin"></i>
          <span>Querying Deezer, iTunes JP, Spotify JP &amp; MusicBrainz (${scope === 'album' ? 'ALBUM' : 'TRACK'} mode)...</span>
        </div>
      `;
      refreshIcons();
    }

    try {
      const res = await fetch(`${base}/api/metadata/search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}`, {
        headers: getFileBridgeHeaders(getSpotifyHeaders()),
      });
      if (res.status === 404) {
        // Remote File Bridge is still running older code — fall back to direct browser search
        const fallbackResults = await searchOnlineMetadataBrowserFallback(query, { scope });
        metaEditorState.onlineResults = fallbackResults;
        if (summaryEl) {
          summaryEl.textContent = `${fallbackResults.length} results (Direct Browser Fallback)`;
        }
        setMetaEditorStatus(
          `Found ${fallbackResults.length} matches via browser fallback (update & restart file-bridge.js on your server PC to enable full backend search & saving).`
        );
        renderOnlineMetadataResults();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      metaEditorState.onlineResults = Array.isArray(data.results) ? data.results : [];

      const s = data.sources || {};
      const spotifyNote = s.spotifyJP?.configured === false ? ' · Spotify JP (set key to enable)' : '';
      if (summaryEl) {
        summaryEl.textContent = `${metaEditorState.onlineResults.length} results${spotifyNote}`;
      }

      setMetaEditorStatus(
        scope === 'album'
          ? `Found ${metaEditorState.onlineResults.length} album matches across Deezer, iTunes JP, Spotify JP & MusicBrainz. Click any album to choose its tags & cover.`
          : `Found ${metaEditorState.onlineResults.length} matches across music databases. Click any result to auto-fill.`
      );
      renderOnlineMetadataResults();
    } catch (err) {
      // Also attempt browser fallback on network error
      const fallbackResults = await searchOnlineMetadataBrowserFallback(query, { scope });
      if (fallbackResults.length > 0) {
        metaEditorState.onlineResults = fallbackResults;
        if (summaryEl) {
          summaryEl.textContent = `${fallbackResults.length} results (Direct Browser Fallback)`;
        }
        setMetaEditorStatus(`Found ${fallbackResults.length} matches via direct browser search.`);
        renderOnlineMetadataResults();
        return;
      }
      setMetaEditorStatus(`Online search failed: ${err.message}`, true);
      if (listEl) {
        listEl.innerHTML = `<div class="p-6 text-center text-xs font-mono text-[#f0605a]">Search failed: ${escapeHtml(err.message)}</div>`;
      }
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  function getSourceBadgeClass(source) {
    if (source === 'iTunes JP') return 'border-pink-500/40 bg-pink-950/30 text-pink-300';
    if (source === 'Spotify JP') return 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
    if (source === 'MusicBrainz') return 'border-amber-500/40 bg-amber-950/30 text-amber-300';
    if (source === 'Deezer') return 'border-sky-500/40 bg-sky-950/30 text-sky-300';
    return 'border-zinc-700 bg-zinc-900 text-zinc-300';
  }

  function renderOnlineMetadataResults() {
    const listEl = $('meta-online-results-list');
    if (!listEl) return;

    const filter = metaEditorState.sourceFilter || 'all';
    const filtered = metaEditorState.onlineResults.filter(
      (r) => filter === 'all' || r.source === filter
    );

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="p-8 text-center text-xs font-mono text-zinc-500">
          ${
            metaEditorState.onlineResults.length === 0
              ? 'Click "AUTO-TAG / SEARCH ONLINE" to pull Kanji/Romaji tags and high-res covers from Deezer, iTunes JP, Spotify JP, and MusicBrainz.'
              : `No results from source "${escapeHtml(filter)}".`
          }
        </div>
      `;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach((item) => {
      const isSelected = metaEditorState.selectedResultId === item.sourceId;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `w-full p-2.5 text-left flex items-center gap-3 transition-colors ${
        isSelected ? 'bg-emerald-950/30 border-l-2 border-l-emerald-400' : 'hover:bg-zinc-900/80'
      }`;

      const isAlbumItem = item.type === 'album' || metaEditorState.searchMode === 'album' || metaEditorState.scope === 'album';
      const typeBadge = isAlbumItem
        ? `<span class="px-1.5 py-0.2 text-[9.5px] font-mono border border-amber-500/40 bg-amber-950/30 text-amber-300 font-semibold">ALBUM${item.trackCount ? ` · ${item.trackCount} TRK` : ''}</span>`
        : `<span class="px-1.5 py-0.2 text-[9.5px] font-mono border border-zinc-700 bg-zinc-900 text-zinc-400">TRACK</span>`;

      const displayTitle = isAlbumItem ? item.album || item.title || 'Untitled Album' : item.title || 'Untitled';
      const displaySub = isAlbumItem
        ? `${escapeHtml(item.artist || 'Unknown Artist')}${item.year ? ` · ${escapeHtml(String(item.year))}` : ''}`
        : `${escapeHtml(item.artist || 'Unknown Artist')}${item.album ? ` · ${escapeHtml(item.album)}` : ''}`;

      const thumbUrl = item.thumbnailUrl || item.coverUrl || '';
      row.innerHTML = `
        <div class="relative w-12 h-12 bg-zinc-900 border border-zinc-700 shrink-0 overflow-hidden flex items-center justify-center">
          ${
            thumbUrl
              ? `<img src="${escapeHtml(thumbUrl)}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'" />`
              : `<i data-lucide="disc" class="w-4 h-4 text-zinc-500"></i>`
          }
        </div>
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="px-1.5 py-0.2 text-[9.5px] font-mono border ${getSourceBadgeClass(item.source)}">
              ${escapeHtml(item.source)}
            </span>
            ${typeBadge}
            ${
              item.resolution
                ? `<span class="px-1.5 py-0.2 text-[9.5px] font-mono border border-zinc-800 bg-zinc-900 text-zinc-400">${escapeHtml(item.resolution)}</span>`
                : ''
            }
            ${
              item.year
                ? `<span class="text-[10px] font-mono text-zinc-400">${escapeHtml(String(item.year))}</span>`
                : ''
            }
          </div>
          <p class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(displayTitle)}</p>
          <p class="text-[11px] text-zinc-400 truncate">${displaySub}</p>
        </div>
        <div class="shrink-0 text-[10px] font-mono text-emerald-400 px-2 font-semibold">
          ${isSelected ? 'SELECTED' : isAlbumItem ? 'CHOOSE ALBUM' : 'USE'}
        </div>
      `;

      row.onclick = () => {
        metaEditorState.selectedResultId = item.sourceId;

        const chosenAlbum = item.album || item.title || '';
        const chosenYear = item.year ? String(item.year) : '';

        metaEditorState.sourceArtist = String(item.artist || '').trim();
        const dbMatch = refreshMatchedDbArtist();
        let chosenArtist = metaEditorState.sourceArtist;
        let artistNote = '';

        if (metaEditorState.artistMode !== 'source') {
          if (metaEditorState.lockedDbArtist) {
            chosenArtist = metaEditorState.lockedDbArtist;
            artistNote = ` · Kept selected DB artist "${chosenArtist}"`;
          } else if (dbMatch && dbMatch.name) {
            chosenArtist = dbMatch.name;
            if (normArtistKey(chosenArtist) !== normArtistKey(metaEditorState.sourceArtist)) {
              artistNote = ` · Kept DB artist "${chosenArtist}" instead of "${metaEditorState.sourceArtist}"`;
            }
          }
        }

        if (metaEditorState.scope === 'album') {
          // Album Folder Mode: auto-fill Album, Artist, Year, and Cover for the folder batch
          if ($('meta-input-album')) $('meta-input-album').value = chosenAlbum;
          if ($('meta-input-artist') && chosenArtist) $('meta-input-artist').value = chosenArtist;
          if ($('meta-input-year') && chosenYear) $('meta-input-year').value = chosenYear;

          // If overrideAlbumTitles is checked, also fill title
          if ($('meta-input-title') && $('meta-override-album-titles')?.checked) {
            $('meta-input-title').value = item.title || chosenAlbum;
          }

          setMetaEditorStatus(
            `Selected album from ${item.source}: "${chosenAlbum}" by ${chosenArtist || item.artist}${artistNote}. Ready to sync all tracks.`
          );
        } else {
          // Single Track Mode
          if ($('meta-input-title') && item.type !== 'album' && item.title) {
            $('meta-input-title').value = item.title;
            if (
              metaEditorState.isYtmStaging &&
              metaEditorState.ytmStagedJob?.tracks?.length === 1
            ) {
              metaEditorState.ytmStagedJob.tracks[0].title = item.title;
              renderStagedTracksList();
            }
          }
          if ($('meta-input-artist') && chosenArtist) $('meta-input-artist').value = chosenArtist;
          if ($('meta-input-album') && chosenAlbum) $('meta-input-album').value = chosenAlbum;
          if ($('meta-input-year') && chosenYear) $('meta-input-year').value = chosenYear;

          if (isAlbumItem) {
            setMetaEditorStatus(
              `Selected album "${chosenAlbum}" by ${chosenArtist || item.artist}${artistNote}.`
            );
          } else {
            setMetaEditorStatus(
              `Auto-filled tags & cover from ${item.source}: "${item.title}" — ${chosenArtist || item.artist}${artistNote}`
            );
          }
        }

        if (metaEditorState.isYtmStaging && isAlbumItem && item.sourceId) {
          fetchOnlineAlbumTracksForStaging(item);
        }

        updateMetaArtistModeUI();

        // Load high-res cover art preview
        if (item.coverUrl) {
          metaEditorState.selectedCoverFile = null;
          metaEditorState.selectedCoverUrl = item.coverUrl;
          const fileInput = $('meta-cover-file-input');
          if (fileInput) fileInput.value = '';
          setMetaCoverPreview(item.coverUrl, `${item.source} (${item.resolution || 'HIGH-RES'})`);
        }

        renderOnlineMetadataResults();
      };

      listEl.appendChild(row);
    });

    refreshIcons();
  }

  function refreshMusicUIAfterMetadataUpdate(instantCoverUrl = '') {
    // Bust Subsonic cover art cache so newly embedded covers reload immediately
    if (typeof client.bustCoverCache === 'function') {
      client.bustCoverCache();
    }
    artistAlbumCoverCache.clear();

    // Immediately show the newly selected cover in Album Detail if currently viewing an album
    if (instantCoverUrl && state.route === 'album-detail') {
      const albumImg = $('album-detail-cover');
      const albumFb = $('album-detail-cover-fallback');
      if (albumImg) {
        albumImg.src = instantCoverUrl;
        albumImg.classList.remove('hidden');
      }
      if (albumFb) {
        albumFb.classList.add('hidden');
      }
    }

    // Ping Navidrome API to force a scan & refresh UI caches
    client.request('startScan').catch(() => {});
    state.artists = null;
    state.songs = null;
    state.songsPromise = null;
    state.albumsByType = {};

    if (state.route === 'files') {
      loadFilesView();
    }

    // Re-fetch and re-render current route after Navidrome finishes indexing the updated file(s)
    setTimeout(async () => {
      if (typeof client.bustCoverCache === 'function') {
        client.bustCoverCache();
      }
      if (state.route === 'album-detail' && state.currentAlbum?.id) {
        try {
          const updated = await client.resolveAlbumSongs(state.currentAlbum);
          state.currentAlbum = updated;
          renderAlbumDetailView();
        } catch (_) {
          renderAlbumDetailView();
        }
      } else {
        rerenderCurrentRoute();
      }
    }, 1400);
  }

  /**
   * 1. Dedicated Cover-Only Update Flow -> POST /api/update-cover
   * Packages the image file (or selected online coverUrl), target scope ('single' | 'album'),
   * and target identifiers (filePath, folderPath, filePaths, hints) into a FormData payload.
   */
  async function submitUpdateCoverOnly() {
    if (metaEditorState.busy) return;
    if (!metaEditorState.selectedCoverFile && !metaEditorState.selectedCoverUrl) {
      showToast('Choose a local .jpg/.png image or select an online result with cover art first', 'error');
      return;
    }

    const base = getFileBridgeBase();
    const formData = new FormData();
    formData.append('scope', metaEditorState.scope);
    formData.append('type', metaEditorState.scope === 'album' ? 'folder' : 'file');
    formData.append(
      'targetPath',
      metaEditorState.scope === 'album'
        ? (metaEditorState.folderPath || metaEditorState.filePath || '')
        : (metaEditorState.filePath || metaEditorState.folderPath || '')
    );
    formData.append('filePath', metaEditorState.filePath || '');
    formData.append('folderPath', metaEditorState.folderPath || '');
    if (Array.isArray(metaEditorState.filePaths) && metaEditorState.filePaths.length > 0) {
      formData.append('filePaths', JSON.stringify(metaEditorState.filePaths));
    }
    formData.append('hintTitle', $('meta-input-title')?.value?.trim() || metaEditorState.hints?.title || '');
    formData.append('hintArtist', $('meta-input-artist')?.value?.trim() || metaEditorState.hints?.artist || '');
    formData.append('hintAlbum', $('meta-input-album')?.value?.trim() || metaEditorState.hints?.album || '');

    const instantCoverPreview = metaEditorState.previewObjectUrl || metaEditorState.selectedCoverUrl || '';
    if (metaEditorState.selectedCoverFile) {
      formData.append('image', metaEditorState.selectedCoverFile);
    } else if (metaEditorState.selectedCoverUrl) {
      formData.append('coverUrl', metaEditorState.selectedCoverUrl);
    }

    metaEditorState.busy = true;
    setMetaEditorStatus(
      metaEditorState.scope === 'album'
        ? 'Embedding cover art into all audio tracks in album...'
        : 'Embedding cover art into audio track...'
    );

    try {
      const res = await fetch(`${base}/api/update-cover`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            'HTTP 404 — Your home server is still running the old file-bridge.js. Pull the latest repo on your main server PC and restart run-windows.ps1.'
          );
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const targetDesc =
        metaEditorState.filePath.split('/').pop() ||
        metaEditorState.hints?.title ||
        'track';

      if (!data.updatedCount) {
        const detail = data.errors?.[0]?.error ? `: ${data.errors[0].error}` : '';
        throw new Error(`0 tracks were updated${detail}`);
      }

      const msg =
        metaEditorState.scope === 'album'
          ? `Embedded cover art into ${data.updatedCount} track(s) in album`
          : `Updated embedded cover art for "${targetDesc}"`;

      if (data.errors && data.errors.length > 0) {
        showToast(`Updated ${data.updatedCount} track(s) (${data.errors.length} failed: ${data.errors[0].error})`, 'warning');
      } else {
        showToast(msg);
      }
      setMetaEditorStatus(`${msg}. Triggered Navidrome library rescan.`);

      refreshMusicUIAfterMetadataUpdate(instantCoverPreview);
      closeMetadataEditor();
    } catch (err) {
      setMetaEditorStatus(`Cover update failed: ${err.message}`, true);
      showToast(`Cover update failed: ${err.message}`, 'error');
    } finally {
      metaEditorState.busy = false;
    }
  }

  /**
   * Confirm & Start Staged YTM Download -> POST /api/ytm/download
   * Sends confirmed cover art (file or URL), artist, album, year, and individual track titles/numbers.
   */
  async function submitStagedYtmDownload() {
    if (metaEditorState.busy || !metaEditorState.ytmStagedJob) return;

    const sj = metaEditorState.ytmStagedJob;
    const titleVal = $('meta-input-title')?.value?.trim() ?? '';
    const artistVal = $('meta-input-artist')?.value?.trim() ?? '';
    const albumVal = $('meta-input-album')?.value?.trim() ?? '';
    const yearVal = $('meta-input-year')?.value?.trim() ?? '';

    const confirmedTracks = (sj.tracks || []).map((t, idx) => {
      let trkTitle = String(t.title || t.ytTitle || `Track ${idx + 1}`).trim();
      if (sj.tracks.length === 1 && titleVal) {
        trkTitle = titleVal;
      }
      return {
        index: idx + 1,
        trackNumber: Number(t.trackNumber) || idx + 1,
        id: t.id || '',
        url: t.url || '',
        title: trkTitle,
        artist: artistVal || t.artist || '',
        album: albumVal || t.album || '',
      };
    });

    const stagedMetadata = {
      title: titleVal || confirmedTracks[0]?.title || '',
      artist: artistVal,
      album: albumVal,
      year: yearVal,
      coverUrl: metaEditorState.selectedCoverUrl || '',
      isPlaylist: Boolean(sj.isPlaylist || confirmedTracks.length > 1),
      tracks: confirmedTracks,
    };

    const formData = new FormData();
    formData.append('url', sj.url);
    formData.append('format', sj.format || 'opus');
    formData.append('destMode', sj.destMode || 'auto');
    formData.append('targetDir', sj.targetDir || '');
    formData.append('stagedMetadata', JSON.stringify(stagedMetadata));

    if (client && client.username && typeof client.buildUrl === 'function') {
      try {
        formData.append('navidromeScanUrl', client.buildUrl('startScan'));
      } catch (_) {}
    }

    if (metaEditorState.selectedCoverFile) {
      formData.append('image', metaEditorState.selectedCoverFile);
    }

    metaEditorState.busy = true;
    const saveBtn = $('meta-save-all-btn');
    if (saveBtn) saveBtn.disabled = true;
    setMetaEditorStatus('Starting YTM download with staged metadata & cover art...');

    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/download`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const urlInput = $('ytm-url-input');
      if (urlInput) urlInput.value = '';

      closeMetadataEditor();
      setYtmPanelExpanded(true);
      ensureYtmSseConnected();
      showToast(
        `Started YTM download (${confirmedTracks.length} track${confirmedTracks.length === 1 ? '' : 's'}) with staged tags`
      );
      await refreshYtmStatus();
    } catch (err) {
      setMetaEditorStatus(`Download start failed: ${err.message}`, true);
      showToast(`Download start failed: ${err.message}`, 'error');
    } finally {
      metaEditorState.busy = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  /**
   * 2. Full Metadata & Cover Writer Flow -> POST /api/metadata/apply
   * Sends finalized metadata object (Title, Artist, Album, Year) + Cover Art (file or URL)
   * to be injected into the physical audio file(s).
   */
  async function submitApplyFullMetadata() {
    if (metaEditorState.busy) return;
    if (metaEditorState.isYtmStaging) {
      return await submitStagedYtmDownload();
    }

    const base = getFileBridgeBase();
    const formData = new FormData();
    formData.append('scope', metaEditorState.scope);
    formData.append('type', metaEditorState.scope === 'album' ? 'folder' : 'file');
    formData.append(
      'targetPath',
      metaEditorState.scope === 'album'
        ? (metaEditorState.folderPath || metaEditorState.filePath || '')
        : (metaEditorState.filePath || metaEditorState.folderPath || '')
    );
    formData.append('filePath', metaEditorState.filePath || '');
    formData.append('folderPath', metaEditorState.folderPath || '');
    if (Array.isArray(metaEditorState.filePaths) && metaEditorState.filePaths.length > 0) {
      formData.append('filePaths', JSON.stringify(metaEditorState.filePaths));
    }

    const titleVal = $('meta-input-title')?.value?.trim() ?? '';
    const artistVal = $('meta-input-artist')?.value?.trim() ?? '';
    const albumVal = $('meta-input-album')?.value?.trim() ?? '';
    const yearVal = $('meta-input-year')?.value?.trim() ?? '';
    const overrideAlbumTitles = Boolean($('meta-override-album-titles')?.checked);

    formData.append('title', titleVal);
    formData.append('artist', artistVal);
    formData.append('album', albumVal);
    formData.append('year', yearVal);
    formData.append('overrideAlbumTitles', String(overrideAlbumTitles));
    formData.append('hintTitle', metaEditorState.hints?.title || titleVal);
    formData.append('hintArtist', metaEditorState.hints?.artist || artistVal);
    formData.append('hintAlbum', metaEditorState.hints?.album || albumVal);

    const instantCoverPreview = metaEditorState.previewObjectUrl || metaEditorState.selectedCoverUrl || '';
    if (metaEditorState.selectedCoverFile) {
      formData.append('image', metaEditorState.selectedCoverFile);
    } else if (metaEditorState.selectedCoverUrl) {
      formData.append('coverUrl', metaEditorState.selectedCoverUrl);
    }

    metaEditorState.busy = true;
    const saveBtn = $('meta-save-all-btn');
    if (saveBtn) saveBtn.disabled = true;
    setMetaEditorStatus(
      metaEditorState.scope === 'album'
        ? 'Writing metadata & cover art to all audio tracks in album...'
        : 'Writing metadata & cover art to audio file...'
    );

    try {
      const res = await fetch(`${base}/api/metadata/apply`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(
            'HTTP 404 — Your home server is still running the old file-bridge.js. Pull the latest repo on your main server PC and restart run-windows.ps1.'
          );
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      if (!data.updatedCount) {
        const detail = data.errors?.[0]?.error ? `: ${data.errors[0].error}` : '';
        throw new Error(`0 audio files were updated${detail}`);
      }

      const targetDesc =
        metaEditorState.filePath.split('/').pop() ||
        titleVal ||
        metaEditorState.hints?.title ||
        'track';
      const msg =
        metaEditorState.scope === 'album'
          ? `Saved metadata & cover to ${data.updatedCount} audio file(s) in album`
          : `Saved metadata & cover to "${targetDesc}"`;

      if (data.errors && data.errors.length > 0) {
        showToast(`Saved to ${data.updatedCount} file(s) (${data.errors.length} failed: ${data.errors[0].error})`, 'warning');
      } else {
        showToast(msg);
      }
      setMetaEditorStatus(msg);

      refreshMusicUIAfterMetadataUpdate(instantCoverPreview);
      closeMetadataEditor();
    } catch (err) {
      setMetaEditorStatus(`Save failed: ${err.message}`, true);
      showToast(`Metadata save failed: ${err.message}`, 'error');
    } finally {
      metaEditorState.busy = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function initMetadataEditorEvents() {
    if (metaEditorState.initialized) return;
    metaEditorState.initialized = true;

    on('files-edit-folder-meta-btn', 'click', () => {
      const folderName = filesState.currentPath
        ? filesState.currentPath.split('/').filter(Boolean).pop()
        : 'Root Music Folder';
      openMetadataEditor(
        {
          name: folderName,
          isDirectory: true,
          type: 'folder',
          relPath: filesState.currentPath || '',
        },
        'album'
      );
    });

    on('meta-editor-close-btn', 'click', closeMetadataEditor);
    on('meta-editor-cancel-btn', 'click', closeMetadataEditor);

    on('meta-scope-btn-single', 'click', () => setMetaEditorScope('single'));
    on('meta-scope-btn-album', 'click', () => setMetaEditorScope('album'));

    on('meta-search-type-album-btn', 'click', () => {
      setMetaSearchMode('album');
      const q = $('meta-online-search-input')?.value?.trim();
      if (q) runOnlineMetadataSearch();
    });
    on('meta-search-type-track-btn', 'click', () => {
      setMetaSearchMode('track');
      const q = $('meta-online-search-input')?.value?.trim();
      if (q) runOnlineMetadataSearch();
    });

    const modal = $('files-metadata-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeMetadataEditor();
      });
    }

    on('meta-override-album-titles', 'change', () => updateMetaScopeUI());
    on('meta-staged-sync-online-titles-btn', 'click', () => applyOnlineAlbumTracksToStaged());
    on('meta-staged-reset-yt-titles-btn', 'click', () => resetStagedTracksToYoutubeTitles());

    on('meta-input-title', 'input', (e) => {
      if (metaEditorState.isYtmStaging && metaEditorState.ytmStagedJob?.tracks?.length === 1) {
        metaEditorState.ytmStagedJob.tracks[0].title = e.target.value;
        renderStagedTracksList();
      }
    });

    // Existing DB Artist Mode & Picker controls
    on('meta-artist-mode-db-btn', 'click', () => setMetaArtistMode('db'));
    on('meta-artist-mode-source-btn', 'click', () => setMetaArtistMode('source'));
    on('meta-artist-db-picker-btn', 'click', () => toggleMetaDbDropdown());
    on('meta-artist-db-search', 'input', (e) => renderMetaDbArtistsList(e.target.value));
    on('meta-input-artist', 'input', () => {
      metaEditorState.lockedDbArtist = '';
      updateMetaArtistModeUI();
    });

    // Local cover art file picker (.jpg, .png, .webp)
    const coverInput = $('meta-cover-file-input');
    if (coverInput) {
      coverInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (metaEditorState.previewObjectUrl) {
          URL.revokeObjectURL(metaEditorState.previewObjectUrl);
        }
        metaEditorState.selectedCoverFile = file;
        metaEditorState.selectedCoverUrl = '';
        metaEditorState.previewObjectUrl = URL.createObjectURL(file);
        setMetaCoverPreview(metaEditorState.previewObjectUrl, `LOCAL FILE (${file.name})`);
        setMetaEditorStatus(`Selected local image "${file.name}" (${formatFileSize(file.size)}).`);
      });
    }

    on('meta-apply-cover-only-btn', 'click', submitUpdateCoverOnly);
    on('meta-save-all-btn', 'click', submitApplyFullMetadata);

    // Online Auto-Tag Search Form
    on('meta-online-search-form', 'submit', (e) => {
      e.preventDefault();
      runOnlineMetadataSearch();
    });

    // Source Filter Pills
    const filterGroup = $('meta-source-filters');
    if (filterGroup) {
      filterGroup.querySelectorAll('[data-meta-source]').forEach((btn) => {
        btn.addEventListener('click', () => {
          metaEditorState.sourceFilter = btn.getAttribute('data-meta-source') || 'all';
          filterGroup.querySelectorAll('[data-meta-source]').forEach((b) => {
            const active = b.getAttribute('data-meta-source') === metaEditorState.sourceFilter;
            b.className = active
              ? 'px-2 py-0.5 border border-emerald-400 bg-emerald-400/15 text-emerald-300'
              : 'px-2 py-0.5 border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-100';
          });
          renderOnlineMetadataResults();
        });
      });
    }

    // Optional Spotify Client Credentials panel
    const credsPanel = $('meta-spotify-creds-panel');
    const idInput = $('meta-spotify-client-id');
    const secretInput = $('meta-spotify-client-secret');
    if (idInput) idInput.value = localStorage.getItem('century.spotify_client_id') || '';
    if (secretInput) secretInput.value = localStorage.getItem('century.spotify_client_secret') || '';

    on('meta-spotify-creds-btn', 'click', () => {
      if (credsPanel) credsPanel.classList.toggle('hidden');
    });
    on('meta-spotify-save-btn', 'click', () => {
      const id = idInput?.value?.trim() || '';
      const secret = secretInput?.value?.trim() || '';
      localStorage.setItem('century.spotify_client_id', id);
      localStorage.setItem('century.spotify_client_secret', secret);
      if (credsPanel) credsPanel.classList.add('hidden');
      showToast('Saved Spotify API credentials for &market=JP auto-tagging');
    });

    window.addEventListener('keydown', (e) => {
      if (metaEditorState.active && e.key === 'Escape') {
        e.preventDefault();
        if (metaEditorState.dbPickerOpen) {
          toggleMetaDbDropdown(false);
          return;
        }
        closeMetadataEditor();
      }
    });
  }

  function navigateFilesUp() {
    if (!filesState.currentPath) return;
    const parts = filesState.currentPath.split('/').filter(Boolean);
    parts.pop();
    loadFilesView(parts.join('/'));
  }

  function initFilesEvents() {
    if (filesState.initialized) return;
    filesState.initialized = true;

    // Up button
    on('files-up-btn', 'click', navigateFilesUp);

    // New folder button
    on('files-new-folder-btn', 'click', createNewFolderPrompt);

    // Refresh button
    on('files-refresh-btn', 'click', () => loadFilesView());

    // Filter input: recursive search (BFS walk) when a query is set;
    // clearing it returns to the current folder's listing.
    const filterInput = $('files-filter-input');
    const filterClear = $('files-filter-clear');
    let filesSearchTimer = null;
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        filesState.filterQuery = e.target.value;
        if (filterClear) filterClear.classList.toggle('hidden', !e.target.value);
        if (filesSearchTimer) clearTimeout(filesSearchTimer);
        const q = filesState.filterQuery;
        if (!q.trim()) {
          filesState.searchResults = null;
          filesState.visibleCount = 100;
          renderFilesList();
          return;
        }
        filesSearchTimer = setTimeout(() => searchFilesRecursive(q), 300);
      });
    }
    if (filterClear) {
      filterClear.addEventListener('click', () => {
        if (filterInput) filterInput.value = '';
        filesState.filterQuery = '';
        filesState.searchResults = null;
        filesState.visibleCount = 100;
        filterClear.classList.add('hidden');
        renderFilesList();
      });
    }

    // Upload input (files)
    const uploadInput = $('files-upload-input');
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        if (e.target.files?.length) {
          uploadFiles(e.target.files);
          uploadInput.value = '';
        }
      });
    }

    // Upload folder input (webkitdirectory): the files carry
    // webkitRelativePath, which uploadFiles sends as the `paths` field so
    // the bridge recreates the folder structure.
    const uploadFolderInput = $('files-upload-folder-input');
    if (uploadFolderInput) {
      uploadFolderInput.addEventListener('change', (e) => {
        if (e.target.files?.length) {
          uploadFiles(e.target.files);
          uploadFolderInput.value = '';
        }
      });
    }

    // Incremental reveal: show the next 100 rows.
    on('files-show-more-btn', 'click', () => {
      filesState.visibleCount += 100;
      renderFilesList();
    });

    // Bridge recheck & URL save
    on('files-retry-bridge-btn', 'click', () => {
      checkFilesBridge().then((ok) => {
        if (ok) {
          showToast('File Bridge connected');
          loadFilesView();
        } else {
          showToast('Could not reach File Bridge', 'error');
        }
      });
    });

    const bridgeUrlInput = $('files-bridge-url-input');
    if (bridgeUrlInput) {
      bridgeUrlInput.value = filesState.bridgeUrl;
    }
    on('files-save-bridge-url-btn', 'click', () => {
      if (bridgeUrlInput && bridgeUrlInput.value.trim()) {
        filesState.bridgeUrl = bridgeUrlInput.value.trim();
        localStorage.setItem('century.nas_url', filesState.bridgeUrl);
        localStorage.setItem('century.file_bridge_url', filesState.bridgeUrl);
        showToast('Saved File Bridge URL');
        loadFilesView();
      }
    });

    // Drag and drop zone
    const dropzone = $('files-dropzone');
    const dragOverlay = $('files-drag-overlay');
    if (dropzone) {
      let dragCounter = 0;
      dropzone.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (dragOverlay) dragOverlay.classList.remove('hidden');
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      });
      dropzone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0 && dragOverlay) {
          dragCounter = 0;
          dragOverlay.classList.add('hidden');
        }
      });
      dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dragOverlay) dragOverlay.classList.add('hidden');

        try {
          // Ignore e.dataTransfer.files, iterate through e.dataTransfer.items and crawl via webkitGetAsEntry()
          showToast('Scanning dropped files and folders...');
          const files = await getFilesFromDataTransfer(e.dataTransfer);
          if (files && files.length > 0) {
            uploadFiles(files);
          } else {
            showToast('No files detected in drop', 'error');
          }
        } catch (err) {
          showToast(`Failed to read dropped files: ${err.message}`, 'error');
        }
      });
    }

    initImageViewerEvents();
    initMetadataEditorEvents();
    initYtmDownloaderEvents();
  }

  // ============================================================================
  // YTM Downloader Foundation & Cookie Management (Auth-Gated inside Files UI)
  // ============================================================================
  const ytmState = {
    expanded: localStorage.getItem('century.ytm_panel_expanded') === 'true',
    cookiesDrawerOpen: false,
    ytDlpAvailable: false,
    ytDlpVersion: null,
    cookies: null,
    jobs: [],
    liveLogs: [],
    eventSource: null,
    sseConnected: false,
    defaultMusicRelPath: 'Music',
    destMode: ['current', 'choose', 'auto'].includes(localStorage.getItem('century.ytm_dest_mode'))
      ? localStorage.getItem('century.ytm_dest_mode')
      : 'auto',
    chosenMusicSubPath: localStorage.getItem('century.ytm_chosen_dir') || '',
    format: localStorage.getItem('century.ytm_format') === 'm4a' ? 'm4a' : 'opus',
    folderPicker: {
      open: false,
      browsingSubPath: '',
      parentSubPath: '',
      isRoot: true,
      folders: [],
      newFolderOpen: false,
    },
    pollTimer: null,
    pausedAlertedJobIds: new Set(),
    completedSyncedJobIds: new Set(),
    busy: false,
    initialized: false,
  };

  function isPathInsideMusicRoot(relStoragePath) {
    const clean = normalizeSubsonicPath(relStoragePath || '');
    const musicRoot = normalizeSubsonicPath(ytmState.defaultMusicRelPath || 'Music');
    if (!musicRoot) return true;
    return (
      clean.toLowerCase() === musicRoot.toLowerCase() ||
      clean.toLowerCase().startsWith(`${musicRoot.toLowerCase()}/`)
    );
  }

  function syncYtmDestinationUI() {
    const mode = ytmState.destMode || 'auto';
    const previewEl = $('ytm-dest-preview-text');
    const browseBtn = $('ytm-open-folder-picker-btn');
    const musicRoot = normalizeSubsonicPath(ytmState.defaultMusicRelPath || 'Music') || 'Music';

    const modeButtons = [
      { id: 'ytm-dest-mode-current', key: 'current' },
      { id: 'ytm-dest-mode-choose', key: 'choose' },
      { id: 'ytm-dest-mode-auto', key: 'auto' },
    ];
    for (const item of modeButtons) {
      const btn = $(item.id);
      if (!btn) continue;
      const active = mode === item.key;
      btn.className = `h-8 px-2.5 border text-[11px] font-mono inline-flex items-center justify-center gap-1.5 transition-colors ${
        active
          ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300 font-semibold'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-zinc-100'
      }`;
    }

    if (browseBtn) {
      browseBtn.classList.toggle('hidden', mode !== 'choose');
    }

    if (previewEl) {
      if (mode === 'current') {
        const cur = normalizeSubsonicPath(filesState.currentPath || '');
        if (!cur) {
          previewEl.textContent = `Current folder is root — navigate into /${musicRoot} above to save here`;
          previewEl.className = 'text-[11px] font-mono text-amber-300 truncate';
        } else if (!isPathInsideMusicRoot(cur)) {
          previewEl.textContent = `/${cur} is outside /${musicRoot} — open /${musicRoot} or switch mode`;
          previewEl.className = 'text-[11px] font-mono text-amber-300 truncate';
        } else {
          previewEl.textContent = `Saving directly into: /${cur}`;
          previewEl.className = 'text-[11px] font-mono text-emerald-300 truncate';
        }
      } else if (mode === 'choose') {
        const chosen = normalizeSubsonicPath(ytmState.chosenMusicSubPath || '');
        const fullDisplay = chosen ? `/${musicRoot}/${chosen}` : `/${musicRoot}`;
        previewEl.textContent = `Selected custom folder: ${fullDisplay}`;
        previewEl.className = 'text-[11px] font-mono text-emerald-300 truncate';
      } else {
        previewEl.textContent = `Auto-Sort → /${musicRoot}/(Artist)/(Album or Single)/(Song) [Windows-safe]`;
        previewEl.className = 'text-[11px] font-mono text-zinc-400 truncate';
      }
    }
  }

  function setYtmDestMode(mode, { openPickerIfChoose = false } = {}) {
    const next = ['current', 'choose', 'auto'].includes(mode) ? mode : 'auto';
    ytmState.destMode = next;
    localStorage.setItem('century.ytm_dest_mode', next);
    syncYtmDestinationUI();
    if (next === 'choose' && openPickerIfChoose) {
      openYtmFolderPicker(ytmState.chosenMusicSubPath || '');
    }
  }

  function syncYtmFormatUI() {
    const fmt = ytmState.format === 'm4a' ? 'm4a' : 'opus';
    const opusBtn = $('ytm-format-btn-opus');
    const m4aBtn = $('ytm-format-btn-m4a');
    const hintEl = $('ytm-format-spec-hint');
    const subEl = $('ytm-format-subtext');

    if (opusBtn) {
      opusBtn.className = `h-9 px-2.5 border text-[11px] font-mono inline-flex items-center justify-center gap-1.5 transition-colors ${
        fmt === 'opus'
          ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300 font-semibold'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-zinc-100'
      }`;
    }
    if (m4aBtn) {
      m4aBtn.className = `h-9 px-2.5 border text-[11px] font-mono inline-flex items-center justify-center gap-1.5 transition-colors ${
        fmt === 'm4a'
          ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300 font-semibold'
          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-zinc-100'
      }`;
    }
    if (hintEl) {
      hintEl.textContent = fmt === 'm4a' ? '-f 141 · 256kbps AAC' : '-f 251 · High-Quality Opus';
    }
    if (subEl) {
      subEl.textContent =
        fmt === 'm4a'
          ? 'Format 141 · Safeguard ≤ 135kbps · Staged tags & cover'
          : 'Format 251 · Safeguard ≤ 70kbps · Staged tags & cover';
    }
  }

  function setYtmFormat(fmt) {
    ytmState.format = fmt === 'm4a' ? 'm4a' : 'opus';
    localStorage.setItem('century.ytm_format', ytmState.format);
    syncYtmFormatUI();
  }

  function formatYtmRelativeTime(ms) {
    if (!ms) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(ms).toLocaleDateString();
  }

  function updateYtmSseBadge() {
    const badge = $('ytm-sse-status-badge');
    if (!badge) return;
    if (ytmState.sseConnected) {
      badge.textContent = 'SSE: LIVE';
      badge.className =
        'px-1.5 py-0.2 text-[9.5px] font-mono border border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
    } else {
      badge.textContent = 'SSE: STANDBY';
      badge.className =
        'px-1.5 py-0.2 text-[9.5px] font-mono border border-zinc-700 bg-zinc-900 text-zinc-400';
    }
  }

  function renderYtmLiveLogs() {
    const outEl = $('ytm-live-log-output');
    if (!outEl) return;

    if (!ytmState.liveLogs || ytmState.liveLogs.length === 0) {
      outEl.innerHTML = `<div class="text-zinc-500">Waiting for download stream logs...</div>`;
      return;
    }

    outEl.innerHTML = ytmState.liveLogs
      .map((item) => {
        const timeStr = item.ts ? new Date(item.ts).toLocaleTimeString() : '';
        const cls =
          item.level === 'error'
            ? 'text-[#f0605a]'
            : item.level === 'warn'
              ? 'text-amber-300'
              : item.text?.startsWith('[AudioTagger]') || item.text?.startsWith('[Saved]') || item.text?.startsWith('[Completed]')
                ? 'text-emerald-300'
                : 'text-zinc-300';
        return `<div class="${cls} break-all"><span class="text-zinc-500">[${escapeHtml(timeStr)}]</span> ${escapeHtml(item.text || '')}</div>`;
      })
      .join('');
    outEl.scrollTop = outEl.scrollHeight;
  }

  function appendYtmLiveLog(entry) {
    if (!entry || !entry.text) return;
    const last = ytmState.liveLogs[ytmState.liveLogs.length - 1];
    // Update in-place if consecutive [download] % progress line
    if (
      last &&
      last.text?.startsWith('[download]') &&
      entry.text?.startsWith('[download]') &&
      entry.text.includes('%')
    ) {
      ytmState.liveLogs[ytmState.liveLogs.length - 1] = entry;
    } else {
      ytmState.liveLogs.push(entry);
      if (ytmState.liveLogs.length > 150) {
        ytmState.liveLogs.splice(0, ytmState.liveLogs.length - 150);
      }
    }
    renderYtmLiveLogs();
  }

  function syncNavidromeAfterYtmJob(job) {
    if (!job || !job.id) return;
    if (ytmState.completedSyncedJobIds.has(job.id)) return;
    ytmState.completedSyncedJobIds.add(job.id);

    client.request('startScan').catch(() => {});
    if (typeof client.bustCoverCache === 'function') {
      client.bustCoverCache();
    }
    artistAlbumCoverCache.clear();
    state.artists = null;
    state.songs = null;
    state.songsPromise = null;
    state.albumsByType = {};

    if (state.route === 'files') {
      loadFilesView();
    }
    showToast(
      `YTM download finished: ${job.completedTracks} track(s) saved to /${job.destRelPath} · Navidrome rescan triggered`
    );
  }

  function closeYtmSse() {
    if (ytmState.eventSource) {
      try {
        ytmState.eventSource.close();
      } catch (_) {}
      ytmState.eventSource = null;
    }
    ytmState.sseConnected = false;
    updateYtmSseBadge();
  }

  function ensureYtmSseConnected() {
    const apiKey = getFileBridgeApiKey();
    if (!filesState.isOnline || !apiKey || typeof EventSource === 'undefined') return;
    if (ytmState.eventSource && ytmState.eventSource.readyState !== EventSource.CLOSED) {
      return;
    }

    closeYtmSse();
    const sseUrl = `${getFileBridgeBase()}/api/ytm/events?apiKey=${encodeURIComponent(apiKey)}`;
    try {
      const es = new EventSource(sseUrl);
      ytmState.eventSource = es;

      es.onopen = () => {
        ytmState.sseConnected = true;
        updateYtmSseBadge();
      };

      es.onerror = () => {
        ytmState.sseConnected = false;
        updateYtmSseBadge();
      };

      es.addEventListener('init', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (Array.isArray(data.jobs)) {
            ytmState.jobs = data.jobs;
            if (ytmState.liveLogs.length === 0 && data.jobs[0]?.logs?.length) {
              ytmState.liveLogs = [...data.jobs[0].logs];
              renderYtmLiveLogs();
            }
            renderYtmJobs();
          }
        } catch (_) {}
      });

      es.addEventListener('job', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          const updatedJob = data.job;
          if (!updatedJob || !updatedJob.id) return;
          const idx = ytmState.jobs.findIndex((j) => j.id === updatedJob.id);
          if (idx >= 0) {
            ytmState.jobs[idx] = updatedJob;
          } else {
            ytmState.jobs.unshift(updatedJob);
          }
          renderYtmJobs();
        } catch (_) {}
      });

      es.addEventListener('log', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (data.log) {
            appendYtmLiveLog(data.log);
          }
          if (data.jobId && typeof data.currentTrackPercent === 'number') {
            const targetJob = ytmState.jobs.find((j) => j.id === data.jobId);
            if (targetJob) {
              targetJob.currentTrackPercent = data.currentTrackPercent;
              if (data.currentProgressLine) {
                targetJob.currentProgressLine = data.currentProgressLine;
              }
              renderYtmJobs();
            }
          }
        } catch (_) {}
      });

      es.addEventListener('completed', (ev) => {
        try {
          const data = JSON.parse(ev.data || '{}');
          if (data.job) {
            const idx = ytmState.jobs.findIndex((j) => j.id === data.job.id);
            if (idx >= 0) ytmState.jobs[idx] = data.job;
            else ytmState.jobs.unshift(data.job);
            renderYtmJobs();
            syncNavidromeAfterYtmJob(data.job);
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  function updateYtmAuthVisibility(online) {
    const section = $('ytm-downloader-section');
    if (!section) return;
    if (online && getFileBridgeApiKey()) {
      section.classList.remove('hidden');
      initYtmDownloaderEvents();
      syncYtmPanelCollapsedUI();
      ensureYtmSseConnected();
      refreshYtmStatus();
    } else {
      section.classList.add('hidden');
      closeYtmSse();
      if (ytmState.pollTimer) {
        clearTimeout(ytmState.pollTimer);
        ytmState.pollTimer = null;
      }
    }
  }

  function syncYtmPanelCollapsedUI() {
    const body = $('ytm-panel-body');
    const toggleBtn = $('ytm-panel-toggle-btn');
    const chevron = $('ytm-panel-chevron');
    const hint = $('ytm-toggle-hint');
    if (body) body.classList.toggle('hidden', !ytmState.expanded);
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(ytmState.expanded));
    if (chevron) chevron.style.transform = ytmState.expanded ? 'rotate(180deg)' : 'rotate(0deg)';
    if (hint) hint.textContent = ytmState.expanded ? 'COLLAPSE' : 'EXPAND';
  }

  function setYtmPanelExpanded(expanded) {
    ytmState.expanded = Boolean(expanded);
    localStorage.setItem('century.ytm_panel_expanded', String(ytmState.expanded));
    syncYtmPanelCollapsedUI();
  }

  function setYtmCookiesDrawerOpen(open) {
    ytmState.cookiesDrawerOpen = Boolean(open);
    const drawer = $('ytm-cookies-drawer');
    if (drawer) {
      drawer.classList.toggle('hidden', !ytmState.cookiesDrawerOpen);
      if (ytmState.cookiesDrawerOpen) {
        setTimeout(() => $('ytm-cookies-textarea')?.focus(), 50);
      }
    }
  }

  function renderYtmCookieStatus(cookies) {
    ytmState.cookies = cookies || null;
    const badge = $('ytm-cookies-status-badge');
    const metaText = $('ytm-cookies-meta-text');
    const warnText = $('ytm-cookies-warning-text');

    if (badge) {
      if (cookies?.active) {
        const updated = cookies.lastUpdated ? ` · ${formatYtmRelativeTime(cookies.lastUpdated)}` : '';
        badge.textContent = `Cookies: Active${updated}`;
        badge.className = 'px-2 py-0.5 text-[10px] font-mono border border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
      } else if (cookies?.exists) {
        badge.textContent = 'Cookies: Check / Expired';
        badge.className = 'px-2 py-0.5 text-[10px] font-mono border border-amber-500/40 bg-amber-950/30 text-amber-300';
      } else {
        badge.textContent = 'Cookies: Missing (128kbps)';
        badge.className = 'px-2 py-0.5 text-[10px] font-mono border border-zinc-700 bg-zinc-900 text-zinc-400';
      }
    }

    if (metaText) {
      if (cookies?.exists) {
        const lastStr = cookies.lastUpdated ? new Date(cookies.lastUpdated).toLocaleString() : 'Unknown';
        metaText.textContent = `Last Updated: ${lastStr} (${cookies.youtubeCookieCount || 0} YT cookies)`;
      } else {
        metaText.textContent = 'Not set — server will use free-tier quality unless cookies.txt is uploaded.';
      }
    }

    if (warnText) {
      if (cookies?.warning) {
        warnText.textContent = cookies.warning;
        warnText.classList.remove('hidden');
      } else {
        warnText.textContent = '';
        warnText.classList.add('hidden');
      }
    }
  }

  function renderYtmSafeguardBanner() {
    const banner = $('ytm-safeguard-banner');
    const titleEl = $('ytm-safeguard-title');
    const details = $('ytm-safeguard-details');
    const cancelBtn = $('ytm-safeguard-cancel-btn');
    const continueBtn = $('ytm-safeguard-continue-btn');
    if (!banner || !details) return;

    const pausedJob = (ytmState.jobs || []).find(
      (j) => j.status === 'paused_low_bitrate' && j.lowBitrateAlert
    );

    if (!pausedJob) {
      banner.classList.add('hidden');
      return;
    }

    // Ensure downloader panel is expanded so user immediately sees the safeguard prompt
    if (!ytmState.expanded) {
      setYtmPanelExpanded(true);
    }

    const alert = pausedJob.lowBitrateAlert;
    const isM4a = pausedJob.format === 'm4a';
    const thresh = alert.thresholdKbps || pausedJob.bitrateThresholdKbps || (isM4a ? 135 : 70);
    if (titleEl) {
      titleEl.textContent = `Low-Bitrate Safeguard Triggered (≤ ${thresh} kbps .${pausedJob.format}) — Queue Paused`;
    }

    const cookieHint = alert.cookiesWereUsed
      ? `Your server cookies.txt appears expired or lacked YouTube Music Premium auth, causing a low-bitrate fallback (≤ ${thresh} kbps for .${pausedJob.format}).`
      : `No active cookies.txt was present, so YouTube served a low-bitrate stream (≤ ${thresh} kbps for .${pausedJob.format}).`;

    details.innerHTML = `
      First track <strong class="text-zinc-100">${escapeHtml(alert.trackTitle)}</strong> streamed at
      <span class="px-1.5 py-0.5 font-mono bg-amber-950 border border-amber-500/40 text-amber-300 font-semibold">${escapeHtml(String(alert.bitrateKbps))} kbps</span>
      (≤ ${escapeHtml(String(thresh))} kbps threshold for .${escapeHtml(pausedJob.format)}). ${escapeHtml(cookieHint)}
      Remaining tracks are paused before committing <code class="text-zinc-300">${escapeHtml(alert.plannedFileName)}</code>.
    `;

    banner.classList.remove('hidden');

    if (!ytmState.pausedAlertedJobIds.has(pausedJob.id)) {
      ytmState.pausedAlertedJobIds.add(pausedJob.id);
      showToast(`Bitrate Safeguard: Paused "${alert.trackTitle}" (${alert.bitrateKbps} kbps)`, 'error');
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => cancelYtmJob(pausedJob.id, true, true);
    }
    if (continueBtn) {
      continueBtn.onclick = () => resumeYtmJob(pausedJob.id);
    }
  }

  function renderYtmJobs() {
    const container = $('ytm-jobs-container');
    const listEl = $('ytm-jobs-list');
    const summaryEl = $('ytm-jobs-summary');
    const queueBadge = $('ytm-queue-badge');
    const jobs = Array.isArray(ytmState.jobs) ? ytmState.jobs : [];

    const activeJobs = jobs.filter((j) =>
      j.status === 'queued' || j.status === 'inspecting' || j.status === 'downloading'
    );
    const pausedJob = jobs.find((j) => j.status === 'paused_low_bitrate');

    if (queueBadge) {
      if (pausedJob) {
        queueBadge.textContent = 'PAUSED: BITRATE SAFEGUARD';
        queueBadge.className = 'px-2 py-0.5 text-[10px] font-mono font-semibold border border-amber-500/50 bg-amber-950/40 text-amber-300';
        queueBadge.classList.remove('hidden');
      } else if (activeJobs.length > 0) {
        queueBadge.textContent = `${activeJobs.length} ACTIVE`;
        queueBadge.className = 'px-2 py-0.5 text-[10px] font-mono font-semibold border border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
        queueBadge.classList.remove('hidden');
      } else {
        queueBadge.classList.add('hidden');
      }
    }

    renderYtmSafeguardBanner();

    if (!container || !listEl) return;
    if (jobs.length === 0) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    if (summaryEl) {
      summaryEl.textContent = `${jobs.length} job(s)`;
    }

    listEl.innerHTML = '';
    for (const job of jobs) {
      const card = document.createElement('div');
      card.className = 'p-3 bg-zinc-950 border border-zinc-800 space-y-2';

      const trackFraction =
        job.status === 'downloading' && typeof job.currentTrackPercent === 'number'
          ? Math.min(0.99, Math.max(0, job.currentTrackPercent / 100))
          : 0;
      const pct =
        job.totalTracks > 0
          ? Math.min(100, Math.round(((job.completedTracks + trackFraction) / job.totalTracks) * 100))
          : job.status === 'completed'
            ? 100
            : 0;

      let statusLabel = String(job.status || '').toUpperCase();
      let statusCls = 'border-zinc-700 text-zinc-400 bg-zinc-900';
      if (job.status === 'downloading' || job.status === 'inspecting' || job.status === 'queued') {
        statusCls = 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30';
        if (job.status === 'inspecting') statusLabel = 'INSPECTING BITRATE...';
        else if (job.status === 'downloading') {
          const trkPctStr =
            typeof job.currentTrackPercent === 'number' && job.currentTrackPercent > 0
              ? ` (${Math.round(job.currentTrackPercent)}%)`
              : '';
          statusLabel = `DOWNLOADING ${job.currentTrackIndex || 0}/${job.totalTracks || '?'}${trkPctStr}`;
        }
      } else if (job.status === 'paused_low_bitrate') {
        statusCls = 'border-amber-500/50 text-amber-300 bg-amber-950/40';
        statusLabel = 'PAUSED (BITRATE SAFEGUARD)';
      } else if (job.status === 'completed') {
        statusCls = 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20';
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        statusCls = 'border-[#f0605a]/40 text-[#f0605a] bg-[#f0605a]/10';
      }

      const brThresh = job.bitrateThresholdKbps || (job.format === 'm4a' ? 135 : 70);
      const brBadge =
        job.detectedBitrateKbps > 0
          ? `<span class="px-1.5 py-0.5 text-[10px] font-mono border ${
              job.detectedBitrateKbps <= brThresh
                ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
            }">${escapeHtml(String(job.detectedBitrateKbps))} kbps</span>`
          : '';

      const stagedBadge =
        job.stagedMetadata && (job.stagedMetadata.artist || job.stagedMetadata.album || job.stagedMetadata.hasCover)
          ? `<span class="px-1.5 py-0.5 text-[10px] font-mono border border-emerald-500/30 bg-emerald-950/20 text-emerald-300">STAGED TAGS${job.stagedMetadata.hasCover ? ' + COVER' : ''}</span>`
          : '';

      const titleText =
        job.stagedMetadata?.album ||
        job.collectionTitle ||
        job.currentTrackTitle ||
        job.url;
      const canCancel =
        job.status === 'queued' ||
        job.status === 'inspecting' ||
        job.status === 'downloading' ||
        job.status === 'paused_low_bitrate';

      card.innerHTML = `
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="min-w-0 flex-1 space-y-0.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-1.5 py-0.5 text-[10px] font-mono border ${statusCls}">${escapeHtml(statusLabel)}</span>
              ${brBadge}
              ${stagedBadge}
              <span class="px-1.5 py-0.5 text-[10px] font-mono border border-zinc-800 bg-zinc-900 text-zinc-400">.${escapeHtml(job.format)}</span>
              <span class="text-[11px] font-mono text-zinc-400 truncate">→ /${escapeHtml(job.destRelPath || 'Music')}</span>
            </div>
            <p class="text-xs font-medium text-zinc-100 truncate">${escapeHtml(titleText)}</p>
            ${
              job.currentTrackTitle && (job.status === 'downloading' || job.status === 'inspecting')
                ? `<p class="text-[11px] font-mono text-zinc-400 truncate">Track ${job.currentTrackIndex}: ${escapeHtml(job.currentTrackTitle)}</p>`
                : ''
            }
            ${job.error ? `<p class="text-[11px] font-mono text-[#f0605a]">${escapeHtml(job.error)}</p>` : ''}
          </div>
          ${
            canCancel
              ? `<button type="button" data-ytm-cancel-id="${escapeHtml(job.id)}" class="h-7 px-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[10.5px] font-mono text-[#f0605a] shrink-0">ABORT</button>`
              : ''
          }
        </div>
        ${
          job.totalTracks > 0
            ? `<div class="h-1 bg-zinc-800 overflow-hidden"><div class="h-full ${
                job.status === 'paused_low_bitrate' ? 'bg-amber-400' : 'bg-emerald-400'
              } transition-all duration-200" style="width:${pct}%"></div></div>`
            : ''
        }
      `;

      const abortBtn = card.querySelector('[data-ytm-cancel-id]');
      if (abortBtn) {
        abortBtn.onclick = () => cancelYtmJob(job.id, job.status === 'paused_low_bitrate', false);
      }

      listEl.appendChild(card);

      // Refresh Files view & Navidrome library once when a job newly finishes
      if (
        job.status === 'completed' &&
        job.completedTracks > 0 &&
        !ytmState.completedSyncedJobIds.has(job.id)
      ) {
        syncNavidromeAfterYtmJob(job);
      }
    }
    renderYtmLiveLogs();
    refreshIcons();
  }

  async function refreshYtmStatus() {
    if (!filesState.isOnline || !getFileBridgeApiKey()) return;
    if (ytmState.pollTimer) {
      clearTimeout(ytmState.pollTimer);
      ytmState.pollTimer = null;
    }

    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/status`, {
        headers: getFileBridgeHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        $('ytm-downloader-section')?.classList.add('hidden');
        return;
      }
      if (!res.ok) return;

      const data = await res.json();
      ytmState.ytDlpAvailable = Boolean(data.ytDlp?.available);
      ytmState.ytDlpVersion = data.ytDlp?.version || null;
      ytmState.defaultMusicRelPath = data.defaultMusicRelPath || 'Music';
      ytmState.jobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (ytmState.liveLogs.length === 0 && ytmState.jobs[0]?.logs?.length) {
        ytmState.liveLogs = [...ytmState.jobs[0].logs];
      }
      ensureYtmSseConnected();
      syncYtmDestinationUI();

      const engineBadge = $('ytm-engine-badge');
      if (engineBadge) {
        if (ytmState.ytDlpAvailable) {
          engineBadge.textContent = `yt-dlp: ${ytmState.ytDlpVersion || 'Ready'}`;
          engineBadge.className = 'px-2 py-0.5 text-[10px] font-mono border border-zinc-700 bg-zinc-900 text-zinc-300';
        } else {
          engineBadge.textContent = 'yt-dlp: Not Found';
          engineBadge.className = 'px-2 py-0.5 text-[10px] font-mono border border-[#f0605a]/40 bg-[#f0605a]/10 text-[#f0605a]';
        }
      }

      renderYtmCookieStatus(data.cookies);
      renderYtmJobs();

      // Poll continuously while any job is running or paused
      const hasLiveJobs = ytmState.jobs.some(
        (j) =>
          j.status === 'queued' ||
          j.status === 'inspecting' ||
          j.status === 'downloading'
      );
      if (hasLiveJobs && state.route === 'files') {
        ytmState.pollTimer = setTimeout(refreshYtmStatus, 1800);
      }
    } catch (_) {}
  }

  async function saveYtmCookiesFromText(rawText) {
    const clean = String(rawText || '').trim();
    if (!clean) {
      showToast('Paste cookies.txt content or upload a cookies.txt file first', 'error');
      return;
    }
    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/cookies`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ content: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      renderYtmCookieStatus(data.cookies);
      const textarea = $('ytm-cookies-textarea');
      if (textarea) textarea.value = '';
      setYtmCookiesDrawerOpen(false);
      showToast('Saved persistent cookies.txt to server');
    } catch (err) {
      showToast(`Cookie save failed: ${err.message}`, 'error');
    }
  }

  async function saveYtmCookiesFromFile(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/cookies`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      renderYtmCookieStatus(data.cookies);
      const textarea = $('ytm-cookies-textarea');
      if (textarea) textarea.value = '';
      setYtmCookiesDrawerOpen(false);
      showToast(`Uploaded ${file.name} securely to server`);
    } catch (err) {
      showToast(`Cookie upload failed: ${err.message}`, 'error');
    }
  }

  async function deleteServerYtmCookies() {
    if (!confirm('Delete server/config/cookies.txt from the backend server?')) return;
    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/cookies`, {
        method: 'DELETE',
        headers: getFileBridgeHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      renderYtmCookieStatus(data.cookies);
      showToast('Deleted server cookies.txt');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  function closeYtmFolderPicker() {
    ytmState.folderPicker.open = false;
    $('ytm-folder-picker-modal')?.classList.add('hidden');
  }

  function setYtmPickerNewFolderOpen(open) {
    ytmState.folderPicker.newFolderOpen = Boolean(open);
    const form = $('ytm-fp-new-folder-form');
    if (form) {
      form.classList.toggle('hidden', !ytmState.folderPicker.newFolderOpen);
      if (ytmState.folderPicker.newFolderOpen) {
        setTimeout(() => $('ytm-fp-new-folder-input')?.focus(), 40);
      }
    }
  }

  async function loadYtmFolderPicker(musicSubPath = '') {
    const listEl = $('ytm-fp-list');
    const pathEl = $('ytm-fp-current-path');
    const upBtn = $('ytm-fp-up-btn');
    const statusEl = $('ytm-fp-status');
    const musicRoot = normalizeSubsonicPath(ytmState.defaultMusicRelPath || 'Music') || 'Music';

    if (listEl) {
      listEl.innerHTML = `
        <div class="p-6 flex items-center justify-center gap-2 text-xs font-mono text-zinc-400">
          <i data-lucide="loader-2" class="w-4 h-4 text-emerald-400 animate-spin"></i>
          <span>Loading folders...</span>
        </div>
      `;
      refreshIcons();
    }

    try {
      const res = await fetch(
        `${getFileBridgeBase()}/api/ytm/folders?path=${encodeURIComponent(musicSubPath || '')}`,
        { headers: getFileBridgeHeaders() }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      ytmState.folderPicker.browsingSubPath = data.musicSubPath || '';
      ytmState.folderPicker.parentSubPath = data.parentMusicSubPath || '';
      ytmState.folderPicker.isRoot = Boolean(data.isRoot);
      ytmState.folderPicker.folders = Array.isArray(data.folders) ? data.folders : [];

      if (pathEl) {
        pathEl.textContent = data.musicSubPath ? `/${musicRoot}/${data.musicSubPath}` : `/${musicRoot}`;
      }
      if (upBtn) {
        upBtn.disabled = Boolean(data.isRoot);
      }
      if (statusEl) {
        statusEl.textContent = `${ytmState.folderPicker.folders.length} subfolder(s)`;
      }

      if (!listEl) return;
      if (ytmState.folderPicker.folders.length === 0) {
        listEl.innerHTML = `
          <div class="p-8 text-center text-xs font-mono text-zinc-500">
            No subfolders here. Select this folder or create a new folder above.
          </div>
        `;
        return;
      }

      listEl.innerHTML = '';
      for (const folder of ytmState.folderPicker.folders) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'w-full px-4 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-zinc-900 transition-colors';
        row.innerHTML = `
          <div class="flex items-center gap-2.5 min-w-0">
            <i data-lucide="folder" class="w-4 h-4 text-emerald-400 shrink-0"></i>
            <span class="text-xs text-zinc-100 truncate">${escapeHtml(folder.name)}</span>
          </div>
          <i data-lucide="chevron-right" class="w-3.5 h-3.5 text-zinc-500 shrink-0"></i>
        `;
        row.onclick = () => loadYtmFolderPicker(folder.musicSubPath);
        listEl.appendChild(row);
      }
      refreshIcons();
    } catch (err) {
      if (listEl) {
        listEl.innerHTML = `<div class="p-6 text-center text-xs font-mono text-[#f0605a]">${escapeHtml(err.message)}</div>`;
      }
      if (statusEl) {
        statusEl.textContent = err.message;
      }
    }
  }

  async function openYtmFolderPicker(initialSubPath = '') {
    ytmState.folderPicker.open = true;
    setYtmPickerNewFolderOpen(false);
    $('ytm-folder-picker-modal')?.classList.remove('hidden');
    refreshIcons();
    await loadYtmFolderPicker(initialSubPath || ytmState.chosenMusicSubPath || '');
  }

  async function createYtmPickerSubfolder() {
    const input = $('ytm-fp-new-folder-input');
    const name = input?.value?.trim() || '';
    if (!name) return;

    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/folders`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          path: ytmState.folderPicker.browsingSubPath || '',
          name,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (input) input.value = '';
      setYtmPickerNewFolderOpen(false);
      showToast(`Created folder "${data.folder?.name || name}"`);
      await loadYtmFolderPicker(data.folder?.musicSubPath ?? ytmState.folderPicker.browsingSubPath);
    } catch (err) {
      showToast(`Create folder failed: ${err.message}`, 'error');
    }
  }

  async function submitYtmDownload() {
    const urlInput = $('ytm-url-input');
    const url = urlInput?.value?.trim() || '';
    if (!url) return;

    const destMode = ytmState.destMode || 'auto';
    let targetDir = '';
    if (destMode === 'current') {
      const cur = normalizeSubsonicPath(filesState.currentPath || '');
      if (!cur || !isPathInsideMusicRoot(cur)) {
        const musicRoot = normalizeSubsonicPath(ytmState.defaultMusicRelPath || 'Music') || 'Music';
        showToast(
          `Current Open Folder must be inside /${musicRoot}. Navigate into Music above or switch destination mode.`,
          'error'
        );
        return;
      }
      targetDir = cur;
    } else if (destMode === 'choose') {
      targetDir = ytmState.chosenMusicSubPath || '';
    }

    const format = ytmState.format === 'm4a' ? 'm4a' : 'opus';
    const submitBtn = $('ytm-submit-btn');
    const submitLabel = $('ytm-submit-label');
    if (submitBtn) submitBtn.disabled = true;
    if (submitLabel) submitLabel.textContent = 'FETCHING METADATA...';

    try {
      showToast('Fetching YouTube Music link metadata for staging...');
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/prepare`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      await openMetadataEditorForYtmStaging(data.staged, {
        url,
        destMode,
        targetDir,
        format,
      });
    } catch (err) {
      showToast(`Metadata staging failed: ${err.message}`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (submitLabel) submitLabel.textContent = 'STAGE & DOWNLOAD';
    }
  }

  async function resumeYtmJob(jobId) {
    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/jobs/${encodeURIComponent(jobId)}/resume`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      showToast('Resuming queue at available stream quality...');
      await refreshYtmStatus();
    } catch (err) {
      showToast(`Resume failed: ${err.message}`, 'error');
    }
  }

  async function cancelYtmJob(jobId, deleteLowBitrateFile = true, openCookiesUpdater = false) {
    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ deleteLowBitrateFile }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const deletedCount = Array.isArray(data.deletedFiles) ? data.deletedFiles.length : 0;
      if (openCookiesUpdater) {
        setYtmCookiesDrawerOpen(true);
        showToast(
          deletedCount > 0
            ? `Aborted & deleted low-bitrate file. Upload or paste fresh cookies.txt below.`
            : 'Aborted queue. Upload or paste fresh cookies.txt below.'
        );
      } else {
        showToast('Download job aborted');
      }
      await refreshYtmStatus();
    } catch (err) {
      showToast(`Cancel failed: ${err.message}`, 'error');
    }
  }

  function initYtmDownloaderEvents() {
    if (ytmState.initialized) return;
    ytmState.initialized = true;

    syncYtmPanelCollapsedUI();
    syncYtmDestinationUI();
    syncYtmFormatUI();

    on('ytm-panel-toggle-btn', 'click', () => {
      setYtmPanelExpanded(!ytmState.expanded);
    });

    on('ytm-cookies-toggle-btn', 'click', () => {
      setYtmCookiesDrawerOpen(!ytmState.cookiesDrawerOpen);
    });
    on('ytm-cookies-close-btn', 'click', () => setYtmCookiesDrawerOpen(false));
    on('ytm-cookies-save-btn', 'click', () => {
      saveYtmCookiesFromText($('ytm-cookies-textarea')?.value || '');
    });
    on('ytm-cookies-clear-btn', 'click', deleteServerYtmCookies);

    const cookieFileInput = $('ytm-cookies-file-input');
    if (cookieFileInput) {
      cookieFileInput.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await saveYtmCookiesFromFile(file);
        cookieFileInput.value = '';
      });
    }

    // Destination routing mode selector
    on('ytm-dest-mode-current', 'click', () => setYtmDestMode('current'));
    on('ytm-dest-mode-choose', 'click', () => setYtmDestMode('choose', { openPickerIfChoose: true }));
    on('ytm-dest-mode-auto', 'click', () => setYtmDestMode('auto'));
    on('ytm-open-folder-picker-btn', 'click', () => openYtmFolderPicker(ytmState.chosenMusicSubPath || ''));

    // Format toggle selector
    on('ytm-format-btn-opus', 'click', () => setYtmFormat('opus'));
    on('ytm-format-btn-m4a', 'click', () => setYtmFormat('m4a'));
    on('ytm-clear-logs-btn', 'click', () => {
      ytmState.liveLogs = [];
      renderYtmLiveLogs();
    });

    // Choose Folder modal events
    on('ytm-fp-close-btn', 'click', closeYtmFolderPicker);
    on('ytm-fp-cancel-btn', 'click', closeYtmFolderPicker);
    on('ytm-fp-up-btn', 'click', () => {
      if (!ytmState.folderPicker.isRoot) {
        loadYtmFolderPicker(ytmState.folderPicker.parentSubPath || '');
      }
    });
    on('ytm-fp-new-folder-toggle-btn', 'click', () => {
      setYtmPickerNewFolderOpen(!ytmState.folderPicker.newFolderOpen);
    });
    on('ytm-fp-new-folder-form', 'submit', (e) => {
      e.preventDefault();
      createYtmPickerSubfolder();
    });
    on('ytm-fp-select-btn', 'click', () => {
      ytmState.chosenMusicSubPath = ytmState.folderPicker.browsingSubPath || '';
      localStorage.setItem('century.ytm_chosen_dir', ytmState.chosenMusicSubPath);
      ytmState.destMode = 'choose';
      localStorage.setItem('century.ytm_dest_mode', 'choose');
      closeYtmFolderPicker();
      syncYtmDestinationUI();
    });

    const fpModal = $('ytm-folder-picker-modal');
    if (fpModal) {
      fpModal.addEventListener('click', (e) => {
        if (e.target === fpModal) closeYtmFolderPicker();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (ytmState.folderPicker.open && e.key === 'Escape') {
        e.preventDefault();
        closeYtmFolderPicker();
      }
    });

    on('ytm-download-form', 'submit', (e) => {
      e.preventDefault();
      submitYtmDownload();
    });
  }

  // ============================================================================
  // 3-Section Queue (Queue / Continue Playing / Autoplay) + Drag Reorder
  // ============================================================================
  let draggedQueueIdx = null;
  let lastQueueSignature = '';

  function queueSignature() {
    const q = audioEngine?.queue || [];
    const m = audioEngine?.queueMeta || [];
    return `${q.length}:${audioEngine?.currentIndex}:${audioEngine?.autoplay}:${audioEngine?.getBalancedShuffleEnabled?.()}:${q
      .map((s, i) => `${s.id}@${m[i]?.origin || 'c'}`)
      .join(',')}:${audioEngine?.currentSong?.id}`;
  }

  function createQueueRowElement(entry, totalLength) {
    const { song, index: idx, meta } = entry;
    const isCurrent = idx === audioEngine.currentIndex;
    const item = document.createElement('div');
    item.draggable = true;
    item.setAttribute('data-active', isCurrent ? 'true' : 'false');
    item.__song = song;
    item.__queueIdx = idx;
    item.className = `queue-row group flex items-center justify-between gap-2 px-3 py-2 text-xs border-b border-zinc-800/70 transition-colors ${
      isCurrent ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'
    }`;

    item.addEventListener('dragstart', (e) => {
      draggedQueueIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggedQueueIdx !== null && draggedQueueIdx !== idx) {
        audioEngine.moveQueueItem(draggedQueueIdx, idx);
        renderQueueViews(true);
      }
      draggedQueueIdx = null;
    });

    const whyBadge =
      meta?.origin === 'autoplay' && meta?.why
        ? `<div class="mt-0.5 flex items-center gap-1 text-[10px] font-mono text-emerald-400/90 truncate"><i data-lucide="sparkles" class="w-2.5 h-2.5 shrink-0"></i><span class="truncate">${escapeHtml(meta.why)}</span></div>`
        : '';

    const left = document.createElement('button');
    left.type = 'button';
    left.className = 'flex items-center gap-2.5 min-w-0 flex-1 text-left';
    left.innerHTML = `
      <span class="w-5 text-[10px] font-mono shrink-0 ${isCurrent ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}">${
        isCurrent ? '▶' : idx + 1
      }</span>
      <div class="min-w-0 flex-1">
        <div class="truncate font-medium ${isCurrent ? 'text-emerald-400' : 'text-zinc-100'}">${titleHtml(song.title || 'Untitled', song.artist)}</div>
        <div class="truncate text-[11px] text-zinc-400">${escapeHtml(song.artist || 'Unknown Artist')}</div>
        ${whyBadge}
      </div>`;
    left.addEventListener('click', () => audioEngine.loadAndPlayOnActiveDeck(song, idx));

    const right = document.createElement('div');
    right.className = 'flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100';
    const mk = (icon, label, onClick, disabled, extra = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.disabled = Boolean(disabled);
      b.className = `p-1 text-zinc-400 hover:text-zinc-100 ${extra}`;
      b.innerHTML = `<i data-lucide="${icon}" class="w-3.5 h-3.5"></i>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(e);
      });
      return b;
    };
    right.appendChild(mk('chevron-up', 'Move up', () => { audioEngine.moveQueueItem(idx, idx - 1); renderQueueViews(true); }, idx === 0));
    right.appendChild(mk('chevron-down', 'Move down', () => { audioEngine.moveQueueItem(idx, idx + 1); renderQueueViews(true); }, idx === totalLength - 1));
    right.appendChild(mk('more-vertical', 'Track options', (e) => openTrackContextMenu(e, song, idx)));
    right.appendChild(mk('x', 'Remove from queue', () => { audioEngine.removeFromQueue(idx); renderQueueViews(true); }, false, 'hover:!text-[#f0605a]'));

    item.appendChild(left);
    item.appendChild(right);
    return item;
  }

  function buildQueueList(container) {
    if (!container || !audioEngine) return;
    const q = audioEngine.queue || [];
    container.innerHTML = '';
    if (q.length === 0) {
      container.innerHTML =
        '<div class="p-6 text-center text-xs font-mono text-zinc-400">Queue is empty. Play any track, album, or start Personal Radio.</div>';
      return;
    }

    const sections = audioEngine.getQueueSections();
    const appendHeader = (title, subtitle = '', actionLabel = '', onAction = null) => {
      const head = document.createElement('div');
      head.className =
        'sticky top-0 z-10 px-3 py-1.5 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 flex items-center justify-between gap-2';
      const left = document.createElement('div');
      left.className = 'min-w-0';
      left.innerHTML = `
        <span class="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">${escapeHtml(title)}</span>
        ${subtitle ? `<span class="ml-1.5 text-[10px] font-mono text-zinc-500 truncate">${escapeHtml(subtitle)}</span>` : ''}`;
      head.appendChild(left);
      if (actionLabel && typeof onAction === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-[10px] font-mono text-zinc-400 hover:text-emerald-400 shrink-0';
        btn.textContent = actionLabel;
        btn.addEventListener('click', onAction);
        head.appendChild(btn);
      }
      container.appendChild(head);
    };

    if (sections.current) {
      appendHeader('Now Playing');
      container.appendChild(createQueueRowElement(sections.current, q.length));
    }

    if (sections.upNext.length > 0) {
      appendHeader('Queue', `${sections.upNext.length} added`, 'Clear', () => {
        audioEngine.clearUserQueue();
        renderQueueViews(true);
      });
      sections.upNext.forEach((entry) => container.appendChild(createQueueRowElement(entry, q.length)));
    }

    if (sections.continuePlaying.length > 0) {
      appendHeader(
        'Continue Playing',
        sections.contextName ? `From ${sections.contextName}` : `${sections.continuePlaying.length} tracks`
      );
      sections.continuePlaying.forEach((entry) => container.appendChild(createQueueRowElement(entry, q.length)));
    }

    if (sections.autoplay.length > 0) {
      appendHeader('Autoplay', 'Radio recommendations', 'Refresh', async () => {
        const seed = audioEngine.currentSong;
        if (!seed) return;
        const fresh = await generateRadioTracks(seed, 25, q.filter((_, i) => sections.autoplay.every((a) => a.index !== i)).map((s) => s.id));
        if (fresh.length > 0) {
          audioEngine.appendAutoplayTracks(fresh);
          renderQueueViews(true);
          showToast('Refreshed Autoplay tracks');
        }
      });
      sections.autoplay.forEach((entry) => container.appendChild(createQueueRowElement(entry, q.length)));
    } else if (audioEngine.autoplay && audioEngine.repeatMode === 'off' && sections.current) {
      const hint = document.createElement('div');
      hint.className = 'px-3 py-3 text-[11px] font-mono text-zinc-500 flex items-center justify-between gap-2';
      hint.innerHTML = '<span>Autoplay will continue with similar tracks when this queue ends.</span>';
      container.appendChild(hint);
    }

    queueTranslations(q.slice(0, 80).map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
    const currentRow = container.querySelector('[data-active="true"]');
    if (currentRow && typeof currentRow.scrollIntoView === 'function') {
      currentRow.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderQueueViews(force = false) {
    if (!audioEngine) return;
    const q = audioEngine.queue || [];
    const count = String(q.length);
    ['player-queue-count', 'queue-count-badge'].forEach((id) => $(id) && ($(id).textContent = count));
    if ($('np-tab-queue-label')) $('np-tab-queue-label').textContent = `Queue (${q.length})`;
    if ($('np-mobile-queue-label')) $('np-mobile-queue-label').textContent = `Queue (${q.length})`;
    setPressed($('queue-autoplay-btn'), Boolean(audioEngine.autoplay));
    setPressed($('queue-balanced-btn'), Boolean(audioEngine.getBalancedShuffleEnabled?.()));
    if ($('queue-context-label')) {
      $('queue-context-label').textContent = audioEngine.contextName ? `From ${audioEngine.contextName}` : '';
    }

    const sig = queueSignature();
    if (!force && sig === lastQueueSignature) return;
    lastQueueSignature = sig;

    if (state.queueOpen) {
      const total = q.reduce((acc, s) => acc + (s.duration || 0), 0);
      $('queue-total-duration').textContent = `${formatDuration(total)} total`;
      $('queue-footer-pos').textContent = q.length > 0 ? `Track ${audioEngine.currentIndex + 1} of ${q.length}` : 'Track 0 of 0';
      buildQueueList($('queue-items-list'));
    }
    if (state.route === 'now-playing') {
      if (state.npTab === 'queue') buildQueueList($('np-panel-queue'));
      if (state.npMobileOverlay === 'queue') buildQueueList($('np-mobile-overlay-body'));
    }
  }

  function toggleQueueDrawer(force) {
    const nextOpen = typeof force === 'boolean' ? force : !state.queueOpen;
    if (nextOpen === state.queueOpen) return;
    state.queueOpen = nextOpen;
    if (state.queueOpen && state.lyricsDrawerOpen) {
      state.lyricsDrawerOpen = false;
      if (window.PlenripAnimations?.closeDrawer) {
        window.PlenripAnimations.closeDrawer($('lyrics-drawer'), { keepBackdrop: true });
      } else {
        show($('lyrics-drawer'), false);
      }
      setPressed($('btn-lyrics-drawer'), false);
      updateLyricsVisibilityDependents();
    }
    const drawer = $('queue-drawer');
    if (drawer) drawer.style.transform = '';
    if (window.PlenripAnimations?.openDrawer && window.PlenripAnimations?.closeDrawer) {
      if (state.queueOpen) window.PlenripAnimations.openDrawer(drawer);
      else window.PlenripAnimations.closeDrawer(drawer, { keepBackdrop: state.lyricsDrawerOpen });
    } else {
      show(drawer, state.queueOpen);
    }
    setPressed($('btn-queue'), state.queueOpen);
    if (state.queueOpen) renderQueueViews(true);
  }

  function toggleLyricsDrawer(force) {
    const nextOpen = typeof force === 'boolean' ? force : !state.lyricsDrawerOpen;
    if (nextOpen === state.lyricsDrawerOpen) return;
    state.lyricsDrawerOpen = nextOpen;
    if (state.lyricsDrawerOpen && state.queueOpen) {
      state.queueOpen = false;
      if (window.PlenripAnimations?.closeDrawer) {
        window.PlenripAnimations.closeDrawer($('queue-drawer'), { keepBackdrop: true });
      } else {
        show($('queue-drawer'), false);
      }
      setPressed($('btn-queue'), false);
    }
    const drawer = $('lyrics-drawer');
    if (window.PlenripAnimations?.openDrawer && window.PlenripAnimations?.closeDrawer) {
      if (state.lyricsDrawerOpen) window.PlenripAnimations.openDrawer(drawer);
      else window.PlenripAnimations.closeDrawer(drawer, { keepBackdrop: state.queueOpen });
    } else {
      show(drawer, state.lyricsDrawerOpen);
    }
    setPressed($('btn-lyrics-drawer'), state.lyricsDrawerOpen);
    updateDrawerMeta();
    updateLyricsVisibilityDependents();
  }

  function updateDrawerMeta() {
    const song = audioEngine?.currentSong;
    $('ld-title').innerHTML = song ? titleHtml(song.title, song.artist) : 'No track selected';
    $('ld-artist').textContent = song ? song.artist || 'Unknown Artist' : '-';
    if (song) attachCoverImage($('ld-cover-img'), $('ld-cover-fallback'), song.coverArt || song.albumId, song.id, 120);
  }

  // ============================================================================
  // Track Context Menu
  // ============================================================================
  function openTrackContextMenu(event, song, queueIdx = null) {
    state.ctxSong = song;
    state.ctxQueueIndex = queueIdx;
    const menu = $('track-context-menu');
    if (!menu || !song) return;

    const starred = state.starredSongIds.has(song.id);
    $('ctx-star-label').textContent = starred ? 'Unstar Track' : 'Star Track';
    show($('ctx-remove-queue'), queueIdx !== null && queueIdx !== undefined);

    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    const srcRect = event.currentTarget?.getBoundingClientRect?.();
    let x = event.clientX || (srcRect ? srcRect.left : 20);
    let y = event.clientY || (srcRect ? srcRect.bottom : 20);
    if (x + rect.width > window.innerWidth - 12) x = window.innerWidth - rect.width - 12;
    if (y + rect.height > window.innerHeight - 12) y = Math.max(12, window.innerHeight - rect.height - 12);
    menu.style.left = `${Math.max(12, x)}px`;
    menu.style.top = `${y}px`;
    window.PlenripAnimations?.openContextMenu?.(menu);
    refreshIcons();
  }

  function closeTrackContextMenu() {
    const menu = $('track-context-menu');
    if (window.PlenripAnimations?.closeContextMenu) {
      window.PlenripAnimations.closeContextMenu(menu);
    } else {
      show(menu, false);
    }
    state.ctxSong = null;
    state.ctxQueueIndex = null;
  }

  // ============================================================================
  // OKLCH 3-Blob Ambient Mesh Helper (Now Playing & Signature Room)
  // ============================================================================
  async function applyAmbientMeshForSong(song, prefix) {
    const layerA = $(`${prefix}-ambient-mesh-a`);
    const layerB = $(`${prefix}-ambient-mesh-b`);
    if (!layerA || !layerB || !song) return;
    const D = window.PlenripDiscovery;
    if (!D?.getAmbientPalette) return;

    const coverId = song.coverArt || song.albumId || song.id;
    if (!coverId) return;
    const url = client.getCoverArtUrl(coverId, 160);
    const pal = await D.getAmbientPalette(coverId, url).catch(() => null);
    if (!pal || audioEngine?.currentSong?.id !== song.id) return;

    const stateKey = prefix === 'sig' ? 'sigMeshUseB' : 'npMeshUseB';
    const nextUseB = !state[stateKey];
    state[stateKey] = nextUseB;
    const incoming = nextUseB ? layerB : layerA;
    const outgoing = nextUseB ? layerA : layerB;

    const blobs = incoming.querySelectorAll('.ambient-blob');
    if (blobs[0]) blobs[0].style.backgroundColor = pal.vibrant?.oklch || pal.vibrant?.hex || 'var(--primary)';
    if (blobs[1]) blobs[1].style.backgroundColor = pal.secondary?.oklch || pal.secondary?.hex || 'var(--card)';
    if (blobs[2]) blobs[2].style.backgroundColor = pal.base?.oklch || pal.base?.hex || 'var(--background)';

    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
  }

  // ============================================================================
  // Lyrics (Shared Renderer + Manual-Scroll "Back to current line" Pill)
  // ============================================================================
  const JP_REGEX = /[\u3040-\u30ff\u4e00-\u9fff]/;

  const lyricViews = [
    {
      key: 'drawer', container: 'ld-lyrics-scroll', modeGroup: 'ld-lyrics-mode-group',
      preparing: 'ld-lyrics-preparing', searchBtn: 'ld-lyrics-search-btn', backPill: 'ld-lyrics-back-pill', size: 'text-sm',
      visible: () => state.lyricsDrawerOpen, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'np', container: 'np-lyrics-scroll', modeGroup: 'np-lyrics-mode-group',
      preparing: 'np-lyrics-preparing', searchBtn: 'np-lyrics-search-btn', backPill: 'np-lyrics-back-pill', size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npTab === 'lyrics' && window.innerWidth >= 1024, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'npm', container: 'np-mobile-overlay-body', modeGroup: 'np-mobile-lyrics-mode-group',
      size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npMobileOverlay === 'lyrics' && window.innerWidth < 1024, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'sig', container: 'signature-lyrics-container', modeGroup: 'sig-lyrics-mode-group',
      preparing: 'sig-lyrics-preparing', backPill: 'sig-lyrics-back-pill', size: 'text-2xl md:text-3xl',
      visible: () => state.signatureOpen, lastIdx: -2, manualScrollUntil: 0,
    },
  ];

  function updateBackPillVisibility(view) {
    if (!view?.backPill) return;
    const pill = $(view.backPill);
    if (!pill) return;
    const paused = lyricsManager.getManualScrollPause() && Date.now() < view.manualScrollUntil && view.visible();
    pill.classList.toggle('hidden', !paused);
    pill.classList.toggle('inline-flex', paused);
  }

  function resumeLyricsAutoScroll(viewKey) {
    const view = lyricViews.find((v) => v.key === viewKey);
    if (!view) return;
    view.manualScrollUntil = 0;
    updateBackPillVisibility(view);
    const container = $(view.container);
    const activeEl = container?.querySelector('.lyric-line-active');
    if (container && activeEl) scrollLineIntoCenter(container, activeEl);
  }

  document.addEventListener('wheel', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const view = lyricViews.find((v) => target.closest(`#${v.container}`));
    if (view && lyricsManager.getManualScrollPause()) {
      view.manualScrollUntil = Date.now() + 5000;
      updateBackPillVisibility(view);
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const view = lyricViews.find((v) => target.closest(`#${v.container}`));
    if (view && lyricsManager.getManualScrollPause()) {
      view.manualScrollUntil = Date.now() + 5000;
      updateBackPillVisibility(view);
    }
  }, { passive: true });

  function anyLyricsVisible() {
    return lyricViews.some((v) => v.visible());
  }

  function getDisplayLines() {
    const L = state.lyrics;
    const res = L.result;
    if (!res || !Array.isArray(res.lines)) return [];
    return res.lines;
  }

  function buildWordSegments(line, nextLineStart) {
    const words = Array.isArray(line.words) ? line.words : [];
    const segments = [];
    if (words.length === 0) return segments;
    if (words.length === 1 && words[0].text && [...words[0].text].length > 1) {
      const chars = [...words[0].text];
      const w = words[0];
      const start = w.t;
      const end = w.end ?? nextLineStart ?? w.t + 2;
      const dur = Math.max(0.08, end - start);
      chars.forEach((ch, i) => {
        const segStart = start + (dur * i) / chars.length;
        const segEnd = start + (dur * (i + 1)) / chars.length;
        segments.push({ text: ch, t: segStart, end: segEnd, trailingSpace: '' });
      });
      return segments;
    }
    words.forEach((w, i) => {
      const next = words[i + 1];
      const end = w.end ?? (next ? next.t : nextLineStart) ?? w.t + 0.2;
      segments.push({
        text: w.text,
        t: w.t,
        end: Math.max(w.t + 0.08, end),
        trailingSpace: JP_REGEX.test(w.text) ? '' : ' ',
      });
    });
    return segments;
  }

  function normalizeLyricsText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\s\p{P}]/gu, '');
  }

  function canRomanizeLine(text) {
    return JP_REGEX.test(String(text || ''));
  }

  const NON_LATIN_REGEX = /[\u3040-\u30ff\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0900-\u097f]/;
  function canTranslateLine(text) {
    return NON_LATIN_REGEX.test(String(text || ''));
  }

  function getRomajiSubline(lineIdx) {
    const L = state.lyrics;
    if (!lyricsManager.getShowRomaji()) return null;
    if (!L.romaji || L.romaji.length !== L.result?.lines?.length) return null;
    const line = L.result.lines[lineIdx];
    const romaji = L.romaji[lineIdx]?.text ?? '';
    if (!romaji || !canRomanizeLine(line?.text || '')) return null;
    if (normalizeLyricsText(romaji) === normalizeLyricsText(line.text)) return null;
    return romaji;
  }

  function getTranslatedSubline(lineIdx) {
    const L = state.lyrics;
    if (!lyricsManager.getShowTranslated()) return null;
    if (!L.en || L.en.length !== L.result?.lines?.length) return null;
    const line = L.result.lines[lineIdx];
    const en = L.en[lineIdx]?.text ?? '';
    if (!en || !canTranslateLine(line?.text || '')) return null;
    if (normalizeLyricsText(en) === normalizeLyricsText(line.text)) return null;
    return en;
  }

  async function ensureLyrics(force = false) {
    const song = audioEngine?.currentSong;
    const L = state.lyrics;
    if (!song) {
      L.trackId = null;
      L.result = null;
      renderAllLyrics();
      return;
    }
    if (!force && L.trackId === song.id && (L.result || L.loading)) {
      renderAllLyrics();
      return;
    }

    L.trackId = song.id;
    L.loading = true;
    L.result = null;
    L.romaji = null;
    L.en = null;
    L.preparing = false;
    L.activeIdx = -1;
    renderAllLyrics();

    const res = await lyricsManager.resolveLyrics({
      trackId: song.id,
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      durationSeconds: song.duration || 0,
    });
    if (audioEngine?.currentSong?.id !== song.id) return;
    L.loading = false;
    L.result = res;
    renderAllLyrics();
    if (res.status === 'ok' && res.lines && hasJapaneseScript(res.lines)) {
      lyricsManager.migrateLegacyTrackMode(song.id);
      if (lyricsManager.getShowRomaji() || lyricsManager.getShowTranslated()) {
        prepareReadings();
      }
    }
  }

  async function prepareReadings() {
    const L = state.lyrics;
    const song = audioEngine?.currentSong;
    if (!song || !L.result?.lines || L.preparing) return;
    if (L.romaji && L.en) return;
    const res = L.result;
    if (!L.romaji && Array.isArray(res.romajiLines) && res.romajiLines.length === res.lines.length) {
      L.romaji = res.lines.map((l, i) => ({ t: l.t, timeSeconds: l.timeSeconds ?? l.t, text: res.romajiLines[i] ?? '' }));
    }
    if (!L.en && Array.isArray(res.translationLines) && res.translationLines.length === res.lines.length) {
      L.en = res.lines.map((l, i) => ({ t: l.t, timeSeconds: l.timeSeconds ?? l.t, text: res.translationLines[i] ?? '' }));
    }
    if (L.romaji && L.en) {
      renderAllLyrics();
      return;
    }
    L.preparing = true;
    renderAllLyrics();
    let { romaji, en } = await lyricsManager.deriveReadings(L.result.lines, song.id);
    if (!romaji || !en) {
      const fallback = await processJapaneseLyrics(L.result.lines, song.id);
      romaji = romaji || fallback.romaji;
      en = en || fallback.en;
    }
    if (audioEngine?.currentSong?.id !== song.id) return;
    L.romaji = romaji || L.romaji;
    L.en = en || L.en;
    L.preparing = false;
    renderAllLyrics();
  }

  function toggleLyricsPref(kind) {
    const song = audioEngine?.currentSong;
    if (!song) return;
    if (kind === 'romaji') {
      const next = !lyricsManager.getShowRomaji();
      lyricsManager.setShowRomaji(next);
      if (next) prepareReadings();
    } else if (kind === 'translated') {
      const next = !lyricsManager.getShowTranslated();
      lyricsManager.setShowTranslated(next);
      if (next) prepareReadings();
    }
    renderAllLyrics();
  }

  function renderAllLyrics() {
    lyricViews.forEach((v) => {
      v.lastIdx = -2;
      if (v.visible()) renderLyricsInto(v);
      updateBackPillVisibility(v);
    });
    updateSignatureLyricsChrome();
    syncLyrics(true);
  }

  function updateLyricsVisibilityDependents() {
    if (anyLyricsVisible()) ensureLyrics(false);
    updateDrawerMeta();
  }

  function renderLyricsInto(view) {
    const container = $(view.container);
    if (!container) return;
    const L = state.lyrics;
    const song = audioEngine?.currentSong;
    const res = L.result;
    const synced = res?.status === 'ok' && res.kind === 'synced' && Array.isArray(res.lines) && res.lines.length > 0;

    const group = $(view.modeGroup);
    if (group) {
      const showToggles = synced && hasJapaneseScript(res.lines);
      group.classList.toggle('hidden', !showToggles);
      if (showToggles) group.classList.add('flex');
      group.querySelectorAll('[data-lyrics-toggle]').forEach((b) => {
        const kind = b.getAttribute('data-lyrics-toggle');
        const on = kind === 'romaji' ? lyricsManager.getShowRomaji() : lyricsManager.getShowTranslated();
        setModeButton(b, on);
      });
    }
    if (view.preparing) show($(view.preparing), L.preparing);

    const message = (text, extra = '') => {
      container.innerHTML = `<div class="h-full min-h-[8rem] flex flex-col items-center justify-center text-center gap-3 p-6 text-sm font-mono text-zinc-400">${text}${extra}</div>`;
    };

    if (!song) return message('Play a track to load synchronized lyrics.');
    if (L.loading) return message('Searching lyrics providers...');

    if (!res || res.status !== 'ok' || (!res.lines?.length && !res.plainText)) {
      message(
        res?.status === 'unreachable'
          ? 'Lyrics providers could not be reached.'
          : `No lyrics found for "${escapeHtml(song.title)}".`,
        '<button type="button" data-open-lyrics-source class="px-3 py-1.5 bg-zinc-800 border border-zinc-600 hover:border-emerald-400 text-xs font-mono text-zinc-100">Lyric search</button>'
      );
      container.querySelector('[data-open-lyrics-source]')?.addEventListener('click', openLyricsSourceModal);
      return;
    }

    if (!synced) {
      container.innerHTML = `<div class="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200 p-4">${escapeHtml(res.plainText || '')}</div>`;
      return;
    }

    const lines = getDisplayLines();
    const wordSweep = lyricsManager.getWordSweep();
    const splitBg = lyricsManager.getSplitBackground();
    container.innerHTML = '<div class="py-[30%]"></div>';
    const wrap = container.firstElementChild;
    lines.forEach((line, idx) => {
      const el = document.createElement('div');
      el.setAttribute('data-idx', String(idx));
      const isBg = Boolean(line.isBG) && splitBg;
      const parentIdx = isBg ? findBgParentIndex(lines, idx) : -1;
      const renderAsBg = isBg && parentIdx >= 0;
      if (renderAsBg) {
        el.setAttribute('data-parent', String(parentIdx));
        el.className = 'lyric-line lyric-line-bg cursor-pointer px-4 leading-snug';
      } else {
        el.className = `lyric-line cursor-pointer px-4 py-2 leading-snug text-zinc-400 hover:text-zinc-100 ${view.size}`;
      }
      if (wordSweep && line.words && line.words.length > 0) {
        const primary = document.createElement('span');
        primary.className = 'block';
        primary.setAttribute('data-lyrics-primary', 'original');
        buildWordSegments(line, lines[idx + 1]?.t).forEach((seg) => {
          const wrapEl = document.createElement('span');
          wrapEl.className = 'lyric-word-wrap';
          wrapEl.setAttribute('data-word-span', 'true');
          wrapEl.setAttribute('data-t', String(seg.t));
          wrapEl.setAttribute('data-end', String(seg.end));
          const base = document.createElement('span');
          base.className = 'lyric-word-base';
          base.textContent = seg.text;
          const fill = document.createElement('span');
          fill.className = 'lyric-word-fill';
          fill.setAttribute('data-word-fill', 'true');
          fill.setAttribute('aria-hidden', 'true');
          fill.textContent = seg.text;
          wrapEl.appendChild(base);
          wrapEl.appendChild(fill);
          primary.appendChild(wrapEl);
          if (seg.trailingSpace) primary.appendChild(document.createTextNode(seg.trailingSpace));
        });
        el.appendChild(primary);
      } else {
        const primary = document.createElement('span');
        primary.className = 'block';
        primary.setAttribute('data-lyrics-primary', 'original');
        primary.textContent = line.text || '♪';
        el.appendChild(primary);
      }
      const romajiText = getRomajiSubline(idx);
      if (romajiText !== null) {
        const sub = document.createElement('span');
        sub.className = 'lyric-subline lyric-subline-romaji';
        sub.setAttribute('data-lyrics-subline', 'romaji');
        sub.textContent = romajiText;
        el.appendChild(sub);
      }
      const enText = getTranslatedSubline(idx);
      if (enText !== null) {
        const sub = document.createElement('span');
        sub.className = 'lyric-subline lyric-subline-translated';
        sub.setAttribute('data-lyrics-subline', 'translated');
        sub.textContent = enText;
        el.appendChild(sub);
      }
      el.addEventListener('click', () => {
        const offset = lyricsManager.getTrackOffset(L.trackId);
        const seekTo = renderAsBg ? (lines[parentIdx].timeSeconds ?? lines[parentIdx].t ?? line.timeSeconds) : line.timeSeconds;
        view.manualScrollUntil = 0;
        updateBackPillVisibility(view);
        audioEngine.seek(Math.max(0, seekTo - offset));
      });
      wrap.appendChild(el);
    });
    const dots = document.createElement('div');
    dots.className = 'lyric-dots hidden px-4 py-2';
    dots.setAttribute('role', 'status');
    dots.innerHTML = '<span class="lyric-dot"></span><span class="lyric-dot"></span><span class="lyric-dot"></span>';
    wrap.appendChild(dots);
  }

  function scrollLineIntoCenter(container, el) {
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const top = container.scrollTop + (eRect.top - cRect.top) - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function syncLyrics(force = false) {
    const L = state.lyrics;
    const res = L.result;
    const song = audioEngine?.currentSong;
    if (!song || !res || res.kind !== 'synced' || !Array.isArray(res.lines) || L.trackId !== song.id) return;

    const lines = getDisplayLines();
    const deck = audioEngine.getActiveDeck();
    const time = (deck.currentTime || audioEngine.currentTime || 0) + lyricsManager.getTrackOffset(song.id);
    const idx = findActiveLeadIndex(lines, time);
    L.activeIdx = idx;
    const gaps = findInstrumentalGaps(lines, song.duration || 0);
    const gap = gaps.find((g) => time >= g.start && time < g.end) || null;

    for (const view of lyricViews) {
      if (!view.visible()) continue;
      updateBackPillVisibility(view);
      const container = $(view.container);
      if (!container) continue;
      const els = container.querySelectorAll('.lyric-line');
      if (els.length === 0) continue;

      if (view.lastIdx !== idx || force) {
        const hidePlayed = lyricsManager.getHidePlayed();
        const hideUpcoming = lyricsManager.getHideUpcoming();
        els.forEach((el, i) => {
          const active = i === idx;
          el.classList.toggle('lyric-line-active', active);
          el.classList.toggle('hidden', (hidePlayed && i < idx) || (hideUpcoming && i > idx));
          const isBgLine = el.classList.contains('lyric-line-bg');
          el.classList.toggle('text-zinc-400', !active && !isBgLine && !el.querySelector('[data-word-span]'));
          if (el.classList.contains('lyric-line-bg')) {
            const parent = parseInt(el.getAttribute('data-parent') || '-1', 10);
            el.classList.toggle('lyric-line-bg-open', parent === idx);
          }
          if (!active) {
            const revealed = i < idx;
            el.querySelectorAll('[data-word-span]').forEach((wrapEl) => {
              const fill = wrapEl.querySelector('[data-word-fill]');
              if (fill) fill.style.clipPath = revealed ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)';
            });
          }
        });
        if (idx >= 0 && els[idx]) {
          const paused = lyricsManager.getManualScrollPause() && Date.now() < view.manualScrollUntil;
          if (!paused) scrollLineIntoCenter(container, els[idx]);
        }
        view.lastIdx = idx;
      }

      const dots = container.querySelector('.lyric-dots');
      if (dots) {
        const isIntroGap = gap && gap.afterLineIndex === -1;
        if (gap && ((idx >= 0 && els[idx]) || isIntroGap)) {
          const progress = Math.max(0, Math.min(1, (time - gap.start) / Math.max(0.01, gap.end - gap.start)));
          const filled = Math.min(3, Math.round(progress * 3));
          dots.classList.remove('hidden');
          dots.setAttribute('aria-label', `Instrumental break, ${filled} of 3`);
          dots.querySelectorAll('.lyric-dot').forEach((d, di) => {
            d.classList.toggle('lyric-dot-filled', di < filled);
          });
          if (isIntroGap) {
            if (els[0] && els[0].previousElementSibling !== dots) els[0].before(dots);
          } else if (els[idx].nextElementSibling !== dots) {
            els[idx].after(dots);
          }
        } else {
          dots.classList.add('hidden');
          dots.removeAttribute('aria-label');
        }
      }

      const activeEl = idx >= 0 ? els[idx] : null;
      if (activeEl) {
        activeEl.querySelectorAll('[data-word-span]').forEach((wrapEl) => {
          const fill = wrapEl.querySelector('[data-word-fill]');
          if (!fill) return;
          const start = parseFloat(wrapEl.getAttribute('data-t') || '0');
          const end = parseFloat(wrapEl.getAttribute('data-end') || '0');
          const progress = Math.max(0, Math.min(1, (time - start) / Math.max(0.04, end - start)));
          fill.style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`;
        });
      }
    }
  }

  function lyricsFrameLoop() {
    if (audioEngine?.isPlaying && anyLyricsVisible()) syncLyrics(false);
    requestAnimationFrame(lyricsFrameLoop);
  }

  // ============================================================================
  // Listening Room (Fullscreen Signature View + OKLCH Ambient Mesh)
  // ============================================================================
  let sigIdleTimer = null;

  function wakeSignatureChrome() {
    const modal = $('signature-modal');
    if (!modal) return;
    modal.classList.remove('signature-idle');
    if (sigIdleTimer) clearTimeout(sigIdleTimer);
    if (state.signatureOpen) {
      sigIdleTimer = setTimeout(() => modal.classList.add('signature-idle'), 4000);
    }
  }

  function openSignatureView() {
    state.signatureOpen = true;
    const modal = $('signature-modal');
    if (window.PlenripAnimations?.openSignatureModal) {
      window.PlenripAnimations.openSignatureModal(modal);
    } else {
      show(modal, true);
    }
    updateSignatureMetadataUI(true);
    wakeSignatureChrome();
    ensureLyrics(false);
    renderAllLyrics();
    refreshIcons();
  }

  function closeSignatureView() {
    if (!state.signatureOpen && $('signature-modal')?.classList.contains('hidden')) return;
    state.signatureOpen = false;
    const modal = $('signature-modal');
    modal?.classList.remove('signature-idle');
    if (sigIdleTimer) clearTimeout(sigIdleTimer);
    if (window.PlenripAnimations?.closeSignatureModal) {
      window.PlenripAnimations.closeSignatureModal(modal);
    } else {
      show(modal, false);
    }
    closeLyricsSourceModal();
  }

  let lastSigCoverId = null;

  function updateLyricsOffsetDisplays() {
    const song = audioEngine?.currentSong;
    const offset = song ? lyricsManager.getTrackOffset(song.id) : 0;
    const text = `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}s`;
    const sig = $('sig-offset-value');
    if (sig) sig.textContent = text;
    const np = $('np-offset-value');
    if (np) np.textContent = text;
    const npControls = $('np-offset-controls');
    if (npControls) {
      const showNp = Boolean(song) && state.route === 'now-playing' && state.npTab === 'lyrics';
      npControls.classList.toggle('hidden', !showNp);
      npControls.classList.toggle('flex', showNp);
    }
  }

  function updateSignatureMetadataUI(force = false) {
    const song = audioEngine?.currentSong;
    if (!$('sig-title')) return;
    if (!song) {
      $('sig-title').textContent = 'No Track Playing';
      $('sig-artist').textContent = '-';
      $('sig-album').textContent = '';
      return;
    }
    $('sig-title').innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
    $('sig-artist').textContent = song.artist || 'Unknown Artist';
    $('sig-album').textContent = song.album || '';
    const offset = lyricsManager.getTrackOffset(song.id);
    $('sig-offset-value').textContent = `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}s`;

    if (force || lastSigCoverId !== song.id) {
      const shouldFade = !force && lastSigCoverId !== null && lastSigCoverId !== song.id;
      lastSigCoverId = song.id;
      attachCoverImage($('sig-cover-img'), $('sig-cover-fallback'), song.coverArt || song.albumId, song.id, 600, {
        animateFade: shouldFade,
      });
      const backdrop = $('sig-backdrop-art');
      const coverId = song.coverArt || song.albumId;
      if (backdrop && coverId) {
        backdrop.style.backgroundImage = `url("${client.getCoverArtUrl(coverId, 300)}")`;
        backdrop.style.backgroundSize = 'cover';
        backdrop.style.backgroundPosition = 'center';
      }
      void applyAmbientMeshForSong(song, 'sig');
    }
  }

  function updateSignatureLyricsChrome() {
    const badge = $('sig-provider-badge');
    const offsetControls = $('sig-offset-controls');
    if (!badge) return;
    const L = state.lyrics;
    const res = L.result;
    if (L.loading) badge.textContent = 'LOADING...';
    else if (!res || res.status !== 'ok') badge.textContent = res ? `${(res.providerName || 'AUTO').toUpperCase()} · NOT FOUND` : 'AUTO';
    else {
      const kind = res.hasWordSync ? 'WORD SYNC' : res.kind === 'synced' ? 'SYNCED' : 'PLAIN';
      badge.textContent = `${res.providerName.toUpperCase()} · ${kind}`;
    }
    const synced = res?.status === 'ok' && res.kind === 'synced';
    if (offsetControls) {
      offsetControls.classList.toggle('hidden', !synced);
      if (synced) offsetControls.classList.add('flex');
    }
  }

  // ============================================================================
  // Lyrics Source Modal (7 Providers + Manual LRCLIB Search)
  // ============================================================================
  function currentLyricsRequest(song) {
    return {
      trackId: song.id,
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      durationSeconds: song.duration || 0,
    };
  }

  function openLyricsSourceModal() {
    const song = audioEngine?.currentSong;
    if (!song) {
      showToast('Play a track first to configure its lyrics source.');
      return;
    }
    state.lyricsSourceModalOpen = true;
    const modal = $('lyrics-source-modal');
    if (window.PlenripAnimations?.openModal) {
      window.PlenripAnimations.openModal(modal);
    } else {
      show(modal, true);
    }
    $('lyrics-manual-title').value = song.title || '';
    $('lyrics-manual-artist').value = song.artist || '';
    $('lyrics-manual-results-list').innerHTML = '';
    probeProviders(song, false);
  }

  function closeLyricsSourceModal() {
    state.lyricsSourceModalOpen = false;
    const modal = $('lyrics-source-modal');
    if (window.PlenripAnimations?.closeModal) {
      window.PlenripAnimations.closeModal(modal);
    } else {
      show(modal, false);
    }
  }

  function probeProviders(song, force) {
    state.providerProbes = {};
    LYRICS_PROVIDERS_META.forEach((p) => (state.providerProbes[p.id] = { status: 'checking' }));
    renderProviderList(song);
    lyricsManager.probeAll(
      currentLyricsRequest(song),
      (id, res) => {
        state.providerProbes[id] = res;
        if (state.lyricsSourceModalOpen) renderProviderList(song);
      },
      { force }
    );
  }

  function renderProviderList(song) {
    const list = $('lyrics-providers-status-list');
    if (!list || !song) return;
    const override = lyricsManager.getTrackProviderOverride(song.id);
    list.innerHTML = '';

    const choose = (id) => {
      lyricsManager.setTrackProviderOverride(song.id, id);
      closeLyricsSourceModal();
      ensureLyrics(true);
    };

    const auto = document.createElement('button');
    auto.type = 'button';
    auto.className = `w-full px-3 py-2.5 border text-left flex items-center justify-between text-xs transition-colors ${
      override === 'auto' ? 'bg-zinc-800 border-emerald-400' : 'bg-zinc-950 border-zinc-700 hover:border-zinc-500'
    }`;
    auto.innerHTML = `
      <div>
        <div class="font-semibold text-zinc-100">Automatic</div>
        <div class="text-[11px] font-mono text-zinc-400">Best match: word sync, then line sync, then plain (priority order)</div>
      </div>
      <span class="px-2 py-0.5 border border-zinc-700 text-[10px] font-mono text-emerald-400">AUTO</span>`;
    auto.addEventListener('click', () => choose('auto'));
    list.appendChild(auto);

    for (const meta of LYRICS_PROVIDERS_META) {
      const probe = state.providerProbes[meta.id] || { status: 'checking' };
      let badge;
      if (probe.status === 'checking') badge = '<span class="text-[11px] font-mono text-zinc-400">Checking...</span>';
      else if (probe.status === 'ok') {
        const kind = probe.hasWordSync ? 'Word sync' : probe.kind === 'synced' ? 'Synced' : 'Plain';
        badge = `<span class="px-2 py-0.5 border border-emerald-400 text-[10px] font-mono text-emerald-400">Available (${kind})</span>`;
      } else if (probe.status === 'not_found') badge = '<span class="text-[11px] font-mono text-zinc-400">Not found</span>';
      else badge = '<span class="text-[11px] font-mono text-[#f0605a]">Unreachable</span>';

      const row = document.createElement('div');
      row.className = `w-full px-3 py-2.5 border flex items-center justify-between gap-2 text-xs transition-colors ${
        override === meta.id ? 'bg-zinc-800 border-emerald-400' : 'bg-zinc-950 border-zinc-700'
      }`;
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'flex-1 text-left flex items-center justify-between gap-2';
      pick.innerHTML = `<span class="font-medium text-zinc-100">${escapeHtml(meta.name)}</span>${badge}`;
      pick.addEventListener('click', () => choose(meta.id));
      row.appendChild(pick);

      if (probe.status === 'unreachable') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'px-2 py-1 border border-zinc-600 text-[10px] font-mono text-zinc-100 hover:border-emerald-400';
        retry.textContent = 'RETRY';
        retry.addEventListener('click', async (e) => {
          e.stopPropagation();
          state.providerProbes[meta.id] = { status: 'checking' };
          renderProviderList(song);
          state.providerProbes[meta.id] = await lyricsManager.fetchFromProvider(meta.id, currentLyricsRequest(song), { force: true });
          renderProviderList(song);
        });
        row.appendChild(retry);
      }
      list.appendChild(row);
    }
  }

  async function runManualLyricsSearch() {
    const song = audioEngine?.currentSong;
    if (!song) return;
    const title = $('lyrics-manual-title').value.trim();
    const artist = $('lyrics-manual-artist').value.trim();
    const results = $('lyrics-manual-results-list');
    results.innerHTML = '<div class="py-2 text-xs font-mono text-zinc-400">Searching LRCLIB...</div>';
    const candidates = await lyricsManager.searchLrcLibManual(`${title} ${artist}`);
    results.innerHTML = '';
    if (candidates.length === 0) {
      results.innerHTML = '<div class="py-2 text-xs font-mono text-zinc-400">No results.</div>';
      return;
    }
    candidates.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full px-3 py-2 border border-zinc-700 bg-zinc-950 hover:border-emerald-400 text-left flex items-center justify-between gap-2 text-xs mt-1.5';
      btn.innerHTML = `
        <span class="min-w-0">
          <span class="block truncate text-zinc-100">${escapeHtml(c.trackName || '')} - ${escapeHtml(c.artistName || '')}</span>
          <span class="block text-[11px] font-mono text-zinc-400">${escapeHtml(c.albumName || '')} · ${formatDuration(c.duration)}</span>
        </span>
        <span class="shrink-0 text-[10px] font-mono ${c.syncedLyrics ? 'text-emerald-400' : 'text-zinc-400'}">${c.syncedLyrics ? 'SYNCED' : 'PLAIN'}</span>`;
      btn.addEventListener('click', () => {
        const L = state.lyrics;
        L.trackId = song.id;
        L.loading = false;
        L.result = lyricsManager.applyManualLrcLibCandidate(c);
        L.romaji = null;
        L.en = null;
        closeLyricsSourceModal();
        renderAllLyrics();
        if (L.result.lines && hasJapaneseScript(L.result.lines) && (lyricsManager.getShowRomaji() || lyricsManager.getShowTranslated())) prepareReadings();
      });
      results.appendChild(btn);
    });
  }

  // ============================================================================
  // Now Playing View (Resizable Split Rail + OKLCH 3-Blob Ambient Mesh)
  // ============================================================================
  function applyNpRailWidth() {
    const rail = $('np-right-rail');
    if (rail && window.innerWidth >= 1024) {
      rail.style.width = `${state.npRailWidth}px`;
    }
  }

  function setNpTab(tab) {
    state.npTab = tab;
    const queueActive = tab === 'queue';
    show($('np-panel-queue'), queueActive);
    const lyricsPanel = $('np-panel-lyrics');
    lyricsPanel.classList.toggle('hidden', queueActive);
    lyricsPanel.classList.toggle('flex', !queueActive);
    const style = (btn, active) => {
      btn.classList.toggle('bg-zinc-800', active);
      btn.classList.toggle('text-zinc-100', active);
      btn.classList.toggle('border-zinc-600', active);
      btn.classList.toggle('text-zinc-400', !active);
      btn.classList.toggle('border-transparent', !active);
    };
    style($('np-tab-queue'), queueActive);
    style($('np-tab-lyrics'), !queueActive);
    show($('np-clear-queue-btn'), queueActive);
    updateLyricsOffsetDisplays();
    renderQueueViews(true);
    updateLyricsVisibilityDependents();
    if (!queueActive) renderAllLyrics();
  }

  function setNpMobileOverlay(kind) {
    state.npMobileOverlay = state.npMobileOverlay === kind ? null : kind;
    const panel = $('np-mobile-overlay-panel');
    const open = Boolean(state.npMobileOverlay);
    panel.classList.toggle('hidden', !open);
    panel.classList.toggle('flex', open);
    $('np-mobile-overlay-title').textContent = state.npMobileOverlay === 'queue' ? 'Queue' : 'Synced Lyrics';
    if (state.npMobileOverlay === 'queue') {
      show($('np-mobile-lyrics-mode-group'), false);
      renderQueueViews(true);
    } else if (state.npMobileOverlay === 'lyrics') {
      updateLyricsVisibilityDependents();
      renderAllLyrics();
    }
  }

  let lastNpTrackId = null;

  function renderNowPlaying() {
    if (!$('view-now-playing')) return;
    applyNpRailWidth();
    const song = audioEngine?.currentSong;
    show($('np-empty-state'), !song);
    $('np-empty-state')?.classList.toggle('flex', !song);
    show($('np-active-state'), Boolean(song));
    if (!song) return;

    $('np-title').innerHTML = titleHtml(song.title || 'Untitled', song.artist);
    $('np-artist-btn').textContent = song.artist || 'Unknown Artist';
    $('np-album-btn').textContent = song.album || '';
    $('np-mobile-title').innerHTML = titleHtml(song.title || 'Untitled', song.artist);
    $('np-mobile-artist').textContent = song.artist || 'Unknown Artist';

    if (lastNpTrackId !== song.id) {
      const shouldFade = lastNpTrackId !== null && lastNpTrackId !== song.id;
      lastNpTrackId = song.id;
      attachCoverImage($('np-cover-img'), $('np-cover-fallback'), song.coverArt || song.albumId, song.id, 700, {
        animateFade: shouldFade,
      });
      attachCoverImage($('np-mobile-cover-img'), $('np-mobile-cover-fallback'), song.coverArt || song.albumId, song.id, 700, {
        animateFade: shouldFade,
      });
      const backdrop = $('np-backdrop-art');
      const coverId = song.coverArt || song.albumId;
      if (backdrop && coverId) {
        backdrop.style.backgroundImage = `url("${client.getCoverArtUrl(coverId, 300)}")`;
        backdrop.style.backgroundSize = 'cover';
        backdrop.style.backgroundPosition = 'center';
      } else if (backdrop) {
        backdrop.style.backgroundImage = '';
      }
      void applyAmbientMeshForSong(song, 'np');
    }
    setNpTab(state.npTab);
  }

  // ============================================================================
  // Player bar + engine state synchronization
  // ============================================================================
  let lastPlayerTrackId = null;
  let lastTranslationStamp = '';

  function updateSliderFill(el) {
    if (!el) return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || (el.id?.includes('volume') ? 1 : 100);
    const val = parseFloat(el.value) || 0;
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    el.style.setProperty('--range-progress', `${pct}%`);
  }

  function updatePlayerBarUI() {
    if (!audioEngine) return;
    const song = audioEngine.currentSong;
    const playing = audioEngine.isPlaying;

    ['icon-play', 'sig-icon-play', 'mobile-mini-play-icon', 'np-mobile-play-icon'].forEach((id) => setIcon($(id), playing ? 'pause' : 'play'));

    const cur = audioEngine.currentTime || 0;
    const dur = audioEngine.duration || song?.duration || 0;
    ['time-current', 'sig-time-current', 'np-mobile-time-current'].forEach((id) => $(id) && ($(id).textContent = formatDuration(cur)));
    ['time-total', 'sig-time-total', 'np-mobile-time-total'].forEach((id) => $(id) && ($(id).textContent = formatDuration(dur)));

    if (!state.scrubbing && !audioEngine.isSeeking) {
      ['seek-slider', 'sig-seek-slider', 'np-mobile-seek'].forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.max = String(dur > 0 ? dur : 100);
        el.value = String(cur);
        updateSliderFill(el);
      });
    }
    const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    if ($('mobile-mini-progress')) $('mobile-mini-progress').style.width = `${pct}%`;

    ['btn-shuffle', 'sig-btn-shuffle', 'np-mobile-shuffle'].forEach((id) => {
      const b = $(id);
      if (b) {
        b.classList.toggle('text-emerald-400', audioEngine.shuffle);
        b.classList.toggle('text-zinc-400', !audioEngine.shuffle);
      }
    });
    ['btn-repeat', 'sig-btn-repeat', 'np-mobile-repeat'].forEach((id) => {
      const b = $(id);
      if (b) {
        b.classList.toggle('text-emerald-400', audioEngine.repeatMode !== 'off');
        b.classList.toggle('text-zinc-400', audioEngine.repeatMode === 'off');
      }
    });
    const one = $('repeat-one-badge');
    if (one) {
      one.classList.toggle('hidden', audioEngine.repeatMode !== 'one');
      one.classList.toggle('flex', audioEngine.repeatMode === 'one');
    }

    const vol = $('volume-slider');
    if (vol && document.activeElement !== vol) {
      vol.value = String(audioEngine.volume);
      updateSliderFill(vol);
    }
    setIcon($('icon-volume'), audioEngine.volume === 0 ? 'volume-x' : audioEngine.volume < 0.5 ? 'volume-1' : 'volume-2');

    renderQueueViews();

    const stamp = `${song?.id}|${titles.isEnabled()}|${song ? titles.getTranslatedTitle(song.title, song.artist) : ''}`;
    if (!song) {
      $('player-title-btn').textContent = 'No track selected';
      $('player-artist-btn').textContent = 'Select any song or album to begin playback';
      $('player-album-btn')?.classList.add('hidden');
      $('player-album-sep')?.classList.add('hidden');
      const bitrateEl = $('player-bitrate-indicator');
      if (bitrateEl) {
        bitrateEl.textContent = '--';
        bitrateEl.title = 'No track selected';
        bitrateEl.classList.add('opacity-40');
      }
      $('mobile-mini-title').textContent = 'No track selected';
      $('mobile-mini-artist').textContent = 'Select a track to play';
      lastPlayerTrackId = null;
      lastTranslationStamp = stamp;
      if (state.route === 'now-playing') renderNowPlaying();
      return;
    }

    const trackChanged = lastPlayerTrackId !== song.id;
    if (trackChanged || stamp !== lastTranslationStamp) {
      lastTranslationStamp = stamp;
      $('player-title-btn').innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
      $('player-artist-btn').textContent = song.artist || 'Unknown Artist';
      // Album button (bottom bar): shows the album name and opens the album
      // detail when clicked. Hidden when the song has no album.
      const albumBtn = $('player-album-btn');
      const albumSep = $('player-album-sep');
      if (albumBtn) {
        const hasAlbum = Boolean(song.album);
        albumBtn.textContent = song.album || '';
        albumBtn.classList.toggle('hidden', !hasAlbum);
        albumSep?.classList.toggle('hidden', !hasAlbum);
      }
      const bitrateEl = $('player-bitrate-indicator');
      if (bitrateEl) {
        const br = song.bitRate || song.bitrate;
        if (br) {
          bitrateEl.textContent = String(br);
          bitrateEl.title = `Bitrate: ${br} kbps`;
          bitrateEl.classList.remove('opacity-40');
        } else if (song.suffix) {
          bitrateEl.textContent = song.suffix.toUpperCase();
          bitrateEl.title = `Format: ${song.suffix.toUpperCase()}`;
          bitrateEl.classList.remove('opacity-40');
        } else {
          bitrateEl.textContent = '320';
          bitrateEl.title = 'Bitrate: 320 kbps';
          bitrateEl.classList.remove('opacity-40');
        }
      }
      $('mobile-mini-title').innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
      $('mobile-mini-artist').textContent = song.artist || 'Unknown Artist';
      queueTranslations([{ title: song.title, artist: song.artist }]);
    }

    const starred = state.starredSongIds.has(song.id);
    // No star in the bottom player bar (Century has none there; the star
    // lives in Now Playing only). Kept for np-star-btn / np-mobile-star-btn.
    ['np-star-btn', 'np-mobile-star-btn'].forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.classList.toggle('text-emerald-400', starred);
      b.querySelector('svg, i')?.classList.toggle('fill-current', starred);
    });

    if (trackChanged) {
      lastPlayerTrackId = song.id;
      attachCoverImage($('player-cover-img'), $('player-cover-fallback'), song.coverArt || song.albumId, song.id, 120);
      attachCoverImage($('mobile-mini-cover'), $('mobile-mini-fallback'), song.coverArt || song.albumId, song.id, 120);
      updateSignatureMetadataUI();
      updateDrawerMeta();
      refreshRowHighlights();
      if (anyLyricsVisible()) ensureLyrics(false);
      else {
        state.lyrics.trackId = null;
        state.lyrics.result = null;
      }
      if (state.route === 'now-playing') renderNowPlaying();
    } else {
      // Play / pause state changes only need the row indicators refreshed
      if (lastRowPlayingState !== playing) refreshRowHighlights();
    }
    lastRowPlayingState = playing;

    if (anyLyricsVisible()) syncLyrics(false);
  }

  let lastRowPlayingState = null;

  // ============================================================================
  // Connection banner & Typed Verification
  // ============================================================================
  function setConnectionError(msg) {
    state.connected = !msg;
    const banner = $('error-banner');
    if (banner) {
      show(banner, Boolean(msg) && state.route !== 'welcome');
      if (msg) $('error-banner-msg').textContent = `${msg}. Verify server URL and credentials in Settings.`;
    }
    const ok = !msg;
    ['settings-server-status-dot', 'settings-tab-server-dot'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.classList.toggle('bg-emerald-400', ok);
      el.classList.toggle('bg-[#f0605a]', !ok);
    });
    const badge = $('settings-ping-badge');
    if (badge) {
      badge.textContent = ok ? 'Connected to Navidrome (Subsonic API v1.16.1)' : `Cannot reach server: ${msg}`;
    }
    if (ok) {
      show($('settings-server-error-box'), false);
    }
  }

  function classifySubsonicError(err, serverUrl) {
    if (err instanceof SubsonicApiError && err.code === 40) {
      return {
        errorKind: 'auth_failed',
        title: 'Incorrect Username or Password',
        message: 'Check your username and password and try again.',
        focusField: 'pass',
      };
    }
    if (err instanceof SubsonicApiError) {
      return {
        errorKind: 'unknown',
        title: 'Server Error',
        message: err.message || 'The Navidrome server returned an error.',
        focusField: null,
      };
    }
    if (err instanceof SubsonicRequestTimeoutError) {
      return {
        errorKind: 'timeout',
        title: 'Navidrome Server Timed Out',
        message: `No response from ${formatServerHost(serverUrl)} within 15 seconds.`,
        focusField: 'url',
      };
    }
    if (isMixedContentRisk(serverUrl)) {
      return {
        errorKind: 'unreachable',
        title: 'Blocked by Browser Security',
        message: 'This page is loaded over HTTPS, which blocks plain HTTP server URLs. Use https:// for your Navidrome server.',
        focusField: 'url',
      };
    }
    return {
      errorKind: 'unreachable',
      title: 'Navidrome Server Unreachable',
      message: `Could not reach ${formatServerHost(serverUrl)}. Verify the URL and that Navidrome is running.`,
      focusField: 'url',
    };
  }

  function clearLibraryCachesForReconnect() {
    artistAlbumCoverCache.clear();
    artistImageCache.clear();
    state.artists = null;
    state.songs = null;
    state.songsPromise = null;
    state.albumsByType = {};
    state.mergedAlbums = null;
    state.searchIndex = null;
    state.currentArtist = null;
    state.currentAlbum = null;
    state.currentPlaylist = null;
    state.playlists = [];
    state.favouriteSongs = [];
    state.starredSongIds.clear();
    state.starredAlbumIds.clear();
    state.starredArtistIds.clear();
    Object.values(libraryViews).forEach((v) => {
      if (v?.view) v.view.items = null;
    });
    updateSidebarCounts();
  }

  async function verifyAndSaveNavidromeConfig({ serverUrl, username, password }) {
    const prevUrl = client.baseUrl;
    const prevUser = client.username;
    const prevPass = client.password;

    const cleanUrl = normalizeServerUrlInput(serverUrl);
    const cleanUser = String(username || '').trim();
    const rawPass = typeof password === 'string' ? password : '';

    if (!cleanUrl || !cleanUser) {
      return {
        ok: false,
        errorKind: 'missing_fields',
        title: 'Missing Required Fields',
        message: 'Server URL and Username are required.',
        focusField: !cleanUrl ? 'url' : 'user',
      };
    }
    if (!isValidHttpUrl(cleanUrl)) {
      return {
        ok: false,
        errorKind: 'invalid_url',
        title: 'Invalid Server URL',
        message: 'Server URL must start with http:// or https://.',
        focusField: 'url',
      };
    }

    const serverOrUserChanged = cleanUrl !== prevUrl || cleanUser !== prevUser;
    const hasNewPass = rawPass.length > 0;
    if ((serverOrUserChanged || !prevPass) && !hasNewPass) {
      if (serverOrUserChanged) {
        try {
          localStorage.removeItem(STORAGE_KEYS.NAVIDROME_PASS);
        } catch {
          // Ignore storage errors
        }
        client.password = '';
      }
      return {
        ok: false,
        errorKind: 'password_required',
        title: 'Password Required',
        message: serverOrUserChanged
          ? 'Enter your password for the updated server or username.'
          : 'Enter your Navidrome password.',
        focusField: 'pass',
      };
    }

    const effectivePass = hasNewPass ? rawPass : prevPass;
    client.baseUrl = cleanUrl;
    client.username = cleanUser;
    client.password = effectivePass;

    try {
      const pingOk = await client.ping({ throwOnError: true, timeoutMs: 15000 });
      if (!pingOk) {
        throw new Error('Ping returned non-ok status');
      }
      client.saveConfig(cleanUrl, cleanUser, effectivePass);
      if (serverOrUserChanged) {
        clearLibraryCachesForReconnect();
      }
      setConnectionError(null);
      return { ok: true, serverOrUserChanged };
    } catch (err) {
      client.baseUrl = prevUrl;
      client.username = prevUser;
      client.password = prevPass;
      const mapped = classifySubsonicError(err, cleanUrl);
      return { ok: false, ...mapped };
    }
  }

  async function retryConnection() {
    try {
      const ok = await client.ping({ throwOnError: true, timeoutMs: 15000 });
      if (ok) {
        setConnectionError(null);
        showToast('Connected to Navidrome');
        await Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]);
        state.artists = null;
        state.songs = null;
        state.songsPromise = null;
        state.albumsByType = {};
        state.mergedAlbums = null;
        Object.values(libraryViews).forEach((v) => (v.view.items = null));
        if (state.route !== 'welcome') navigateTo(state.route);
        return true;
      }
    } catch (err) {
      const mapped = classifySubsonicError(err, client.baseUrl);
      setConnectionError(mapped.title);
      showToast(mapped.title);
      return false;
    }
    setConnectionError('Ping failed');
    showToast('Could not connect to server');
    return false;
  }

  // ============================================================================
  // Settings Modal (Appearance, Discovery & Radio, Playback, Audio, Lyrics, Library, Server, NAS)
  // ============================================================================
  function setSettingsTab(tab) {
    const tabs = ['appearance', 'discovery', 'playback', 'audio', 'lyrics', 'library', 'server', 'nas'];
    const activeTab = tabs.includes(tab) ? tab : 'appearance';

    tabs.forEach((t) => {
      show($(`settings-tab-${t}`), t === activeTab);
      const btn = $(`settings-tab-btn-${t}`);
      const active = t === activeTab;
      if (btn) {
        btn.classList.toggle('border-emerald-400', active);
        btn.classList.toggle('text-zinc-100', active);
        btn.classList.toggle('font-semibold', active);
        btn.classList.toggle('border-transparent', !active);
        btn.classList.toggle('text-zinc-400', !active);
      }
    });

    if (activeTab === 'nas') {
      checkFilesBridge();
    } else if (activeTab === 'discovery') {
      void renderDiscoverySettings();
    }
  }

  async function renderDiscoverySettings() {
    const D = window.PlenripDiscovery;
    if (!D) return;

    // 1. Radio & Co-occurrence readiness
    try {
      const [status, totalEvents] = await Promise.all([
        D.checkRadioReadiness(client),
        D.getPlayEventCount(),
      ]);
      const badge = $('settings-radio-status-badge');
      const detail = $('settings-radio-status-detail');
      if (badge) {
        badge.textContent = status.ready ? 'READY' : 'WARMING UP';
        badge.classList.toggle('text-emerald-300', status.ready);
        badge.classList.toggle('text-zinc-300', !status.ready);
      }
      if (detail) {
        detail.textContent = `${totalEvents} events · ${status.completedPlays || 0} completed plays · ${
          status.hasEdges ? 'Co-occurrence graph active' : 'Collecting session pairs'
        }`;
      }
    } catch {
      // Ignore
    }

    // 2. Adventurousness buttons & Shelf sliders
    const ds = state.discoverySettings;
    $('settings-adventurousness-group')?.querySelectorAll('[data-adventurousness]').forEach((btn) => {
      setModeButton(btn, btn.getAttribute('data-adventurousness') === ds.adventurousness);
    });

    const bindSliderVal = (sliderId, labelId, val, suffix = '') => {
      const s = $(sliderId);
      const l = $(labelId);
      if (s) {
        s.value = String(val);
        updateSliderFill(s);
      }
      if (l) l.textContent = `${val}${suffix}`;
    };
    bindSliderVal('settings-silence-days', 'settings-silence-days-val', ds.silenceDays, 'd');
    bindSliderVal('settings-starred-cooldown', 'settings-starred-cooldown-val', ds.starredCooldownDays, 'd');
    bindSliderVal('settings-quickpick-hours', 'settings-quickpick-hours-val', ds.quickPickExclusionHours, 'h');
    bindSliderVal('settings-max-per-artist', 'settings-max-per-artist-val', ds.maxPerArtist, '');

    // 3. Recent Listening Sessions exclusion list
    const sessBox = $('settings-sessions-list');
    if (sessBox && D.getPlayEventLog && D.splitSessions) {
      const [events, excludedSet] = await Promise.all([
        D.getPlayEventLog(),
        D.getExcludedSessionIds(),
      ]);
      const sessions = D.splitSessions(events).slice(-15).reverse();
      sessBox.innerHTML = '';
      if (sessions.length === 0) {
        sessBox.innerHTML = '<div class="p-3 text-zinc-500 text-center">No listening sessions recorded yet.</div>';
      } else {
        const songMap = new Map((state.songs || []).map((s) => [s.id, s]));
        sessions.forEach((sess) => {
          const isEx = excludedSet.has(sess.id);
          const dateStr = new Date(sess.startedAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          const sampleSong = songMap.get(sess.events?.[0]?.songId);
          const sampleLabel = sampleSong ? ` · ${sampleSong.artist || sampleSong.title}` : '';
          const row = document.createElement('div');
          row.className = 'px-3 py-2 flex items-center justify-between gap-2';
          row.innerHTML = `
            <div class="min-w-0">
              <div class="text-zinc-200 truncate ${isEx ? 'line-through opacity-50' : ''}">${escapeHtml(dateStr)}${escapeHtml(sampleLabel)}</div>
              <div class="text-[10px] text-zinc-500">${sess.events.length} tracks</div>
            </div>`;
          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = `px-2 py-0.5 text-[10px] border ${
            isEx
              ? 'bg-[#f0605a]/15 border-[#f0605a]/50 text-[#f0605a]'
              : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
          }`;
          toggleBtn.textContent = isEx ? 'EXCLUDED' : 'INCLUDE';
          toggleBtn.addEventListener('click', async () => {
            await D.setSessionExcluded(sess.id, !isEx);
            D.clearShelfCache?.();
            await renderDiscoverySettings();
            if (state.route === 'home') void renderHomeHistorySections();
          });
          row.appendChild(toggleBtn);
          sessBox.appendChild(row);
        });
      }
    }
  }

  async function populateOutputDevices() {
    const select = $('settings-output-device');
    if (!select || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput');
      select.innerHTML = '<option value="">System Default Output</option>';
      devices.forEach((d, i) => {
        if (d.deviceId === 'default') return;
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Output device ${i + 1}`;
        select.appendChild(opt);
      });
      select.value = audioEngine.outputDeviceId === 'default' ? '' : audioEngine.outputDeviceId;
    } catch {
      // Ignore enumeration failures
    }
  }

  function renderAppearanceControls() {
    document.querySelectorAll('[data-palette-option]').forEach((card) => {
      const active = card.getAttribute('data-palette-option') === state.appearance.palette;
      card.classList.toggle('border-emerald-400', active);
      card.classList.toggle('ring-1', active);
      card.classList.toggle('ring-emerald-400', active);
      card.classList.toggle('border-zinc-700', !active);
    });
    document.querySelectorAll('[data-radius-option]').forEach((btn) => {
      const active = btn.getAttribute('data-radius-option') === state.appearance.radius;
      btn.classList.toggle('border-emerald-400', active);
      btn.classList.toggle('ring-1', active);
      btn.classList.toggle('ring-emerald-400', active);
      btn.classList.toggle('border-zinc-700', !active);
    });
    const denseEl = $('settings-dense-rows-toggle');
    if (denseEl) denseEl.checked = state.appearance.denseRows;
    const pauseEl = $('settings-pause-animations-toggle');
    if (pauseEl) pauseEl.checked = state.appearance.pauseAnimations;
  }

  function renderSettings() {
    renderAppearanceControls();

    const fade = Math.round(audioEngine.crossfadeSeconds);
    const fadeSlider = $('settings-crossfade-slider');
    fadeSlider.value = String(fade);
    updateSliderFill(fadeSlider);
    $('settings-crossfade-label').textContent = fade === 0 ? '0s (Gapless cut)' : `${fade}s`;

    $('settings-norm-group').querySelectorAll('[data-norm]').forEach((b) => setModeButton(b, b.getAttribute('data-norm') === audioEngine.normalization));
    const preampSlider = $('settings-preamp-slider');
    preampSlider.value = String(audioEngine.preampDb);
    updateSliderFill(preampSlider);
    $('settings-preamp-label').textContent = `${audioEngine.preampDb > 0 ? '+' : ''}${audioEngine.preampDb} dB`;
    $('settings-stream-quality').value = audioEngine.streamQuality;
    $('settings-translated-titles-toggle').checked = titles.isEnabled();
    $('settings-history-count').textContent = `${historyStore.entries.length} plays recorded locally`;

    const wordSweepToggle = $('settings-word-sweep-toggle');
    if (wordSweepToggle) wordSweepToggle.checked = lyricsManager.getWordSweep();
    const splitBgToggle = $('settings-split-bg-toggle');
    if (splitBgToggle) splitBgToggle.checked = lyricsManager.getSplitBackground();
    const manualScrollToggle = $('settings-manual-scroll-pause-toggle');
    if (manualScrollToggle) manualScrollToggle.checked = lyricsManager.getManualScrollPause();
    const hidePlayedToggle = $('settings-hide-played-toggle');
    if (hidePlayedToggle) hidePlayedToggle.checked = lyricsManager.getHidePlayed();
    const hideUpcomingToggle = $('settings-hide-upcoming-toggle');
    if (hideUpcomingToggle) hideUpcomingToggle.checked = lyricsManager.getHideUpcoming();
    const splitAlbumsToggle = $('settings-split-albums-toggle');
    if (splitAlbumsToggle) splitAlbumsToggle.checked = getSplitAlbumsSingles();
    const autoplayToggle = $('settings-autoplay-toggle');
    if (autoplayToggle) autoplayToggle.checked = audioEngine.autoplay;
    const balancedToggle = $('settings-balanced-shuffle-toggle');
    if (balancedToggle) balancedToggle.checked = Boolean(audioEngine.getBalancedShuffleEnabled?.());

    $('settings-server-url').value = client.baseUrl;
    $('settings-server-user').value = client.username;
    $('settings-server-pass').value = '';
    $('settings-server-pass').placeholder = client.password ? 'Leave blank to keep existing' : 'Enter password';
    show($('settings-server-error-box'), false);

    const nasUrlInput = $('settings-nas-url');
    if (nasUrlInput) {
      const savedNas = (localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url') || '').trim();
      nasUrlInput.value = /^http:\/\/(localhost|127\.0\.0\.1):3001$/i.test(savedNas) ? '' : savedNas;
    }
    const nasKeyInput = $('settings-nas-key');
    if (nasKeyInput) {
      nasKeyInput.value = getFileBridgeApiKey();
    }

    populateOutputDevices();
    refreshIcons();
  }

  function openSettings(tab = 'appearance') {
    state.settingsOpen = true;
    const modal = $('settings-modal');
    if (window.PlenripAnimations?.openModal) {
      window.PlenripAnimations.openModal(modal);
    } else {
      show(modal, true);
    }
    renderSettings();
    setSettingsTab(tab);
  }

  function closeSettings() {
    state.settingsOpen = false;
    const modal = $('settings-modal');
    if (window.PlenripAnimations?.closeModal) {
      window.PlenripAnimations.closeModal(modal);
    } else {
      show(modal, false);
    }
  }

  // ============================================================================
  // Event Bindings & Keyboard Shortcuts
  // ============================================================================
  function on(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
  }

  function seekFromSlider(e) {
    audioEngine.seek(parseFloat(e.target.value) || 0);
  }

  async function allArtistSongsThen(fn) {
    if (!state.currentArtist) return;
    const songs = await collectArtistSongs();
    fn(songs);
  }

  function downscaleImageFileToDataUrl(file, maxEdge = 420) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Invalid image file'));
        img.onload = () => {
          const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  function bindAllEvents() {
    // Multi-select action bar
    on('multi-select-play-btn', 'click', multiSelectPlay);
    on('multi-select-queue-btn', 'click', multiSelectAddToQueue);
    on('multi-select-playlist-btn', 'click', multiSelectAddToPlaylist);
    on('multi-select-star-btn', 'click', multiSelectStar);
    on('multi-select-clear-btn', 'click', clearMultiSelect);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.multiSelect.size > 0) {
        clearMultiSelect();
        e.stopPropagation();
      }
    }, true);

    // Sidebar + mobile chrome + inline playlist creation
    on('sidebar-toggle-btn', 'click', () => {
      toggleSidebar();
      renderSidebarContinue();
    });
    on('sidebar-brand-wrap', 'click', () => navigateTo('home'));
    on('mobile-menu-btn', 'click', () => setMobileSidebar(true));
    on('mobile-sidebar-backdrop', 'click', () => setMobileSidebar(false));
    on('mobile-back-btn', 'click', goBack);
    on('mobile-search-btn', 'click', () => navigateTo('search'));
    document.querySelectorAll('.sidebar-nav-btn[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-route')));
    });
    document.querySelectorAll('.mobile-tab-btn[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-route')));
    });
    on('nav-settings', 'click', () => openSettings('appearance'));

    const inlineForm = $('sidebar-inline-create-form');
    const inlineInput = $('sidebar-inline-create-input');
    on('sidebar-new-playlist-btn', 'click', () => {
      if (state.sidebarCollapsed || !inlineForm || !inlineInput) {
        openModal('create-playlist-modal');
        return;
      }
      const willOpen = inlineForm.classList.contains('hidden');
      show(inlineForm, willOpen);
      if (willOpen) {
        inlineInput.value = '';
        inlineInput.focus();
      }
    });
    inlineInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        show(inlineForm, false);
      }
    });
    inlineForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = inlineInput?.value?.trim();
      if (!name) return;
      try {
        await createPlaylistWithSongs(name, []);
        inlineInput.value = '';
        show(inlineForm, false);
        showToast(`Created playlist "${name}"`);
      } catch (err) {
        showToast(`Create failed: ${err.message}`);
      }
    });

    // Connection banner
    on('error-retry-btn', 'click', retryConnection);
    on('error-settings-btn', 'click', () => openSettings('server'));
    on('error-dismiss-btn', 'click', () => show($('error-banner'), false));

    // Home
    on('home-radio-btn', 'click', startPersonalRadio);
    on('home-refresh-btn', 'click', async () => {
      window.PlenripDiscovery?.clearShelfCache?.();
      await syncStarredFromServer();
      loadHomeView();
    });
    on('home-see-all-albums-btn', 'click', () => navigateTo('albums'));
    on('home-quick-pick-play-all', 'click', () => {
      playSongs(currentQuickPickSongs, { shuffle: false, contextName: 'Quick Pick', source: 'shelf' });
    });
    on('home-quick-pick-prev', 'click', () => {
      $('home-quick-pick-grid')?.scrollBy({ left: -330, behavior: 'smooth' });
    });
    on('home-quick-pick-next', 'click', () => {
      $('home-quick-pick-grid')?.scrollBy({ left: 330, behavior: 'smooth' });
    });

    // Artist detail
    on('back-to-artists-btn', 'click', () => navigateTo('artists', { preserveScroll: true }));
    on('artist-play-all-btn', 'click', () =>
      allArtistSongsThen((songs) => playSongs(songs, { contextName: state.currentArtist?.name || 'Artist', source: 'artist' }))
    );
    on('artist-shuffle-btn', 'click', () =>
      allArtistSongsThen((songs) => playSongs(songs, { shuffle: true, contextName: state.currentArtist?.name || 'Artist', source: 'artist' }))
    );
    on('artist-radio-btn', 'click', () =>
      allArtistSongsThen((songs) => {
        const seed = state.artistPopularSongs?.[0] || songs[0];
        if (seed) startRadio(seed, state.currentArtist?.name || 'Artist');
      })
    );
    on('artist-popular-toggle-btn', 'click', () => {
      state.artistPopularExpanded = !state.artistPopularExpanded;
      renderArtistPopularList();
    });
    on('artist-star-btn', 'click', () => toggleStarArtist(state.currentArtist));

    // Album detail
    on('album-back-btn', 'click', () => navigateTo(state.albumBackRoute || 'albums', { preserveScroll: true }));
    on('album-play-btn', 'click', () =>
      playSongs(state.currentAlbum?.song || [], { shuffle: false, contextName: state.currentAlbum?.name || 'Album', source: 'album' })
    );
    on('album-shuffle-btn', 'click', () =>
      playSongs(state.currentAlbum?.song || [], { shuffle: true, contextName: state.currentAlbum?.name || 'Album', source: 'album' })
    );
    on('album-radio-btn', 'click', () => {
      const seed = state.currentAlbum?.song?.[0];
      if (seed) startRadio(seed, state.currentAlbum?.name || 'Album');
    });
    on('album-star-btn', 'click', () => toggleStarAlbum(state.currentAlbum));
    on('album-more-btn', 'click', (e) => {
      e.stopPropagation();
      $('album-more-menu').classList.toggle('hidden');
    });
    on('album-menu-shuffle', 'click', () =>
      playSongs(state.currentAlbum?.song || [], { shuffle: true, contextName: state.currentAlbum?.name || 'Album', source: 'album' })
    );
    on('album-menu-play-next', 'click', () => enqueueNext(state.currentAlbum?.song || []));
    on('album-menu-add-queue', 'click', () => enqueueEnd(state.currentAlbum?.song || []));
    on('album-menu-add-playlist', 'click', () => openAddToPlaylistModal(state.currentAlbum?.song || []));

    // Songs + favourites
    on('songs-play-all-btn', 'click', async () => {
      const all = libraryViews.songs.view.items || (await loadAllSongs());
      playSongs(all, { shuffle: false, contextName: 'Songs', source: 'other' });
    });
    on('songs-shuffle-btn', 'click', async () => {
      const all = libraryViews.songs.view.items || (await loadAllSongs());
      playSongs(all, { shuffle: true, contextName: 'Songs', source: 'other' });
    });
    on('favourites-play-btn', 'click', () =>
      playSongs(state.favouriteSongs, { shuffle: false, contextName: 'Favourite Songs', source: 'playlist' })
    );
    on('favourites-shuffle-btn', 'click', () =>
      playSongs(state.favouriteSongs, { shuffle: true, contextName: 'Favourite Songs', source: 'playlist' })
    );
    on('favourites-prev-page', 'click', () => { favouritesPage = Math.max(0, favouritesPage - 1); loadFavouritesView(); });
    on('favourites-next-page', 'click', () => { favouritesPage += 1; loadFavouritesView(); });

    // Playlists + Smart Playlist Freeze/.nsp + Custom Cover Picker
    on('playlists-open-create-modal-btn', 'click', () => openModal('create-playlist-modal'));
    on('playlist-back-btn', 'click', () => navigateTo('playlists', { preserveScroll: true }));
    on('playlist-play-btn', 'click', () =>
      playSongs(state.currentPlaylist?.entry || [], { shuffle: false, contextName: state.currentPlaylist?.name || 'Playlist', source: 'playlist' })
    );
    on('playlist-shuffle-btn', 'click', () =>
      playSongs(state.currentPlaylist?.entry || [], { shuffle: true, contextName: state.currentPlaylist?.name || 'Playlist', source: 'playlist' })
    );
    on('playlist-freeze-toggle-btn', 'click', async () => {
      const pl = state.currentPlaylist;
      if (!pl?.isSmart || !pl.smartDef) return;
      const nextLive = pl.smartDef.liveUpdating === false;
      pl.smartDef.liveUpdating = nextLive;
      pl.smartDef.frozenSongIds = nextLive ? undefined : (pl.entry || []).map((s) => s.id);
      await window.PlenripDiscovery?.saveSmartPlaylistToDb?.(pl.smartDef);
      showToast(nextLive ? 'Smart playlist set to Live Updating' : 'Smart playlist frozen to current tracks');
      renderPlaylistDetailView();
    });
    on('playlist-export-nsp-btn', 'click', () => {
      const def = state.currentPlaylist?.smartDef;
      if (!def) return;
      window.PlenripDiscovery?.downloadNspFile?.(def);
      showToast(`Exported ${def.id}.nsp`);
    });
    on('playlist-change-cover-btn', 'click', openPlaylistCoverPicker);
    on('playlist-cover-file-input', 'change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await downscaleImageFileToDataUrl(file, 420);
        state.playlistCoverStagedDataUrl = dataUrl;
        const prev = $('playlist-cover-preview');
        const fb = $('playlist-cover-preview-fallback');
        if (prev && fb) {
          prev.src = dataUrl;
          prev.classList.remove('hidden');
          fb.classList.add('hidden');
        }
      } catch (err) {
        showToast(err.message);
      }
    });
    on('playlist-cover-reset-btn', 'click', () => {
      state.playlistCoverStagedDataUrl = '';
      const prev = $('playlist-cover-preview');
      const fb = $('playlist-cover-preview-fallback');
      if (prev && fb) {
        prev.removeAttribute('src');
        prev.classList.add('hidden');
        fb.classList.remove('hidden');
      }
    });
    on('playlist-cover-save-btn', 'click', () => {
      if (!state.playlistCoverTargetId) return;
      setCustomPlaylistCover(state.playlistCoverTargetId, state.playlistCoverStagedDataUrl || '');
      invalidatePlaylistCollage(state.playlistCoverTargetId);
      closeModal('playlist-cover-modal');
      renderSidebarPlaylists();
      if (state.route === 'playlist-detail') renderPlaylistDetailView();
      if (state.route === 'playlists') loadPlaylistsView();
      showToast(state.playlistCoverStagedDataUrl ? 'Saved custom playlist cover' : 'Restored automatic collage cover');
    });

    on('playlist-more-btn', 'click', (e) => {
      e.stopPropagation();
      $('playlist-more-menu').classList.toggle('hidden');
    });
    on('playlist-menu-shuffle', 'click', () =>
      playSongs(state.currentPlaylist?.entry || [], { shuffle: true, contextName: state.currentPlaylist?.name || 'Playlist', source: 'playlist' })
    );
    on('playlist-menu-play-next', 'click', () => enqueueNext(state.currentPlaylist?.entry || []));
    on('playlist-menu-add-queue', 'click', () => enqueueEnd(state.currentPlaylist?.entry || []));
    on('playlist-menu-add-playlist', 'click', () => openAddToPlaylistModal(state.currentPlaylist?.entry || []));

    const renameForm = $('playlist-rename-form');
    const renameInput = $('playlist-rename-input');
    on('playlist-rename-toggle-btn', 'click', () => {
      if (!state.currentPlaylist || state.currentPlaylist.isSmart) return;
      renameInput.value = state.currentPlaylist.name;
      renameForm.classList.remove('hidden');
      renameForm.classList.add('flex');
      renameInput.focus();
    });
    on('playlist-rename-cancel-btn', 'click', () => {
      renameForm.classList.add('hidden');
      renameForm.classList.remove('flex');
    });
    renameForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = renameInput.value.trim();
      if (!name || !state.currentPlaylist || state.currentPlaylist.isSmart) return;
      try {
        await client.updatePlaylist({ playlistId: state.currentPlaylist.id, name });
        renameForm.classList.add('hidden');
        renameForm.classList.remove('flex');
        showToast(`Renamed playlist to "${name}"`);
        await openPlaylistDetail(state.currentPlaylist.id);
        await refreshPlaylistsSidebarAndCache();
      } catch (err) {
        showToast(`Rename failed: ${err.message}`);
      }
    });

    on('playlist-delete-btn', 'click', async (e) => {
      e.stopPropagation();
      if (!state.currentPlaylist || state.currentPlaylist.isSmart) return;
      if (!state.deletePlaylistConfirm) {
        state.deletePlaylistConfirm = true;
        $('playlist-delete-label').textContent = 'Confirm delete?';
        return;
      }
      try {
        const name = state.currentPlaylist.name;
        await client.deletePlaylist(state.currentPlaylist.id);
        showToast(`Deleted playlist "${name}"`);
        state.currentPlaylist = null;
        await refreshPlaylistsSidebarAndCache();
        navigateTo('playlists');
      } catch (err) {
        showToast(`Delete failed: ${err.message}`);
      }
    });

    // Playlist & Shortcuts Modals
    const modalClosers = [
      ['create-playlist-close-btn', 'create-playlist-modal'],
      ['create-playlist-cancel-btn', 'create-playlist-modal'],
      ['save-queue-close-btn', 'save-queue-playlist-modal'],
      ['save-queue-cancel-btn', 'save-queue-playlist-modal'],
      ['add-to-playlist-close-btn', 'add-to-playlist-modal'],
      ['playlist-cover-close-btn', 'playlist-cover-modal'],
      ['playlist-cover-cancel-btn', 'playlist-cover-modal'],
      ['shortcuts-close-btn', 'shortcuts-modal'],
    ];
    modalClosers.forEach(([btnId, modalId]) => on(btnId, 'click', () => closeModal(modalId)));
    ['create-playlist-modal', 'save-queue-playlist-modal', 'add-to-playlist-modal', 'playlist-cover-modal', 'shortcuts-modal'].forEach((id) => {
      $(id)?.addEventListener('click', (e) => {
        if (e.target === $(id)) closeModal(id);
      });
    });

    on('create-playlist-modal-form', 'submit', async (e) => {
      e.preventDefault();
      const input = $('create-playlist-modal-input');
      const name = input.value.trim();
      if (!name) return;
      try {
        await createPlaylistWithSongs(name, []);
        input.value = '';
        closeModal('create-playlist-modal');
        showToast(`Created playlist "${name}"`);
      } catch (err) {
        showToast(`Failed to create playlist: ${err.message}`);
      }
    });

    on('queue-save-playlist-form', 'submit', async (e) => {
      e.preventDefault();
      const input = $('queue-save-playlist-input');
      const name = input.value.trim();
      if (!name || audioEngine.queue.length === 0) return;
      try {
        await createPlaylistWithSongs(name, audioEngine.queue);
        input.value = '';
        closeModal('save-queue-playlist-modal');
        showToast(`Saved queue as playlist "${name}"`);
      } catch (err) {
        showToast(`Failed to save queue: ${err.message}`);
      }
    });

    on('add-to-playlist-new-form', 'submit', async (e) => {
      e.preventDefault();
      const input = $('add-to-playlist-new-input');
      const name = input.value.trim();
      if (!name) return;
      try {
        await createPlaylistWithSongs(name, state.addPlaylistSongs);
        input.value = '';
        closeModal('add-to-playlist-modal');
        showToast(`Created "${name}" with ${state.addPlaylistSongs.length} track(s)`);
      } catch (err) {
        showToast(`Failed to create playlist: ${err.message}`);
      }
    });

    // Queue Drawer + Swipe Handle + Lyrics Drawer
    on('btn-queue', 'click', () => toggleQueueDrawer());
    on('queue-close-btn', 'click', () => toggleQueueDrawer(false));
    on('queue-start-radio-btn', 'click', () => {
      if (audioEngine?.currentSong) startRadio(audioEngine.currentSong);
      else startPersonalRadio();
    });
    on('queue-autoplay-btn', 'click', () => {
      audioEngine.setAutoplay(!audioEngine.autoplay);
      if (state.settingsOpen && $('settings-autoplay-toggle')) {
        $('settings-autoplay-toggle').checked = audioEngine.autoplay;
      }
      renderQueueViews(true);
    });
    on('queue-balanced-btn', 'click', () => {
      const next = !audioEngine.getBalancedShuffleEnabled();
      audioEngine.setBalancedShuffleEnabled(next);
      if (state.settingsOpen && $('settings-balanced-shuffle-toggle')) {
        $('settings-balanced-shuffle-toggle').checked = next;
      }
      renderQueueViews(true);
    });
    on('queue-clear-btn', 'click', () => {
      audioEngine.clearQueue();
      renderQueueViews(true);
    });
    on('queue-open-save-modal-btn', 'click', () => {
      if (audioEngine.queue.length === 0) return showToast('Queue is empty');
      openModal('save-queue-playlist-modal');
    });

    // Left-edge drag/swipe to dismiss #queue-drawer
    const qHandle = $('queue-drag-handle');
    if (qHandle) {
      let startX = null;
      qHandle.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        qHandle.setPointerCapture?.(e.pointerId);
      });
      qHandle.addEventListener('pointermove', (e) => {
        if (startX === null) return;
        const dx = Math.max(0, e.clientX - startX);
        const drawer = $('queue-drawer');
        if (drawer) drawer.style.transform = `translateX(${dx}px)`;
      });
      const finishQDrag = (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX;
        startX = null;
        const drawer = $('queue-drawer');
        if (dx > 85) {
          toggleQueueDrawer(false);
        } else if (drawer) {
          if (window.PlenripAnimations?.snapBackDrawer) {
            window.PlenripAnimations.snapBackDrawer(drawer);
          } else {
            drawer.style.transform = '';
          }
        }
      };
      qHandle.addEventListener('pointerup', finishQDrag);
      qHandle.addEventListener('pointercancel', finishQDrag);
    }

    on('drawer-backdrop', 'click', () => {
      if (state.queueOpen) toggleQueueDrawer(false);
      if (state.lyricsDrawerOpen) toggleLyricsDrawer(false);
    });

    on('btn-lyrics-drawer', 'click', () => toggleLyricsDrawer());
    on('lyrics-drawer-close-btn', 'click', () => toggleLyricsDrawer(false));

    // Bottom Player Bar (untouched structure, bound cleanly — title/cover triggers normal fade-in)
    const openNowPlaying = () => navigateTo('now-playing', { trigger: 'player-title' });
    on('player-cover-btn', 'click', openNowPlaying);
    on('player-title-btn', 'click', openNowPlaying);
    on('mobile-mini-track-btn', 'click', openNowPlaying);
    on('player-artist-btn', 'click', () => {
      const id = audioEngine?.currentSong?.artistId;
      if (id) openArtistDetail(id);
    });
    on('player-album-btn', 'click', () => {
      const id = audioEngine?.currentSong?.albumId;
      if (id) openAlbumDetail(id);
    });
    const starCurrent = () => audioEngine?.currentSong && toggleStarTrack(audioEngine.currentSong);
    ['np-star-btn', 'np-mobile-star-btn'].forEach((id) => on(id, 'click', starCurrent));
    ['player-more-btn', 'np-more-btn', 'np-mobile-more-btn'].forEach((id) =>
      on(id, 'click', (e) => {
        e.stopPropagation();
        if (audioEngine?.currentSong) openTrackContextMenu(e, audioEngine.currentSong, null);
      })
    );

    ['btn-play', 'sig-btn-play', 'mobile-mini-play', 'np-mobile-play'].forEach((id) => on(id, 'click', () => audioEngine.togglePlayPause()));
    ['btn-prev', 'sig-btn-prev', 'mobile-mini-prev', 'np-mobile-prev'].forEach((id) => on(id, 'click', () => audioEngine.previous()));
    ['btn-next', 'sig-btn-next', 'mobile-mini-next', 'np-mobile-next'].forEach((id) => on(id, 'click', () => audioEngine.next()));
    ['btn-shuffle', 'sig-btn-shuffle', 'np-mobile-shuffle'].forEach((id) =>
      on(id, 'click', () => {
        audioEngine.toggleShuffle();
        renderQueueViews(true);
      })
    );
    ['btn-repeat', 'sig-btn-repeat', 'np-mobile-repeat'].forEach((id) => on(id, 'click', () => audioEngine.cycleRepeatMode()));
    on('btn-signature', 'click', openSignatureView);

    ['seek-slider', 'sig-seek-slider', 'np-mobile-seek'].forEach((id) => {
      on(id, 'input', seekFromSlider);
      on(id, 'pointerdown', () => (state.scrubbing = true));
    });
    window.addEventListener('pointerup', () => {
      state.scrubbing = false;
      if (!seekRowHovered) $('player-center-track-wrap')?.classList.remove('opacity-0');
    });

    let seekRowHovered = false;
    on('player-seek-row', 'mouseenter', () => {
      seekRowHovered = true;
      $('player-center-track-wrap')?.classList.add('opacity-0');
    });
    on('player-seek-row', 'mouseleave', () => {
      seekRowHovered = false;
      if (!state.scrubbing) $('player-center-track-wrap')?.classList.remove('opacity-0');
    });

    on('volume-slider', 'input', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 0) state.lastNonZeroVolume = v;
      audioEngine.setVolume(v);
    });

    const toggleMute = () => {
      if (audioEngine.volume > 0) {
        state.lastNonZeroVolume = audioEngine.volume;
        audioEngine.setVolume(0);
      } else {
        audioEngine.setVolume(state.lastNonZeroVolume || 0.85);
      }
    };
    on('btn-mute', 'click', toggleMute);

    on('btn-volume', 'click', (e) => {
      e.stopPropagation();
      const toggle = $('volume-toggle');
      if (!toggle) return;
      if (!toggle.checked) {
        toggle.checked = true;
      } else {
        toggleMute();
      }
    });

    let isVolumeDragging = false;
    let pendingCloseVolume = false;

    const volumeSlider = $('volume-slider');
    if (volumeSlider) {
      volumeSlider.addEventListener('pointerdown', () => {
        isVolumeDragging = true;
      });
    }

    window.addEventListener('pointerup', () => {
      if (isVolumeDragging) {
        isVolumeDragging = false;
        if (pendingCloseVolume) {
          pendingCloseVolume = false;
          const toggle = $('volume-toggle');
          if (toggle) toggle.checked = false;
        }
      }
    });

    const playerBarPanel = $('player-bar-panel');
    if (playerBarPanel) {
      playerBarPanel.addEventListener('mouseleave', () => {
        const toggle = $('volume-toggle');
        if (!toggle || !toggle.checked) return;
        if (isVolumeDragging) {
          pendingCloseVolume = true;
          return;
        }
        toggle.checked = false;
      });
      playerBarPanel.addEventListener('mouseenter', () => {
        pendingCloseVolume = false;
      });
    }

    document.addEventListener('pointerdown', (e) => {
      const panel = $('player-bar-panel');
      const toggle = $('volume-toggle');
      if (panel && toggle && toggle.checked && !panel.contains(e.target)) {
        toggle.checked = false;
      }
    });

    // Now Playing + Resizable Split Rail (280px - 720px)
    on('np-browse-btn', 'click', () => navigateTo('albums'));
    on('np-artist-btn', 'click', () => audioEngine?.currentSong?.artistId && openArtistDetail(audioEngine.currentSong.artistId));
    on('np-album-btn', 'click', () => audioEngine?.currentSong?.albumId && openAlbumDetail(audioEngine.currentSong.albumId, 'now-playing'));
    on('np-tab-queue', 'click', () => setNpTab('queue'));
    on('np-tab-lyrics', 'click', () => setNpTab('lyrics'));
    on('np-clear-queue-btn', 'click', () => {
      audioEngine.clearQueue();
      renderQueueViews(true);
      renderNowPlaying();
    });
    on('np-mobile-back-btn', 'click', goBack);
    on('np-mobile-btn-queue', 'click', () => setNpMobileOverlay('queue'));
    on('np-mobile-btn-lyrics', 'click', () => setNpMobileOverlay('lyrics'));
    on('np-mobile-overlay-close', 'click', () => {
      const current = state.npMobileOverlay;
      if (current) setNpMobileOverlay(current);
    });

    const npResizer = $('np-rail-resizer');
    if (npResizer) {
      let resizingRail = false;
      npResizer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        resizingRail = true;
        npResizer.setPointerCapture?.(e.pointerId);
      });
      npResizer.addEventListener('pointermove', (e) => {
        if (!resizingRail) return;
        const width = Math.max(280, Math.min(720, Math.round(window.innerWidth - e.clientX)));
        state.npRailWidth = width;
        applyNpRailWidth();
      });
      const stopRailResize = () => {
        if (!resizingRail) return;
        resizingRail = false;
        localStorage.setItem(STORAGE_KEYS.NP_PANEL_WIDTH, String(state.npRailWidth));
      };
      npResizer.addEventListener('pointerup', stopRailResize);
      npResizer.addEventListener('pointercancel', stopRailResize);
    }

    // Lyrics toggles + Back-to-current-line pills + Source search
    document.querySelectorAll('[data-lyrics-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleLyricsPref(btn.getAttribute('data-lyrics-toggle')));
    });
    on('ld-lyrics-back-pill', 'click', () => resumeLyricsAutoScroll('drawer'));
    on('np-lyrics-back-pill', 'click', () => resumeLyricsAutoScroll('np'));
    on('sig-lyrics-back-pill', 'click', () => resumeLyricsAutoScroll('sig'));
    ['ld-lyrics-search-btn', 'np-lyrics-search-btn', 'btn-lyrics-source'].forEach((id) => on(id, 'click', openLyricsSourceModal));
    on('lyrics-source-close-btn', 'click', closeLyricsSourceModal);
    on('lyrics-manual-search-form', 'submit', (e) => {
      e.preventDefault();
      runManualLyricsSearch();
    });

    // Listening Room
    on('btn-close-signature', 'click', closeSignatureView);
    const nudgeOffset = (delta) => {
      const song = audioEngine?.currentSong;
      if (!song) return;
      lyricsManager.setTrackOffset(song.id, delta === null ? 0 : lyricsManager.getTrackOffset(song.id) + delta);
      updateLyricsOffsetDisplays();
      syncLyrics(true);
    };
    on('sig-offset-minus', 'click', () => nudgeOffset(-0.2));
    on('sig-offset-plus', 'click', () => nudgeOffset(0.2));
    on('sig-offset-reset', 'click', () => nudgeOffset(null));
    on('np-offset-minus', 'click', () => nudgeOffset(-0.2));
    on('np-offset-plus', 'click', () => nudgeOffset(0.2));
    on('np-offset-reset', 'click', () => nudgeOffset(null));
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((evt) => {
      $('signature-modal')?.addEventListener(evt, wakeSignatureChrome, { passive: true });
    });

    // Context menu
    on('ctx-play-now', 'click', () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) audioEngine.playQueue([s], 0, { shuffle: false, contextName: s.title, source: 'other' });
    });
    on('ctx-start-radio', 'click', () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) startRadio(s);
    });
    on('ctx-play-next', 'click', () => {
      if (state.ctxSong) {
        audioEngine.playNextInQueue(state.ctxSong);
        showToast(`Playing "${state.ctxSong.title}" next`);
      }
      closeTrackContextMenu();
    });
    on('ctx-add-queue', 'click', () => {
      if (state.ctxSong) {
        audioEngine.addToQueue(state.ctxSong);
        showToast(`Added "${state.ctxSong.title}" to queue`);
      }
      closeTrackContextMenu();
    });
    on('ctx-remove-queue', 'click', () => {
      if (state.ctxQueueIndex !== null) {
        audioEngine.removeFromQueue(state.ctxQueueIndex);
        renderQueueViews(true);
      }
      closeTrackContextMenu();
    });
    on('ctx-open-add-playlist', 'click', () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) openAddToPlaylistModal([s]);
    });
    on('ctx-goto-artist', 'click', () => {
      const id = state.ctxSong?.artistId;
      closeTrackContextMenu();
      if (id) {
        closeSignatureView();
        openArtistDetail(id);
      }
    });
    on('ctx-goto-album', 'click', () => {
      const id = state.ctxSong?.albumId;
      closeTrackContextMenu();
      if (id) {
        closeSignatureView();
        openAlbumDetail(id, state.route === 'now-playing' ? 'albums' : state.route);
      }
    });
    on('ctx-star-track', 'click', async () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) await toggleStarTrack(s);
    });

    // Initialize global Metadata & Cover Art Editor modal events (untouched)
    initMetadataEditorEvents();

    // Click-away for floating menus
    document.addEventListener('click', (e) => {
      const menu = $('track-context-menu');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) closeTrackContextMenu();
      document.querySelectorAll('[id$="-sort-menu"], #album-more-menu, #playlist-more-menu').forEach((m) => {
        if (!m.classList.contains('hidden') && !m.contains(e.target)) m.classList.add('hidden');
      });
    });

    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();

      const row = target.closest('[data-song-id], .queue-row');
      const song = row?.__song;
      if (song) {
        const queueIdx = typeof row.__queueIdx === 'number' ? row.__queueIdx : null;
        openTrackContextMenu(e, song, queueIdx);
        return;
      }

      if (target.closest('#bottom-player-bar, #view-now-playing, #signature-modal')) {
        if (audioEngine?.currentSong) openTrackContextMenu(e, audioEngine.currentSong, null);
        return;
      }
    });

    // Settings Tabs & Controls
    on('settings-modal-close-btn', 'click', closeSettings);
    $('settings-modal')?.addEventListener('click', (e) => {
      if (e.target === $('settings-modal')) closeSettings();
    });
    ['appearance', 'discovery', 'playback', 'audio', 'lyrics', 'library', 'server', 'nas'].forEach((t) => {
      on(`settings-tab-btn-${t}`, 'click', () => setSettingsTab(t));
    });

    // Appearance controls
    document.querySelectorAll('[data-palette-option]').forEach((card) => {
      card.addEventListener('click', () => {
        const pal = card.getAttribute('data-palette-option');
        if (!pal) return;
        state.appearance.palette = pal;
        localStorage.setItem(STORAGE_KEYS.THEME_PALETTE, pal);
        applyAppearanceTheme();
        renderAppearanceControls();
      });
    });
    document.querySelectorAll('[data-radius-option]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rad = btn.getAttribute('data-radius-option');
        if (!rad) return;
        state.appearance.radius = rad;
        localStorage.setItem(STORAGE_KEYS.THEME_RADIUS, rad);
        applyAppearanceTheme();
        renderAppearanceControls();
      });
    });
    on('settings-dense-rows-toggle', 'change', (e) => {
      state.appearance.denseRows = Boolean(e.target.checked);
      localStorage.setItem(STORAGE_KEYS.DENSE_VARIANT, state.appearance.denseRows ? 'true' : 'false');
      applyAppearanceTheme();
    });
    on('settings-pause-animations-toggle', 'change', (e) => {
      state.appearance.pauseAnimations = Boolean(e.target.checked);
      localStorage.setItem(STORAGE_KEYS.PAUSE_ANIMATIONS, state.appearance.pauseAnimations ? 'true' : 'false');
      applyAppearanceTheme();
    });

    // Discovery & Radio controls
    on('settings-rebuild-cooc-btn', 'click', async () => {
      const D = window.PlenripDiscovery;
      if (!D?.rebuildCooccurrenceIndex) return;
      showToast('Rebuilding co-occurrence graph...');
      await D.rebuildCooccurrenceIndex(true);
      await renderDiscoverySettings();
      showToast('Recommendation index updated');
    });
    $('settings-adventurousness-group')?.querySelectorAll('[data-adventurousness]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const adv = btn.getAttribute('data-adventurousness') || 'balanced';
        state.discoverySettings.adventurousness = adv;
        localStorage.setItem(STORAGE_KEYS.ADVENTUROUSNESS, adv);
        void renderDiscoverySettings();
      });
    });
    const wireDiscoverySlider = (id, labelId, field, storageKey, suffix = '') => {
      on(id, 'input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (Number.isNaN(val)) return;
        state.discoverySettings[field] = val;
        localStorage.setItem(storageKey, String(val));
        if ($(labelId)) $(labelId).textContent = `${val}${suffix}`;
        window.PlenripDiscovery?.clearShelfCache?.();
        if (state.route === 'home') void renderHomeHistorySections();
      });
    };
    wireDiscoverySlider('settings-silence-days', 'settings-silence-days-val', 'silenceDays', STORAGE_KEYS.SILENCE_DAYS, 'd');
    wireDiscoverySlider('settings-starred-cooldown', 'settings-starred-cooldown-val', 'starredCooldownDays', STORAGE_KEYS.STARRED_COOLDOWN_DAYS, 'd');
    wireDiscoverySlider('settings-quickpick-hours', 'settings-quickpick-hours-val', 'quickPickExclusionHours', STORAGE_KEYS.QUICKPICK_EXCLUSION_HOURS, 'h');
    wireDiscoverySlider('settings-max-per-artist', 'settings-max-per-artist-val', 'maxPerArtist', STORAGE_KEYS.MAX_PER_ARTIST_SHELF, '');

    on('settings-export-history-btn', 'click', async () => {
      const D = window.PlenripDiscovery;
      if (!D?.exportPlayEventLogJson) return;
      const json = await D.exportPlayEventLogJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plenrip-discovery-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('Exported discovery telemetry JSON');
    });
    on('settings-import-history-input', 'change', async (e) => {
      const file = e.target?.files?.[0];
      if (!file || !window.PlenripDiscovery?.importPlayEventLogJson) return;
      try {
        const text = await file.text();
        const res = await window.PlenripDiscovery.importPlayEventLogJson(text);
        window.PlenripDiscovery.clearShelfCache?.();
        await renderDiscoverySettings();
        if (state.route === 'home') void renderHomeHistorySections();
        showToast(`Imported ${res?.imported ?? 0} play events`);
      } catch (err) {
        showToast(`Import failed: ${err.message}`);
      } finally {
        e.target.value = '';
      }
    });

    // Existing Playback, Audio, Lyrics, Library, Server, NAS settings bindings
    on('settings-split-albums-toggle', 'change', (e) => {
      setSplitAlbumsSingles(e.target.checked);
      libraryViews.albums?.load(true);
      if (state.route === 'artist-detail') navigateTo('artist-detail');
    });
    on('settings-word-sweep-toggle', 'change', (e) => {
      lyricsManager.setWordSweep(e.target.checked);
      renderAllLyrics();
    });
    on('settings-split-bg-toggle', 'change', (e) => {
      lyricsManager.setSplitBackground(e.target.checked);
      renderAllLyrics();
    });
    on('settings-manual-scroll-pause-toggle', 'change', (e) => {
      lyricsManager.setManualScrollPause(e.target.checked);
      renderAllLyrics();
    });
    on('settings-hide-played-toggle', 'change', (e) => {
      lyricsManager.setHidePlayed(e.target.checked);
      renderAllLyrics();
    });
    on('settings-hide-upcoming-toggle', 'change', (e) => {
      lyricsManager.setHideUpcoming(e.target.checked);
      renderAllLyrics();
    });
    on('settings-clear-lyrics-cache-btn', 'click', () => {
      lyricsManager.clearLyricsCache();
      showToast('Cleared cached lyrics');
      state.lyrics.result = null;
      state.lyrics.trackId = null;
      if (audioEngine?.currentSong) ensureLyrics(true);
    });
    on('settings-output-device', 'change', (e) => audioEngine.setOutputDevice(e.target.value || 'default'));
    on('settings-crossfade-slider', 'input', (e) => {
      const v = parseInt(e.target.value, 10) || 0;
      audioEngine.setCrossfadeSeconds(v);
      $('settings-crossfade-label').textContent = v === 0 ? '0s (Gapless cut)' : `${v}s`;
    });
    on('settings-autoplay-toggle', 'change', (e) => {
      audioEngine.setAutoplay(e.target.checked);
      renderQueueViews(true);
    });
    on('settings-balanced-shuffle-toggle', 'change', (e) => {
      audioEngine.setBalancedShuffleEnabled(e.target.checked);
      renderQueueViews(true);
    });
    $('settings-norm-group')?.querySelectorAll('[data-norm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        audioEngine.setNormalization(btn.getAttribute('data-norm'));
        renderSettings();
      });
    });
    on('settings-preamp-slider', 'input', (e) => {
      const v = parseFloat(e.target.value) || 0;
      audioEngine.setPreampDb(v);
      $('settings-preamp-label').textContent = `${v > 0 ? '+' : ''}${v} dB`;
    });
    on('settings-stream-quality', 'change', (e) => audioEngine.setStreamQuality(e.target.value));
    on('settings-translated-titles-toggle', 'change', (e) => titles.setEnabled(e.target.checked));
    on('settings-clear-history-btn', 'click', () => {
      historyStore.clear();
      window.PlenripDiscovery?.clearShelfCache?.();
      renderSettings();
      showToast('Cleared local listening history');
      if (state.route === 'home') void renderHomeHistorySections();
    });
    on('settings-recheck-btn', 'click', retryConnection);
    on('settings-pass-toggle-btn', 'click', () => {
      const input = $('settings-server-pass');
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      setIcon($('settings-pass-eye-icon'), reveal ? 'eye-off' : 'eye');
    });
    on('settings-server-form', 'submit', async (e) => {
      e.preventDefault();
      const errBox = $('settings-server-error-box');
      show(errBox, false);
      const res = await verifyAndSaveNavidromeConfig({
        serverUrl: $('settings-server-url').value,
        username: $('settings-server-user').value,
        password: $('settings-server-pass').value,
      });
      if (!res.ok) {
        if ($('settings-server-error-title')) $('settings-server-error-title').textContent = res.title || 'Connection error';
        if ($('settings-server-error-msg')) $('settings-server-error-msg').textContent = res.message || 'Check server URL and credentials.';
        show(errBox, true);
        setConnectionError(res.title || 'Connection failed');
        if (res.focusField === 'url') $('settings-server-url')?.focus();
        else if (res.focusField === 'user') $('settings-server-user')?.focus();
        else if (res.focusField === 'pass') $('settings-server-pass')?.focus();
        refreshIcons();
        return;
      }
      $('settings-server-pass').value = '';
      $('settings-server-pass').placeholder = 'Leave blank to keep existing';
      showToast('Connected to Navidrome');
      await Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]);
      if (state.route !== 'welcome') navigateTo(state.route);
    });
    on('settings-reset-server-btn', 'click', async () => {
      client.saveConfig(DEFAULT_CONFIG.serverUrl, DEFAULT_CONFIG.username, DEFAULT_CONFIG.password);
      renderSettings();
      showToast('Restored default Navidrome settings');
      await retryConnection();
    });
    on('settings-disconnect-server-btn', 'click', () => {
      client.clearConfig();
      clearLibraryCachesForReconnect();
      setConnectionError('Disconnected from Navidrome server');
      show($('error-banner'), false);
      const badge = $('settings-ping-badge');
      if (badge) badge.textContent = 'Disconnected from Navidrome server';
      renderSettings();
      showToast('Disconnected from Navidrome');
    });
    on('settings-rerun-welcome-btn', 'click', () => {
      const wt = readWalkthroughState();
      writeWalkthroughState({
        status: 'in_progress',
        skippedSteps: wt?.skippedSteps || [],
      });
      closeSettings();
      navigateTo('welcome');
    });

    // NAS Storage Settings
    on('settings-nas-recheck-btn', 'click', checkFilesBridge);
    on('settings-nas-key-toggle-btn', 'click', () => {
      const input = $('settings-nas-key');
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      setIcon($('settings-nas-key-eye-icon'), reveal ? 'eye-off' : 'eye');
    });
    on('settings-nas-form', 'submit', async (e) => {
      e.preventDefault();
      const rawUrl = $('settings-nas-url')?.value?.trim() || '';
      const rawKey = $('settings-nas-key')?.value?.trim() || '';
      const cleanUrl = /^http:\/\/(localhost|127\.0\.0\.1):3001$/i.test(rawUrl) ? '' : rawUrl.replace(/\/+$/, '');

      filesState.bridgeUrl = cleanUrl;
      filesState.apiKey = rawKey;

      if (cleanUrl) {
        localStorage.setItem('century.nas_url', cleanUrl);
        localStorage.setItem('century.file_bridge_url', cleanUrl);
      } else {
        localStorage.removeItem('century.nas_url');
        localStorage.removeItem('century.file_bridge_url');
      }
      if (rawKey) {
        localStorage.setItem('century.nas_api_key', rawKey);
      } else {
        localStorage.removeItem('century.nas_api_key');
      }

      const bridgeUrlInput = $('files-bridge-url-input');
      if (bridgeUrlInput) bridgeUrlInput.value = cleanUrl;

      showToast('Saved NAS Storage settings');
      await checkFilesBridge();
      if (state.route === 'files') {
        loadFilesView();
      }
    });
    on('settings-reset-nas-btn', 'click', async () => {
      filesState.bridgeUrl = '';
      filesState.apiKey = '';
      localStorage.removeItem('century.nas_url');
      localStorage.removeItem('century.file_bridge_url');
      localStorage.removeItem('century.nas_api_key');
      renderSettings();
      showToast('Restored default NAS settings');
      await checkFilesBridge();
      if (state.route === 'files') {
        loadFilesView();
      }
    });

    // Translations arriving later re-render whatever is on screen
    let titleRerenderTimer = null;
    titles.onUpdate(() => {
      if (titleRerenderTimer) clearTimeout(titleRerenderTimer);
      titleRerenderTimer = setTimeout(rerenderCurrentRoute, 350);
    });

    bindWelcomeEvents();

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
      const onWelcome = state.route === 'welcome';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (onWelcome) return;
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
        return;
      }

      if (e.key === 'Escape') {
        const isOverlayOpen = (el) =>
          window.PlenripAnimations?.isOverlayOpen
            ? window.PlenripAnimations.isOverlayOpen(el)
            : Boolean(el && !el.classList.contains('hidden'));
        const volToggle = $('volume-toggle');
        if (volToggle && volToggle.checked) {
          volToggle.checked = false;
          return;
        }
        if (isOverlayOpen($('track-context-menu'))) return closeTrackContextMenu();
        if (metaEditorState.active || !$('files-metadata-modal')?.classList.contains('hidden')) return closeMetadataEditor();
        for (const id of ['add-to-playlist-modal', 'save-queue-playlist-modal', 'create-playlist-modal', 'playlist-cover-modal']) {
          if (isOverlayOpen($(id))) return closeModal(id);
        }
        if (state.lyricsSourceModalOpen) return closeLyricsSourceModal();
        if (state.settingsOpen) return closeSettings();
        if (isOverlayOpen($('shortcuts-modal'))) return closeModal('shortcuts-modal');
        if (state.signatureOpen) return closeSignatureView();
        if (state.queueOpen) return toggleQueueDrawer(false);
        if (state.lyricsDrawerOpen) return toggleLyricsDrawer(false);
        if (onWelcome) return;
        return goBack();
      }
      if (typing) return;
      const k = e.key.toLowerCase();

      if (e.key === '/') {
        if (onWelcome) return;
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
      } else if (e.key === '?') {
        if (onWelcome) return;
        e.preventDefault();
        const shortcutsEl = $('shortcuts-modal');
        const isOpen = window.PlenripAnimations?.isOverlayOpen
          ? window.PlenripAnimations.isOverlayOpen(shortcutsEl)
          : Boolean(shortcutsEl && !shortcutsEl.classList.contains('hidden'));
        isOpen ? closeModal('shortcuts-modal') : openModal('shortcuts-modal');
      } else if (e.code === 'Space') {
        e.preventDefault();
        audioEngine.togglePlayPause();
      } else if (e.key === ']' || k === 'n') {
        if (onWelcome) return;
        e.preventDefault();
        audioEngine.next();
      } else if (e.key === '[' || k === 'p') {
        if (onWelcome) return;
        e.preventDefault();
        audioEngine.previous();
      } else if (k === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        audioEngine.seek((audioEngine.currentTime || 0) + 10);
      } else if (k === 'j' || e.key === 'ArrowLeft') {
        e.preventDefault();
        audioEngine.seek(Math.max(0, (audioEngine.currentTime || 0) - 10));
      } else if (k === 's') {
        if (onWelcome) return;
        e.preventDefault();
        audioEngine.toggleShuffle();
        renderQueueViews(true);
      } else if (k === 'r') {
        if (onWelcome) return;
        e.preventDefault();
        audioEngine.cycleRepeatMode();
      } else if (k === 'q') {
        if (onWelcome) return;
        e.preventDefault();
        toggleQueueDrawer();
      } else if (k === 'u') {
        if (onWelcome) return;
        e.preventDefault();
        state.signatureOpen ? closeSignatureView() : openSignatureView();
      }
    });

    window.addEventListener('resize', () => {
      updateViewportScale();
      applyNpRailWidth();
      if (anyLyricsVisible()) renderAllLyrics();
    });

    document.addEventListener('input', (e) => {
      if (e.target && e.target.type === 'range') {
        updateSliderFill(e.target);
      }
    });
  }

  // ============================================================================
  // Welcome Onboarding Walkthrough (5 Steps)
  // ============================================================================
  const welcomeState = {
    step: 1,
    skippedSteps: [],
    busy: false,
    step2Loading: false,
    step2LoadedOnce: false,
    samplePlaying: false,
    step3BridgeProbed: false,
    step4SearchOpen: false,
    step4Timer: null,
  };

  function addSkippedStep(stepNum) {
    if (!welcomeState.skippedSteps.includes(stepNum)) {
      welcomeState.skippedSteps.push(stepNum);
    }
  }

  function clearWelcomeStep1Errors() {
    ['welcome-url-error', 'welcome-user-error', 'welcome-pass-error'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.textContent = '';
        el.classList.add('hidden');
      }
    });
    ['welcome-server-url', 'welcome-username', 'welcome-password'].forEach((id) => {
      $(id)?.classList.remove('border-[#f0605a]');
    });
    show($('welcome-step1-alert'), false);
  }

  function setWelcomeFieldError(inputId, errorId, msg) {
    const input = $(inputId);
    const errEl = $(errorId);
    if (input) input.classList.add('border-[#f0605a]');
    if (errEl) {
      errEl.innerHTML = `<i data-lucide="alert-circle" class="w-3.5 h-3.5 shrink-0"></i><span>${escapeHtml(msg)}</span>`;
      errEl.classList.remove('hidden');
    }
  }

  function setWelcomeStep(stepNum, options = {}) {
    const prevStep = welcomeState.step || 1;
    const step = Math.max(1, Math.min(5, Number(stepNum) || 1));
    welcomeState.step = step;

    const label = $('welcome-step-label');
    if (label) label.textContent = `Step ${step} of 5`;
    const fill = $('welcome-progress-fill');
    if (fill) {
      if (options.animate !== false && window.PlenripAnimations?.animateWelcomeProgress) {
        window.PlenripAnimations.animateWelcomeProgress(fill, step / 5);
      } else {
        fill.style.transform = `scaleX(${step / 5})`;
      }
    }
    const card = $('welcome-card');
    if (card) card.setAttribute('aria-label', `Walkthrough step ${step} of 5`);

    for (let i = 1; i <= 5; i += 1) {
      const panel = $(`welcome-step-${i}`);
      if (!panel) continue;
      const active = i === step;
      panel.classList.toggle('hidden', !active);
      if (active && options.animate !== false && window.PlenripAnimations?.animateWelcomeStep) {
        window.PlenripAnimations.animateWelcomeStep(panel, step >= prevStep ? 1 : -1);
      }
    }

    if (step === 1) {
      clearWelcomeStep1Errors();
    } else if (step === 2) {
      void loadWelcomeStep2(false);
    } else if (step === 3) {
      void initWelcomeStep3();
    } else if (step === 4) {
      initWelcomeStep4();
    } else if (step === 5) {
      updateWelcomeStep5();
    }
    refreshIcons();
  }

  function initWelcomeView() {
    const wt = readWalkthroughState();
    welcomeState.skippedSteps = Array.isArray(wt?.skippedSteps) ? [...wt.skippedSteps] : [];
    welcomeState.step2LoadedOnce = false;
    welcomeState.step3BridgeProbed = false;
    welcomeState.samplePlaying = false;
    welcomeState.step4SearchOpen = false;

    if ($('welcome-server-url')) $('welcome-server-url').value = client.baseUrl || DEFAULT_CONFIG.serverUrl;
    if ($('welcome-username')) $('welcome-username').value = client.username || '';
    if ($('welcome-password')) $('welcome-password').value = '';

    const startStep = client.hasSavedCredentials() ? 2 : 1;
    if (startStep === 1) {
      state.connected = false;
    }
    setWelcomeStep(startStep, { animate: false });
  }

  async function loadWelcomeStep2(force = false) {
    if ($('welcome-host-label')) {
      $('welcome-host-label').textContent = formatServerHost(client.baseUrl);
    }
    if (welcomeState.step2Loading) return;
    if (welcomeState.step2LoadedOnce && !force) return;

    welcomeState.step2Loading = true;
    show($('welcome-step2-loading'), true);
    show($('welcome-step2-error'), false);
    show($('welcome-step2-stats'), false);
    show($('welcome-step2-empty'), false);

    try {
      if (force) {
        state.songs = null;
        state.songsPromise = null;
        state.artists = null;
        state.albumsByType = {};
        state.mergedAlbums = null;
      }
      const [songs, artists, albums] = await Promise.all([
        loadAllSongs(),
        loadAllArtists(),
        loadAllAlbums('newest'),
      ]);

      welcomeState.step2LoadedOnce = true;
      show($('welcome-step2-loading'), false);

      const tracksCount = Array.isArray(songs) ? songs.length : 0;
      const artistsCount = Array.isArray(artists) ? artists.length : 0;
      const albumsCount = Array.isArray(albums) ? albums.length : 0;

      if (tracksCount === 0) {
        const scan = await client.getScanStatus();
        const emptyMsg = $('welcome-step2-empty-msg');
        if (emptyMsg) {
          emptyMsg.textContent = scan.scanning
            ? `Navidrome is scanning your library... (${scan.count || 0} tracks scanned)`
            : 'No tracks in this library yet.';
        }
        show($('welcome-step2-empty'), true);
        refreshIcons();
        return;
      }

      if ($('welcome-stat-tracks')) $('welcome-stat-tracks').textContent = tracksCount.toLocaleString();
      if ($('welcome-stat-artists')) $('welcome-stat-artists').textContent = artistsCount.toLocaleString();
      if ($('welcome-stat-albums')) $('welcome-stat-albums').textContent = albumsCount.toLocaleString();

      const coversWrap = $('welcome-recent-covers');
      if (coversWrap) {
        coversWrap.innerHTML = '';
        const sampleAlbums = (albums || []).slice(0, 4);
        sampleAlbums.forEach((alb) => {
          const box = document.createElement('div');
          box.className = 'relative w-14 h-14 bg-zinc-950 border border-zinc-700 overflow-hidden flex items-center justify-center radius-inner shrink-0';
          box.title = alb.name || 'Album';
          const img = document.createElement('img');
          img.alt = '';
          img.className = 'hidden w-full h-full object-cover';
          const fb = document.createElement('div');
          fb.className = 'text-zinc-500 flex items-center justify-center';
          fb.innerHTML = '<i data-lucide="disc" class="w-5 h-5"></i>';
          box.appendChild(img);
          box.appendChild(fb);
          attachCoverImage(img, fb, alb.coverArt, null, 120);
          coversWrap.appendChild(box);
        });
        show(coversWrap, sampleAlbums.length > 0);
      }

      show($('welcome-step2-stats'), true);
      refreshIcons();
    } catch (err) {
      show($('welcome-step2-loading'), false);
      const mapped = classifySubsonicError(err, client.baseUrl);
      if ($('welcome-step2-error-msg')) {
        $('welcome-step2-error-msg').textContent = mapped.message || 'Could not load library counts.';
      }
      show($('welcome-step2-error'), true);
      refreshIcons();
    } finally {
      welcomeState.step2Loading = false;
    }
  }

  function updateWelcomeStep2ContinueStyle() {
    const nextBtn = $('welcome-step2-next-btn');
    if (!nextBtn) return;
    const active = welcomeState.samplePlaying;
    nextBtn.classList.toggle('bg-emerald-400', active);
    nextBtn.classList.toggle('hover:bg-emerald-300', active);
    nextBtn.classList.toggle('text-zinc-950', active);
    nextBtn.classList.toggle('font-semibold', active);
    nextBtn.classList.toggle('bg-zinc-800', !active);
    nextBtn.classList.toggle('hover:bg-zinc-700', !active);
    nextBtn.classList.toggle('border', !active);
    nextBtn.classList.toggle('border-zinc-600', !active);
    nextBtn.classList.toggle('text-zinc-100', !active);
  }

  function renderWelcomeBridgeStatus(online, message = '') {
    const dot = $('welcome-bridge-dot');
    const txt = $('welcome-bridge-status-text');
    const last = $('welcome-bridge-last-checked');
    if (dot) {
      dot.classList.remove('bg-zinc-500', 'bg-[#22c55e]', 'bg-[#f0605a]');
      if (online === null) dot.classList.add('bg-zinc-500');
      else if (online) dot.classList.add('bg-[#22c55e]');
      else dot.classList.add('bg-[#f0605a]');
    }
    if (txt) txt.textContent = message;
    if (last) {
      last.textContent = online === null ? '' : `Last checked: ${new Date().toLocaleTimeString()}`;
    }
  }

  function saveWelcomeBridgeInputs() {
    const rawUrl = $('welcome-bridge-url')?.value?.trim() || '';
    const rawKey = $('welcome-bridge-key')?.value?.trim() || '';
    const cleanUrl = /^http:\/\/(localhost|127\.0\.0\.1):3001$/i.test(rawUrl) ? '' : rawUrl.replace(/\/+$/, '');
    filesState.bridgeUrl = cleanUrl;
    filesState.apiKey = rawKey;
    try {
      if (cleanUrl) {
        localStorage.setItem('century.nas_url', cleanUrl);
        localStorage.setItem('century.file_bridge_url', cleanUrl);
      } else {
        localStorage.removeItem('century.nas_url');
        localStorage.removeItem('century.file_bridge_url');
      }
      if (rawKey) localStorage.setItem('century.nas_api_key', rawKey);
      else localStorage.removeItem('century.nas_api_key');
    } catch {
      // Ignore storage errors
    }
  }

  async function testWelcomeBridgeConnection({ initialCheck = false } = {}) {
    show($('welcome-bridge-error'), false);
    renderWelcomeBridgeStatus(null, 'Checking file bridge...');
    const online = await checkFilesBridge();
    const base = getFileBridgeBase();
    if (online) {
      renderWelcomeBridgeStatus(true, `Connected to file bridge on ${base}`);
      if (initialCheck) {
        show($('welcome-bridge-fields'), false);
        show($('welcome-bridge-edit-toggle'), true);
        if ($('welcome-step3-next-btn')) $('welcome-step3-next-btn').textContent = 'Next';
      }
    } else {
      renderWelcomeBridgeStatus(false, `File bridge not detected on ${base}`);
      if (initialCheck) {
        show($('welcome-bridge-fields'), true);
        show($('welcome-bridge-edit-toggle'), false);
        if ($('welcome-step3-next-btn')) $('welcome-step3-next-btn').textContent = 'Save & continue';
      }
    }
    return online;
  }

  async function initWelcomeStep3() {
    if ($('welcome-bridge-url')) {
      const savedNas = (localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url') || '').trim();
      $('welcome-bridge-url').value = /^http:\/\/(localhost|127\.0\.0\.1):3001$/i.test(savedNas) ? '' : savedNas;
    }
    if ($('welcome-bridge-key')) {
      $('welcome-bridge-key').value = getFileBridgeApiKey();
    }
    show($('welcome-bridge-error'), false);
    if (!welcomeState.step3BridgeProbed) {
      welcomeState.step3BridgeProbed = true;
      await testWelcomeBridgeConnection({ initialCheck: true });
    }
  }

  function initWelcomeStep4() {
    const isApple = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
    if ($('welcome-shortcut-kbd')) {
      $('welcome-shortcut-kbd').textContent = isApple ? 'Cmd+K' : 'Ctrl+K';
    }
    if (!state.songs) void ensureLocalSearchIndex();
  }

  function openWelcomeStep4Search() {
    welcomeState.step4SearchOpen = true;
    show($('welcome-quick-search-wrap'), true);
    const input = $('welcome-quick-search-input');
    if (input) {
      input.focus();
      void runWelcomeStep4Search(input.value);
    }
  }

  async function runWelcomeStep4Search(rawQuery) {
    const q = String(rawQuery || '').trim();
    const listEl = $('welcome-quick-search-results');
    const clearBtn = $('welcome-quick-search-clear');
    show(clearBtn, q.length > 0);
    if (!listEl) return;

    if (!q) {
      listEl.innerHTML = '<div class="p-3 text-xs font-mono text-zinc-400">Type a few letters to search your local library.</div>';
      return;
    }

    const res = await executeSmartSearch(q);
    const items = [
      ...(res.song || []).slice(0, 3).map((s) => ({ kind: 'song', item: s })),
      ...(res.album || []).slice(0, 1).map((a) => ({ kind: 'album', item: a })),
      ...(res.artist || []).slice(0, 1).map((a) => ({ kind: 'artist', item: a })),
    ].slice(0, 5);

    listEl.innerHTML = '';
    if (items.length === 0) {
      listEl.innerHTML = `<div class="p-3 text-xs font-mono text-zinc-400">No matches for "${escapeHtml(q)}".</div>`;
      return;
    }

    items.forEach(({ kind, item }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full min-h-11 sm:min-h-9 px-3 py-2 text-left hover:bg-zinc-900 flex items-center justify-between gap-3 text-xs transition-colors';
      const title = kind === 'song' ? item.title : item.name;
      const sub = kind === 'song' ? (item.artist || 'Song') : kind === 'album' ? (item.artist || 'Album') : 'Artist';
      btn.innerHTML = `
        <div class="min-w-0">
          <div class="text-zinc-100 font-medium truncate">${escapeHtml(title || 'Untitled')}</div>
          <div class="text-[11px] font-mono text-zinc-400 truncate">${escapeHtml(sub)}</div>
        </div>
        <span class="px-1.5 py-0.5 text-[10px] font-mono uppercase border border-zinc-700 bg-zinc-900 text-emerald-400 shrink-0">${escapeHtml(kind)}</span>`;
      btn.addEventListener('click', async () => {
        if (kind === 'song') {
          playOrToggle(item, [item], 0, { contextName: 'Welcome Search', source: 'search' });
          showToast(`Playing: ${item.title || 'Untitled'}`);
        } else if (kind === 'album') {
          const detail = await client.resolveAlbumSongs(item).catch(() => null);
          if (detail?.song?.length) {
            playSongs(detail.song, { contextName: detail.name, source: 'album' });
            showToast(`Playing album: ${detail.name}`);
          }
        } else if (kind === 'artist') {
          const detail = await client.getArtist(item.id).catch(() => null);
          const firstAlb = detail?.album?.[0];
          if (firstAlb) {
            const albDetail = await client.resolveAlbumSongs(firstAlb).catch(() => null);
            if (albDetail?.song?.length) {
              playSongs(albDetail.song, { contextName: item.name, source: 'artists' });
              showToast(`Playing ${item.name}`);
            }
          }
        }
      });
      listEl.appendChild(btn);
    });
  }

  function updateWelcomeStep5() {
    const qLen = audioEngine?.queue?.length || 0;
    const hint = $('welcome-queue-hint');
    if (hint) {
      hint.textContent = qLen > 0 ? `(${qLen} queued)` : '';
      show(hint, qLen > 0);
    }
  }

  function completeWelcomeToHome(skipped = false) {
    if (skipped) {
      addSkippedStep(3);
      addSkippedStep(4);
    }
    writeWalkthroughState({
      status: skipped ? 'skipped' : 'completed',
      skippedSteps: welcomeState.skippedSteps,
      completedAt: Date.now(),
    });
    void Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]).catch(() => {});
    if (window.PlenripDiscovery?.flushScrobbleQueue) {
      void window.PlenripDiscovery.flushScrobbleQueue(client);
    }
    loadAllArtists().catch(() => {});
    navigateTo('home');
  }

  function bindWelcomeEvents() {
    on('welcome-pass-toggle', 'click', () => {
      const input = $('welcome-password');
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      setIcon($('welcome-pass-eye-icon'), reveal ? 'eye-off' : 'eye');
    });

    on('welcome-step1-form', 'submit', async (e) => {
      e.preventDefault();
      if (welcomeState.busy) return;
      clearWelcomeStep1Errors();

      const urlVal = $('welcome-server-url')?.value || '';
      const userVal = $('welcome-username')?.value || '';
      const passVal = $('welcome-password')?.value || '';
      const btn = $('welcome-connect-btn');

      welcomeState.busy = true;
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i><span>Connecting...</span>';
        refreshIcons();
      }

      try {
        const res = await verifyAndSaveNavidromeConfig({
          serverUrl: urlVal,
          username: userVal,
          password: passVal,
        });

        if (!res.ok) {
          if (res.errorKind === 'missing_fields') {
            if (!normalizeServerUrlInput(urlVal)) setWelcomeFieldError('welcome-server-url', 'welcome-url-error', 'Server URL is required.');
            if (!String(userVal).trim()) setWelcomeFieldError('welcome-username', 'welcome-user-error', 'Username is required.');
          } else if (res.errorKind === 'invalid_url') {
            setWelcomeFieldError('welcome-server-url', 'welcome-url-error', res.message);
          } else if (res.errorKind === 'password_required') {
            setWelcomeFieldError('welcome-password', 'welcome-pass-error', res.message);
          }

          if ($('welcome-step1-alert-title')) $('welcome-step1-alert-title').textContent = res.title || 'Connection failed';
          if ($('welcome-step1-alert-msg')) $('welcome-step1-alert-msg').textContent = res.message || 'Check your details and try again.';
          show($('welcome-step1-alert'), true);

          if (res.focusField === 'url') $('welcome-server-url')?.focus();
          else if (res.focusField === 'user') $('welcome-username')?.focus();
          else if (res.focusField === 'pass') $('welcome-password')?.focus();
          refreshIcons();
          return;
        }

        if ($('welcome-password')) $('welcome-password').value = '';
        welcomeState.step2LoadedOnce = false;
        writeWalkthroughState({ status: 'in_progress', skippedSteps: welcomeState.skippedSteps });
        void Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]).catch(() => {});
        setWelcomeStep(2);
      } finally {
        welcomeState.busy = false;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>Connect &amp; continue</span>';
        }
      }
    });

    on('welcome-step2-retry-btn', 'click', () => void loadWelcomeStep2(true));
    on('welcome-refresh-counts-btn', 'click', () => void loadWelcomeStep2(true));
    on('welcome-play-sample-btn', 'click', async () => {
      let pool = Array.isArray(state.songs) && state.songs.length > 0 ? state.songs : [];
      if (pool.length === 0) {
        pool = await client.getRandomSongs(50).catch(() => []);
      }
      if (pool.length === 0) {
        showToast('No playable tracks found yet.');
        return;
      }
      playSongs(pool, { shuffle: true, contextName: 'Welcome Mix', source: 'home' });
      const song = audioEngine?.currentSong || pool[0];
      welcomeState.samplePlaying = true;
      updateWelcomeStep2ContinueStyle();
      if (song && $('welcome-now-playing-text')) {
        $('welcome-now-playing-text').textContent = `Now playing: ${song.title || 'Untitled'} - ${song.artist || 'Unknown Artist'}`;
        show($('welcome-now-playing-inline'), true);
      }
    });
    on('welcome-step2-back-btn', 'click', () => setWelcomeStep(1));
    on('welcome-step2-skip-btn', 'click', () => completeWelcomeToHome(true));
    on('welcome-step2-next-btn', 'click', () => setWelcomeStep(3));

    on('welcome-bridge-key-toggle', 'click', () => {
      const input = $('welcome-bridge-key');
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      setIcon($('welcome-bridge-key-eye'), reveal ? 'eye-off' : 'eye');
    });
    on('welcome-bridge-edit-toggle', 'click', () => {
      const fields = $('welcome-bridge-fields');
      if (!fields) return;
      const willOpen = fields.classList.contains('hidden');
      show(fields, willOpen);
      if ($('welcome-step3-next-btn')) {
        $('welcome-step3-next-btn').textContent = willOpen ? 'Save & continue' : 'Next';
      }
    });
    on('welcome-bridge-test-btn', 'click', async () => {
      saveWelcomeBridgeInputs();
      await testWelcomeBridgeConnection({ initialCheck: false });
    });
    on('welcome-step3-back-btn', 'click', () => setWelcomeStep(2));
    on('welcome-step3-skip-btn', 'click', () => {
      addSkippedStep(3);
      writeWalkthroughState({ status: 'in_progress', skippedSteps: welcomeState.skippedSteps });
      setWelcomeStep(4);
    });
    on('welcome-step3-next-btn', 'click', async () => {
      const fieldsOpen = !$('welcome-bridge-fields')?.classList.contains('hidden');
      if (fieldsOpen) saveWelcomeBridgeInputs();
      const online = await testWelcomeBridgeConnection({ initialCheck: false });
      if (online) {
        setWelcomeStep(4);
      } else {
        const errEl = $('welcome-bridge-error');
        if (errEl) {
          errEl.textContent = 'File bridge is offline. Verify the URL and API key, or choose Skip for now.';
          show(errEl, true);
        }
      }
    });

    on('welcome-shortcut-show-btn', 'click', openWelcomeStep4Search);
    on('welcome-quick-search-input', 'input', (e) => {
      const val = e.target.value;
      clearTimeout(welcomeState.step4Timer);
      welcomeState.step4Timer = setTimeout(() => void runWelcomeStep4Search(val), 120);
    });
    on('welcome-quick-search-input', 'keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        const input = $('welcome-quick-search-input');
        if (input && input.value) {
          input.value = '';
          void runWelcomeStep4Search('');
        } else {
          input?.blur();
        }
      }
    });
    on('welcome-quick-search-clear', 'click', () => {
      const input = $('welcome-quick-search-input');
      if (input) {
        input.value = '';
        input.focus();
      }
      void runWelcomeStep4Search('');
    });
    on('welcome-step4-back-btn', 'click', () => setWelcomeStep(3));
    on('welcome-step4-skip-btn', 'click', () => {
      addSkippedStep(4);
      writeWalkthroughState({ status: 'in_progress', skippedSteps: welcomeState.skippedSteps });
      setWelcomeStep(5);
    });
    on('welcome-step4-next-btn', 'click', () => setWelcomeStep(5));

    on('welcome-step5-back-btn', 'click', () => setWelcomeStep(4));
    on('welcome-finish-btn', 'click', () => completeWelcomeToHome(false));

    // Capture-phase Cmd/Ctrl+K inside Step 4
    window.addEventListener(
      'keydown',
      (e) => {
        if (state.route === 'welcome' && welcomeState.step === 4 && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          e.stopPropagation();
          openWelcomeStep4Search();
        }
      },
      true
    );
  }

  function rerenderCurrentRoute() {
    switch (state.route) {
      case 'home': void renderHomeHistorySections(); loadHomeView(); break;
      case 'artists': libraryViews.artists.render(); break;
      case 'albums': libraryViews.albums.render(); break;
      case 'songs': libraryViews.songs.render(); break;
      case 'files': loadFilesView(); break;
      case 'search': renderSearchResults(); break;
      case 'favourites': loadFavouritesView(); break;
      case 'album-detail': renderAlbumDetailView(); break;
      case 'playlist-detail': renderPlaylistDetailTracks(); break;
      case 'now-playing': renderNowPlaying(); renderQueueViews(true); break;
      default: break;
    }
    lastPlayerTrackId = null;
    updatePlayerBarUI();
    if (state.queueOpen) renderQueueViews(true);
  }

  // ============================================================================
  // View Template Loader (plain HTML partials from ./views/*.html)
  // ============================================================================
  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
    return res.text();
  }

  async function loadViewTemplates() {
    const viewMount = $('view-mount');
    const overlayMount = $('overlay-mount');
    try {
      const [views, overlays] = await Promise.all([
        Promise.all(MAIN_VIEWS.map((v) => fetchText(`./views/${v}.html`))),
        Promise.all(['signature-room', 'settings'].map((v) => fetchText(`./views/${v}.html`))),
      ]);
      viewMount.innerHTML = views.join('\n');
      overlayMount.innerHTML = overlays.join('\n');
    } catch (err) {
      viewMount.innerHTML = `
        <div class="p-8 max-w-xl mx-auto mt-10 studio-panel border-l-2 border-l-[#f0605a] space-y-3">
          <h2 class="text-base font-semibold text-zinc-100">Could not load view templates from ./views/</h2>
          <p class="text-xs text-zinc-400">
            Browsers block fetching separate HTML files over <code class="font-mono text-zinc-100">file://</code>.
            Serve this folder over any static HTTP server, for example VS Code Live Server or
            <code class="font-mono text-emerald-400">python3 -m http.server 5500</code>.
          </p>
          <p class="text-[11px] font-mono text-[#f0605a]">${escapeHtml(err.message)}</p>
        </div>`;
      throw err;
    }
  }

  // ============================================================================
  // Bootstrap
  // ============================================================================
  async function init() {
    applyAppearanceTheme();
    updateViewportScale();
    applySidebarState();
    try {
      await loadViewTemplates();
    } catch (err) {
      window.PlenripAnimations?.hideIntroImmediately?.();
      throw err;
    }

    audioEngine = new GaplessAudioEngine(client, historyStore, updatePlayerBarUI, (err, song) => {
      const label = song ? ` "${song.title || 'Untitled'}"` : '';
      showToast(`Couldn't play${label}. Check the connection and try again.`);
    });

    audioEngine.onAutoplayNeeded = (lastSong) =>
      generateRadioTracks(lastSong, 25, (audioEngine.queue || []).map((s) => s.id));

    initLibraryViews();
    setupSearchHandlers();
    bindAllEvents();
    renderSearchResults();
    updatePlayerBarUI();
    requestAnimationFrame(lyricsFrameLoop);

    const isLoggedIn = client.hasSavedCredentials();

    if (needsFirstWalkthrough()) {
      if (!isLoggedIn) {
        // Not logged in -> 1A Full Portfolio Opening Intro revealing the Welcome / Login page
        state.connected = false;
        navigateTo('welcome', { immediate: true });
        if (window.PlenripAnimations?.playLoggedOutIntro) {
          window.PlenripAnimations.playLoggedOutIntro({ welcomeEl: $('view-welcome') });
        }
      } else {
        // Already logged in (resuming walkthrough) -> 1B Quick Reveal
        navigateTo('welcome', { immediate: true });
        if (window.PlenripAnimations?.playLoggedInReveal) {
          window.PlenripAnimations.playLoggedInReveal({ isWelcome: true });
        }
        void Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]).catch(() => {});
      }
    } else {
      // Already logged in -> 1B Quick Shell Reveal on every page load
      navigateTo('home', { immediate: true });
      if (window.PlenripAnimations?.playLoggedInReveal) {
        window.PlenripAnimations.playLoggedInReveal({ isWelcome: false });
      }
      void Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()])
        .then(() => refreshStarButtons())
        .catch(() => {});
      if (window.PlenripDiscovery?.flushScrobbleQueue) {
        void window.PlenripDiscovery.flushScrobbleQueue(client);
      }
      // Warm artist count in sidebar non-blockingly
      loadAllArtists().catch(() => {});
    }
    document.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
    refreshIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
