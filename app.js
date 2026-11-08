// Plenrip Audio - Application UI, Views, Routing, Modals & Shortcuts
// Zero-framework vanilla JS controller. No build step: just serve this folder over HTTP.

(function () {
  const {
    STORAGE_KEYS,
    DEFAULT_CONFIG,
    LYRICS_PROVIDERS_META,
    DEFAULT_LYRICS_PRIORITY,
    LASTFM_DEFAULT_PLACEHOLDER_HASH,
    SubsonicClient,
    TitleTranslationStore,
    LyricsManager,
    HistoryStore,
    LastFmManager,
    GaplessAudioEngine,
    findActiveLineIndex,
    hasJapaneseScript,
    processJapaneseLyrics,
    generateAuraPlaceholder,
    fetchDeezerArtistImageJsonp,
    generatePlaylistCollage,
  } = window.PlenripEngine;

  // Core instances
  const client = new SubsonicClient();
  const lyricsManager = new LyricsManager();
  const historyStore = new HistoryStore();
  const lastFm = new LastFmManager();
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
      if (remote && !String(remote).includes(LASTFM_DEFAULT_PLACEHOLDER_HASH)) {
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
    row.className =
      'song-row group flex items-center justify-between gap-3 px-3 py-2 border-b border-zinc-700 hover:bg-zinc-800/70 transition-colors';

    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0 flex-1';

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

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.title = 'Track options';
    menuBtn.setAttribute('aria-label', 'More actions for track');
    menuBtn.className = 'p-1.5 text-zinc-400 hover:text-zinc-100';
    menuBtn.innerHTML = '<i data-lucide="more-horizontal" class="w-4 h-4"></i>';
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

  // Generic media card (album, artist, playlist, song)
  function createMediaCard(opts) {
    const card = document.createElement('div');
    card.className =
      'group studio-panel hover:border-zinc-500 p-3 flex flex-col cursor-pointer transition-colors min-w-0';

    const cover = document.createElement('div');
    cover.className = `w-full aspect-square bg-zinc-950 border border-zinc-700 overflow-hidden relative flex items-center justify-center mb-2.5 ${
      opts.round ? '!rounded-full' : ''
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
    } else attachCoverImage(img, fb, opts.coverId, opts.fallbackSongId, 300);

    if (typeof opts.onPlay === 'function') {
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('aria-label', `Play ${opts.title || ''}`);
      playBtn.className =
        'absolute bottom-2 right-2 px-2 py-1 bg-emerald-400 text-zinc-950 text-[10px] font-mono font-semibold opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity';
      playBtn.textContent = '[PLAY]';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onPlay();
      });
      cover.appendChild(playBtn);
    }

    if (typeof opts.progressPercent === 'number') {
      const bar = document.createElement('div');
      bar.className = 'absolute left-0 right-0 bottom-0 h-1 bg-zinc-700';
      bar.innerHTML = `<div class="h-full bg-emerald-400" style="width:${Math.max(2, Math.min(100, opts.progressPercent))}%"></div>`;
      cover.appendChild(bar);
    }

    const title = document.createElement('div');
    title.className = `text-sm font-medium text-zinc-100 group-hover:text-emerald-400 truncate ${opts.round ? 'text-center' : ''}`;
    title.innerHTML = opts.titleHtml || escapeHtml(opts.title || '');

    card.appendChild(cover);
    card.appendChild(title);

    if (opts.subtitle) {
      const sub = document.createElement('div');
      sub.className = `text-xs text-zinc-400 truncate mt-0.5 ${opts.round ? 'text-center' : ''}`;
      sub.textContent = opts.subtitle;
      card.appendChild(sub);
    }
    if (opts.meta) {
      const meta = document.createElement('div');
      meta.className = `mt-1.5 text-[11px] font-mono text-zinc-400 ${opts.round ? 'text-center' : ''}`;
      meta.textContent = opts.meta;
      card.appendChild(meta);
    }

    card.addEventListener('click', () => opts.onClick && opts.onClick());
    return card;
  }

  function createAlbumCard(album, backRoute = 'albums') {
    return createMediaCard({
      coverId: album.coverArt || (String(album.id).startsWith('singles-') ? null : album.id),
      fallbackSongId: album._virtualSongs?.[0]?.id,
      fallbackIcon: String(album.id).startsWith('singles-') ? 'music-2' : 'disc',
      titleHtml: titleHtml(album.name || 'Untitled Album', album.artist),
      subtitle: album.artist || 'Unknown Artist',
      meta: `${album.year ? album.year + ' · ' : ''}${album.songCount ? album.songCount + ' trk' : 'Album'}`,
      onClick: () => openAlbumDetail(album, backRoute),
      onPlay: async () => {
        try {
          const detail = await client.resolveAlbumSongs(album);
          playSongs(detail.song, { shuffle: false });
        } catch (err) {
          showToast(`Failed to play album: ${err.message}`);
        }
      },
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
      round: true,
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

  async function toggleStarAlbum(album) {
    if (!album?.id || String(album.id).startsWith('singles-')) return;
    const was = state.starredAlbumIds.has(album.id);
    try {
      if (was) {
        await client.unstar({ albumId: album.id });
        state.starredAlbumIds.delete(album.id);
      } else {
        await client.star({ albumId: album.id });
        state.starredAlbumIds.add(album.id);
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
      const pages = Math.max(1, Math.ceil(filtered.length / cfg.pageSize));
      if (view.page >= pages) view.page = pages - 1;
      const slice = filtered.slice(view.page * cfg.pageSize, (view.page + 1) * cfg.pageSize);

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
      fetchItems: (view) => loadAllAlbums(view.sort),
      isStarred: (a) => state.starredAlbumIds.has(a.id),
      matches: (a, q) =>
        titles.matchesSearchWithTranslation(a.name, a.artist, q) || titles.matchesSearchWithTranslation(a.artist, '', q),
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
      renderPage: (container, items) => items.forEach((a) => container.appendChild(createAlbumCard(a, 'albums'))),
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
        titles.matchesSearchWithTranslation(s.title, s.artist, q) ||
        titles.matchesSearchWithTranslation(s.album, s.artist, q) ||
        titles.matchesSearchWithTranslation(s.artist, '', q),
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
          container.appendChild(createTrackRowElement(song, view.page * 100 + idx, all));
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
      const recent = await client.getAlbumList2({ type: 'newest', size: 12, offset: 0 });
      setConnectionError(null);
      recentGrid.innerHTML = '';
      if (recent.length === 0) {
        recentGrid.innerHTML = '<div class="col-span-full py-6 text-xs font-mono text-zinc-400">No albums found on server.</div>';
      } else {
        recent.forEach((alb) => recentGrid.appendChild(createAlbumCard(alb, 'home')));
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

    // 2. Forgotten Favourite?
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

    // 4. Quick Pick (deterministic per day)
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
      }, 250);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (input.value) {
          e.preventDefault();
          e.stopPropagation();
          clearSearchState(true);
        } else {
          input.blur();
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
        const card = createAlbumCard(al, 'search');
        grid.appendChild(card);
        state.searchNavItems.push({ el: card, trigger: () => openAlbumDetail(al, 'search') });
      });
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    if (song.length > 0) {
      const sec = section('Songs', song.length);
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
      } else {
        albums.forEach((alb) => grid.appendChild(createAlbumCard(alb, 'artist-detail')));
      }
      queueTranslations([{ title: artist.name, artist: '' }, ...albums.map((a) => ({ title: a.name, artist: a.artist }))]);
      refreshIcons();

      // Biography + similar artists (best-effort)
      client.getArtistInfo2(artistId).then((info) => {
        if (state.currentArtist?.id !== artistId) return;
        const bio = String(info.biography || '').replace(/<a [^>]*>.*?<\/a>/gi, '').replace(/<[^>]+>/g, '').trim();
        if (bio) {
          $('artist-bio-text').textContent = bio.length > 600 ? `${bio.slice(0, 600)}...` : bio;
          show($('artist-bio-wrap'), true);
        }
        const similar = (info.similarArtist || []).filter((a) => a.id).slice(0, 8);
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
        createTrackRowElement(song, idx, songs, { showCover: virtual, showAlbum: virtual, showTrackNumber: !virtual })
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
        })
      );
    });
    queueTranslations(entries.map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
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
  async function loadFavouritesView() {
    const list = $('favourites-list');
    if (!list) return;
    if (!list.hasChildNodes()) list.innerHTML = '<div class="p-6 text-xs font-mono text-zinc-400">Loading starred tracks...</div>';
    try {
      await syncStarredFromServer();
      const songs = state.favouriteSongs;
      $('favourites-count-label').textContent = `${songs.length} starred tracks`;
      list.innerHTML = '';
      if (songs.length === 0) {
        list.innerHTML = '<div class="p-8 text-center text-xs font-mono text-zinc-400">No favourite songs yet. Click the star on any track to add it.</div>';
        return;
      }
      songs.forEach((song, idx) => list.appendChild(createTrackRowElement(song, idx, songs)));
      queueTranslations(songs.map((s) => ({ title: s.title, artist: s.artist })));
      refreshIcons();
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
    bridgeUrl: localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url') || 'http://localhost:3001',
    apiKey: localStorage.getItem('century.nas_api_key') || '',
    isOnline: false,
    initialized: false,
  };

  function getFileBridgeBase() {
    const saved = localStorage.getItem('century.nas_url') || localStorage.getItem('century.file_bridge_url');
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');

    // Automatically infer from client.baseUrl (Navidrome's IP / hostname on Windows PC)
    try {
      if (client?.baseUrl) {
        const u = new URL(client.baseUrl);
        return `${u.protocol}//${u.hostname}:3001`;
      }
    } catch (_) {}

    return (filesState.bridgeUrl || 'http://localhost:3001').trim().replace(/\/+$/, '');
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

  async function loadFilesView(targetPath) {
    initFilesEvents();
    if (typeof targetPath === 'string') {
      filesState.currentPath = targetPath;
    }
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
    if (!tbody) return;
    tbody.innerHTML = '';

    const q = (filesState.filterQuery || '').trim().toLowerCase();
    const filtered = filesState.items.filter((item) => !q || item.name.toLowerCase().includes(q));

    const foldersCount = filesState.items.filter((i) => i.isDirectory).length;
    const filesCount = filesState.items.length - foldersCount;
    if (countLabel) {
      countLabel.textContent = `${foldersCount} folder${foldersCount === 1 ? '' : 's'}, ${filesCount} file${filesCount === 1 ? '' : 's'}${
        filesState.currentPath ? ` in /${filesState.currentPath}` : ' (root storage)'
      }`;
    }

    if (filtered.length === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    filtered.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'group hover:bg-zinc-800/50 transition-colors';

      const iconName = getFileIcon(item.name, item.isDirectory);
      const iconColor = item.isDirectory ? 'text-emerald-400' : 'text-zinc-400';
      const isImg = !item.isDirectory && isImageFile(item.name);

      tr.innerHTML = `
        <td class="py-2.5 px-4 text-center font-mono text-[11px] text-zinc-500">${idx + 1}</td>
        <td class="py-2.5 px-4">
          <div class="flex items-center gap-2.5 min-w-0">
            <i data-lucide="${iconName}" class="w-4 h-4 shrink-0 ${iconColor}"></i>
            <button
              type="button"
              class="file-item-btn text-left truncate font-sans text-xs ${
                item.isDirectory || isImg
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
          const next = filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name;
          loadFilesView(next);
        };
      } else if (isImg) {
        tr.querySelector('.file-item-btn').onclick = () => {
          openImageViewer(item);
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
          const target = filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name;
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

  async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    const base = getFileBridgeBase();
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    showToast(`Uploading ${files.length} file${files.length === 1 ? '' : 's'}...`);

    try {
      const res = await fetch(`${base}/api/files/upload?path=${encodeURIComponent(filesState.currentPath)}`, {
        method: 'POST',
        headers: getFileBridgeHeaders(),
        body: formData,
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('401 Unauthorized: Invalid or missing NAS API Key.');
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      showToast(`Successfully uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
      client.request('startScan').catch(() => {});
      loadFilesView();
    } catch (err) {
      showToast(`Upload failed: ${err.message}`, 'error');
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
    const target = filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name;
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
    const images = filesState.items.filter((i) => !i.isDirectory && isImageFile(i.name));
    if (!images.length) return;

    let idx = images.findIndex((i) => i.name === targetItem.name);
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

    const relativePath = filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name;
    const base = getFileBridgeBase();
    const apiKey = getFileBridgeApiKey();

    const rawUrl = new URL(`${base}/api/files/raw`);
    rawUrl.searchParams.set('path', relativePath);
    if (apiKey) rawUrl.searchParams.set('apiKey', apiKey);

    if (img) {
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
      img.src = rawUrl.toString();
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
    const target = filesState.currentPath ? `${filesState.currentPath}/${item.name}` : item.name;
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

    // Filter input
    const filterInput = $('files-filter-input');
    const filterClear = $('files-filter-clear');
    if (filterInput) {
      filterInput.addEventListener('input', (e) => {
        filesState.filterQuery = e.target.value;
        if (filterClear) filterClear.classList.toggle('hidden', !e.target.value);
        renderFilesList();
      });
    }
    if (filterClear) {
      filterClear.addEventListener('click', () => {
        if (filterInput) filterInput.value = '';
        filesState.filterQuery = '';
        filterClear.classList.add('hidden');
        renderFilesList();
      });
    }

    // Upload input
    const uploadInput = $('files-upload-input');
    if (uploadInput) {
      uploadInput.addEventListener('change', (e) => {
        if (e.target.files?.length) {
          uploadFiles(e.target.files);
          uploadInput.value = '';
        }
      });
    }

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
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (dragOverlay) dragOverlay.classList.add('hidden');
        if (e.dataTransfer?.files?.length) {
          uploadFiles(e.dataTransfer.files);
        }
      });
    }

    initImageViewerEvents();
  }

  // ============================================================================
  // Queue (drawer, now-playing panel, mobile overlay) with drag-and-drop reorder
  // ============================================================================
  let draggedQueueIdx = null;
  let lastQueueSignature = '';

  function queueSignature() {
    const q = audioEngine?.queue || [];
    return `${q.length}:${audioEngine?.currentIndex}:${q[0]?.id}:${q[q.length - 1]?.id}:${audioEngine?.currentSong?.id}`;
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
      right.appendChild(mk('more-horizontal', 'Track options', (e) => openTrackContextMenu(e, song, idx)));
      right.appendChild(mk('x', 'Remove from queue', () => { audioEngine.removeFromQueue(idx); renderQueueViews(true); }, false, 'hover:!text-[#f0605a]'));

      item.appendChild(left);
      item.appendChild(right);
      container.appendChild(item);
    });
    queueTranslations(q.slice(0, 80).map((s) => ({ title: s.title, artist: s.artist })));
    refreshIcons();
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
      visible: () => state.lyricsDrawerOpen, lastIdx: -2,
    },
    {
      key: 'np', container: 'np-lyrics-scroll', modeGroup: 'np-lyrics-mode-group',
      preparing: 'np-lyrics-preparing', searchBtn: 'np-lyrics-search-btn', size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npTab === 'lyrics' && window.innerWidth >= 1024, lastIdx: -2,
    },
    {
      key: 'npm', container: 'np-mobile-overlay-body', modeGroup: 'np-mobile-lyrics-mode-group',
      size: 'text-lg',
      visible: () => state.route === 'now-playing' && state.npMobileOverlay === 'lyrics' && window.innerWidth < 1024, lastIdx: -2,
    },
    {
      key: 'sig', container: 'signature-lyrics-container', modeGroup: 'sig-lyrics-mode-group',
      preparing: 'sig-lyrics-preparing', size: 'text-2xl md:text-3xl',
      visible: () => state.signatureOpen, lastIdx: -2,
    },
  ];

  function anyLyricsVisible() {
    return lyricViews.some((v) => v.visible());
  }

  function getDisplayLines() {
    const L = state.lyrics;
    const res = L.result;
    if (!res || !Array.isArray(res.lines)) return [];
    const mode = lyricsManager.getTrackMode(L.trackId);
    if (mode === 'romaji' && L.romaji) return L.romaji;
    if (mode === 'en' && L.en) return L.en;
    return res.lines;
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
    if (res.status === 'ok' && res.lines && hasJapaneseScript(res.lines) && lyricsManager.getTrackMode(song.id) !== 'original') {
      prepareReadings();
    }
  }

  async function prepareReadings() {
    const L = state.lyrics;
    const song = audioEngine?.currentSong;
    if (!song || !L.result?.lines || L.romaji || L.preparing) return;
    L.preparing = true;
    renderAllLyrics();
    const { romaji, en } = await processJapaneseLyrics(L.result.lines, song.id);
    if (audioEngine?.currentSong?.id !== song.id) return;
    L.romaji = romaji;
    L.en = en;
    L.preparing = false;
    renderAllLyrics();
  }

  function setLyricsMode(mode) {
    const song = audioEngine?.currentSong;
    if (!song) return;
    lyricsManager.setTrackMode(song.id, mode);
    if (mode !== 'original' && !state.lyrics.romaji) prepareReadings();
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

    // Mode group (only for Japanese lyrics with synced lines)
    const group = $(view.modeGroup);
    if (group) {
      const showModes = synced && hasJapaneseScript(res.lines);
      group.classList.toggle('hidden', !showModes);
      if (showModes) group.classList.add('flex');
      const mode = lyricsManager.getTrackMode(L.trackId);
      group.querySelectorAll('[data-lyrics-mode]').forEach((b) => setModeButton(b, b.getAttribute('data-lyrics-mode') === mode));
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
    const mode = lyricsManager.getTrackMode(L.trackId);
    container.innerHTML = '<div class="py-[30%]"></div>';
    const wrap = container.firstElementChild;
    lines.forEach((line, idx) => {
      const el = document.createElement('div');
      el.setAttribute('data-idx', String(idx));
      el.className = `lyric-line cursor-pointer px-4 py-2 leading-snug text-zinc-400 hover:text-zinc-100 ${view.size}`;
      if (mode === 'original' && line.words && line.words.length > 0) {
        line.words.forEach((w) => {
          const span = document.createElement('span');
          span.className = 'lyric-word lyric-word-unsung';
          span.setAttribute('data-t', String(w.t));
          span.setAttribute('data-end', String(w.end));
          span.textContent = JP_REGEX.test(w.text) ? w.text : `${w.text} `;
          el.appendChild(span);
        });
      } else {
        el.textContent = line.text || '♪';
      }
      el.addEventListener('click', () => {
        const offset = lyricsManager.getTrackOffset(L.trackId);
        audioEngine.seek(Math.max(0, line.timeSeconds - offset));
      });
      wrap.appendChild(el);
    });
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
    const idx = findActiveLineIndex(lines, time);
    L.activeIdx = idx;

    for (const view of lyricViews) {
      if (!view.visible()) continue;
      const container = $(view.container);
      if (!container) continue;
      const els = container.querySelectorAll('.lyric-line');
      if (els.length === 0) continue;

      if (view.lastIdx !== idx || force) {
        els.forEach((el, i) => {
          const active = i === idx;
          el.classList.toggle('lyric-line-active', active);
          el.classList.toggle('text-zinc-400', !active && !el.querySelector('.lyric-word'));
          // Reset word state for non-active lines
          if (!active) {
            el.querySelectorAll('.lyric-word').forEach((w) => {
              w.classList.remove('lyric-word-active');
              w.classList.toggle('lyric-word-sung', i < idx);
              w.classList.toggle('lyric-word-unsung', i >= idx);
              w.style.removeProperty('--word-fill');
            });
          }
        });
        if (idx >= 0 && els[idx]) scrollLineIntoCenter(container, els[idx]);
        view.lastIdx = idx;
      }

      // Word-level karaoke fill on the active line
      const activeEl = idx >= 0 ? els[idx] : null;
      if (activeEl) {
        activeEl.querySelectorAll('.lyric-word').forEach((w) => {
          const start = parseFloat(w.getAttribute('data-t'));
          const end = parseFloat(w.getAttribute('data-end'));
          if (time >= end) {
            w.classList.remove('lyric-word-active', 'lyric-word-unsung');
            w.classList.add('lyric-word-sung');
            w.style.removeProperty('--word-fill');
          } else if (time >= start) {
            const pct = Math.max(0, Math.min(100, ((time - start) / Math.max(0.05, end - start)) * 100));
            w.classList.remove('lyric-word-unsung', 'lyric-word-sung');
            w.classList.add('lyric-word-active');
            w.style.setProperty('--word-fill', `${pct}%`);
          } else {
            w.classList.remove('lyric-word-active', 'lyric-word-sung');
            w.classList.add('lyric-word-unsung');
            w.style.removeProperty('--word-fill');
          }
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
        if (L.result.lines && hasJapaneseScript(L.result.lines) && lyricsManager.getTrackMode(song.id) !== 'original') prepareReadings();
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
      $('mobile-mini-title').innerHTML = titleHtml(song.title || 'Untitled Track', song.artist);
      $('mobile-mini-artist').textContent = song.artist || 'Unknown Artist';
      queueTranslations([{ title: song.title, artist: song.artist }]);
    }

    const starred = state.starredSongIds.has(song.id);
    ['player-star-btn', 'np-star-btn', 'np-mobile-star-btn'].forEach((id) => {
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
    const audio = tab === 'audio';
    const server = tab === 'server';
    const nas = tab === 'nas';

    show($('settings-tab-audio'), audio);
    show($('settings-tab-server'), server);
    show($('settings-tab-nas'), nas);

    const style = (btn, active) => {
      if (!btn) return;
      btn.classList.toggle('border-emerald-400', active);
      btn.classList.toggle('text-zinc-100', active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-zinc-400', !active);
    };
    style($('settings-tab-btn-audio'), audio);
    style($('settings-tab-btn-server'), server);
    style($('settings-tab-btn-nas'), nas);

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

    $('settings-server-url').value = client.baseUrl;
    $('settings-server-user').value = client.username;
    $('settings-server-pass').value = '';

    const nasUrlInput = $('settings-nas-url');
    if (nasUrlInput) {
      nasUrlInput.value = getFileBridgeBase();
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
    const starCurrent = () => audioEngine?.currentSong && toggleStarTrack(audioEngine.currentSong);
    ['player-star-btn', 'np-star-btn', 'np-mobile-star-btn'].forEach((id) => on(id, 'click', starCurrent));
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
    on('btn-mute', 'click', () => {
      if (audioEngine.volume > 0) {
        state.lastNonZeroVolume = audioEngine.volume;
        audioEngine.setVolume(0);
      } else {
        audioEngine.setVolume(state.lastNonZeroVolume || 0.85);
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

    // Lyrics: mode buttons (all groups) + search buttons
    document.querySelectorAll('[data-lyrics-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setLyricsMode(btn.getAttribute('data-lyrics-mode')));
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
      updateSignatureMetadataUI();
      syncLyrics(true);
    };
    on('sig-offset-minus', 'click', () => nudgeOffset(-0.2));
    on('sig-offset-plus', 'click', () => nudgeOffset(0.2));
    on('sig-offset-reset', 'click', () => nudgeOffset(null));
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((evt) => {
      $('signature-modal')?.addEventListener(evt, wakeSignatureChrome, { passive: true });
    });

    // Context menu
    on('ctx-play-now', 'click', () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) audioEngine.playQueue([s], 0, { shuffle: false });
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

    // Click-away for floating menus
    document.addEventListener('click', (e) => {
      const menu = $('track-context-menu');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) closeTrackContextMenu();
      document.querySelectorAll('[id$="-sort-menu"], #album-more-menu, #playlist-more-menu').forEach((m) => {
        if (!m.classList.contains('hidden') && !m.contains(e.target)) m.classList.add('hidden');
      });
    });

    // Settings
    on('settings-modal-close-btn', 'click', closeSettings);
    on('settings-done-btn', 'click', closeSettings);
    $('settings-modal')?.addEventListener('click', (e) => {
      if (e.target === $('settings-modal')) closeSettings();
    });
    on('settings-tab-btn-audio', 'click', () => setSettingsTab('audio'));
    on('settings-tab-btn-server', 'click', () => setSettingsTab('server'));
    on('settings-tab-btn-nas', 'click', () => setSettingsTab('nas'));
    on('settings-output-device', 'change', (e) => audioEngine.setOutputDevice(e.target.value || 'default'));
    on('settings-crossfade-slider', 'input', (e) => {
      const v = parseInt(e.target.value, 10) || 0;
      audioEngine.setCrossfadeSeconds(v);
      $('settings-crossfade-label').textContent = v === 0 ? '0s (Gapless cut)' : `${v}s`;
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
      const cleanUrl = rawUrl.replace(/\/+$/, '') || 'http://localhost:3001';

      filesState.bridgeUrl = cleanUrl;
      filesState.apiKey = rawKey;

      localStorage.setItem('century.nas_url', cleanUrl);
      localStorage.setItem('century.file_bridge_url', cleanUrl);
      localStorage.setItem('century.nas_api_key', rawKey);

      const bridgeUrlInput = $('files-bridge-url-input');
      if (bridgeUrlInput) bridgeUrlInput.value = cleanUrl;

      showToast('Saved NAS Storage settings');
      await checkFilesBridge();
      if (state.route === 'files') {
        loadFilesView();
      }
    });
    on('settings-reset-nas-btn', 'click', async () => {
      filesState.bridgeUrl = 'http://localhost:3001';
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
        if (!$('track-context-menu').classList.contains('hidden')) return closeTrackContextMenu();
        for (const id of ['add-to-playlist-modal', 'save-queue-playlist-modal', 'create-playlist-modal']) {
          if (!$(id).classList.contains('hidden')) return closeModal(id);
        }
        if (state.lyricsSourceModalOpen) return closeLyricsSourceModal();
        if (state.settingsOpen) return closeSettings();
        if (!$('shortcuts-modal').classList.contains('hidden')) return closeModal('shortcuts-modal');
        if (state.signatureOpen) return closeSignatureView();
        if (state.queueOpen) return toggleQueueDrawer(false);
        if (state.lyricsDrawerOpen) return toggleLyricsDrawer(false);
        return;
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
    await client.loadEnvConfig();

    audioEngine = new GaplessAudioEngine(client, historyStore, lastFm, updatePlayerBarUI);

    initLibraryViews();
    setupSearchHandlers();
    bindAllEvents();
    renderSearchResults();
    updatePlayerBarUI();
    requestAnimationFrame(lyricsFrameLoop);

    // Last.fm OAuth callback token (if the user connected scrobbling before)
    const lfmToken = new URLSearchParams(window.location.search).get('token');
    if (lfmToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      lastFm.handleCallbackToken(lfmToken).then((s) => showToast(`Connected to Last.fm as ${s.name}`)).catch(() => {});
    }

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
