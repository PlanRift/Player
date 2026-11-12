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
  // State
  // ============================================================================
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

    // Library caches (loaded fully once, filtered/sorted/paginated on the client)
    artists: null,
    songs: null,
    songsPromise: null,
    albumsByType: {},
    artistInfoCache: new Map(),

    currentArtist: null,
    currentArtistAlbums: [],
    currentArtistSongsPromise: null,
    currentAlbum: null,
    albumBackRoute: 'albums',
    currentPlaylist: null,
    deletePlaylistConfirm: false,

    playlists: [],
    playlistCollages: new Map(),
    starredSongIds: new Set(),
    starredAlbumIds: new Set(),
    starredArtistIds: new Set(),

    // Multi-select (V-15, Century M7): selected song ids + the song
    // objects, for the action bar in Songs / Album Detail / Playlist
    // Detail. `scope` records which view owns the selection; navigating
    // away clears it.
    multiSelect: new Set(),
    multiSelectSongs: new Map(),
    multiSelectScope: null,
    favouriteSongs: [],
    starredArtists: [],
    starredAlbums: [],

    // Search
    searchQuery: '',
    searchTimer: null,
    searchResults: { artist: [], album: [], song: [] },
    searchNavItems: [],
    searchSelectedIndex: -1,

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

    // Context menu + add-to-playlist
    ctxSong: null,
    ctxQueueIndex: null,
    addPlaylistSongs: [],

    scrubbing: false,
    lastNonZeroVolume: 0.85,
    connected: true,
  };

  // ============================================================================
  // Helpers
  // ============================================================================
  const $ = (id) => document.getElementById(id);

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

  // Sage toggle styling helpers
  const MODE_ACTIVE = ['bg-emerald-400', 'text-zinc-950', 'font-semibold'];
  function setModeButton(btn, active) {
    MODE_ACTIVE.forEach((c) => btn.classList.toggle(c, active));
    btn.classList.toggle('text-zinc-400', !active);
    btn.classList.toggle('text-zinc-300', false);
    btn.classList.toggle('bg-zinc-900', !active && btn.classList.contains('norm-mode-btn'));
    btn.classList.toggle('border-emerald-400', active && btn.classList.contains('norm-mode-btn'));
  }

  function setPressed(btn, pressed) {
    if (!btn) return;
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    btn.classList.toggle('text-emerald-400', pressed);
    btn.classList.toggle('border-emerald-400', pressed);
    btn.classList.toggle('text-zinc-400', !pressed);
  }

  // Cover art with stream-header fallback
  function attachCoverImage(imgEl, fallbackEl, coverId, fallbackSongId, size = 300) {
    if (!imgEl) return;
    imgEl.classList.add('hidden');
    if (fallbackEl) fallbackEl.classList.remove('hidden');
    imgEl.removeAttribute('src');

    const showImg = (url) => {
      if (!url) return;
      imgEl.onload = () => {
        imgEl.classList.remove('hidden');
        if (fallbackEl) fallbackEl.classList.add('hidden');
      };
      imgEl.onerror = async () => {
        imgEl.onload = null;
        imgEl.onerror = null;
        if (fallbackSongId) {
          const streamUrl = await client.extractCoverFromStream(fallbackSongId);
          if (streamUrl) {
            imgEl.src = streamUrl;
            imgEl.classList.remove('hidden');
            if (fallbackEl) fallbackEl.classList.add('hidden');
          }
        }
      };
      imgEl.src = url;
      // Cached image: the load event may already have fired (or never
      // fire again for the same URL), leaving the fallback disc visible
      // BESIDE the loaded cover in the flex container. Hide it at once
      // when the image is already complete.
      if (imgEl.complete && imgEl.naturalWidth > 0) {
        imgEl.classList.remove('hidden');
        if (fallbackEl) fallbackEl.classList.add('hidden');
      }
    };

    if (coverId) {
      showImg(client.getCoverArtUrl(coverId, size));
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

  function applySidebarState() {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
    setIcon($('sidebar-toggle-icon'), state.sidebarCollapsed ? 'chevron-right' : 'chevron-left');
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, state.sidebarCollapsed ? 'true' : 'false');
    applySidebarState();
  }

  function setMobileSidebar(open) {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('-translate-x-full', !open);
    sidebar.classList.toggle('translate-x-0', open);
    show($('mobile-sidebar-backdrop'), open);
  }

  function navigateTo(route, options = {}) {
    if (!MAIN_VIEWS.includes(route)) route = 'home';
    if (state.route !== route) state.previousRoute = state.route;
    state.route = route;
    setMobileSidebar(false);
    // Multi-select is scoped to one view; leaving it clears the selection
    // so the action bar never acts on songs from a view the user left.
    clearMultiSelect();

    for (const v of MAIN_VIEWS) {
      show($(`view-${v}`), v === route);
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

    const main = $('main-content');
    if (main && !options.preserveScroll) main.scrollTop = 0;

    // Mobile chrome
    const isNp = route === 'now-playing';
    show($('mobile-top-bar'), !isNp);
    $('mobile-top-bar')?.classList.toggle('md:hidden', true);
    const isDetail = DETAIL_ROUTES.includes(route);
    show($('mobile-back-btn'), isDetail);
    show($('mobile-menu-btn'), !isDetail);
    $('bottom-player-bar')?.classList.toggle('max-md:hidden', isNp);

    if (route === 'home') loadHomeView();
    else if (route === 'search') setTimeout(() => $('search-input')?.focus(), 30);
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
    if (r === 'album-detail') navigateTo(state.albumBackRoute || 'albums', { preserveScroll: true });
    else if (r === 'artist-detail') navigateTo('artists', { preserveScroll: true });
    else if (r === 'playlist-detail') navigateTo('playlists', { preserveScroll: true });
    else navigateTo(state.previousRoute && state.previousRoute !== 'now-playing' ? state.previousRoute : 'home');
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
    // The global contextmenu handler (Century Phase 3) reads the song
    // off the row it was opened on. Stored on the element, like Century's
    // __contextData, so a right-click anywhere on the row finds its song.
    row.__song = song;
    row.className =
      'song-row group flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-700 hover:bg-zinc-800/70 transition-colors';
    if (options.selectable && state.multiSelect.has(song.id)) {
      row.classList.add('song-row-selected');
    }

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0 flex-1';

    // Multi-select checkbox (V-15, Century M7). Only in the selectable
    // views (Songs / Album Detail / Playlist Detail). Ctrl/Cmd+click on
    // the row toggles selection too, without playing the track.
    if (options.selectable) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'multi-select-checkbox shrink-0 w-4 h-4 accent-emerald-400 cursor-pointer';
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
    idxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playOrToggle(song, queueContext, index);
    });
    left.appendChild(idxBtn);

    if (options.showCover !== false) {
      const coverWrap = document.createElement('div');
      coverWrap.className = 'w-9 h-9 bg-zinc-950 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center';
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'hidden w-full h-full object-cover';
      const fb = document.createElement('div');
      fb.className = 'text-zinc-400 flex items-center justify-center';
      fb.innerHTML = '<i data-lucide="music" class="w-3.5 h-3.5"></i>';
      coverWrap.appendChild(img);
      coverWrap.appendChild(fb);
      attachCoverImage(img, fb, song.coverArt || song.albumId, song.id, 100);
      left.appendChild(coverWrap);
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0 flex-1';

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'row-title block max-w-full truncate text-sm text-left font-medium text-zinc-100 hover:underline';
    titleBtn.innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
    titleBtn.addEventListener('click', () => playOrToggle(song, queueContext, index));

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

    // Playlist reorder (Century Phase 4): up/down arrows + Alt+Arrow.
    // Only shown when the caller provides onMoveTrack (playlist detail).
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
      // Alt+ArrowUp / Alt+ArrowDown reorders the focused row.
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

  function playOrToggle(song, queueContext, index) {
    if (isCurrentSong(song)) {
      audioEngine.togglePlayPause();
      return;
    }
    const queue = queueContext && queueContext.length > 0 ? queueContext : [song];
    const idx = typeof index === 'number' && queue[index]?.id === song.id ? index : queue.findIndex((s) => s.id === song.id);
    audioEngine.playQueue(queue, Math.max(0, idx), { shuffle: false });
  }

  function playSongs(songs, { shuffle = false } = {}) {
    if (!songs || songs.length === 0) {
      showToast('Nothing to play');
      return;
    }
    audioEngine.playQueue(songs, 0, { shuffle });
  }

  // Radio / autoplay (Century M1): build a continuous list of similar tracks
  // from a seed song. Algorithm (Century radioEngine):
  // 1. Tracks from the seed artist's discography.
  // 2. Similar artists from getArtistInfo2, cross-referenced with the local
  //    library (never invent fake similar artists), max 4 tracks each.
  // 3. Fallback: top tracks from listening history — ONLY when no similar
  //    songs were found at all (Century uses history only then, not as a
  //    top-up on top of similars).
  // Deduplicates, excludes the seed song (and, for autoplay, every track
  // already in the queue), balances distribution, limit 25.
  async function generateRadioTracks(seed, limit = 25, excludeIds = []) {
    if (!seed) return [];
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

    // 1. Seed artist's tracks
    const seedArtistId = seed.artistId || '';
    if (seedArtistId) {
      pushAll(await artistSongs(seedArtistId));
    }

    // 2. Similar artists (server-provided), cross-referenced with the library
    const similarBefore = out.length;
    if (seedArtistId && out.length < limit) {
      try {
        const info = await client.getArtistInfo2(seedArtistId);
        const similars = (info?.similarArtist || []).filter((a) => a?.id).slice(0, 5);
        // Prefer similar artists that exist in the local library
        let libraryArtists = [];
        try {
          libraryArtists = await loadAllArtists();
        } catch {
          libraryArtists = [];
        }
        const byName = new Map(libraryArtists.map((a) => [String(a.name || '').toLowerCase(), a]));
        for (const sim of similars) {
          if (out.length >= limit) break;
          const local = byName.get(String(sim.name || '').toLowerCase());
          const simId = local?.id || sim.id;
          if (!simId) continue;
          // Max 4 tracks per similar artist (Century radioEngine) so one
          // prolific similar artist cannot flood the 25.
          pushAll((await artistSongs(simId)).slice(0, 4));
        }
      } catch {
        // Similar-artist lookup is best-effort
      }
    }
    const similarAdded = out.length - similarBefore;

    // 3. Fallback: top tracks from listening history — only when NO similar
    // songs were found (Century: history is the fallback, not a top-up).
    if (similarAdded === 0 && out.length < limit) {
      try {
        const allSongs = await loadAllSongs();
        const byId = new Map(allSongs.map((s) => [s.id, s]));
        const top = historyStore.getListenAgain(byId, limit) || [];
        // getListenAgain returns wrappers {song, playCount, lastPlayed} —
        // unwrap to the songs, otherwise pushAll skips them (no .id).
        pushAll(top.map((t) => t.song).filter(Boolean));
      } catch {
        // History fallback is best-effort
      }
    }

    // Balance distribution + shuffle, then cap at the limit. The first
    // track stays fixed (Century radioEngine) and the rest are spread out
    // by artist via balancedShuffle.
    const shuffled = out.length > 1 ? [out[0], ...balancedShuffle(out.slice(1))] : out;
    return shuffled.slice(0, limit);
  }

  // Start a radio queue from a seed song (context menu "Start Radio").
  async function startRadio(seed) {
    if (!seed) return;
    showToast(`Starting radio from "${seed.title || 'Untitled'}"...`);
    const tracks = await generateRadioTracks(seed, 25);
    if (tracks.length === 0) {
      showToast('No similar tracks found for radio');
      return;
    }
    audioEngine.playQueue([seed, ...tracks], 0, { shuffle: false });
  }


  // Generic media card (album, artist, playlist, song)
  function createMediaCard(opts) {
    const card = document.createElement('div');
    card.className =
      'group studio-panel hover:border-zinc-500 p-3 flex flex-col cursor-pointer transition-colors min-w-0';

    const cover = document.createElement('div');
    cover.className = 'w-full aspect-square bg-zinc-950 border border-zinc-700 overflow-hidden relative flex items-center justify-center mb-2.5';
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
    } else attachCoverImage(img, fb, opts.coverId, opts.fallbackSongId, 300);

    if (typeof opts.onPlay === 'function') {
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('aria-label', `Play ${opts.title || ''}`);
      playBtn.title = `Play ${opts.title || ''}`;
      playBtn.className =
        'absolute inset-0 m-auto h-8 w-8 flex items-center justify-center rounded-full bg-black/60 text-zinc-100 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary';
      playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onPlay();
      });
      cover.appendChild(playBtn);
    } else {
      // No onPlay: a non-interactive hover affordance (Century MediaCard).
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
      meta.className = 'mt-1.5 text-[11px] font-mono text-zinc-400';
      meta.textContent = opts.meta;
      card.appendChild(meta);
    }

    card.addEventListener('click', () => opts.onClick && opts.onClick());
    return card;
  }

  function createAlbumCard(album, backRoute = 'albums', withPlay = true) {
    return createMediaCard({
      coverId: album.coverArt || (String(album.id).startsWith('singles-') ? null : album.id),
      fallbackSongId: album._virtualSongs?.[0]?.id,
      fallbackIcon: String(album.id).startsWith('singles-') ? 'music-2' : 'disc',
      titleHtml: titleHtml(album.name || 'Untitled Album', album.artist),
      subtitle: album.artist || 'Unknown Artist',
      meta: `${album.year ? album.year + ' · ' : ''}${album.songCount ? album.songCount + ' trk' : 'Album'}`,
      onClick: () => openAlbumDetail(album, backRoute),
      onPlay: withPlay
        ? async () => {
            try {
              const detail = await client.resolveAlbumSongs(album);
              playSongs(detail.song, { shuffle: false });
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
      onClick: () => extra.onClick ? extra.onClick() : playOrToggle(song, queueContext),
      onPlay: () => (extra.onClick ? extra.onClick() : playOrToggle(song, queueContext)),
    });
  }

  function createArtistCard(artist) {
    return createMediaCard({
      artist,
      titleHtml: titleHtml(artist.name || 'Unknown Artist', ''),
      meta: `${artist.albumCount ?? 0} ${artist.albumCount === 1 ? 'album' : 'albums'}`,
      onClick: () => openArtistDetail(artist.id),
    });
  }

  // ============================================================================
  // Star / Unstar
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
    } catch {
      // Ignore if offline
    }
  }

  // ---- Multi-select (V-15, Century M7) ----
  // Selection lives in state.multiSelect (ids) + state.multiSelectSongs
  // (id -> song, insertion order). `scope` is the view that owns the
  // selection ('songs' | 'album' | 'playlist'); selecting in a different
  // view clears the old selection first, so the action bar never acts on
  // songs from a view the user has left.
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
    // Sync every visible row checkbox + row highlight with the set.
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
    audioEngine.playQueue(songs, 0);
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
        // Ignore per-song failures; the rest still star.
      }
    }
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
      refreshStarButtons();
      updatePlayerBarUI();
      if (state.route === 'favourites') loadFavouritesView();
    } catch (err) {
      showToast(`Star action failed: ${err.message}`);
    }
  }

  // Optimistic starred update for an album across every cached list
  // (browse albumsByType + the artist discography). Century's
  // setAlbumStarred spec (2026-11-08): starring an album must update the
  // cached album objects immediately, not just the starredAlbumIds set,
  // or a starred filter reading album.starred shows stale data.
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
  // Library data loading (cached, then filtered/sorted/paginated client-side)
  // ============================================================================
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
    return state.artists;
  }

  async function loadAllAlbums(type = 'newest') {
    if (state.albumsByType[type]) return state.albumsByType[type];
    const all = [];
    const BATCH = 500;
    for (let offset = 0; offset < 20000; offset += BATCH) {
      const batch = await client.getAlbumList2({ type, size: BATCH, offset });
      all.push(...batch);
      if (batch.length < BATCH) break;
    }
    state.albumsByType[type] = all;
    return all;
  }

  // ============================================================================
  // Library toolbar + pagination controller (artists, albums, songs)
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
    const view = { query: '', sort: cfg.defaultSort, starredOnly: false, page: 0, items: null, loading: false };

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
      const dirty = view.query || view.starredOnly || view.sort !== cfg.defaultSort;
      show(ui.resetBtn, Boolean(dirty));
      if (ui.toolbarCount) ui.toolbarCount.textContent = `${filteredCount} ${filteredCount === 1 ? cfg.noun : cfg.nounPlural}`;
    }

    function getFiltered() {
      let items = view.items || [];
      if (view.starredOnly) items = items.filter(cfg.isStarred);
      const q = view.query.trim().toLowerCase();
      if (q) items = items.filter((it) => cfg.matches(it, q));
      return cfg.sorters[view.sort] ? cfg.sorters[view.sort]([...items]) : items;
    }

    function render() {
      if (!ui.container) return;
      if (!view.items) return;
      const filtered = getFiltered();
      // Century renders the full list in browse mode and paginates only
      // while filtering/searching. When cfg.fullListInBrowse is set and
      // nothing is filtering, the page size is the whole list.
      const isFiltering = Boolean(view.query.trim() || view.starredOnly);
      const pageSize = !isFiltering && cfg.fullListInBrowse
        ? Math.max(1, filtered.length)
        : (isFiltering && cfg.searchPageSize ? cfg.searchPageSize : cfg.pageSize);
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if (view.page >= pages) view.page = pages - 1;
      const slice = filtered.slice(view.page * pageSize, (view.page + 1) * pageSize);

      updateControls(filtered.length);
      if (ui.countLabel) ui.countLabel.textContent = `${(view.items || []).length} ${cfg.nounPlural} in library`;

      ui.container.innerHTML = '';
      if (slice.length === 0) {
        ui.container.innerHTML = `<div class="col-span-full p-8 text-center text-xs font-mono text-zinc-400">${
          view.query || view.starredOnly ? `No matching ${cfg.nounPlural}.` : `No ${cfg.nounPlural} found.`
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

  // Albums / Singles & EPs split (Century): an album with <= 6 tracks (or a
  // virtual Singles bucket) is a Single/EP; anything else is an Album.
  // One toggle in Settings > Library controls the browse view + discography.
  // These helpers live at module scope (not inside initLibraryViews) because
  // they are also called from openArtistDetail, renderSettings, and the
  // split-toggle change handler.
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
      // Ignore storage errors
    }
  }
  function isSingleOrEp(album) {
    if (!album) return false;
    if (typeof album.songCount === 'number') return album.songCount <= SINGLE_EP_MAX_TRACKS;
    return false;
  }

  function initLibraryViews() {
    const byName = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
    const stats = () => getPlayStats();

    libraryViews.artists = createLibraryView({
      prefix: 'artists',
      containerId: 'artists-grid',
      noun: 'artist',
      nounPlural: 'artists',
      defaultSort: 'name-asc',
      pageSize: 48,
      fetchItems: () => loadAllArtists(),
      isStarred: (a) => state.starredArtistIds.has(a.id),
      matches: (a, q) => titles.matchesSearchWithTranslation(a.name, '', q),
      translationItem: (a) => ({ title: a.name, artist: '' }),
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
      // Century: browse shows the full list (split into Albums / Singles
      // & EPs); pagination only while searching (36/page).
      fullListInBrowse: true,
      searchPageSize: 36,
      fetchItems: (view) => loadAllAlbums(view.sort),
      isStarred: (a) => state.starredAlbumIds.has(a.id),
      matches: (a, q) =>
        titles.matchesAllTokens(
          [
            { text: a.name, artist: a.artist },
            { text: a.artist, artist: '' },
          ],
          q
        ),
      translationItem: (a) => ({ title: a.name, artist: a.artist }),
      sorters: { newest: (l) => l, alphabeticalByName: (l) => l, alphabeticalByArtist: (l) => l, frequent: (l) => l, recent: (l) => l },
      onSortChange: async (view, isReset) => {
        // Album ordering comes from the server for each sort type
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
        // Split view: two sections (Albums / Singles & EPs) with mono counts
        // from the full filtered list; each section shows its page slice.
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
        titles.matchesAllTokens(
          [
            { text: s.title, artist: s.artist },
            { text: s.album, artist: s.artist },
            { text: s.artist, artist: '' },
          ],
          q
        ),
      translationItem: (s) => ({ title: s.title, artist: s.artist }),
      sorters: {
        'title-asc': (l) => l.sort((a, b) => byName(a.title, b.title)),
        'artist-asc': (l) => l.sort((a, b) => byName(a.artist, b.artist) || byName(a.title, b.title)),
        'most-played': (l) => {
          const s = stats().bySong;
          return l.sort((a, b) => (s.get(b.id)?.count || 0) - (s.get(a.id)?.count || 0) || byName(a.title, b.title));
        },
        'recently-played': (l) => {
          const s = stats().bySong;
          return l.sort((a, b) => (s.get(b.id)?.last || 0) - (s.get(a.id)?.last || 0) || byName(a.title, b.title));
        },
        'recently-added': (l) => l.sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))),
      },
      renderPage: (container, items, view, all) => {
        // Queue context is the full filtered + sorted list so playback continues past the page
        items.forEach((song, idx) => {
          container.appendChild(createTrackRowElement(song, view.page * 100 + idx, all, { selectable: true, selectScope: 'songs' }));
        });
      },
    });
  }

  // ============================================================================
  // Home (Honest History sections + Recently Added)
  // ============================================================================
  async function loadHomeView() {
    const recentGrid = $('home-recent-grid');
    if (!recentGrid) return;
    if (!recentGrid.hasChildNodes()) {
      recentGrid.innerHTML = '<div class="col-span-full py-6 text-xs font-mono text-zinc-400">Loading recently added albums...</div>';
    }

    try {
      const recent = await client.getAlbumList2({ type: 'newest', size: 18, offset: 0 });
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

    renderHomeHistorySections();
    // Listen Again + Quick Pick need the full song list for lookups
    loadAllSongs()
      .then(() => {
        if (state.route === 'home') renderHomeHistorySections();
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

  function renderHomeHistorySections() {
    const songMap = new Map((state.songs || []).map((s) => [s.id, s]));
    const currentId = audioEngine?.currentSong?.id || null;
    const translationItems = [];
    const note = (s) => translationItems.push({ title: s.title, artist: s.artist });

    // 1. Continue Listening
    const cont = historyStore.getContinueListening(currentId, 6);
    fillSection(
      'home-section-continue',
      'home-continue-grid',
      cont.map((item) => {
        note(item.song);
        const remaining = Math.max(0, item.durationSeconds - item.positionSeconds);
        return createSongCard(item.song, [item.song], {
          meta: `${formatDuration(remaining)} left`,
          progressPercent: (item.positionSeconds / item.durationSeconds) * 100,
          onClick: () => audioEngine.playQueue([item.song], 0, { shuffle: false, startTime: item.positionSeconds }),
        });
      }),
      'home-continue-meta',
      `${cont.length} in progress`
    );

    // 4. Forgotten Favourite?
    const forgotten = historyStore.getForgottenFavourites(state.favouriteSongs, 6);
    const forgottenSongs = forgotten.map((f) => f.song);
    fillSection(
      'home-section-forgotten',
      'home-forgotten-grid',
      forgotten.map((f) => {
        note(f.song);
        return createSongCard(f.song, forgottenSongs, { meta: f.badge });
      })
    );

    // 3. Listen Again
    const again = historyStore.getListenAgain(songMap, 6);
    const againSongs = again.map((a) => a.song);
    fillSection(
      'home-section-listen-again',
      'home-listen-again-grid',
      again.map((a) => {
        note(a.song);
        return createSongCard(a.song, againSongs, { meta: `${a.playCount} plays` });
      })
    );

    // 2. Quick Pick (deterministic per day)
    const quick = historyStore.getQuickPick(state.favouriteSongs, songMap, 9);
    fillSection(
      'home-section-quick-pick',
      'home-quick-pick-grid',
      quick.map((s) => {
        note(s);
        return createSongCard(s, quick);
      }),
      'home-quick-pick-meta',
      `${quick.length} picks for today`
    );

    queueTranslations(translationItems);
    refreshIcons();
  }

  // ============================================================================
  // Search (translated + original titles, keyboard navigation)
  // ============================================================================
  function clearSearchState(clearInput = false) {
    const input = $('search-input');
    if (clearInput && input) input.value = '';
    state.searchQuery = '';
    show($('search-clear-btn'), false);
    state.searchResults = { artist: [], album: [], song: [] };
    state.searchSelectedIndex = -1;
    renderSearchResults();
  }

  function setupSearchHandlers() {
    const input = $('search-input');
    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      state.searchQuery = q;
      show($('search-clear-btn'), q.length > 0);
      if (state.searchTimer) clearTimeout(state.searchTimer);
      if (!q) {
        clearSearchState();
        return;
      }
      state.searchTimer = setTimeout(async () => {
        try {
          const res = await titles.searchLibraryWithTranslation(client, q, { artistCount: 12, albumCount: 18, songCount: 40 });
          if (state.searchQuery !== q) return;
          state.searchResults = res;
          state.searchSelectedIndex = -1;
          renderSearchResults();
        } catch (err) {
          showToast(`Search failed: ${err.message}`);
        }
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (input.value) {
          e.preventDefault();
          e.stopPropagation();
          clearSearchState(true);
        } else {
          // Empty search input: Esc goes back (Century).
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
      } else if (e.key === 'Enter' && state.searchSelectedIndex >= 0) {
        e.preventDefault();
        state.searchNavItems[state.searchSelectedIndex]?.trigger();
      }
    });

    $('search-clear-btn')?.addEventListener('click', () => {
      clearSearchState(true);
      input.focus();
    });

    document.querySelectorAll('[data-search-nav]').forEach((btn) => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-search-nav')));
    });
  }

  function highlightSearchNavItem() {
    state.searchNavItems.forEach((item, idx) => {
      const active = idx === state.searchSelectedIndex;
      item.el.classList.toggle('ring-2', active);
      item.el.classList.toggle('ring-emerald-400', active);
      if (active) item.el.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderSearchResults() {
    const container = $('search-results');
    if (!container) return;
    state.searchNavItems = [];
    const label = $('search-summary-label');

    if (!state.searchQuery) {
      container.innerHTML = `
        <div class="py-12 text-center text-sm font-mono text-zinc-400">
          Type above to search across your library, including translated titles.
        </div>`;
      return;
    }

    const { artist = [], album = [], song = [] } = state.searchResults;
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

    if (artist.length > 0) {
      const sec = section('Artists', artist.length);
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
      artist.forEach((ar) => {
        const card = createArtistCard(ar);
        grid.appendChild(card);
        state.searchNavItems.push({ el: card, trigger: () => openArtistDetail(ar.id) });
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    if (album.length > 0) {
      const sec = section('Albums', album.length);
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';
      album.forEach((al) => {
        const card = createAlbumCard(al, 'search', false);
        grid.appendChild(card);
        state.searchNavItems.push({ el: card, trigger: () => openAlbumDetail(al, 'search') });
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    if (song.length > 0) {
      const sec = section('Tracks', song.length);
      const list = document.createElement('div');
      list.className = 'studio-panel overflow-hidden';
      song.forEach((s, idx) => {
        const row = createTrackRowElement(s, idx, song);
        list.appendChild(row);
        state.searchNavItems.push({ el: row, trigger: () => playOrToggle(s, song, idx) });
      });
      sec.appendChild(list);
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
  // Artist detail (bio, similar artists, discography with virtual Singles)
  // ============================================================================
  function renderArtistStarButton() {
    const btn = $('artist-star-btn');
    if (!btn || !state.currentArtist) return;
    const starred = state.starredArtistIds.has(state.currentArtist.id);
    btn.classList.toggle('text-emerald-400', starred);
    btn.classList.toggle('border-emerald-400', starred);
    btn.querySelector('svg, i')?.classList.toggle('fill-current', starred);
  }

  // Wikipedia biography fallback (bio-only): REST summary, EN -> JA.
  // Returns { text, lang } or null. Never throws.
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
      } catch (_) {
        // Try the next language, then give up silently.
      }
    }
    return null;
  }

  async function openArtistDetail(artistId) {
    if (!artistId) return;
    navigateTo('artist-detail');
    const grid = $('artist-albums-grid');
    $('artist-detail-name').textContent = 'Loading...';
    $('artist-detail-meta').textContent = '';
    show($('artist-bio-wrap'), false);
    show($('artist-similar-wrap'), false);
    if (grid) grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">Loading artist catalog...</div>';

    try {
      const artist = await client.getArtist(artistId);
      state.currentArtist = artist;
      const albums = await client.resolveArtistAlbums(artist);
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
        // Split discography: Albums / Singles & EPs (the virtual Singles
        // bucket is always a Single/EP).
        const isDiscSingle = (a) => String(a.id).startsWith('singles-') || isSingleOrEp(a);
        const discAlbums = albums.filter((a) => !isDiscSingle(a));
        const discSingles = albums.filter((a) => isDiscSingle(a));
        const discSection = (title, count, cards) => {
          if (cards.length === 0) return;
          const head = document.createElement('div');
          head.className = 'col-span-full flex items-baseline justify-between gap-2 pb-2 border-b border-zinc-800';
          head.innerHTML = `<h2 class="font-display font-normal text-lg text-zinc-100 tracking-tight">${title}</h2><span class="font-mono text-xs text-zinc-400">${count} ${count === 1 ? 'album' : 'albums'}</span>`;
          grid.appendChild(head);
          cards.forEach((alb) => grid.appendChild(createAlbumCard(alb, 'artist-detail')));
        };
        discSection('Albums', discAlbums.length, discAlbums);
        discSection('Singles & EPs', discSingles.length, discSingles);
      }
      queueTranslations([{ title: artist.name, artist: '' }, ...albums.map((a) => ({ title: a.name, artist: a.artist }))]);
      refreshIcons();

      // Biography + similar artists (best-effort)
      client.getArtistInfo2(artistId).then(async (info) => {
        if (state.currentArtist?.id !== artistId) return;
        let bio = String(info.biography || '').replace(/<a [^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
        let bioSource = bio ? 'Server' : '';
        // Locked decision: Wikipedia is the bio-only fallback when the
        // server has no biography (EN -> JA -> hide).
        if (!bio) {
          const wiki = await fetchWikipediaBio(artist.name);
          if (wiki) {
            bio = wiki.text;
            bioSource = `Wikipedia (${wiki.lang.toUpperCase()})`;
          }
        }
        if (bio) {
          $('artist-bio-text').textContent = bio.length > 600 ? `${bio.slice(0, 600)}...` : bio;
          const src = $('artist-bio-source');
          if (src) src.textContent = `Biography · ${bioSource}`;
          show($('artist-bio-wrap'), true);
        }
        const similar = (info.similarArtist || []).filter((a) => a.id).slice(0, 12);
        if (similar.length > 0) {
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
  // Album detail
  // ============================================================================
  async function openAlbumDetail(albumOrId, backRoute = 'albums') {
    if (!albumOrId) return;
    state.albumBackRoute = backRoute;
    state.currentAlbum = null;
    navigateTo('album-detail');
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
    $('album-detail-badge').textContent = virtual ? 'Singles Collection' : 'Layer 3 · Album Release';
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

    attachCoverImage(
      $('album-detail-cover'),
      $('album-detail-cover-fallback'),
      album.coverArt || (!virtual ? album.id : null),
      songs[0]?.id || null,
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
    songs.forEach((song, idx) => {
      list.appendChild(
        createTrackRowElement(song, idx, songs, { showCover: virtual, showAlbum: virtual, showTrackNumber: !virtual, selectable: true, selectScope: 'album' })
      );
    });
    queueTranslations(songs.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
  }

  // Queue helpers for bulk actions
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
  // Playlists (collage covers, CRUD, add-to-playlist modal)
  // ============================================================================
  async function getPlaylistCollage(pl) {
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
      btn.title = pl.name;
      btn.className =
        'sidebar-playlist-item sidebar-nav-btn w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors';
      btn.innerHTML = `
        <span class="w-5 h-5 shrink-0 bg-zinc-950 border border-zinc-700 overflow-hidden flex items-center justify-center">
          <img alt="" class="hidden w-full h-full object-cover" />
          <i data-lucide="disc-3" class="nav-icon w-3 h-3"></i>
        </span>
        <span class="sidebar-label flex-1 text-left truncate">${escapeHtml(pl.name)}</span>
        <span class="sidebar-shortcut text-[10px] font-mono text-zinc-400">${pl.songCount ?? 0}</span>`;
      btn.addEventListener('click', () => openPlaylistDetail(pl.id));
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

  async function loadPlaylistsView() {
    const grid = $('playlists-grid');
    if (!grid) return;
    if (!grid.hasChildNodes()) grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-zinc-400">Loading playlists...</div>';
    try {
      state.playlists = await client.getPlaylists();
      renderSidebarPlaylists();
      $('playlists-count-label').textContent = `${state.playlists.length} custom playlists`;
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
            playSongs(detail?.entry || []);
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
    state.deletePlaylistConfirm = false;
    navigateTo('playlist-detail');
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
    $('playlist-detail-title').textContent = pl.name;
    const entries = pl.entry || [];
    const totalSec = pl.duration || entries.reduce((acc, s) => acc + (s.duration || 0), 0);
    $('playlist-detail-meta').textContent = `${entries.length} tracks · ${formatTotalDuration(totalSec)}`;
    $('playlist-delete-label').textContent = state.deletePlaylistConfirm ? 'Confirm delete?' : 'Delete playlist';

    const img = $('playlist-detail-cover');
    const fb = $('playlist-detail-cover-fallback');
    img.classList.add('hidden');
    fb.classList.remove('hidden');
    generatePlaylistCollage(entries, (id, sz) => client.getCoverArtUrl(id, sz)).then((url) => {
      if (!url) return;
      img.onload = () => {
        img.classList.remove('hidden');
        fb.classList.add('hidden');
      };
      img.src = url;
    });
    renderPlaylistDetailTracks();
  }

  function renderPlaylistDetailTracks() {
    const pl = state.currentPlaylist;
    const list = $('playlist-tracks-list');
    if (!pl || !list) return;
    const entries = pl.entry || [];
    list.innerHTML = '';
    if (entries.length === 0) {
      list.innerHTML = '<div class="p-8 text-center text-xs font-mono text-zinc-400">This playlist is empty. Use the 3-dot menu on any song to add tracks.</div>';
      return;
    }
    entries.forEach((song, idx) => {
      list.appendChild(
        createTrackRowElement(song, idx, entries, {
          selectable: true,
          selectScope: 'playlist',
          onRemoveFromPlaylist: async (removeIdx) => {
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
          onMoveTrack: (fromIdx, toIdx) => movePlaylistTrack(fromIdx, toIdx),
        })
      );
    });
    queueTranslations(entries.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
  }

  // Playlist reorder (Century Phase 4, atomic updatePlaylist): remove ALL
  // indices and add the full reordered ID list in one call, so the server
  // replaces the playlist content with the new order.
  async function movePlaylistTrack(fromIdx, toIdx) {
    const pl = state.currentPlaylist;
    if (!pl || !Array.isArray(pl.entry)) return;
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

  // Modals: create playlist, save queue, add to playlist
  function openModal(id) {
    show($(id), true);
    refreshIcons();
  }
  function closeModal(id) {
    show($(id), false);
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
      pageSongs.forEach((song, idx) => list.appendChild(createTrackRowElement(song, favouritesPage * FAVOURITES_PAGE_SIZE + idx, songs)));
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

      tr.innerHTML = `
        <td class="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-500">${idx + 1}</td>
        <td class="py-2.5 px-4">
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
        </td>
        <td class="py-2.5 px-4 text-right font-mono text-[11px] text-zinc-400">${formatFileSize(item.size)}</td>
        <td class="py-2.5 px-4 text-right font-mono text-[11px] text-zinc-400 whitespace-nowrap">${formatFileDate(item.mtime)}</td>
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
    scope: 'single', // 'single' | 'album'
    filePath: '',
    folderPath: '',
    filePaths: [],
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
    const badge = $('meta-scope-badge');
    const targetLabel = $('meta-editor-target-label');
    const scopeHint = $('meta-scope-hint');
    const saveLabel = $('meta-save-all-label');
    const overrideWrap = $('meta-override-album-titles-wrap');
    const titleInput = $('meta-input-title');
    const singleTabBtn = $('meta-scope-btn-single');
    const albumTabBtn = $('meta-scope-btn-album');

    if (badge) {
      badge.textContent = isAlbum ? 'ALBUM FOLDER' : 'SINGLE TRACK';
      badge.className = `px-2 py-0.5 text-[10px] font-mono font-semibold shrink-0 ${
        isAlbum
          ? 'bg-amber-400/15 border border-amber-400/40 text-amber-300'
          : 'bg-emerald-400/15 border border-emerald-400/40 text-emerald-300'
      }`;
    }

    if (singleTabBtn) {
      singleTabBtn.className = `px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${
        !isAlbum
          ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      }`;
    }
    if (albumTabBtn) {
      albumTabBtn.className = `px-2.5 py-1 inline-flex items-center gap-1.5 transition-colors ${
        isAlbum
          ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 font-semibold'
          : 'text-zinc-400 hover:text-zinc-200 border-transparent'
      }`;
    }

    if (targetLabel) {
      const displayTarget = isAlbum
        ? metaEditorState.folderPath || metaEditorState.targetPath || metaEditorState.hints?.album || '(album folder)'
        : metaEditorState.filePath || metaEditorState.targetPath || metaEditorState.hints?.title || '-';
      targetLabel.textContent = `${isAlbum ? 'Album Folder' : 'Single Track'}: ${
        displayTarget.startsWith('(') ? displayTarget : `/${displayTarget}`
      }`;
    }

    if (scopeHint) {
      const trackCount = metaEditorState.filePaths?.length || 0;
      scopeHint.textContent = isAlbum
        ? trackCount > 0
          ? `Batch-updating all ${trackCount} track(s) in album folder`
          : 'Batch-updating all audio tracks in album folder'
        : 'Editing single audio file';
    }

    if (saveLabel) {
      const trackCount = metaEditorState.filePaths?.length || 0;
      saveLabel.textContent = isAlbum
        ? trackCount > 0
          ? `SAVE TO ALBUM FOLDER (${trackCount} TRACKS)`
          : 'SAVE TO ALBUM FOLDER'
        : 'SAVE TO TRACK';
    }

    if (overrideWrap) {
      overrideWrap.classList.toggle('hidden', !isAlbum);
      overrideWrap.classList.toggle('inline-flex', isAlbum);
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
    const coverId = detail.coverArt || (!virtual ? detail.id : null) || songs[0]?.id;
    const coverUrl = coverId ? client.getCoverArtUrl(coverId, 500) : '';

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
            `Selected album from ${item.source}: "${chosenAlbum}" by ${chosenArtist || item.artist}${artistNote}. Ready to sync all tracks in folder.`
          );
        } else {
          // Single Track Mode
          if ($('meta-input-title') && item.type !== 'album' && item.title) {
            $('meta-input-title').value = item.title;
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
   * 2. Full Metadata & Cover Writer Flow -> POST /api/metadata/apply
   * Sends finalized metadata object (Title, Artist, Album, Year) + Cover Art (file or URL)
   * to be injected into the physical audio file(s).
   */
  async function submitApplyFullMetadata() {
    if (metaEditorState.busy) return;

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
    defaultMusicRelPath: 'Music',
    pollTimer: null,
    pausedAlertedJobIds: new Set(),
    completedSyncedJobIds: new Set(),
    busy: false,
    initialized: false,
  };

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

  function updateYtmAuthVisibility(online) {
    const section = $('ytm-downloader-section');
    if (!section) return;
    if (online && getFileBridgeApiKey()) {
      section.classList.remove('hidden');
      initYtmDownloaderEvents();
      syncYtmPanelCollapsedUI();
      refreshYtmStatus();
    } else {
      section.classList.add('hidden');
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
    const cookieHint = alert.cookiesWereUsed
      ? 'Your server cookies.txt appears expired or lacked YouTube Music Premium auth, causing a free-tier 128kbps fallback.'
      : 'No active cookies.txt was present, so YouTube served free-tier 128kbps quality.';

    details.innerHTML = `
      First track <strong class="text-zinc-100">${escapeHtml(alert.trackTitle)}</strong> streamed at
      <span class="px-1.5 py-0.5 font-mono bg-amber-950 border border-amber-500/40 text-amber-300 font-semibold">${escapeHtml(String(alert.bitrateKbps))} kbps</span>
      (≤ ${escapeHtml(String(alert.thresholdKbps || 135))} kbps). ${escapeHtml(cookieHint)}
      Remaining tracks are paused before committing <code class="text-zinc-300">${escapeHtml(alert.plannedFileName)}</code>.
    `;

    banner.classList.remove('hidden');

    if (!ytmState.pausedAlertedJobIds.has(pausedJob.id)) {
      ytmState.pausedAlertedJobIds.add(pausedJob.id);
      showToast(`128kbps Safeguard: Paused "${alert.trackTitle}" (${alert.bitrateKbps} kbps)`, 'error');
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
        queueBadge.textContent = 'PAUSED: 128KBPS SAFEGUARD';
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

      const pct =
        job.totalTracks > 0
          ? Math.round((job.completedTracks / job.totalTracks) * 100)
          : job.status === 'completed'
            ? 100
            : 0;

      let statusLabel = String(job.status || '').toUpperCase();
      let statusCls = 'border-zinc-700 text-zinc-400 bg-zinc-900';
      if (job.status === 'downloading' || job.status === 'inspecting' || job.status === 'queued') {
        statusCls = 'border-emerald-500/40 text-emerald-300 bg-emerald-950/30';
        if (job.status === 'inspecting') statusLabel = 'INSPECTING BITRATE...';
        else if (job.status === 'downloading') statusLabel = `DOWNLOADING ${job.currentTrackIndex || 0}/${job.totalTracks || '?'}`;
      } else if (job.status === 'paused_low_bitrate') {
        statusCls = 'border-amber-500/50 text-amber-300 bg-amber-950/40';
        statusLabel = 'PAUSED (128KBPS SAFEGUARD)';
      } else if (job.status === 'completed') {
        statusCls = 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20';
      } else if (job.status === 'failed' || job.status === 'cancelled') {
        statusCls = 'border-[#f0605a]/40 text-[#f0605a] bg-[#f0605a]/10';
      }

      const brBadge =
        job.detectedBitrateKbps > 0
          ? `<span class="px-1.5 py-0.5 text-[10px] font-mono border ${
              job.detectedBitrateKbps <= 135
                ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
                : 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
            }">${escapeHtml(String(job.detectedBitrateKbps))} kbps</span>`
          : '';

      const titleText = job.collectionTitle || job.currentTrackTitle || job.url;
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
        ytmState.completedSyncedJobIds.add(job.id);
        client.request('startScan').catch(() => {});
        if (state.route === 'files') {
          loadFilesView();
        }
        showToast(`YTM download finished: ${job.completedTracks} track(s) saved to /${job.destRelPath}`);
      }
    }
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

  async function submitYtmDownload() {
    const urlInput = $('ytm-url-input');
    const dirInput = $('ytm-target-dir-input');
    const fmtSelect = $('ytm-format-select');
    const url = urlInput?.value?.trim() || '';
    if (!url) return;

    const submitBtn = $('ytm-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch(`${getFileBridgeBase()}/api/ytm/download`, {
        method: 'POST',
        headers: getFileBridgeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          url,
          targetDir: dirInput?.value?.trim() || '',
          format: fmtSelect?.value || 'opus',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (urlInput) urlInput.value = '';
      showToast('Queued YTM download (checking Track 1 bitrate)...');
      await refreshYtmStatus();
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
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

    on('ytm-use-current-dir-btn', 'click', () => {
      const dirInput = $('ytm-target-dir-input');
      if (dirInput) {
        dirInput.value = filesState.currentPath || ytmState.defaultMusicRelPath || 'Music';
      }
    });

    on('ytm-download-form', 'submit', (e) => {
      e.preventDefault();
      submitYtmDownload();
    });
  }

  // ============================================================================
  // Queue (drawer, now-playing panel, mobile overlay) with drag-and-drop reorder
  // ============================================================================
  let draggedQueueIdx = null;
  let lastQueueSignature = '';

  function queueSignature() {
    const q = audioEngine?.queue || [];
    // Include EVERY song id, not just the first/last: two different queues
    // can share length + first + last + current song (e.g. two lists that
    // start and end on the same tracks), and the old first/last-only
    // signature made renderQueueViews skip the re-render, leaving the
    // previous queue visible in the drawer after playing new music.
    return `${q.length}:${audioEngine?.currentIndex}:${q.map((s) => s.id).join(',')}:${audioEngine?.currentSong?.id}`;
  }

  function buildQueueList(container) {
    const q = audioEngine?.queue || [];
    container.innerHTML = '';
    if (q.length === 0) {
      container.innerHTML = '<div class="p-6 text-center text-xs font-mono text-zinc-400">Queue is empty. Play any track or album to fill the queue.</div>';
      return;
    }

    q.forEach((song, idx) => {
      const isCurrent = idx === audioEngine.currentIndex;
      const item = document.createElement('div');
      item.draggable = true;
      item.setAttribute('data-active', isCurrent ? 'true' : 'false');
      // The global contextmenu handler reads the song + queue index off
      // the row it was opened on (same pattern as track rows).
      item.__song = song;
      item.__queueIdx = idx;
      item.className = `queue-row group flex items-center justify-between gap-2 px-3 py-2 text-xs border-b border-zinc-700 transition-colors ${
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

      const left = document.createElement('button');
      left.type = 'button';
      left.className = 'flex items-center gap-2.5 min-w-0 flex-1 text-left';
      left.innerHTML = `
        <span class="w-5 text-[10px] font-mono ${isCurrent ? 'text-emerald-400 font-semibold' : 'text-zinc-400'}">${idx + 1}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium ${isCurrent ? 'text-emerald-400' : 'text-zinc-100'}">${titleHtml(song.title || 'Untitled', song.artist)}</div>
          <div class="truncate text-[11px] text-zinc-400">${escapeHtml(song.artist || 'Unknown Artist')}</div>
        </div>`;
      left.addEventListener('click', () => audioEngine.loadAndPlayOnActiveDeck(song, idx));

      const right = document.createElement('div');
      right.className = 'flex items-center gap-0.5 shrink-0';
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
      right.appendChild(mk('chevron-down', 'Move down', () => { audioEngine.moveQueueItem(idx, idx + 1); renderQueueViews(true); }, idx === q.length - 1));
      right.appendChild(mk('more-vertical', 'Track options', (e) => openTrackContextMenu(e, song, idx)));
      right.appendChild(mk('x', 'Remove from queue', () => { audioEngine.removeFromQueue(idx); renderQueueViews(true); }, false, 'hover:!text-[#f0605a]'));

      item.appendChild(left);
      item.appendChild(right);
      container.appendChild(item);
    });
    queueTranslations(q.slice(0, 80).map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
    // Scroll the currently playing track into view, so opening the queue
    // lands on the song that's playing instead of the top of the list.
    // 'nearest' only scrolls when the row is off-screen, so it never yanks
    // the list while the user is browsing it. (buildQueueList only runs
    // when the queue signature changes, i.e. on track/queue change, not on
    // every timeupdate.)
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

    const sig = queueSignature();
    if (!force && sig === lastQueueSignature) return;
    lastQueueSignature = sig;

    if (state.queueOpen) {
      const total = q.reduce((acc, s) => acc + (s.duration || 0), 0);
      $('queue-total-duration').textContent = `${formatDuration(total)} total`;
      $('queue-footer-pos').textContent = `Track ${audioEngine.currentIndex + 1} of ${q.length}`;
      buildQueueList($('queue-items-list'));
    }
    if (state.route === 'now-playing') {
      if (state.npTab === 'queue') buildQueueList($('np-panel-queue'));
      if (state.npMobileOverlay === 'queue') buildQueueList($('np-mobile-overlay-body'));
    }
  }

  function toggleQueueDrawer(force) {
    state.queueOpen = typeof force === 'boolean' ? force : !state.queueOpen;
    if (state.queueOpen && state.lyricsDrawerOpen) toggleLyricsDrawer(false);
    show($('queue-drawer'), state.queueOpen);
    setPressed($('btn-queue'), state.queueOpen);
    if (state.queueOpen) renderQueueViews(true);
  }

  function toggleLyricsDrawer(force) {
    state.lyricsDrawerOpen = typeof force === 'boolean' ? force : !state.lyricsDrawerOpen;
    if (state.lyricsDrawerOpen && state.queueOpen) toggleQueueDrawer(false);
    show($('lyrics-drawer'), state.lyricsDrawerOpen);
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
  // Track context menu
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
    refreshIcons();
  }

  function closeTrackContextMenu() {
    show($('track-context-menu'), false);
    state.ctxSong = null;
    state.ctxQueueIndex = null;
  }

  // ============================================================================
  // Lyrics (shared renderer for drawer, now-playing, mobile overlay, listening room)
  // ============================================================================
  const JP_REGEX = /[\u3040-\u30ff\u4e00-\u9fff]/;

  const lyricViews = [
    {
      key: 'drawer', container: 'ld-lyrics-scroll', modeGroup: 'ld-lyrics-mode-group',
      preparing: 'ld-lyrics-preparing', searchBtn: 'ld-lyrics-search-btn', size: 'text-sm',
      visible: () => state.lyricsDrawerOpen, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'np', container: 'np-lyrics-scroll', modeGroup: 'np-lyrics-mode-group',
      preparing: 'np-lyrics-preparing', searchBtn: 'np-lyrics-search-btn', size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npTab === 'lyrics' && window.innerWidth >= 1024, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'npm', container: 'np-mobile-overlay-body', modeGroup: 'np-mobile-lyrics-mode-group',
      size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npMobileOverlay === 'lyrics' && window.innerWidth < 1024, lastIdx: -2, manualScrollUntil: 0,
    },
    {
      key: 'sig', container: 'signature-lyrics-container', modeGroup: 'sig-lyrics-mode-group',
      preparing: 'sig-lyrics-preparing', size: 'text-2xl md:text-3xl',
      visible: () => state.signatureOpen, lastIdx: -2, manualScrollUntil: 0,
    },
  ];

  // Manual scroll pauses auto-centering for 5s (Century manualScrollPause).
  // Delegated on document so it works for views loaded later via templates.
  document.addEventListener('wheel', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const view = lyricViews.find((v) => target.closest(`#${v.container}`));
    if (view && lyricsManager.getManualScrollPause()) view.manualScrollUntil = Date.now() + 5000;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    const view = lyricViews.find((v) => target.closest(`#${v.container}`));
    if (view && lyricsManager.getManualScrollPause()) view.manualScrollUntil = Date.now() + 5000;
  }, { passive: true });

  function anyLyricsVisible() {
    return lyricViews.some((v) => v.visible());
  }

  // Century model (L-1): the original lines are ALWAYS the displayed
  // lines. Romaji / Translated render as sub-lines under them (see
  // getRomajiSubline / getTranslatedSubline), not as an exclusive mode.
  function getDisplayLines() {
    const L = state.lyrics;
    const res = L.result;
    if (!res || !Array.isArray(res.lines)) return [];
    return res.lines;
  }

  // Build the per-segment sweep list for one lyric line (Century
  // buildSweepSegments, simplified). Each segment carries its text, start
  // and end times. A single long word is split into per-character
  // segments (even time slices) so the sweep moves across the line
  // instead of filling the whole word at once. JP words get no trailing
  // space; other words get one. `nextLineStart` bounds the last word.
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

  // Normalize a lyric line for identity comparison (Century
  // normalizeLyricsText): lowercase, strip punctuation + spaces.
  function normalizeLyricsText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[\s\p{P}]/gu, '');
  }

  // A line can show a romaji sub-line only when it has Japanese script.
  function canRomanizeLine(text) {
    return JP_REGEX.test(String(text || ''));
  }

  // A line can show a translated sub-line only when it is not already
  // English (i.e. it contains non-Latin script).
  const NON_LATIN_REGEX = /[\u3040-\u30ff\u4e00-\u9fff\u3400-\u4dbf\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0900-\u097f]/;
  function canTranslateLine(text) {
    return NON_LATIN_REGEX.test(String(text || ''));
  }

  // Romaji sub-line for line index i, or null when suppressed (toggle off,
  // no romaji data, line has no JP script, or romaji equals the original).
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

  // Translated sub-line for line index i, or null when suppressed.
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
    // Prepare romaji / EN readings when the track has Japanese script and
    // at least one sub-line toggle is on (Century: readings are derived
    // for the sub-lines, not for an exclusive mode).
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
    // Prefer the relay's sidecars (kuroshiro / Gemini / Google, server-side) — instant, no extra network.
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
    // Derive the missing side(s) via the relay (kuroshiro / Gemini /
    // Google, server-side), then client-side Google Translate + offline
    // Hepburn if the relay is down. A missing side is NOT back-filled
    // with the original text (L-2): it stays missing and its sub-line
    // simply does not render.
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

  // Toggle a global lyrics sub-line pref (Century toolbar: Romaji |
  // Translated). Turning a toggle on derives the readings if needed.
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

    // Toggle group (only for Japanese lyrics with synced lines):
    // Romaji | Translated — global prefs, not a per-track mode.
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
      // Background vocal: small + dim below its parent lead (Morphe model).
      // A BG line with no parent lead renders as a normal line (defensive
      // rule for a stray first-line isBG flag from the relay).
      const isBg = Boolean(line.isBG) && splitBg;
      const parentIdx = isBg ? findBgParentIndex(lines, idx) : -1;
      const renderAsBg = isBg && parentIdx >= 0;
      if (renderAsBg) {
        el.setAttribute('data-parent', String(parentIdx));
        // No py-2 / size class here: .lyric-line-bg owns the vertical
        // padding (0 closed, 0.25rem open) and the 0.82em font size. The
        // Tailwind Play stylesheet loads after style.css, so a py-2 or
        // text-sm utility on this element would beat the BG rules and the
        // closed line would keep a 16px height instead of collapsing to 0.
        el.className = 'lyric-line lyric-line-bg cursor-pointer px-4 leading-snug';
      } else {
        el.className = `lyric-line cursor-pointer px-4 py-2 leading-snug text-zinc-400 hover:text-zinc-100 ${view.size}`;
      }
      // Primary line: the original text, always shown. Word-synced lines
      // get the Century clip-path two-layer sweep (base + fill layer),
      // which never flickers (no background-clip:text, no color
      // transition — the fill is revealed by clip-path only).
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
      // Sub-lines (Century): Romaji + Translated under the original,
      // each governed by its own global toggle and suppressed when it
      // would duplicate the original or the line cannot carry it.
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
        // Clicking a BG line seeks + its parent lead becomes the active line.
        const seekTo = renderAsBg ? (lines[parentIdx].timeSeconds ?? lines[parentIdx].t ?? line.timeSeconds) : line.timeSeconds;
        audioEngine.seek(Math.max(0, seekTo - offset));
      });
      wrap.appendChild(el);
    });
    // Instrumental dots element (one per view; shown only inside a >=10s gap).
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
    // The active line is always a lead line — a BG line never becomes active.
    const idx = findActiveLeadIndex(lines, time);
    L.activeIdx = idx;
    // Instrumental gap the playback time is currently inside (if any).
    const gaps = findInstrumentalGaps(lines, song.duration || 0);
    const gap = gaps.find((g) => time >= g.start && time < g.end) || null;

    for (const view of lyricViews) {
      if (!view.visible()) continue;
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
          // Focus mode: hide played lines and/or upcoming lines.
          el.classList.toggle('hidden', (hidePlayed && i < idx) || (hideUpcoming && i > idx));
          // Never put text-zinc-400 on a BG line: its sage-dim colour comes
          // from .lyric-line-bg, and the zinc utility would override it.
          const isBgLine = el.classList.contains('lyric-line-bg');
          el.classList.toggle('text-zinc-400', !active && !isBgLine && !el.querySelector('[data-word-span]'));
          // BG line: open (expand + fade in) only while its parent lead is active.
          if (el.classList.contains('lyric-line-bg')) {
            const parent = parseInt(el.getAttribute('data-parent') || '-1', 10);
            el.classList.toggle('lyric-line-bg-open', parent === idx);
          }
          // Reset word state for non-active lines: the fill layer is
          // either fully revealed (played lines) or fully hidden
          // (upcoming lines). Clip-path only — no class juggling, no
          // colour transition, so nothing flickers.
          if (!active) {
            const revealed = i < idx;
            el.querySelectorAll('[data-word-span]').forEach((wrapEl) => {
              const fill = wrapEl.querySelector('[data-word-fill]');
              if (fill) fill.style.clipPath = revealed ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)';
            });
          }
        });
        // Auto-center the active line, unless the user just scrolled by
        // hand and manual-scroll-pause is on (5s pause, Century).
        if (idx >= 0 && els[idx]) {
          const paused = lyricsManager.getManualScrollPause() && Date.now() < view.manualScrollUntil;
          if (!paused) scrollLineIntoCenter(container, els[idx]);
        }
        view.lastIdx = idx;
      }

      // Instrumental dots: show after the active line while inside a gap.
      // An intro gap (afterLineIndex === -1) has no active line yet — the
      // dots render at the top, before the first line (Century).
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
          // Keep the dots directly after the active line, or at the top
          // for an intro gap (before the first line).
          if (isIntroGap) {
            if (els[0] && els[0].previousElementSibling !== dots) els[0].before(dots);
          } else if (els[idx].nextElementSibling !== dots) {
            els[idx].after(dots);
          }
        } else {
          dots.classList.add('hidden');
          // Reset the label with the fill count so a hidden dots element
          // never carries a stale "Instrumental break, N of 3".
          dots.removeAttribute('aria-label');
        }
      }

      // Word-level karaoke fill on the active line (Century
      // ActiveLineWordFill): each word's sage fill layer is revealed by
      // clip-path only — direct style mutation, no class changes, no
      // background-clip:text gradient, no colour transition. That is the
      // flicker fix: the old gradient repainted per frame and flashed
      // white <-> sage.
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
  // Listening Room (fullscreen signature view)
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
    show($('signature-modal'), true);
    updateSignatureMetadataUI(true);
    wakeSignatureChrome();
    ensureLyrics(false);
    renderAllLyrics();
    refreshIcons();
  }

  function closeSignatureView() {
    state.signatureOpen = false;
    show($('signature-modal'), false);
    $('signature-modal')?.classList.remove('signature-idle');
    if (sigIdleTimer) clearTimeout(sigIdleTimer);
    closeLyricsSourceModal();
  }

  let lastSigCoverId = null;

  // Update every lyrics-offset display (Signature Room + Now Playing).
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
      lastSigCoverId = song.id;
      attachCoverImage($('sig-cover-img'), $('sig-cover-fallback'), song.coverArt || song.albumId, song.id, 600);
      const backdrop = $('sig-backdrop-art');
      const coverId = song.coverArt || song.albumId;
      if (backdrop && coverId) {
        backdrop.style.backgroundImage = `url("${client.getCoverArtUrl(coverId, 300)}")`;
        backdrop.style.backgroundSize = 'cover';
        backdrop.style.backgroundPosition = 'center';
      }
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
  // Lyrics source modal (7 providers + manual LRCLIB search)
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
    show($('lyrics-source-modal'), true);
    $('lyrics-manual-title').value = song.title || '';
    $('lyrics-manual-artist').value = song.artist || '';
    $('lyrics-manual-results-list').innerHTML = '';
    probeProviders(song, false);
  }

  function closeLyricsSourceModal() {
    state.lyricsSourceModalOpen = false;
    show($('lyrics-source-modal'), false);
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
  // Now Playing view (desktop two-column + mobile fullscreen)
  // ============================================================================
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
      lastNpTrackId = song.id;
      attachCoverImage($('np-cover-img'), $('np-cover-fallback'), song.coverArt || song.albumId, song.id, 700);
      attachCoverImage($('np-mobile-cover-img'), $('np-mobile-cover-fallback'), song.coverArt || song.albumId, song.id, 700);
      // Ambient wash: blurred cover behind the whole Now Playing view.
      const backdrop = $('np-backdrop-art');
      const coverId = song.coverArt || song.albumId;
      if (backdrop && coverId) {
        backdrop.style.backgroundImage = `url("${client.getCoverArtUrl(coverId, 300)}")`;
        backdrop.style.backgroundSize = 'cover';
        backdrop.style.backgroundPosition = 'center';
      } else if (backdrop) {
        backdrop.style.backgroundImage = '';
      }
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
  // Connection banner
  // ============================================================================
  function setConnectionError(msg) {
    state.connected = !msg;
    const banner = $('error-banner');
    if (banner) {
      show(banner, Boolean(msg));
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
  }

  async function retryConnection() {
    const ok = await client.ping();
    if (ok) {
      setConnectionError(null);
      showToast('Connected to Navidrome');
      await Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]);
      state.artists = null;
      state.songs = null;
      state.songsPromise = null;
      state.albumsByType = {};
      Object.values(libraryViews).forEach((v) => (v.view.items = null));
      navigateTo(state.route);
    } else {
      setConnectionError('Ping failed');
      showToast('Could not connect to server');
    }
  }

  // ============================================================================
  // Settings modal
  // ============================================================================
  function setSettingsTab(tab) {
    const playback = tab === 'playback';
    const audio = tab === 'audio';
    const server = tab === 'server';
    const nas = tab === 'nas';
    const lyrics = tab === 'lyrics';
    const library = tab === 'library';

    show($('settings-tab-playback'), playback);
    show($('settings-tab-audio'), audio);
    show($('settings-tab-server'), server);
    show($('settings-tab-nas'), nas);
    show($('settings-tab-lyrics'), lyrics);
    show($('settings-tab-library'), library);

    const style = (btn, active) => {
      if (!btn) return;
      btn.classList.toggle('border-emerald-400', active);
      btn.classList.toggle('text-zinc-100', active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-zinc-400', !active);
    };
    style($('settings-tab-btn-playback'), playback);
    style($('settings-tab-btn-audio'), audio);
    style($('settings-tab-btn-server'), server);
    style($('settings-tab-btn-nas'), nas);
    style($('settings-tab-btn-lyrics'), lyrics);
    style($('settings-tab-btn-library'), library);

    if (nas) {
      checkFilesBridge();
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

  function renderSettings() {
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
    if (balancedToggle) balancedToggle.checked = localStorage.getItem('century.settings.balancedShuffle') === 'true';

    $('settings-server-url').value = client.baseUrl;
    $('settings-server-user').value = client.username;
    $('settings-server-pass').value = '';

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

  function openSettings(tab = 'audio') {
    state.settingsOpen = true;
    show($('settings-modal'), true);
    renderSettings();
    setSettingsTab(tab);
  }

  function closeSettings() {
    state.settingsOpen = false;
    show($('settings-modal'), false);
  }

  // ============================================================================
  // Event bindings & keyboard shortcuts
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

  function bindAllEvents() {
    // Multi-select action bar (V-15, Century M7)
    on('multi-select-play-btn', 'click', multiSelectPlay);
    on('multi-select-queue-btn', 'click', multiSelectAddToQueue);
    on('multi-select-playlist-btn', 'click', multiSelectAddToPlaylist);
    on('multi-select-star-btn', 'click', multiSelectStar);
    on('multi-select-clear-btn', 'click', clearMultiSelect);
    // Esc clears the selection before it falls through to goBack.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.multiSelect.size > 0) {
        clearMultiSelect();
        e.stopPropagation();
      }
    }, true);

    // Sidebar + mobile chrome
    on('sidebar-toggle-btn', 'click', toggleSidebar);
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
    on('nav-settings', 'click', () => openSettings('audio'));
    on('sidebar-new-playlist-btn', 'click', () => openModal('create-playlist-modal'));

    // Connection banner
    on('error-retry-btn', 'click', retryConnection);
    on('error-settings-btn', 'click', () => openSettings('server'));
    on('error-dismiss-btn', 'click', () => show($('error-banner'), false));

    // Home
    on('home-refresh-btn', 'click', async () => {
      await syncStarredFromServer();
      loadHomeView();
    });
    on('home-see-all-albums-btn', 'click', () => navigateTo('albums'));

    // Artist detail
    on('back-to-artists-btn', 'click', () => navigateTo('artists', { preserveScroll: true }));
    on('artist-play-all-btn', 'click', () => allArtistSongsThen((songs) => playSongs(songs)));
    on('artist-shuffle-btn', 'click', () => allArtistSongsThen((songs) => playSongs(songs, { shuffle: true })));
    on('artist-star-btn', 'click', () => toggleStarArtist(state.currentArtist));

    // Album detail: Play (in order) and Shuffle are plain action buttons
    on('album-back-btn', 'click', () => navigateTo(state.albumBackRoute || 'albums', { preserveScroll: true }));
    on('album-play-btn', 'click', () => playSongs(state.currentAlbum?.song || [], { shuffle: false }));
    on('album-shuffle-btn', 'click', () => playSongs(state.currentAlbum?.song || [], { shuffle: true }));
    on('album-star-btn', 'click', () => toggleStarAlbum(state.currentAlbum));
    on('album-more-btn', 'click', (e) => {
      e.stopPropagation();
      $('album-more-menu').classList.toggle('hidden');
    });
    on('album-menu-shuffle', 'click', () => playSongs(state.currentAlbum?.song || [], { shuffle: true }));
    on('album-menu-play-next', 'click', () => enqueueNext(state.currentAlbum?.song || []));
    on('album-menu-add-queue', 'click', () => enqueueEnd(state.currentAlbum?.song || []));
    on('album-menu-add-playlist', 'click', () => openAddToPlaylistModal(state.currentAlbum?.song || []));

    // Songs + favourites
    on('songs-play-all-btn', 'click', async () => {
      const all = libraryViews.songs.view.items || (await loadAllSongs());
      playSongs(all, { shuffle: false });
    });
    on('songs-shuffle-btn', 'click', async () => {
      const all = libraryViews.songs.view.items || (await loadAllSongs());
      playSongs(all, { shuffle: true });
    });
    on('favourites-play-btn', 'click', () => playSongs(state.favouriteSongs, { shuffle: false }));
    on('favourites-shuffle-btn', 'click', () => playSongs(state.favouriteSongs, { shuffle: true }));
    on('favourites-prev-page', 'click', () => { favouritesPage = Math.max(0, favouritesPage - 1); loadFavouritesView(); });
    on('favourites-next-page', 'click', () => { favouritesPage += 1; loadFavouritesView(); });

    // Playlists
    on('playlists-open-create-modal-btn', 'click', () => openModal('create-playlist-modal'));
    on('playlist-back-btn', 'click', () => navigateTo('playlists', { preserveScroll: true }));
    on('playlist-play-btn', 'click', () => playSongs(state.currentPlaylist?.entry || [], { shuffle: false }));
    on('playlist-shuffle-btn', 'click', () => playSongs(state.currentPlaylist?.entry || [], { shuffle: true }));
    on('playlist-more-btn', 'click', (e) => {
      e.stopPropagation();
      $('playlist-more-menu').classList.toggle('hidden');
    });
    on('playlist-menu-shuffle', 'click', () => playSongs(state.currentPlaylist?.entry || [], { shuffle: true }));
    on('playlist-menu-play-next', 'click', () => enqueueNext(state.currentPlaylist?.entry || []));
    on('playlist-menu-add-queue', 'click', () => enqueueEnd(state.currentPlaylist?.entry || []));
    on('playlist-menu-add-playlist', 'click', () => openAddToPlaylistModal(state.currentPlaylist?.entry || []));

    const renameForm = $('playlist-rename-form');
    const renameInput = $('playlist-rename-input');
    on('playlist-rename-toggle-btn', 'click', () => {
      if (!state.currentPlaylist) return;
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
      if (!name || !state.currentPlaylist) return;
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
      if (!state.currentPlaylist) return;
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

    // Playlist modals
    const modalClosers = [
      ['create-playlist-close-btn', 'create-playlist-modal'],
      ['create-playlist-cancel-btn', 'create-playlist-modal'],
      ['save-queue-close-btn', 'save-queue-playlist-modal'],
      ['save-queue-cancel-btn', 'save-queue-playlist-modal'],
      ['add-to-playlist-close-btn', 'add-to-playlist-modal'],
      ['shortcuts-close-btn', 'shortcuts-modal'],
    ];
    modalClosers.forEach(([btnId, modalId]) => on(btnId, 'click', () => closeModal(modalId)));
    ['create-playlist-modal', 'save-queue-playlist-modal', 'add-to-playlist-modal', 'shortcuts-modal'].forEach((id) => {
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

    // Queue drawer + lyrics drawer
    on('btn-queue', 'click', () => toggleQueueDrawer());
    on('queue-close-btn', 'click', () => toggleQueueDrawer(false));
    on('queue-clear-btn', 'click', () => {
      audioEngine.clearQueue();
      renderQueueViews(true);
    });
    on('queue-open-save-modal-btn', 'click', () => {
      if (audioEngine.queue.length === 0) return showToast('Queue is empty');
      openModal('save-queue-playlist-modal');
    });
    on('btn-lyrics-drawer', 'click', () => toggleLyricsDrawer());
    on('lyrics-drawer-close-btn', 'click', () => toggleLyricsDrawer(false));

    // Player bar
    const openNowPlaying = () => navigateTo('now-playing');
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

    // Center track info fades while hovering or scrubbing the seek bar
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

    // Speaker icon: click opens sound bar; clicking while open mutes/unmutes
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

    // Auto-hide sound bar when mouse stops hovering the player bar
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

    // Now playing
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

    // Lyrics: Romaji / Translated toggle buttons (all groups) + search buttons
    document.querySelectorAll('[data-lyrics-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => toggleLyricsPref(btn.getAttribute('data-lyrics-toggle')));
    });
    ['ld-lyrics-search-btn', 'np-lyrics-search-btn', 'btn-lyrics-source'].forEach((id) => on(id, 'click', openLyricsSourceModal));
    on('lyrics-source-close-btn', 'click', closeLyricsSourceModal);
    on('lyrics-manual-search-form', 'submit', (e) => {
      e.preventDefault();
      runManualLyricsSearch();
    });

    // Listening room
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
      if (s) audioEngine.playQueue([s], 0, { shuffle: false });
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

    // Initialize global Metadata & Cover Art Editor modal events
    initMetadataEditorEvents();

    // Click-away for floating menus
    document.addEventListener('click', (e) => {
      const menu = $('track-context-menu');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) closeTrackContextMenu();
      document.querySelectorAll('[id$="-sort-menu"], #album-more-menu, #playlist-more-menu').forEach((m) => {
        if (!m.classList.contains('hidden') && !m.contains(e.target)) m.classList.add('hidden');
      });
    });

    // Global right-click menu (Century Phase 3): the browser menu never
    // appears inside the app. Text inputs keep the native menu so the
    // user can still copy/paste there.
    document.addEventListener('contextmenu', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();

      // 1. A track row or queue row carries its song on the element.
      const row = target.closest('[data-song-id], .queue-row');
      const song = row?.__song;
      if (song) {
        const queueIdx = typeof row.__queueIdx === 'number' ? row.__queueIdx : null;
        openTrackContextMenu(e, song, queueIdx);
        return;
      }

      // 2. The bottom player bar, Now Playing and the Listening Room act
      // on the song that is currently playing.
      if (target.closest('#bottom-player-bar, #view-now-playing, #signature-modal')) {
        if (audioEngine?.currentSong) openTrackContextMenu(e, audioEngine.currentSong, null);
        return;
      }
      // Anywhere else: no menu, but the browser menu stays suppressed.
    });

    // Settings
    on('settings-modal-close-btn', 'click', closeSettings);
    $('settings-modal')?.addEventListener('click', (e) => {
      if (e.target === $('settings-modal')) closeSettings();
    });
    on('settings-tab-btn-playback', 'click', () => setSettingsTab('playback'));
    on('settings-tab-btn-audio', 'click', () => setSettingsTab('audio'));
    on('settings-tab-btn-server', 'click', () => setSettingsTab('server'));
    on('settings-tab-btn-nas', 'click', () => setSettingsTab('nas'));
    on('settings-tab-btn-lyrics', 'click', () => setSettingsTab('lyrics'));
    on('settings-tab-btn-library', 'click', () => setSettingsTab('library'));
    on('settings-split-albums-toggle', 'change', (e) => {
      setSplitAlbumsSingles(e.target.checked);
      // Re-render the albums view (and the discography if visible)
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
    on('settings-autoplay-toggle', 'change', (e) => audioEngine.setAutoplay(e.target.checked));
    on('settings-balanced-shuffle-toggle', 'change', (e) => {
      localStorage.setItem('century.settings.balancedShuffle', e.target.checked ? 'true' : 'false');
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
      renderSettings();
      showToast('Cleared local listening history');
      if (state.route === 'home') renderHomeHistorySections();
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
      client.saveConfig($('settings-server-url').value, $('settings-server-user').value, $('settings-server-pass').value);
      await retryConnection();
      $('settings-server-pass').value = '';
    });
    on('settings-reset-server-btn', 'click', async () => {
      client.saveConfig(DEFAULT_CONFIG.serverUrl, DEFAULT_CONFIG.username, DEFAULT_CONFIG.password);
      renderSettings();
      showToast('Restored default Navidrome credentials');
      await retryConnection();
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

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
        return;
      }

      if (e.key === 'Escape') {
        const volToggle = $('volume-toggle');
        if (volToggle && volToggle.checked) {
          volToggle.checked = false;
          return;
        }
        if (!$('track-context-menu').classList.contains('hidden')) return closeTrackContextMenu();
        if (metaEditorState.active || !$('files-metadata-modal')?.classList.contains('hidden')) return closeMetadataEditor();
        for (const id of ['add-to-playlist-modal', 'save-queue-playlist-modal', 'create-playlist-modal']) {
          if (!$(id).classList.contains('hidden')) return closeModal(id);
        }
        if (state.lyricsSourceModalOpen) return closeLyricsSourceModal();
        if (state.settingsOpen) return closeSettings();
        if (!$('shortcuts-modal').classList.contains('hidden')) return closeModal('shortcuts-modal');
        if (state.signatureOpen) return closeSignatureView();
        if (state.queueOpen) return toggleQueueDrawer(false);
        if (state.lyricsDrawerOpen) return toggleLyricsDrawer(false);
        // Nothing open: Esc goes back (Century).
        return goBack();
      }
      if (typing) return;
      const k = e.key.toLowerCase();

      if (e.key === '/') {
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
      } else if (e.key === '?') {
        e.preventDefault();
        const hidden = $('shortcuts-modal').classList.contains('hidden');
        hidden ? openModal('shortcuts-modal') : closeModal('shortcuts-modal');
      } else if (e.code === 'Space') {
        e.preventDefault();
        audioEngine.togglePlayPause();
      } else if (e.key === ']' || k === 'n') {
        e.preventDefault();
        audioEngine.next();
      } else if (e.key === '[' || k === 'p') {
        e.preventDefault();
        audioEngine.previous();
      } else if (k === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        audioEngine.seek((audioEngine.currentTime || 0) + 10);
      } else if (k === 'j' || e.key === 'ArrowLeft') {
        e.preventDefault();
        audioEngine.seek(Math.max(0, (audioEngine.currentTime || 0) - 10));
      } else if (k === 's') {
        e.preventDefault();
        audioEngine.toggleShuffle();
        renderQueueViews(true);
      } else if (k === 'r') {
        e.preventDefault();
        audioEngine.cycleRepeatMode();
      } else if (k === 'q') {
        e.preventDefault();
        toggleQueueDrawer();
      } else if (k === 'u') {
        e.preventDefault();
        state.signatureOpen ? closeSignatureView() : openSignatureView();
      }
    });

    window.addEventListener('resize', () => {
      if (anyLyricsVisible()) renderAllLyrics();
    });

    document.addEventListener('input', (e) => {
      if (e.target && e.target.type === 'range') {
        updateSliderFill(e.target);
      }
    });
  }

  function rerenderCurrentRoute() {
    switch (state.route) {
      case 'home': renderHomeHistorySections(); loadHomeView(); break;
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
  // View template loader (plain HTML partials from ./views/*.html)
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
    applySidebarState();
    await loadViewTemplates();

    audioEngine = new GaplessAudioEngine(client, historyStore, updatePlayerBarUI, (err, song) => {
      // A stream failed to play (network / decode / server error).
      // The engine already cleared isPlaying; tell the user what happened.
      const label = song ? ` "${song.title || 'Untitled'}"` : '';
      showToast(`Couldn't play${label}. Check the connection and try again.`);
    });
    // Radio / autoplay (Century M1): when the queue runs out, the engine
    // asks the app for similar tracks to keep playing.
    // Autoplay: exclude every track already in the queue (Century
    // enqueueAutoplayTracks passes the whole queue as excludeSongIds), so
    // radio never replays something the user already heard or queued.
    audioEngine.onAutoplayNeeded = (lastSong) =>
      generateRadioTracks(lastSong, 25, (audioEngine.queue || []).map((s) => s.id));

    initLibraryViews();
    setupSearchHandlers();
    bindAllEvents();
    renderSearchResults();
    updatePlayerBarUI();
    requestAnimationFrame(lyricsFrameLoop);

    await Promise.all([syncStarredFromServer(), refreshPlaylistsSidebarAndCache()]);
    navigateTo('home');
    document.querySelectorAll('input[type="range"]').forEach(updateSliderFill);
    refreshIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
