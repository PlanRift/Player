// Plenrip Audio - Application UI, Views, Routing, Modals & Shortcuts
// Zero-framework Vanilla JS controller.

(function () {
  const {
    STORAGE_KEYS,
    DEFAULT_CONFIG,
    LYRICS_PROVIDERS_META,
    DEFAULT_LYRICS_PRIORITY,
    SubsonicClient,
    LyricsManager,
    HistoryStore,
    LastFmManager,
    GaplessAudioEngine,
    findActiveLineIndex,
    generateDiscoveryCards,
    drawGenerativeThumbnail,
    generatePlaylistCollage,
  } = window.PlenripEngine;

  // Core instances
  const client = new SubsonicClient();
  const lyricsManager = new LyricsManager();
  const historyStore = new HistoryStore();
  const lastFm = new LastFmManager();

  // Application state
  const state = {
    route: 'home',
    previousRoute: 'home',
    sidebarCollapsed: localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === 'true',
    queueOpen: false,
    signatureOpen: false,
    lyricsSourceModalOpen: false,
    shortcutsModalOpen: false,

    // Data caches
    artists: [],
    currentArtist: null,
    currentArtistSingles: [],
    albums: [],
    albumsSort: 'newest',
    albumsOffset: 0,
    albumsHasMore: true,
    currentAlbum: null,
    albumBackRoute: 'albums',

    songs: [],
    songsOffset: 0,
    songsHasMore: true,

    playlists: [],
    currentPlaylist: null,
    deletePlaylistConfirm: false,

    starredSongIds: new Set(),
    starredAlbumIds: new Set(),
    favouriteSongs: [],

    discoveryCards: [],
    currentDiscoveryCard: null,

    // Search state
    searchQuery: '',
    searchTimer: null,
    searchResults: { artist: [], album: [], song: [] },
    searchNavItems: [],
    searchSelectedIndex: -1,

    // Lyrics state for active track
    lyricsTrackId: null,
    lyricsLoading: false,
    lyricsResult: null,
    activeLyricIndex: -1,
    providerProbes: {},

    // Context menu target
    ctxSong: null,
    ctxQueueIndex: null,

    // Volume mute memory
    lastNonZeroVolume: 0.85,
  };

  let audioEngine = null;

  // ============================================================================
  // Formatting & DOM Helpers
  // ============================================================================
  function $(id) {
    return document.getElementById(id);
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
    if (hours > 0) return `${hours} hr ${mins} min`;
    return `${mins} min`;
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  let toastTimer = null;
  function showToast(message) {
    const el = $('toast-banner');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, 2800);
  }

  // Loads Subsonic cover art with automatic stream binary header fallback
  function attachCoverImage(imgEl, fallbackEl, coverId, fallbackSongId, size = 300) {
    if (!imgEl) return;
    imgEl.classList.add('hidden');
    if (fallbackEl) fallbackEl.classList.remove('hidden');

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
      client.extractCoverFromStream(fallbackSongId).then((streamUrl) => {
        if (streamUrl) showImg(streamUrl);
      });
    }
  }

  // ============================================================================
  // Navigation & Sidebar
  // ============================================================================
  const ALL_VIEWS = [
    'home',
    'search',
    'artists',
    'artist-detail',
    'albums',
    'album-detail',
    'songs',
    'playlists',
    'playlist-detail',
    'favourites',
    'discovery-detail',
    'settings',
  ];

  function applySidebarState() {
    const sidebar = $('sidebar');
    if (!sidebar) return;
    if (state.sidebarCollapsed) {
      sidebar.classList.add('sidebar-collapsed');
    } else {
      sidebar.classList.remove('sidebar-collapsed');
    }
  }

  function toggleSidebar() {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, state.sidebarCollapsed ? 'true' : 'false');
    applySidebarState();
  }

  function navigateTo(route, options = {}) {
    if (state.route !== route) {
      state.previousRoute = state.route;
    }
    state.route = route;

    for (const v of ALL_VIEWS) {
      const sec = $(`view-${v}`);
      if (sec) {
        if (v === route) sec.classList.remove('hidden');
        else sec.classList.add('hidden');
      }
    }

    // Highlight sidebar navigation button
    const navButtons = document.querySelectorAll('.sidebar-nav-btn[data-route]');
    navButtons.forEach((btn) => {
      const btnRoute = btn.getAttribute('data-route');
      const isMatch =
        btnRoute === route ||
        (btnRoute === 'artists' && route === 'artist-detail') ||
        (btnRoute === 'albums' && route === 'album-detail' && state.albumBackRoute === 'albums') ||
        (btnRoute === 'artists' && route === 'album-detail' && state.albumBackRoute === 'artist-detail') ||
        (btnRoute === 'home' && route === 'discovery-detail');

      if (isMatch) btn.classList.add('nav-item-active');
      else btn.classList.remove('nav-item-active');
    });

    // Highlight custom sidebar playlist buttons
    document.querySelectorAll('.sidebar-playlist-item').forEach((btn) => {
      const plId = btn.getAttribute('data-playlist-id');
      if (route === 'playlist-detail' && state.currentPlaylist?.id === plId) {
        btn.classList.add('nav-item-active');
      } else {
        btn.classList.remove('nav-item-active');
      }
    });

    const main = $('main-content');
    if (main && !options.preserveScroll) {
      main.scrollTop = 0;
    }

    if (route === 'home') loadHomeView();
    else if (route === 'search') {
      setTimeout(() => {
        const input = $('search-input');
        if (input) input.focus();
      }, 30);
    } else if (route === 'artists') loadArtistsView();
    else if (route === 'albums') loadAlbumsView(true);
    else if (route === 'songs') loadSongsView(true);
    else if (route === 'playlists') loadPlaylistsView();
    else if (route === 'favourites') loadFavouritesView();
    else if (route === 'settings') renderSettingsView();

    refreshIcons();
  }

  // ============================================================================
  // Reusable Track Row Builder (Used across Album, Songs, Favourites, Search, Discovery, Playlist)
  // ============================================================================
  function createTrackRowElement(song, index, queueContext, options = {}) {
    const isCurrent = audioEngine?.currentSong?.id === song.id;
    const isPlaying = isCurrent && audioEngine?.isPlaying;
    const isStarred = state.starredSongIds.has(song.id) || Boolean(song.starred);
    if (song.starred) state.starredSongIds.add(song.id);

    const row = document.createElement('div');
    row.className = `group flex items-center justify-between gap-3 px-4 py-2.5 transition-colors ${
      isCurrent ? 'bg-[#27272a]' : 'hover:bg-[#27272a]/60'
    }`;

    // Left: Index / Equalizer + Optional Cover + Title & Artist
    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0 flex-1';

    const playTrigger = document.createElement('button');
    playTrigger.type = 'button';
    playTrigger.setAttribute('aria-label', `Play ${song.title || 'track'}`);
    playTrigger.className = 'w-7 h-7 rounded flex items-center justify-center shrink-0 text-xs font-mono';

    if (isPlaying) {
      playTrigger.innerHTML = `
        <span class="flex items-end gap-0.5 h-3.5" aria-hidden="true">
          <span class="w-0.5 bg-[#34d399] eq-bar-1"></span>
          <span class="w-0.5 bg-[#34d399] eq-bar-2"></span>
          <span class="w-0.5 bg-[#34d399] eq-bar-3"></span>
        </span>
      `;
    } else {
      const displayNum = options.showTrackNumber && song.track ? song.track : index + 1;
      playTrigger.innerHTML = `
        <span class="group-hover:hidden ${isCurrent ? 'text-[#34d399] font-bold' : 'text-[#a1a1aa]'}">${displayNum}</span>
        <i data-lucide="play" class="hidden group-hover:block w-3.5 h-3.5 text-[#f4f4f5] fill-current"></i>
      `;
    }

    playTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCurrent) {
        audioEngine.togglePlayPause();
      } else {
        audioEngine.playSong(song, queueContext);
      }
    });
    left.appendChild(playTrigger);

    if (options.showCover !== false) {
      const coverWrap = document.createElement('div');
      coverWrap.className =
        'w-9 h-9 rounded bg-[#0e0e11] border border-[#3f3f46] overflow-hidden shrink-0 flex items-center justify-center';
      const img = document.createElement('img');
      img.alt = '';
      img.className = 'hidden w-full h-full object-cover';
      const fb = document.createElement('div');
      fb.className = 'text-[#a1a1aa] flex items-center justify-center';
      fb.innerHTML = '<i data-lucide="music" class="w-3.5 h-3.5"></i>';
      coverWrap.appendChild(img);
      coverWrap.appendChild(fb);
      attachCoverImage(img, fb, song.coverArt || song.albumId, song.id, 120);
      left.appendChild(coverWrap);
    }

    const textWrap = document.createElement('div');
    textWrap.className = 'min-w-0 flex-1';

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = `block max-w-full truncate text-sm text-left font-medium ${
      isCurrent ? 'text-[#34d399]' : 'text-[#f4f4f5]'
    } hover:underline`;
    titleBtn.textContent = song.title || 'Untitled Track';
    titleBtn.addEventListener('click', () => {
      if (isCurrent) audioEngine.togglePlayPause();
      else audioEngine.playSong(song, queueContext);
    });

    const subLine = document.createElement('div');
    subLine.className = 'flex items-center gap-1.5 text-xs text-[#a1a1aa] truncate';

    const artistBtn = document.createElement('button');
    artistBtn.type = 'button';
    artistBtn.className = 'truncate hover:text-[#f4f4f5] hover:underline';
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
      albumBtn.className = 'truncate hover:text-[#f4f4f5] hover:underline';
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

    // Right: Star + Duration + Optional Remove from Playlist + 3-Dot Context Menu
    const right = document.createElement('div');
    right.className = 'flex items-center gap-2 shrink-0';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.setAttribute('aria-label', isStarred ? 'Unstar track' : 'Star track');
    starBtn.title = isStarred ? 'Remove from Favourites' : 'Add to Favourites';
    starBtn.className = `p-1.5 rounded transition-colors ${
      isStarred ? 'text-[#34d399]' : 'text-[#a1a1aa] hover:text-[#f4f4f5]'
    }`;
    starBtn.innerHTML = `<i data-lucide="heart" class="w-3.5 h-3.5 ${isStarred ? 'fill-current' : ''}"></i>`;
    starBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleStarTrack(song);
    });
    right.appendChild(starBtn);

    const durSpan = document.createElement('span');
    durSpan.className = 'w-11 text-right text-xs font-mono text-[#a1a1aa]';
    durSpan.textContent = formatDuration(song.duration);
    right.appendChild(durSpan);

    if (typeof options.onRemoveFromPlaylist === 'function') {
      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.setAttribute('aria-label', 'Remove track from playlist');
      remBtn.title = 'Remove from playlist';
      remBtn.className = 'p-1.5 rounded text-[#a1a1aa] hover:text-[#f87171] hover:bg-[#0e0e11]';
      remBtn.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        options.onRemoveFromPlaylist(index);
      });
      right.appendChild(remBtn);
    }

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-label', 'More actions for track');
    menuBtn.title = 'Track options';
    menuBtn.className = 'p-1.5 rounded text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#0e0e11]';
    menuBtn.innerHTML = '<i data-lucide="more-horizontal" class="w-4 h-4"></i>';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTrackContextMenu(e, song, null);
    });
    right.appendChild(menuBtn);

    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  // Reusable Album Card Builder
  function createAlbumCardElement(album, backRoute = 'albums') {
    const card = document.createElement('div');
    card.className =
      'group rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#71717a] p-3 transition-colors flex flex-col';

    const coverContainer = document.createElement('div');
    coverContainer.className =
      'w-full aspect-square rounded bg-[#0e0e11] border border-[#3f3f46] overflow-hidden relative flex items-center justify-center mb-2.5 cursor-pointer';

    const img = document.createElement('img');
    img.alt = album.name || 'Album cover';
    img.className = 'hidden w-full h-full object-cover';

    const fb = document.createElement('div');
    fb.className = 'flex flex-col items-center justify-center text-[#a1a1aa]';
    fb.innerHTML = '<i data-lucide="disc" class="w-8 h-8"></i>';

    const playOverlay = document.createElement('button');
    playOverlay.type = 'button';
    playOverlay.setAttribute('aria-label', `Play ${album.name || 'album'}`);
    playOverlay.title = `Play ${album.name || 'album'}`;
    playOverlay.className =
      'absolute bottom-2 right-2 w-9 h-9 rounded-full bg-[#34d399] text-[#090d0b] flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-lg';
    playOverlay.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
    playOverlay.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const detail = await client.getAlbum(album.id);
        if (detail.song && detail.song.length > 0) {
          audioEngine.playSong(detail.song[0], detail.song);
        }
      } catch (err) {
        showToast(`Failed to play album: ${err.message}`);
      }
    });

    coverContainer.appendChild(img);
    coverContainer.appendChild(fb);
    coverContainer.appendChild(playOverlay);
    coverContainer.addEventListener('click', () => openAlbumDetail(album.id, backRoute));

    attachCoverImage(img, fb, album.coverArt || album.id, null, 300);

    const titleBtn = document.createElement('button');
    titleBtn.type = 'button';
    titleBtn.className = 'text-sm font-medium text-[#f4f4f5] hover:text-[#34d399] truncate text-left';
    titleBtn.textContent = album.name || 'Untitled Album';
    titleBtn.addEventListener('click', () => openAlbumDetail(album.id, backRoute));

    const subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'text-xs text-[#a1a1aa] hover:text-[#f4f4f5] truncate text-left mt-0.5';
    subBtn.textContent = album.artist || 'Unknown Artist';
    subBtn.addEventListener('click', () => {
      if (album.artistId) openArtistDetail(album.artistId);
      else openAlbumDetail(album.id, backRoute);
    });

    const metaRow = document.createElement('div');
    metaRow.className = 'mt-1.5 flex items-center justify-between text-[11px] font-mono text-[#a1a1aa]';
    metaRow.innerHTML = `
      <span>${album.year ? escapeHtml(album.year) : 'ALBUM'}</span>
      <span>${album.songCount ? `${album.songCount} trk` : ''}</span>
    `;

    card.appendChild(coverContainer);
    card.appendChild(titleBtn);
    card.appendChild(subBtn);
    card.appendChild(metaRow);
    return card;
  }

  // ============================================================================
  // Star / Unstar Synchronization
  // ============================================================================
  async function syncStarredFromServer() {
    try {
      const starred = await client.getStarred2();
      state.starredSongIds = new Set((starred.song || []).map((s) => s.id));
      state.starredAlbumIds = new Set((starred.album || []).map((a) => a.id));
      state.favouriteSongs = starred.song || [];
    } catch {
      // Ignore if offline
    }
  }

  async function toggleStarTrack(song) {
    if (!song?.id) return;
    const currentlyStarred = state.starredSongIds.has(song.id);
    try {
      if (currentlyStarred) {
        await client.unstar({ id: song.id });
        state.starredSongIds.delete(song.id);
        song.starred = undefined;
        showToast(`Removed "${song.title}" from Favourite Songs`);
      } else {
        await client.star({ id: song.id });
        state.starredSongIds.add(song.id);
        song.starred = new Date().toISOString();
        showToast(`Added "${song.title}" to Favourite Songs`);
      }
      updatePlayerBarUI();
      rerenderActiveTrackLists();
    } catch (err) {
      showToast(`Star action failed: ${err.message}`);
    }
  }

  async function toggleStarAlbum(album) {
    if (!album?.id) return;
    const currentlyStarred = state.starredAlbumIds.has(album.id);
    try {
      if (currentlyStarred) {
        await client.unstar({ albumId: album.id });
        state.starredAlbumIds.delete(album.id);
        showToast(`Unstarred album "${album.name}"`);
      } else {
        await client.star({ albumId: album.id });
        state.starredAlbumIds.add(album.id);
        showToast(`Starred album "${album.name}"`);
      }
      renderAlbumStarButton();
    } catch (err) {
      showToast(`Album star failed: ${err.message}`);
    }
  }

  function rerenderActiveTrackLists() {
    if (state.route === 'album-detail' && state.currentAlbum) {
      renderAlbumDetailTracks();
    } else if (state.route === 'songs') {
      renderSongsList();
    } else if (state.route === 'favourites') {
      loadFavouritesView();
    } else if (state.route === 'playlist-detail' && state.currentPlaylist) {
      renderPlaylistDetailTracks();
    } else if (state.route === 'discovery-detail' && state.currentDiscoveryCard) {
      renderDiscoveryDetailTracks();
    } else if (state.route === 'search') {
      renderSearchResults();
    }
  }

  // ============================================================================
  // View 1: HOME (Discovery Mixes + Recently Added)
  // ============================================================================
  async function loadHomeView(forceRefresh = false) {
    const discGrid = $('discovery-grid');
    const recentGrid = $('home-recent-grid');
    if (!discGrid || !recentGrid) return;

    if (state.discoveryCards.length === 0 || forceRefresh) {
      discGrid.innerHTML =
        '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Synthesizing discovery mixes...</div>';
      recentGrid.innerHTML =
        '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Loading recently added albums...</div>';
    }

    try {
      const [cards, recentAlbums] = await Promise.all([
        generateDiscoveryCards(client, historyStore),
        client.getAlbumList2({ type: 'newest', size: 12, offset: 0 }),
      ]);

      setConnectionError(null);
      state.discoveryCards = cards;

      discGrid.innerHTML = '';
      for (const card of cards) {
        const el = document.createElement('div');
        el.className =
          'group rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#71717a] p-3 flex flex-col transition-colors cursor-pointer';

        const artWrap = document.createElement('div');
        artWrap.className = 'w-full aspect-square rounded bg-[#0e0e11] border border-[#3f3f46] overflow-hidden relative mb-3';
        const canvas = document.createElement('canvas');
        canvas.className = 'w-full h-full block';
        artWrap.appendChild(canvas);

        const badge = document.createElement('span');
        badge.className =
          'absolute top-2 left-2 px-2 py-0.5 rounded bg-[#0e0e11]/90 border border-[#3f3f46] text-[10px] font-mono text-[#34d399]';
        badge.textContent = card.badge;
        artWrap.appendChild(badge);

        if (card.tracks.length > 0) {
          const playBtn = document.createElement('button');
          playBtn.type = 'button';
          playBtn.setAttribute('aria-label', `Play ${card.title}`);
          playBtn.className =
            'absolute bottom-2 right-2 w-9 h-9 rounded-full bg-[#34d399] text-[#090d0b] flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shadow-lg';
          playBtn.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-current"></i>';
          playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            audioEngine.playSong(card.tracks[0], card.tracks);
          });
          artWrap.appendChild(playBtn);
        }

        const title = document.createElement('h3');
        title.className = 'text-sm font-semibold text-[#f4f4f5] group-hover:text-[#34d399] truncate';
        title.textContent = card.title;

        const sub = document.createElement('p');
        sub.className = 'text-xs text-[#a1a1aa] line-clamp-2 mt-1 flex-1';
        sub.textContent = card.subtitle;

        const countLine = document.createElement('div');
        countLine.className = 'mt-2 pt-2 border-t border-[#3f3f46] flex items-center justify-between text-[11px] font-mono text-[#a1a1aa]';
        countLine.innerHTML = `
          <span>${card.tracks.length} TRACKS</span>
          <span class="text-[#34d399]">OPEN →</span>
        `;

        el.appendChild(artWrap);
        el.appendChild(title);
        el.appendChild(sub);
        el.appendChild(countLine);

        el.addEventListener('click', () => openDiscoveryDetail(card));
        discGrid.appendChild(el);
        drawGenerativeThumbnail(canvas, card.artVariant, card.accentColor, card.title, 260);
      }

      recentGrid.innerHTML = '';
      if (recentAlbums.length === 0) {
        recentGrid.innerHTML =
          '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">No albums found on server.</div>';
      } else {
        for (const alb of recentAlbums) {
          recentGrid.appendChild(createAlbumCardElement(alb, 'home'));
        }
      }
      refreshIcons();
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  function openDiscoveryDetail(card) {
    state.currentDiscoveryCard = card;
    navigateTo('discovery-detail');

    $('discovery-detail-badge').textContent = card.badge || 'VIRTUAL MIX';
    $('discovery-detail-title').textContent = card.title;
    $('discovery-detail-subtitle').textContent = card.subtitle;

    const totalSec = (card.tracks || []).reduce((acc, s) => acc + (s.duration || 0), 0);
    $('discovery-detail-meta').textContent = `${card.tracks.length} tracks · ${formatTotalDuration(totalSec)}`;

    const canvas = $('discovery-detail-canvas');
    drawGenerativeThumbnail(canvas, card.artVariant, card.accentColor, card.title, 280);

    renderDiscoveryDetailTracks();
  }

  function renderDiscoveryDetailTracks() {
    const card = state.currentDiscoveryCard;
    const container = $('discovery-tracks-list');
    if (!container || !card) return;

    container.innerHTML = '';
    if (!card.tracks || card.tracks.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-xs font-mono text-[#a1a1aa]">
          ${escapeHtml(card.emptyReason || 'No tracks in this mix yet.')}
        </div>
      `;
      return;
    }

    card.tracks.forEach((song, idx) => {
      container.appendChild(createTrackRowElement(song, idx, card.tracks));
    });
    refreshIcons();
  }

  // ============================================================================
  // View 2: DEDICATED SEARCH (with Keyboard Up/Down/Enter Navigation)
  // ============================================================================
  function setupSearchHandlers() {
    const input = $('search-input');
    const clearBtn = $('search-clear-btn');
    if (!input) return;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      state.searchQuery = q;
      if (clearBtn) {
        if (q.length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }

      if (state.searchTimer) clearTimeout(state.searchTimer);
      if (!q) {
        state.searchResults = { artist: [], album: [], song: [] };
        state.searchSelectedIndex = -1;
        renderSearchResults();
        return;
      }

      state.searchTimer = setTimeout(async () => {
        try {
          const res = await client.search3(q, { artistCount: 12, albumCount: 12, songCount: 30 });
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
          input.value = '';
          state.searchQuery = '';
          if (clearBtn) clearBtn.classList.add('hidden');
          state.searchResults = { artist: [], album: [], song: [] };
          state.searchSelectedIndex = -1;
          renderSearchResults();
        }
        return;
      }

      if (state.searchNavItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.searchSelectedIndex = (state.searchSelectedIndex + 1) % state.searchNavItems.length;
        highlightSearchNavItem();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.searchSelectedIndex =
          (state.searchSelectedIndex - 1 + state.searchNavItems.length) % state.searchNavItems.length;
        highlightSearchNavItem();
      } else if (e.key === 'Enter' && state.searchSelectedIndex >= 0) {
        e.preventDefault();
        const item = state.searchNavItems[state.searchSelectedIndex];
        if (item && typeof item.trigger === 'function') item.trigger();
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        state.searchQuery = '';
        clearBtn.classList.add('hidden');
        state.searchResults = { artist: [], album: [], song: [] };
        state.searchSelectedIndex = -1;
        renderSearchResults();
        input.focus();
      });
    }
  }

  function highlightSearchNavItem() {
    state.searchNavItems.forEach((item, idx) => {
      if (!item.el) return;
      if (idx === state.searchSelectedIndex) {
        item.el.classList.add('ring-2', 'ring-[#34d399]');
        item.el.scrollIntoView({ block: 'nearest' });
      } else {
        item.el.classList.remove('ring-2', 'ring-[#34d399]');
      }
    });
  }

  function renderSearchResults() {
    const container = $('search-results');
    if (!container) return;
    state.searchNavItems = [];

    if (!state.searchQuery) {
      container.innerHTML = `
        <div class="py-12 text-center text-sm font-mono text-[#a1a1aa]">
          Type above to search across your entire Navidrome library.
        </div>
      `;
      return;
    }

    const { artist = [], album = [], song = [] } = state.searchResults;
    if (artist.length === 0 && album.length === 0 && song.length === 0) {
      container.innerHTML = `
        <div class="py-12 text-center text-sm font-mono text-[#a1a1aa]">
          No matches found for "${escapeHtml(state.searchQuery)}".
        </div>
      `;
      return;
    }

    container.innerHTML = '';

    // 1. Artists
    if (artist.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'space-y-3';
      sec.innerHTML = `<h2 class="text-xs font-mono uppercase tracking-wider text-[#34d399]">Artists (${artist.length})</h2>`;
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3';

      for (const ar of artist) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'p-3 rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#71717a] text-left flex items-center gap-3 transition-colors';
        btn.innerHTML = `
          <div class="w-10 h-10 rounded-full bg-[#27272a] border border-[#3f3f46] flex items-center justify-center shrink-0">
            <i data-lucide="mic-2" class="w-4 h-4 text-[#34d399]"></i>
          </div>
          <div class="min-w-0">
            <div class="text-sm font-medium text-[#f4f4f5] truncate">${escapeHtml(ar.name)}</div>
            <div class="text-[11px] font-mono text-[#a1a1aa]">${ar.albumCount ?? 0} albums</div>
          </div>
        `;
        const trigger = () => openArtistDetail(ar.id);
        btn.addEventListener('click', trigger);
        grid.appendChild(btn);
        state.searchNavItems.push({ el: btn, trigger });
      }
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    // 2. Albums
    if (album.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'space-y-3';
      sec.innerHTML = `<h2 class="text-xs font-mono uppercase tracking-wider text-[#34d399]">Albums (${album.length})</h2>`;
      const grid = document.createElement('div');
      grid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4';

      for (const al of album) {
        const card = createAlbumCardElement(al, 'search');
        grid.appendChild(card);
        state.searchNavItems.push({
          el: card,
          trigger: () => openAlbumDetail(al.id, 'search'),
        });
      }
      sec.appendChild(grid);
      container.appendChild(sec);
    }

    // 3. Songs
    if (song.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'space-y-3';
      sec.innerHTML = `<h2 class="text-xs font-mono uppercase tracking-wider text-[#34d399]">Songs (${song.length})</h2>`;
      const list = document.createElement('div');
      list.className = 'divide-y divide-[#3f3f46] border border-[#3f3f46] rounded-lg bg-[#18181b] overflow-hidden';

      song.forEach((s, idx) => {
        const row = createTrackRowElement(s, idx, song);
        list.appendChild(row);
        state.searchNavItems.push({
          el: row,
          trigger: () => audioEngine.playSong(s, song),
        });
      });
      sec.appendChild(list);
      container.appendChild(sec);
    }

    refreshIcons();
  }

  // ============================================================================
  // View 3 & 4: ARTISTS (Layer 1) & ARTIST DETAIL (Layer 2 + Virtual "Singles" Card)
  // ============================================================================
  async function loadArtistsView() {
    const grid = $('artists-grid');
    const countLabel = $('artists-count-label');
    if (!grid) return;

    if (state.artists.length === 0) {
      grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Loading artists...</div>';
    }

    try {
      const artists = await client.getArtists();
      setConnectionError(null);
      state.artists = artists;
      renderArtistsGrid();
      if (countLabel) countLabel.textContent = `${artists.length} artists in library`;
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  function renderArtistsGrid() {
    const grid = $('artists-grid');
    if (!grid) return;
    const filterVal = ($('artists-filter-input')?.value || '').trim().toLowerCase();
    const filtered = filterVal
      ? state.artists.filter((a) => (a.name || '').toLowerCase().includes(filterVal))
      : state.artists;

    grid.innerHTML = '';
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">No matching artists.</div>';
      return;
    }

    for (const artist of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className =
        'group rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#71717a] p-4 flex flex-col items-center text-center transition-colors';

      const avatarWrap = document.createElement('div');
      avatarWrap.className =
        'w-24 h-24 rounded-full bg-[#0e0e11] border border-[#3f3f46] overflow-hidden flex items-center justify-center mb-3 relative';
      const img = document.createElement('img');
      img.alt = artist.name || '';
      img.className = 'hidden w-full h-full object-cover';
      const fb = document.createElement('div');
      fb.className = 'text-[#34d399] font-mono text-xl font-bold';
      fb.textContent = (artist.name || '?').slice(0, 2).toUpperCase();

      avatarWrap.appendChild(img);
      avatarWrap.appendChild(fb);
      if (artist.coverArt) {
        attachCoverImage(img, fb, artist.coverArt, null, 240);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'w-full truncate text-sm font-medium text-[#f4f4f5] group-hover:text-[#34d399]';
      nameEl.textContent = artist.name || 'Unknown Artist';

      const countEl = document.createElement('div');
      countEl.className = 'text-xs font-mono text-[#a1a1aa] mt-1';
      countEl.textContent = `${artist.albumCount ?? 0} ${artist.albumCount === 1 ? 'album' : 'albums'}`;

      card.appendChild(avatarWrap);
      card.appendChild(nameEl);
      card.appendChild(countEl);
      card.addEventListener('click', () => openArtistDetail(artist.id));
      grid.appendChild(card);
    }
    refreshIcons();
  }

  async function openArtistDetail(artistId) {
    if (!artistId) return;
    navigateTo('artist-detail');
    const grid = $('artist-albums-grid');
    $('artist-detail-name').textContent = 'Loading...';
    $('artist-detail-meta').textContent = '';
    if (grid) {
      grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Loading artist catalog...</div>';
    }

    try {
      const artist = await client.getArtist(artistId);
      state.currentArtist = artist;

      // Also search for songs by this artist to synthesize the virtual "Singles" card
      // (tracks without an album or tracks from single-song releases)
      const searchRes = await client.search3(artist.name, { songCount: 150, albumCount: 0, artistCount: 0 }).catch(() => ({ song: [] }));
      const artistSongs = (searchRes.song || []).filter(
        (s) => s.artistId === artist.id || (s.artist || '').toLowerCase() === (artist.name || '').toLowerCase()
      );

      const multiTrackAlbumIds = new Set(
        (artist.album || []).filter((a) => (a.songCount || 0) > 1).map((a) => a.id)
      );
      const singles = artistSongs.filter((s) => !s.albumId || !multiTrackAlbumIds.has(s.albumId));
      state.currentArtistSingles = singles;

      $('artist-detail-name').textContent = artist.name;
      $('artist-detail-meta').textContent = `${(artist.album || []).length} albums${
        singles.length > 0 ? ` · ${singles.length} singles/loose tracks` : ''
      }`;

      if (grid) {
        grid.innerHTML = '';
        for (const alb of artist.album || []) {
          grid.appendChild(createAlbumCardElement(alb, 'artist-detail'));
        }

        // Virtual "Singles" card (Layer 2 -> Layer 3 drilldown)
        if (singles.length > 0) {
          const singlesCard = document.createElement('div');
          singlesCard.className =
            'group rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#34d399] p-3 transition-colors flex flex-col cursor-pointer';

          const coverWrap = document.createElement('div');
          coverWrap.className =
            'w-full aspect-square rounded bg-[#0e0e11] border border-[#3f3f46] overflow-hidden relative flex items-center justify-center mb-2.5';
          const img = document.createElement('img');
          img.alt = 'Singles';
          img.className = 'hidden w-full h-full object-cover';
          const fb = document.createElement('div');
          fb.className = 'flex flex-col items-center justify-center text-[#34d399]';
          fb.innerHTML = `
            <i data-lucide="music-2" class="w-8 h-8 mb-1"></i>
            <span class="text-[10px] font-mono">SINGLES</span>
          `;
          coverWrap.appendChild(img);
          coverWrap.appendChild(fb);
          attachCoverImage(img, fb, singles[0].coverArt, singles[0].id, 300);

          const titleEl = document.createElement('div');
          titleEl.className = 'text-sm font-semibold text-[#f4f4f5] group-hover:text-[#34d399] truncate';
          titleEl.textContent = 'Singles';

          const subEl = document.createElement('div');
          subEl.className = 'text-xs text-[#a1a1aa] truncate mt-0.5';
          subEl.textContent = artist.name;

          const metaEl = document.createElement('div');
          metaEl.className = 'mt-1.5 flex items-center justify-between text-[11px] font-mono text-[#34d399]';
          metaEl.innerHTML = `<span>VIRTUAL</span><span>${singles.length} trk</span>`;

          singlesCard.appendChild(coverWrap);
          singlesCard.appendChild(titleEl);
          singlesCard.appendChild(subEl);
          singlesCard.appendChild(metaEl);

          singlesCard.addEventListener('click', () => openArtistSinglesDetail(artist, singles));
          grid.appendChild(singlesCard);
        }
      }
      refreshIcons();
    } catch (err) {
      showToast(`Failed to load artist: ${err.message}`);
    }
  }

  function openArtistSinglesDetail(artist, singles) {
    state.albumBackRoute = 'artist-detail';
    state.currentAlbum = {
      id: `singles-${artist.id}`,
      isVirtualSingles: true,
      name: 'Singles',
      artist: artist.name,
      artistId: artist.id,
      songCount: singles.length,
      duration: singles.reduce((acc, s) => acc + (s.duration || 0), 0),
      coverArt: singles[0]?.coverArt,
      song: singles,
    };
    navigateTo('album-detail');
    renderAlbumDetailView();
  }

  // ============================================================================
  // View 5 & 6: ALBUMS & ALBUM DETAIL (Layer 3)
  // ============================================================================
  const ALBUMS_PAGE_SIZE = 36;

  async function loadAlbumsView(reset = false) {
    const grid = $('albums-grid');
    const loadMoreBtn = $('albums-load-more-btn');
    if (!grid) return;

    if (reset) {
      state.albumsOffset = 0;
      state.albums = [];
      state.albumsHasMore = true;
      grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Loading albums...</div>';
    }

    try {
      const batch = await client.getAlbumList2({
        type: state.albumsSort,
        size: ALBUMS_PAGE_SIZE,
        offset: state.albumsOffset,
      });

      if (reset) grid.innerHTML = '';

      state.albums.push(...batch);
      state.albumsOffset += batch.length;
      state.albumsHasMore = batch.length === ALBUMS_PAGE_SIZE;

      for (const alb of batch) {
        grid.appendChild(createAlbumCardElement(alb, 'albums'));
      }

      if (state.albums.length === 0) {
        grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">No albums found.</div>';
      }

      const countLabel = $('albums-count-label');
      if (countLabel) countLabel.textContent = `${state.albums.length} albums loaded`;

      if (loadMoreBtn) {
        if (state.albumsHasMore) loadMoreBtn.classList.remove('hidden');
        else loadMoreBtn.classList.add('hidden');
      }
      refreshIcons();
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  async function openAlbumDetail(albumId, backRoute = 'albums') {
    if (!albumId) return;
    state.albumBackRoute = backRoute;
    navigateTo('album-detail');

    $('album-detail-title').textContent = 'Loading...';
    $('album-tracks-list').innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">Loading tracklist...</div>';

    try {
      const album = await client.getAlbum(albumId);
      state.currentAlbum = album;
      if (album.starred) state.starredAlbumIds.add(album.id);
      renderAlbumDetailView();
    } catch (err) {
      showToast(`Failed to load album: ${err.message}`);
    }
  }

  function renderAlbumStarButton() {
    const starBtn = $('album-star-btn');
    const starLabel = $('album-star-label');
    if (!starBtn || !state.currentAlbum) return;
    if (state.currentAlbum.isVirtualSingles) {
      starBtn.classList.add('hidden');
      return;
    }
    starBtn.classList.remove('hidden');
    const isStarred = state.starredAlbumIds.has(state.currentAlbum.id);
    if (starLabel) starLabel.textContent = isStarred ? 'STARRED' : 'STAR';
    if (isStarred) starBtn.classList.add('text-[#34d399]', 'border-[#34d399]');
    else starBtn.classList.remove('text-[#34d399]', 'border-[#34d399]');
  }

  function renderAlbumDetailView() {
    const album = state.currentAlbum;
    if (!album) return;

    const backLabel = $('album-back-label');
    if (backLabel) {
      backLabel.textContent =
        state.albumBackRoute === 'artist-detail'
          ? `BACK TO ${(album.artist || 'ARTIST').toUpperCase()}`
          : state.albumBackRoute === 'home'
          ? 'BACK TO HOME'
          : state.albumBackRoute === 'search'
          ? 'BACK TO SEARCH'
          : 'ALL ALBUMS';
    }

    $('album-detail-badge').textContent = album.isVirtualSingles ? 'SINGLES COLLECTION' : 'ALBUM';
    $('album-detail-title').textContent = album.name || 'Untitled Album';

    const artistBtn = $('album-detail-artist-btn');
    artistBtn.textContent = album.artist || 'Unknown Artist';
    artistBtn.onclick = () => {
      if (album.artistId) openArtistDetail(album.artistId);
    };

    const songs = album.song || [];
    const totalSec = album.duration || songs.reduce((acc, s) => acc + (s.duration || 0), 0);
    const metaParts = [];
    if (album.year) metaParts.push(album.year);
    metaParts.push(`${songs.length} tracks`);
    metaParts.push(formatTotalDuration(totalSec));
    $('album-detail-meta').textContent = `· ${metaParts.join(' · ')}`;

    const firstSongId = songs[0]?.id || null;
    attachCoverImage(
      $('album-detail-cover'),
      $('album-detail-cover-fallback'),
      album.coverArt || (!album.isVirtualSingles ? album.id : null),
      firstSongId,
      500
    );

    renderAlbumStarButton();
    renderAlbumDetailTracks();
  }

  function renderAlbumDetailTracks() {
    const album = state.currentAlbum;
    const list = $('album-tracks-list');
    if (!album || !list) return;

    const songs = album.song || [];
    list.innerHTML = '';
    if (songs.length === 0) {
      list.innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">No tracks found in this album.</div>';
      return;
    }

    songs.forEach((song, idx) => {
      list.appendChild(
        createTrackRowElement(song, idx, songs, {
          showCover: Boolean(album.isVirtualSingles),
          showAlbum: Boolean(album.isVirtualSingles),
          showTrackNumber: !album.isVirtualSingles,
        })
      );
    });
    refreshIcons();
  }

  // ============================================================================
  // View 7: SONGS (Paginated Full Library Songs)
  // ============================================================================
  const SONGS_PAGE_SIZE = 100;

  async function loadSongsView(reset = false) {
    const list = $('songs-list');
    const loadMoreBtn = $('songs-load-more-btn');
    if (!list) return;

    if (reset && state.songs.length > 0) {
      renderSongsList();
      return;
    }

    if (reset) {
      state.songsOffset = 0;
      state.songs = [];
      state.songsHasMore = true;
      list.innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">Loading songs...</div>';
    }

    try {
      const res = await client.search3('', {
        songCount: SONGS_PAGE_SIZE,
        songOffset: state.songsOffset,
        albumCount: 0,
        artistCount: 0,
      });
      const batch = res.song || [];
      state.songs.push(...batch);
      state.songsOffset += batch.length;
      state.songsHasMore = batch.length === SONGS_PAGE_SIZE;

      renderSongsList();

      if (loadMoreBtn) {
        if (state.songsHasMore) loadMoreBtn.classList.remove('hidden');
        else loadMoreBtn.classList.add('hidden');
      }
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  function renderSongsList() {
    const list = $('songs-list');
    if (!list) return;

    const countLabel = $('songs-count-label');
    if (countLabel) countLabel.textContent = `${state.songs.length} songs loaded`;

    list.innerHTML = '';
    if (state.songs.length === 0) {
      list.innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">No songs found in library.</div>';
      return;
    }

    state.songs.forEach((song, idx) => {
      list.appendChild(createTrackRowElement(song, idx, state.songs));
    });
    refreshIcons();
  }

  // ============================================================================
  // View 8 & 9: PLAYLISTS (2x2 Canvas Collage + Full CRUD)
  // ============================================================================
  async function refreshPlaylistsSidebarAndCache() {
    try {
      const playlists = await client.getPlaylists();
      state.playlists = playlists;
      renderSidebarCustomPlaylists();
    } catch {
      // Ignore if offline
    }
  }

  function renderSidebarCustomPlaylists() {
    const container = $('sidebar-custom-playlists');
    if (!container) return;
    container.innerHTML = '';

    for (const pl of state.playlists) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-playlist-id', pl.id);
      btn.title = pl.name;
      const isCurrent = state.route === 'playlist-detail' && state.currentPlaylist?.id === pl.id;
      btn.className = `sidebar-playlist-item sidebar-nav-btn w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a] transition-colors ${
        isCurrent ? 'nav-item-active' : ''
      }`;
      btn.innerHTML = `
        <i data-lucide="disc-3" class="nav-icon w-3.5 h-3.5 shrink-0"></i>
        <span class="sidebar-label flex-1 text-left truncate">${escapeHtml(pl.name)}</span>
        <span class="sidebar-shortcut text-[10px] font-mono text-[#a1a1aa]">${pl.songCount ?? 0}</span>
      `;
      btn.addEventListener('click', () => openPlaylistDetail(pl.id));
      container.appendChild(btn);
    }
    refreshIcons();
  }

  async function loadPlaylistsView() {
    const grid = $('playlists-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">Loading playlists...</div>';

    try {
      const playlists = await client.getPlaylists();
      state.playlists = playlists;
      renderSidebarCustomPlaylists();

      const countLabel = $('playlists-count-label');
      if (countLabel) countLabel.textContent = `${playlists.length} custom playlists`;

      grid.innerHTML = '';
      if (playlists.length === 0) {
        grid.innerHTML =
          '<div class="col-span-full py-8 text-xs font-mono text-[#a1a1aa]">No custom playlists yet. Create one above or from the sidebar.</div>';
        return;
      }

      for (const pl of playlists) {
        const card = document.createElement('div');
        card.className =
          'group rounded-lg bg-[#18181b] border border-[#3f3f46] hover:border-[#71717a] p-3 flex flex-col cursor-pointer transition-colors';

        const coverWrap = document.createElement('div');
        coverWrap.className =
          'w-full aspect-square rounded bg-[#0e0e11] border border-[#3f3f46] overflow-hidden relative flex items-center justify-center mb-2.5';
        const img = document.createElement('img');
        img.alt = pl.name;
        img.className = 'hidden w-full h-full object-cover';
        const fb = document.createElement('div');
        fb.className = 'flex flex-col items-center justify-center text-[#a1a1aa]';
        fb.innerHTML = '<i data-lucide="list-music" class="w-8 h-8"></i>';
        coverWrap.appendChild(img);
        coverWrap.appendChild(fb);

        // Asynchronously build 2x2 collage for this playlist
        client
          .getPlaylist(pl.id)
          .then((detail) => generatePlaylistCollage(detail.entry || [], (id, sz) => client.getCoverArtUrl(id, sz)))
          .then((dataUrl) => {
            if (dataUrl) {
              img.onload = () => {
                img.classList.remove('hidden');
                fb.classList.add('hidden');
              };
              img.src = dataUrl;
            }
          })
          .catch(() => {});

        const titleEl = document.createElement('div');
        titleEl.className = 'text-sm font-semibold text-[#f4f4f5] group-hover:text-[#34d399] truncate';
        titleEl.textContent = pl.name;

        const metaEl = document.createElement('div');
        metaEl.className = 'text-xs font-mono text-[#a1a1aa] mt-1';
        metaEl.textContent = `${pl.songCount ?? 0} tracks · ${formatTotalDuration(pl.duration || 0)}`;

        card.appendChild(coverWrap);
        card.appendChild(titleEl);
        card.appendChild(metaEl);
        card.addEventListener('click', () => openPlaylistDetail(pl.id));
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
    $('playlist-tracks-list').innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">Loading playlist...</div>';

    try {
      const detail = await client.getPlaylist(playlistId);
      state.currentPlaylist = detail;
      renderSidebarCustomPlaylists();
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
    $('playlist-delete-label').textContent = state.deletePlaylistConfirm ? 'CONFIRM DELETE?' : 'DELETE PLAYLIST';

    const img = $('playlist-detail-cover');
    const fb = $('playlist-detail-cover-fallback');
    img.classList.add('hidden');
    fb.classList.remove('hidden');

    generatePlaylistCollage(entries, (id, sz) => client.getCoverArtUrl(id, sz)).then((url) => {
      if (url) {
        img.onload = () => {
          img.classList.remove('hidden');
          fb.classList.add('hidden');
        };
        img.src = url;
      }
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
      list.innerHTML =
        '<div class="p-8 text-center text-xs font-mono text-[#a1a1aa]">This playlist is empty. Use the 3-dot menu on any song to add tracks.</div>';
      return;
    }

    entries.forEach((song, idx) => {
      list.appendChild(
        createTrackRowElement(song, idx, entries, {
          onRemoveFromPlaylist: async (removeIdx) => {
            try {
              await client.updatePlaylist({
                playlistId: pl.id,
                songIndexToRemove: removeIdx,
              });
              showToast(`Removed "${song.title}" from playlist`);
              await openPlaylistDetail(pl.id);
              await refreshPlaylistsSidebarAndCache();
            } catch (err) {
              showToast(`Failed to remove track: ${err.message}`);
            }
          },
        })
      );
    });
    refreshIcons();
  }

  // ============================================================================
  // View 10: FAVOURITE SONGS
  // ============================================================================
  async function loadFavouritesView() {
    const list = $('favourites-list');
    if (!list) return;
    list.innerHTML = '<div class="p-6 text-xs font-mono text-[#a1a1aa]">Loading starred tracks...</div>';

    try {
      await syncStarredFromServer();
      const songs = state.favouriteSongs;
      const countLabel = $('favourites-count-label');
      if (countLabel) countLabel.textContent = `${songs.length} starred tracks`;

      list.innerHTML = '';
      if (songs.length === 0) {
        list.innerHTML =
          '<div class="p-8 text-center text-xs font-mono text-[#a1a1aa]">No favourite songs yet. Click the heart icon on any track to star it.</div>';
        return;
      }

      songs.forEach((song, idx) => {
        list.appendChild(createTrackRowElement(song, idx, songs));
      });
      refreshIcons();
    } catch (err) {
      setConnectionError(err.message);
    }
  }

  // ============================================================================
  // View 12: SETTINGS
  // ============================================================================
  function renderSettingsView() {
    $('settings-server-url').value = client.baseUrl;
    $('settings-server-user').value = client.username;
    $('settings-server-pass').value = client.password;

    const fade = Math.round(audioEngine.crossfadeSeconds);
    $('settings-crossfade-slider').value = String(fade);
    $('settings-crossfade-label').textContent = fade === 0 ? '0s (Gapless)' : `${fade}s`;

    // Lyrics Priority List
    renderSettingsLyricsPriorityList();

    // Last.fm State
    const lfm = lastFm.getState();
    $('settings-lastfm-key').value = lfm.apiKey;
    $('settings-lastfm-secret').value = lfm.apiSecret;
    $('settings-lastfm-enabled').checked = lfm.isEnabled;

    const statusBadge = $('settings-lastfm-status');
    const connectBtn = $('settings-lastfm-connect-btn');
    const disconnectBtn = $('settings-lastfm-disconnect-btn');

    if (lfm.isConnected) {
      statusBadge.textContent = `CONNECTED: ${lfm.username}`;
      statusBadge.className =
        'px-2.5 py-1 rounded bg-[#27272a] border border-[#34d399] text-xs font-mono text-[#34d399]';
      connectBtn.classList.add('hidden');
      disconnectBtn.classList.remove('hidden');
    } else {
      statusBadge.textContent = 'NOT CONNECTED';
      statusBadge.className =
        'px-2.5 py-1 rounded bg-[#27272a] border border-[#71717a] text-xs font-mono text-[#a1a1aa]';
      connectBtn.classList.remove('hidden');
      disconnectBtn.classList.add('hidden');
    }

    // Listening History
    const entriesCount = historyStore.entries.length;
    $('settings-history-count').textContent = `${entriesCount} plays recorded locally (${historyStore.getHistorySpanDays()}d span)`;
    refreshIcons();
  }

  function renderSettingsLyricsPriorityList() {
    const listEl = $('settings-lyrics-priority-list');
    if (!listEl) return;
    const order = lyricsManager.getPriorityOrder();
    listEl.innerHTML = '';

    order.forEach((id, idx) => {
      const meta = LYRICS_PROVIDERS_META.find((p) => p.id === id) || { id, name: id, bestKind: 'synced' };
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between px-3.5 py-2.5 text-xs';
      row.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="w-5 font-mono text-[#a1a1aa]">${idx + 1}.</span>
          <span class="font-medium text-[#f4f4f5]">${escapeHtml(meta.name)}</span>
          <span class="px-1.5 py-0.5 rounded bg-[#18181b] border border-[#3f3f46] text-[10px] font-mono text-[#34d399] uppercase">${escapeHtml(meta.bestKind)}</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-move="up"
            aria-label="Move ${escapeHtml(meta.name)} up"
            ${idx === 0 ? 'disabled' : ''}
            class="p-1 rounded bg-[#18181b] border border-[#71717a] text-[#f4f4f5] hover:border-[#34d399]"
          >
            <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
          </button>
          <button
            type="button"
            data-move="down"
            aria-label="Move ${escapeHtml(meta.name)} down"
            ${idx === order.length - 1 ? 'disabled' : ''}
            class="p-1 rounded bg-[#18181b] border border-[#71717a] text-[#f4f4f5] hover:border-[#34d399]"
          >
            <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;

      const [upBtn, downBtn] = row.querySelectorAll('button');
      upBtn.addEventListener('click', () => {
        if (idx === 0) return;
        const next = [...order];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        lyricsManager.setPriorityOrder(next);
        renderSettingsLyricsPriorityList();
      });
      downBtn.addEventListener('click', () => {
        if (idx >= order.length - 1) return;
        const next = [...order];
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        lyricsManager.setPriorityOrder(next);
        renderSettingsLyricsPriorityList();
      });

      listEl.appendChild(row);
    });
    refreshIcons();
  }

  // ============================================================================
  // Queue Drawer (with Drag-and-Drop, Reorder Buttons, Remove, & Save as Playlist)
  // ============================================================================
  function toggleQueueDrawer(forceState) {
    state.queueOpen = typeof forceState === 'boolean' ? forceState : !state.queueOpen;
    const drawer = $('queue-drawer');
    const btn = $('btn-queue');
    if (drawer) {
      if (state.queueOpen) drawer.classList.remove('hidden');
      else drawer.classList.add('hidden');
    }
    if (btn) {
      if (state.queueOpen) btn.classList.add('border-[#34d399]', 'text-[#34d399]');
      else btn.classList.remove('border-[#34d399]', 'text-[#34d399]');
    }
    if (state.queueOpen) renderQueueDrawer();
  }

  let draggedQueueIdx = null;

  function renderQueueDrawer() {
    const countBadge = $('queue-count-badge');
    const playerCount = $('player-queue-count');
    const q = audioEngine?.queue || [];
    if (countBadge) countBadge.textContent = String(q.length);
    if (playerCount) playerCount.textContent = String(q.length);

    if (!state.queueOpen) return;
    const list = $('queue-items-list');
    if (!list) return;

    list.innerHTML = '';
    if (q.length === 0) {
      list.innerHTML =
        '<div class="p-6 text-center text-xs font-mono text-[#a1a1aa]">Queue is empty. Play any track or album to populate the queue.</div>';
      return;
    }

    q.forEach((song, idx) => {
      const isCurrent = idx === audioEngine.currentIndex;
      const item = document.createElement('div');
      item.draggable = true;
      item.className = `group flex items-center justify-between gap-2 px-3 py-2 text-xs transition-colors ${
        isCurrent ? 'bg-[#27272a]' : 'hover:bg-[#27272a]/50'
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
        }
        draggedQueueIdx = null;
      });

      const left = document.createElement('button');
      left.type = 'button';
      left.className = 'flex items-center gap-2.5 min-w-0 flex-1 text-left';
      left.innerHTML = `
        <span class="w-4 text-[10px] font-mono ${isCurrent ? 'text-[#34d399] font-bold' : 'text-[#a1a1aa]'}">${idx + 1}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-medium ${isCurrent ? 'text-[#34d399]' : 'text-[#f4f4f5]'}">${escapeHtml(song.title)}</div>
          <div class="truncate text-[11px] text-[#a1a1aa]">${escapeHtml(song.artist || 'Unknown Artist')}</div>
        </div>
      `;
      left.addEventListener('click', () => {
        audioEngine.loadAndPlayOnActiveDeck(song, idx);
      });

      const right = document.createElement('div');
      right.className = 'flex items-center gap-0.5 shrink-0';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.setAttribute('aria-label', 'Move track up in queue');
      upBtn.disabled = idx === 0;
      upBtn.className = 'p-1 rounded text-[#a1a1aa] hover:text-[#f4f4f5]';
      upBtn.innerHTML = '<i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>';
      upBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audioEngine.moveQueueItem(idx, idx - 1);
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.setAttribute('aria-label', 'Move track down in queue');
      downBtn.disabled = idx === q.length - 1;
      downBtn.className = 'p-1 rounded text-[#a1a1aa] hover:text-[#f4f4f5]';
      downBtn.innerHTML = '<i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>';
      downBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audioEngine.moveQueueItem(idx, idx + 1);
      });

      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.setAttribute('aria-label', 'Remove track from queue');
      remBtn.className = 'p-1 rounded text-[#a1a1aa] hover:text-[#f87171]';
      remBtn.innerHTML = '<i data-lucide="x" class="w-3.5 h-3.5"></i>';
      remBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audioEngine.removeFromQueue(idx);
      });

      right.appendChild(upBtn);
      right.appendChild(downBtn);
      right.appendChild(remBtn);

      item.appendChild(left);
      item.appendChild(right);
      list.appendChild(item);
    });
    refreshIcons();
  }

  // ============================================================================
  // Floating 3-Dot Track Context Menu
  // ============================================================================
  function openTrackContextMenu(event, song, queueIdx = null) {
    state.ctxSong = song;
    state.ctxQueueIndex = queueIdx;

    const menu = $('track-context-menu');
    if (!menu) return;

    const isStarred = state.starredSongIds.has(song.id);
    $('ctx-star-label').textContent = isStarred ? 'Unstar Track' : 'Star Track';

    const remQueueBtn = $('ctx-remove-queue');
    if (queueIdx !== null && queueIdx !== undefined) {
      remQueueBtn.classList.remove('hidden');
    } else {
      remQueueBtn.classList.add('hidden');
    }

    // Populate Playlists inside Context Menu
    const plContainer = $('ctx-playlists-list');
    plContainer.innerHTML = '';
    if (state.playlists.length === 0) {
      plContainer.innerHTML = '<div class="px-3.5 py-1.5 text-[11px] font-mono text-[#a1a1aa]">No custom playlists yet</div>';
    } else {
      for (const pl of state.playlists) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full px-3.5 py-1.5 text-left hover:bg-[#27272a] flex items-center justify-between gap-2';
        btn.innerHTML = `
          <span class="truncate text-[#f4f4f5]">${escapeHtml(pl.name)}</span>
          <i data-lucide="plus" class="w-3 h-3 text-[#34d399] shrink-0"></i>
        `;
        btn.addEventListener('click', async () => {
          closeTrackContextMenu();
          try {
            await client.updatePlaylist({ playlistId: pl.id, songIdToAdd: song.id });
            showToast(`Added "${song.title}" to ${pl.name}`);
            await refreshPlaylistsSidebarAndCache();
          } catch (err) {
            showToast(`Failed to add to playlist: ${err.message}`);
          }
        });
        plContainer.appendChild(btn);
      }
    }

    menu.classList.remove('hidden');
    const rect = menu.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (x + rect.width > window.innerWidth - 12) x = window.innerWidth - rect.width - 12;
    if (y + rect.height > window.innerHeight - 12) y = Math.max(12, window.innerHeight - rect.height - 12);
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    refreshIcons();
  }

  function closeTrackContextMenu() {
    const menu = $('track-context-menu');
    if (menu) menu.classList.add('hidden');
    state.ctxSong = null;
    state.ctxQueueIndex = null;
  }

  // ============================================================================
  // Fullscreen Signature View ("Now Playing Room") & Multi-Provider Synced Lyrics
  // ============================================================================
  function openSignatureView() {
    state.signatureOpen = true;
    $('signature-modal').classList.remove('hidden');
    updateSignatureMetadataUI();
    ensureLyricsForCurrentSong();
    refreshIcons();
  }

  function closeSignatureView() {
    state.signatureOpen = false;
    $('signature-modal').classList.add('hidden');
    closeLyricsSourceModal();
  }

  let lastRenderedCoverSongId = null;

  function updateSignatureMetadataUI() {
    const song = audioEngine?.currentSong;
    if (!song) {
      $('sig-title').textContent = 'No Track Playing';
      $('sig-artist').textContent = '-';
      return;
    }

    $('sig-title').textContent = song.title || 'Untitled Track';
    $('sig-artist').textContent = `${song.artist || 'Unknown Artist'}${song.album ? ` · ${song.album}` : ''}`;

    const offset = lyricsManager.getTrackOffset(song.id);
    $('sig-offset-value').textContent = `${offset >= 0 ? '+' : ''}${offset.toFixed(1)}s`;

    if (lastRenderedCoverSongId !== song.id) {
      attachCoverImage($('sig-cover-img'), $('sig-cover-fallback'), song.coverArt || song.albumId, song.id, 600);
    }
  }

  async function ensureLyricsForCurrentSong(forceReload = false) {
    const song = audioEngine?.currentSong;
    if (!song) return;
    if (!forceReload && state.lyricsTrackId === song.id && state.lyricsResult) {
      renderSignatureLyrics();
      return;
    }

    state.lyricsTrackId = song.id;
    state.lyricsLoading = true;
    state.lyricsResult = null;
    state.activeLyricIndex = -1;
    renderSignatureLyrics();

    const req = {
      trackId: song.id,
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      durationSeconds: song.duration || 0,
    };

    const res = await lyricsManager.resolveLyrics(req);
    if (audioEngine?.currentSong?.id !== song.id) return;

    state.lyricsLoading = false;
    state.lyricsResult = res;
    renderSignatureLyrics();
  }

  function renderSignatureLyrics() {
    const container = $('signature-lyrics-container');
    const badge = $('sig-provider-badge');
    const offsetControls = $('sig-offset-controls');
    if (!container) return;

    const song = audioEngine?.currentSong;
    if (!song) {
      container.innerHTML =
        '<div class="h-full flex items-center justify-center text-sm font-mono text-[#a1a1aa]">Play a track to load synchronized lyrics.</div>';
      return;
    }

    if (state.lyricsLoading) {
      badge.textContent = 'LOADING...';
      container.innerHTML =
        '<div class="h-full flex items-center justify-center text-sm font-mono text-[#a1a1aa]">Searching lyrics providers...</div>';
      return;
    }

    const res = state.lyricsResult;
    if (!res || res.status !== 'ok' || (!res.lines?.length && !res.plainText)) {
      badge.textContent = `${res?.providerName || 'LRCLIB'} · NOT FOUND`;
      offsetControls.classList.add('hidden');
      container.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center gap-3 p-6">
          <p class="text-sm font-mono text-[#a1a1aa]">No lyrics found for "${escapeHtml(song.title)}".</p>
          <button
            id="sig-empty-open-source-btn"
            type="button"
            class="px-3.5 py-1.5 rounded bg-[#27272a] border border-[#71717a] hover:border-[#34d399] text-xs font-mono text-[#f4f4f5]"
          >
            OPEN SUMBER LIRIK / MANUAL SEARCH
          </button>
        </div>
      `;
      const btn = $('sig-empty-open-source-btn');
      if (btn) btn.addEventListener('click', openLyricsSourceModal);
      return;
    }

    badge.textContent = `${res.providerName.toUpperCase()} · ${res.kind === 'synced' ? 'SYNCED' : 'PLAIN'}`;

    if (res.kind === 'synced' && Array.isArray(res.lines) && res.lines.length > 0) {
      offsetControls.classList.remove('hidden');
      container.innerHTML = '';

      res.lines.forEach((line, idx) => {
        const lineBtn = document.createElement('button');
        lineBtn.type = 'button';
        lineBtn.setAttribute('data-lyric-idx', String(idx));
        lineBtn.className =
          'lyric-line w-full text-left px-4 py-2.5 rounded-md text-base md:text-lg text-[#a1a1aa] hover:text-[#f4f4f5] hover:bg-[#27272a]/40 block';
        lineBtn.textContent = line.text || '♪';
        lineBtn.addEventListener('click', () => {
          const offset = lyricsManager.getTrackOffset(song.id);
          audioEngine.seek(Math.max(0, line.timeSeconds - offset));
        });
        container.appendChild(lineBtn);
      });
      syncActiveLyricLine(true);
    } else {
      offsetControls.classList.add('hidden');
      container.innerHTML = `
        <div class="whitespace-pre-wrap text-sm md:text-base leading-relaxed text-[#f4f4f5] font-sans">
          ${escapeHtml(res.plainText || '')}
        </div>
      `;
    }
  }

  function syncActiveLyricLine(forceScroll = false) {
    if (!state.signatureOpen) return;
    const song = audioEngine?.currentSong;
    const res = state.lyricsResult;
    if (!song || !res || res.kind !== 'synced' || !Array.isArray(res.lines)) return;

    const offset = lyricsManager.getTrackOffset(song.id);
    const effectiveTime = (audioEngine.currentTime || 0) + offset;
    const idx = findActiveLineIndex(res.lines, effectiveTime);

    if (idx === state.activeLyricIndex && !forceScroll) return;
    state.activeLyricIndex = idx;

    const container = $('signature-lyrics-container');
    if (!container) return;

    const buttons = container.querySelectorAll('.lyric-line');
    buttons.forEach((btn, i) => {
      if (i === idx) {
        btn.classList.add('lyric-line-active');
        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        btn.classList.remove('lyric-line-active');
      }
    });
  }

  // Lyrics Source Modal ("Sumber Lirik" + Provider Probing + Manual Search)
  function openLyricsSourceModal() {
    const song = audioEngine?.currentSong;
    if (!song) {
      showToast('Play a track first to configure its lyrics source.');
      return;
    }
    state.lyricsSourceModalOpen = true;
    $('lyrics-source-modal').classList.remove('hidden');
    $('lyrics-manual-title').value = song.title || '';
    $('lyrics-manual-artist').value = song.artist || '';

    probeProvidersForCurrentTrack(song);
  }

  function closeLyricsSourceModal() {
    state.lyricsSourceModalOpen = false;
    $('lyrics-source-modal').classList.add('hidden');
  }

  async function probeProvidersForCurrentTrack(song) {
    const req = {
      trackId: song.id,
      title: song.title || '',
      artist: song.artist || '',
      album: song.album || '',
      durationSeconds: song.duration || 0,
    };

    state.providerProbes = {};
    for (const p of LYRICS_PROVIDERS_META) {
      state.providerProbes[p.id] = { status: 'checking' };
    }
    renderLyricsProvidersStatusList(song);

    await Promise.all(
      LYRICS_PROVIDERS_META.map(async (p) => {
        const res = await lyricsManager.fetchFromProvider(p.id, req);
        state.providerProbes[p.id] = res;
        if (state.lyricsSourceModalOpen) {
          renderLyricsProvidersStatusList(song);
        }
      })
    );
  }

  function renderLyricsProvidersStatusList(song) {
    const list = $('lyrics-providers-status-list');
    if (!list || !song) return;
    const currentOverride = lyricsManager.getTrackProviderOverride(song.id);

    list.innerHTML = '';

    // 1. "Otomatis" Option
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = `w-full px-3.5 py-2.5 rounded-lg border text-left flex items-center justify-between text-xs transition-colors ${
      currentOverride === 'auto'
        ? 'bg-[#27272a] border-[#34d399] text-[#f4f4f5]'
        : 'bg-[#0e0e11] border-[#3f3f46] text-[#a1a1aa] hover:text-[#f4f4f5]'
    }`;
    autoBtn.innerHTML = `
      <div>
        <div class="font-semibold text-[#f4f4f5]">Otomatis (Ikuti urutan prioritas)</div>
        <div class="text-[11px] font-mono text-[#a1a1aa]">Queries providers in your configured Settings order</div>
      </div>
      <span class="px-2 py-0.5 rounded bg-[#18181b] border border-[#3f3f46] text-[10px] font-mono text-[#34d399]">AUTO</span>
    `;
    autoBtn.addEventListener('click', () => {
      lyricsManager.setTrackProviderOverride(song.id, 'auto');
      closeLyricsSourceModal();
      ensureLyricsForCurrentSong(true);
    });
    list.appendChild(autoBtn);

    // 2. Individual Providers
    for (const meta of LYRICS_PROVIDERS_META) {
      const probe = state.providerProbes[meta.id] || { status: 'checking' };
      const isSelected = currentOverride === meta.id;

      let badgeHtml = '';
      if (probe.status === 'checking') {
        badgeHtml = '<span class="text-[11px] font-mono text-[#a1a1aa]">Memeriksa...</span>';
      } else if (probe.status === 'ok') {
        badgeHtml = `<span class="px-2 py-0.5 rounded bg-[#27272a] border border-[#34d399] text-[10px] font-mono text-[#34d399]">Tersedia (${
          probe.kind === 'synced' ? 'Synced' : 'Plain'
        })</span>`;
      } else if (probe.status === 'not_found') {
        badgeHtml = '<span class="text-[11px] font-mono text-[#a1a1aa]">Tidak ditemukan</span>';
      } else {
        badgeHtml = '<span class="text-[11px] font-mono text-[#f87171]">Tidak dapat dijangkau</span>';
      }

      const row = document.createElement('div');
      row.className = `w-full px-3.5 py-2.5 rounded-lg border flex items-center justify-between gap-2 text-xs transition-colors ${
        isSelected ? 'bg-[#27272a] border-[#34d399]' : 'bg-[#0e0e11] border-[#3f3f46]'
      }`;

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'flex-1 text-left flex items-center justify-between gap-2';
      selectBtn.innerHTML = `
        <span class="font-medium text-[#f4f4f5]">${escapeHtml(meta.name)}</span>
        ${badgeHtml}
      `;
      selectBtn.addEventListener('click', () => {
        lyricsManager.setTrackProviderOverride(song.id, meta.id);
        closeLyricsSourceModal();
        ensureLyricsForCurrentSong(true);
      });

      row.appendChild(selectBtn);

      if (probe.status === 'unreachable') {
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.title = 'Coba lagi';
        retryBtn.className =
          'px-2 py-1 rounded bg-[#18181b] border border-[#71717a] text-[10px] font-mono text-[#f4f4f5] hover:border-[#34d399]';
        retryBtn.textContent = 'RETRY';
        retryBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          state.providerProbes[meta.id] = { status: 'checking' };
          renderLyricsProvidersStatusList(song);
          const res = await lyricsManager.fetchFromProvider(meta.id, {
            trackId: song.id,
            title: song.title || '',
            artist: song.artist || '',
            album: song.album || '',
            durationSeconds: song.duration || 0,
          });
          state.providerProbes[meta.id] = res;
          renderLyricsProvidersStatusList(song);
        });
        row.appendChild(retryBtn);
      }

      list.appendChild(row);
    }
  }

  // ============================================================================
  // Player Bar & Audio Engine State Synchronization
  // ============================================================================
  let lastPlayerTrackId = null;

  function updatePlayerBarUI() {
    if (!audioEngine) return;
    const song = audioEngine.currentSong;

    // Play/Pause icons
    const playIcon = $('icon-play');
    const sigPlayIcon = $('sig-icon-play');
    const desiredIcon = audioEngine.isPlaying ? 'pause' : 'play';
    if (playIcon && playIcon.getAttribute('data-lucide') !== desiredIcon) {
      playIcon.setAttribute('data-lucide', desiredIcon);
      if (sigPlayIcon) sigPlayIcon.setAttribute('data-lucide', desiredIcon);
      refreshIcons();
    }

    // Time & Seek sliders
    const cur = audioEngine.currentTime || 0;
    const dur = audioEngine.duration || song?.duration || 0;

    $('time-current').textContent = formatDuration(cur);
    $('time-total').textContent = formatDuration(dur);
    $('sig-time-current').textContent = formatDuration(cur);
    $('sig-time-total').textContent = formatDuration(dur);

    const seekSlider = $('seek-slider');
    const sigSeekSlider = $('sig-seek-slider');
    if (seekSlider && !audioEngine.isSeeking) {
      seekSlider.max = String(dur > 0 ? dur : 100);
      seekSlider.value = String(cur);
    }
    if (sigSeekSlider && !audioEngine.isSeeking) {
      sigSeekSlider.max = String(dur > 0 ? dur : 100);
      sigSeekSlider.value = String(cur);
    }

    // Shuffle & Repeat states
    const shuffleBtn = $('btn-shuffle');
    const sigShuffleBtn = $('sig-btn-shuffle');
    if (shuffleBtn) {
      if (audioEngine.shuffle) shuffleBtn.classList.add('text-[#34d399]');
      else shuffleBtn.classList.remove('text-[#34d399]');
    }
    if (sigShuffleBtn) {
      if (audioEngine.shuffle) sigShuffleBtn.classList.add('text-[#34d399]');
      else sigShuffleBtn.classList.remove('text-[#34d399]');
    }

    const repeatBtn = $('btn-repeat');
    const sigRepeatBtn = $('sig-btn-repeat');
    const oneBadge = $('repeat-one-badge');
    if (repeatBtn) {
      if (audioEngine.repeatMode !== 'off') repeatBtn.classList.add('text-[#34d399]');
      else repeatBtn.classList.remove('text-[#34d399]');
    }
    if (sigRepeatBtn) {
      if (audioEngine.repeatMode !== 'off') sigRepeatBtn.classList.add('text-[#34d399]');
      else sigRepeatBtn.classList.remove('text-[#34d399]');
    }
    if (oneBadge) {
      if (audioEngine.repeatMode === 'one') {
        oneBadge.classList.remove('hidden');
        oneBadge.classList.add('flex');
      } else {
        oneBadge.classList.add('hidden');
        oneBadge.classList.remove('flex');
      }
    }

    // Volume slider
    const volSlider = $('volume-slider');
    if (volSlider) volSlider.value = String(audioEngine.volume);
    const volIcon = $('icon-volume');
    if (volIcon) {
      const targetVolIcon = audioEngine.volume === 0 ? 'volume-x' : audioEngine.volume < 0.5 ? 'volume-1' : 'volume-2';
      if (volIcon.getAttribute('data-lucide') !== targetVolIcon) {
        volIcon.setAttribute('data-lucide', targetVolIcon);
        refreshIcons();
      }
    }

    // Queue counts
    $('player-queue-count').textContent = String(audioEngine.queue.length);
    $('queue-count-badge').textContent = String(audioEngine.queue.length);

    if (!song) {
      $('player-title-btn').textContent = 'No track selected';
      $('player-artist-btn').textContent = 'Select any song or album to begin playback';
      lastPlayerTrackId = null;
      return;
    }

    $('player-title-btn').textContent = song.title || 'Untitled Track';
    $('player-artist-btn').textContent = song.artist || 'Unknown Artist';

    // Star button on player bar
    const starBtn = $('player-star-btn');
    const isStarred = state.starredSongIds.has(song.id);
    if (starBtn) {
      if (isStarred) starBtn.classList.add('text-[#34d399]');
      else starBtn.classList.remove('text-[#34d399]');
    }

    // When track changes, update cover art, active rows, queue drawer, and Signature View lyrics
    if (lastPlayerTrackId !== song.id) {
      lastPlayerTrackId = song.id;
      attachCoverImage($('player-cover-img'), $('player-cover-fallback'), song.coverArt || song.albumId, song.id, 160);
      updateSignatureMetadataUI();
      lastRenderedCoverSongId = song.id;
      if (state.signatureOpen) {
        ensureLyricsForCurrentSong();
      }
      if (state.queueOpen) {
        renderQueueDrawer();
      }
      rerenderActiveTrackLists();
    }

    if (state.signatureOpen) {
      syncActiveLyricLine(false);
    }
  }

  // ============================================================================
  // Error Banner Helper
  // ============================================================================
  function setConnectionError(msg) {
    const banner = $('error-banner');
    const dot = $('server-status-dot');
    const pingBadge = $('settings-ping-badge');

    if (msg) {
      if (banner) {
        banner.classList.remove('hidden');
        $('error-banner-msg').textContent = msg;
      }
      if (dot) {
        dot.classList.remove('bg-[#34d399]');
        dot.classList.add('bg-[#f87171]');
      }
      if (pingBadge) {
        pingBadge.textContent = 'OFFLINE';
        pingBadge.classList.remove('text-[#34d399]');
        pingBadge.classList.add('text-[#f87171]');
      }
    } else {
      if (banner) banner.classList.add('hidden');
      if (dot) {
        dot.classList.add('bg-[#34d399]');
        dot.classList.remove('bg-[#f87171]');
      }
      if (pingBadge) {
        pingBadge.textContent = 'CONNECTED';
        pingBadge.classList.add('text-[#34d399]');
        pingBadge.classList.remove('text-[#f87171]');
      }
    }
  }

  // ============================================================================
  // Event Bindings & Keyboard Shortcuts
  // ============================================================================
  function bindAllEvents() {
    // Sidebar Collapse & Navigation
    $('sidebar-toggle-btn').addEventListener('click', toggleSidebar);
    $('sidebar-brand-wrap').addEventListener('click', () => navigateTo('home'));

    document.querySelectorAll('.sidebar-nav-btn[data-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.getAttribute('data-route');
        if (route) navigateTo(route);
      });
    });

    // Sidebar inline + NEW playlist
    const newPlBtn = $('sidebar-new-playlist-btn');
    const newPlForm = $('sidebar-new-playlist-form');
    const newPlInput = $('sidebar-new-playlist-input');
    newPlBtn.addEventListener('click', () => {
      if (state.sidebarCollapsed) {
        state.sidebarCollapsed = false;
        applySidebarState();
      }
      newPlForm.classList.toggle('hidden');
      if (!newPlForm.classList.contains('hidden')) newPlInput.focus();
    });
    newPlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = newPlInput.value.trim();
      if (!name) return;
      try {
        await client.createPlaylist(name, []);
        newPlInput.value = '';
        newPlForm.classList.add('hidden');
        showToast(`Created playlist "${name}"`);
        await refreshPlaylistsSidebarAndCache();
        if (state.route === 'playlists') loadPlaylistsView();
      } catch (err) {
        showToast(`Failed to create playlist: ${err.message}`);
      }
    });

    // Error Banner Buttons
    $('error-retry-btn').addEventListener('click', () => navigateTo(state.route));
    $('error-settings-btn').addEventListener('click', () => navigateTo('settings'));

    // Home Buttons
    $('home-refresh-btn').addEventListener('click', () => loadHomeView(true));
    $('home-see-all-albums-btn').addEventListener('click', () => navigateTo('albums'));

    // Artists Filter & Detail Buttons
    $('artists-filter-input').addEventListener('input', renderArtistsGrid);
    $('back-to-artists-btn').addEventListener('click', () => navigateTo('artists'));
    $('artist-play-all-btn').addEventListener('click', async () => {
      if (!state.currentArtist) return;
      const allTracks = [];
      for (const alb of state.currentArtist.album || []) {
        const detail = await client.getAlbum(alb.id).catch(() => null);
        if (detail?.song) allTracks.push(...detail.song);
      }
      allTracks.push(...(state.currentArtistSingles || []));
      if (allTracks.length > 0) audioEngine.playSong(allTracks[0], allTracks);
    });
    $('artist-shuffle-btn').addEventListener('click', async () => {
      if (!state.currentArtist) return;
      const allTracks = [];
      for (const alb of state.currentArtist.album || []) {
        const detail = await client.getAlbum(alb.id).catch(() => null);
        if (detail?.song) allTracks.push(...detail.song);
      }
      allTracks.push(...(state.currentArtistSingles || []));
      if (allTracks.length > 0) {
        audioEngine.shuffle = true;
        const rand = allTracks[Math.floor(Math.random() * allTracks.length)];
        audioEngine.playSong(rand, allTracks);
      }
    });

    // Albums Sort & Pagination
    $('albums-sort-select').addEventListener('change', (e) => {
      state.albumsSort = e.target.value;
      loadAlbumsView(true);
    });
    $('albums-load-more-btn').addEventListener('click', () => loadAlbumsView(false));

    // Album Detail Actions
    $('album-back-btn').addEventListener('click', () => navigateTo(state.albumBackRoute || 'albums'));
    $('album-play-btn').addEventListener('click', () => {
      const songs = state.currentAlbum?.song || [];
      if (songs.length > 0) audioEngine.playSong(songs[0], songs);
    });
    $('album-shuffle-btn').addEventListener('click', () => {
      const songs = state.currentAlbum?.song || [];
      if (songs.length > 0) {
        audioEngine.shuffle = true;
        const rand = songs[Math.floor(Math.random() * songs.length)];
        audioEngine.playSong(rand, songs);
      }
    });
    $('album-star-btn').addEventListener('click', () => {
      if (state.currentAlbum) toggleStarAlbum(state.currentAlbum);
    });

    // Songs View Actions
    $('songs-play-all-btn').addEventListener('click', () => {
      if (state.songs.length > 0) audioEngine.playSong(state.songs[0], state.songs);
    });
    $('songs-shuffle-btn').addEventListener('click', () => {
      if (state.songs.length > 0) {
        audioEngine.shuffle = true;
        const rand = state.songs[Math.floor(Math.random() * state.songs.length)];
        audioEngine.playSong(rand, state.songs);
      }
    });
    $('songs-load-more-btn').addEventListener('click', () => loadSongsView(false));

    // Playlists View & Detail Actions
    $('playlists-create-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('playlists-create-input');
      const name = input.value.trim();
      if (!name) return;
      try {
        await client.createPlaylist(name, []);
        input.value = '';
        showToast(`Created playlist "${name}"`);
        await loadPlaylistsView();
      } catch (err) {
        showToast(`Failed to create playlist: ${err.message}`);
      }
    });

    $('playlist-back-btn').addEventListener('click', () => navigateTo('playlists'));
    $('playlist-play-btn').addEventListener('click', () => {
      const entries = state.currentPlaylist?.entry || [];
      if (entries.length > 0) audioEngine.playSong(entries[0], entries);
    });
    $('playlist-shuffle-btn').addEventListener('click', () => {
      const entries = state.currentPlaylist?.entry || [];
      if (entries.length > 0) {
        audioEngine.shuffle = true;
        const rand = entries[Math.floor(Math.random() * entries.length)];
        audioEngine.playSong(rand, entries);
      }
    });

    const renameForm = $('playlist-rename-form');
    const renameInput = $('playlist-rename-input');
    $('playlist-rename-toggle-btn').addEventListener('click', () => {
      if (!state.currentPlaylist) return;
      renameInput.value = state.currentPlaylist.name;
      renameForm.classList.remove('hidden');
      renameForm.classList.add('flex');
      renameInput.focus();
    });
    $('playlist-rename-cancel-btn').addEventListener('click', () => {
      renameForm.classList.add('hidden');
      renameForm.classList.remove('flex');
    });
    renameForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = renameInput.value.trim();
      if (!newName || !state.currentPlaylist) return;
      try {
        await client.updatePlaylist({ playlistId: state.currentPlaylist.id, name: newName });
        renameForm.classList.add('hidden');
        renameForm.classList.remove('flex');
        showToast(`Renamed playlist to "${newName}"`);
        await openPlaylistDetail(state.currentPlaylist.id);
        await refreshPlaylistsSidebarAndCache();
      } catch (err) {
        showToast(`Rename failed: ${err.message}`);
      }
    });

    $('playlist-delete-btn').addEventListener('click', async () => {
      if (!state.currentPlaylist) return;
      if (!state.deletePlaylistConfirm) {
        state.deletePlaylistConfirm = true;
        $('playlist-delete-label').textContent = 'CONFIRM DELETE?';
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

    // Favourites View Actions
    $('favourites-play-btn').addEventListener('click', () => {
      if (state.favouriteSongs.length > 0) {
        audioEngine.playSong(state.favouriteSongs[0], state.favouriteSongs);
      }
    });
    $('favourites-shuffle-btn').addEventListener('click', () => {
      if (state.favouriteSongs.length > 0) {
        audioEngine.shuffle = true;
        const rand = state.favouriteSongs[Math.floor(Math.random() * state.favouriteSongs.length)];
        audioEngine.playSong(rand, state.favouriteSongs);
      }
    });

    // Discovery Detail Actions
    $('discovery-back-btn').addEventListener('click', () => navigateTo('home'));
    $('discovery-play-btn').addEventListener('click', () => {
      const tracks = state.currentDiscoveryCard?.tracks || [];
      if (tracks.length > 0) audioEngine.playSong(tracks[0], tracks);
    });
    $('discovery-save-playlist-btn').addEventListener('click', async () => {
      const card = state.currentDiscoveryCard;
      if (!card || !card.tracks?.length) return;
      try {
        const songIds = card.tracks.map((t) => t.id);
        await client.createPlaylist(card.title, songIds);
        showToast(`Saved "${card.title}" to Playlists`);
        await refreshPlaylistsSidebarAndCache();
      } catch (err) {
        showToast(`Failed to save playlist: ${err.message}`);
      }
    });

    // Settings Form & Controls
    $('settings-server-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      client.saveConfig(
        $('settings-server-url').value,
        $('settings-server-user').value,
        $('settings-server-pass').value
      );
      const ok = await client.ping();
      if (ok) {
        setConnectionError(null);
        showToast('Connected to Navidrome server');
        await syncStarredFromServer();
        await refreshPlaylistsSidebarAndCache();
      } else {
        setConnectionError('Ping failed. Check server URL and credentials.');
        showToast('Could not connect to server');
      }
    });

    $('settings-reset-server-btn').addEventListener('click', () => {
      client.saveConfig(DEFAULT_CONFIG.serverUrl, DEFAULT_CONFIG.username, DEFAULT_CONFIG.password);
      renderSettingsView();
      showToast('Restored default Navidrome credentials');
    });

    $('settings-crossfade-slider').addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      audioEngine.setCrossfadeSeconds(val);
      $('settings-crossfade-label').textContent = val === 0 ? '0s (Gapless)' : `${val}s`;
    });

    $('settings-lyrics-reset-btn').addEventListener('click', () => {
      lyricsManager.setPriorityOrder([...DEFAULT_LYRICS_PRIORITY]);
      renderSettingsLyricsPriorityList();
      showToast('Reset lyrics provider priority to default');
    });

    $('settings-lastfm-save-btn').addEventListener('click', () => {
      lastFm.setCredentials($('settings-lastfm-key').value, $('settings-lastfm-secret').value);
      lastFm.setEnabled($('settings-lastfm-enabled').checked);
      showToast('Saved Last.fm API credentials');
      renderSettingsView();
    });

    $('settings-lastfm-enabled').addEventListener('change', (e) => {
      lastFm.setEnabled(e.target.checked);
    });

    $('settings-lastfm-connect-btn').addEventListener('click', () => {
      const key = $('settings-lastfm-key').value.trim();
      const secret = $('settings-lastfm-secret').value.trim();
      if (!key || !secret) {
        showToast('Enter Last.fm API Key and Shared Secret first');
        return;
      }
      lastFm.setCredentials(key, secret);
      const cb = window.location.origin + window.location.pathname;
      window.location.href = lastFm.getAuthUrl(key, cb);
    });

    $('settings-lastfm-disconnect-btn').addEventListener('click', () => {
      lastFm.disconnect();
      renderSettingsView();
      showToast('Disconnected from Last.fm');
    });

    $('settings-clear-history-btn').addEventListener('click', () => {
      historyStore.clear();
      renderSettingsView();
      showToast('Cleared local listening history');
    });

    // Queue Drawer Controls
    $('btn-queue').addEventListener('click', () => toggleQueueDrawer());
    $('queue-close-btn').addEventListener('click', () => toggleQueueDrawer(false));
    $('queue-clear-btn').addEventListener('click', () => {
      audioEngine.clearQueue();
      renderQueueDrawer();
    });
    $('queue-save-playlist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('queue-save-playlist-input');
      const name = input.value.trim();
      if (!name || audioEngine.queue.length === 0) return;
      try {
        const ids = audioEngine.queue.map((s) => s.id);
        await client.createPlaylist(name, ids);
        input.value = '';
        showToast(`Saved queue as playlist "${name}"`);
        await refreshPlaylistsSidebarAndCache();
      } catch (err) {
        showToast(`Failed to save queue: ${err.message}`);
      }
    });

    // Player Bar Controls
    $('player-cover-btn').addEventListener('click', openSignatureView);
    $('player-title-btn').addEventListener('click', openSignatureView);
    $('player-artist-btn').addEventListener('click', () => {
      const artistId = audioEngine?.currentSong?.artistId;
      if (artistId) openArtistDetail(artistId);
    });
    $('player-star-btn').addEventListener('click', () => {
      if (audioEngine?.currentSong) toggleStarTrack(audioEngine.currentSong);
    });

    $('btn-play').addEventListener('click', () => audioEngine.togglePlayPause());
    $('btn-prev').addEventListener('click', () => audioEngine.previous());
    $('btn-next').addEventListener('click', () => audioEngine.next());
    $('btn-shuffle').addEventListener('click', () => audioEngine.toggleShuffle());
    $('btn-repeat').addEventListener('click', () => audioEngine.cycleRepeatMode());
    $('btn-signature').addEventListener('click', openSignatureView);

    $('seek-slider').addEventListener('input', (e) => {
      audioEngine.seek(parseFloat(e.target.value) || 0);
    });
    $('sig-seek-slider').addEventListener('input', (e) => {
      audioEngine.seek(parseFloat(e.target.value) || 0);
    });

    $('volume-slider').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (v > 0) state.lastNonZeroVolume = v;
      audioEngine.setVolume(v);
    });
    $('btn-mute').addEventListener('click', () => {
      if (audioEngine.volume > 0) {
        state.lastNonZeroVolume = audioEngine.volume;
        audioEngine.setVolume(0);
      } else {
        audioEngine.setVolume(state.lastNonZeroVolume || 0.85);
      }
    });

    // Signature Room Controls
    $('btn-close-signature').addEventListener('click', closeSignatureView);
    $('sig-btn-play').addEventListener('click', () => audioEngine.togglePlayPause());
    $('sig-btn-prev').addEventListener('click', () => audioEngine.previous());
    $('sig-btn-next').addEventListener('click', () => audioEngine.next());
    $('sig-btn-shuffle').addEventListener('click', () => audioEngine.toggleShuffle());
    $('sig-btn-repeat').addEventListener('click', () => audioEngine.cycleRepeatMode());

    $('sig-offset-minus').addEventListener('click', () => {
      const song = audioEngine?.currentSong;
      if (!song) return;
      const next = lyricsManager.getTrackOffset(song.id) - 0.2;
      lyricsManager.setTrackOffset(song.id, next);
      updateSignatureMetadataUI();
      syncActiveLyricLine(true);
    });
    $('sig-offset-plus').addEventListener('click', () => {
      const song = audioEngine?.currentSong;
      if (!song) return;
      const next = lyricsManager.getTrackOffset(song.id) + 0.2;
      lyricsManager.setTrackOffset(song.id, next);
      updateSignatureMetadataUI();
      syncActiveLyricLine(true);
    });
    $('sig-offset-reset').addEventListener('click', () => {
      const song = audioEngine?.currentSong;
      if (!song) return;
      lyricsManager.setTrackOffset(song.id, 0);
      updateSignatureMetadataUI();
      syncActiveLyricLine(true);
    });

    $('btn-lyrics-source').addEventListener('click', openLyricsSourceModal);
    $('lyrics-source-close-btn').addEventListener('click', closeLyricsSourceModal);

    $('lyrics-manual-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const song = audioEngine?.currentSong;
      if (!song) return;
      const title = $('lyrics-manual-title').value.trim();
      const artist = $('lyrics-manual-artist').value.trim();
      if (!title || !artist) return;

      closeLyricsSourceModal();
      state.lyricsLoading = true;
      renderSignatureLyrics();

      const res = await lyricsManager.fetchFromProvider('lrclib', {
        trackId: song.id,
        title,
        artist,
        album: song.album,
        durationSeconds: song.duration,
      });
      state.lyricsLoading = false;
      state.lyricsResult = res;
      renderSignatureLyrics();
    });

    // Context Menu Actions
    $('ctx-play-next').addEventListener('click', () => {
      if (state.ctxSong) {
        audioEngine.playNextInQueue(state.ctxSong);
        showToast(`Playing "${state.ctxSong.title}" next`);
      }
      closeTrackContextMenu();
    });
    $('ctx-add-queue').addEventListener('click', () => {
      if (state.ctxSong) {
        audioEngine.addToQueue(state.ctxSong);
        showToast(`Added "${state.ctxSong.title}" to queue`);
      }
      closeTrackContextMenu();
    });
    $('ctx-star-track').addEventListener('click', async () => {
      const s = state.ctxSong;
      closeTrackContextMenu();
      if (s) await toggleStarTrack(s);
    });
    $('ctx-remove-queue').addEventListener('click', () => {
      if (state.ctxQueueIndex !== null) {
        audioEngine.removeFromQueue(state.ctxQueueIndex);
      }
      closeTrackContextMenu();
    });
    $('ctx-goto-album').addEventListener('click', () => {
      const albumId = state.ctxSong?.albumId;
      closeTrackContextMenu();
      if (albumId) {
        closeSignatureView();
        openAlbumDetail(albumId, state.route);
      }
    });
    $('ctx-goto-artist').addEventListener('click', () => {
      const artistId = state.ctxSong?.artistId;
      closeTrackContextMenu();
      if (artistId) {
        closeSignatureView();
        openArtistDetail(artistId);
      }
    });
    $('ctx-new-playlist-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('ctx-new-playlist-input');
      const name = input.value.trim();
      const song = state.ctxSong;
      if (!name || !song) return;
      input.value = '';
      closeTrackContextMenu();
      try {
        await client.createPlaylist(name, [song.id]);
        showToast(`Created "${name}" with "${song.title}"`);
        await refreshPlaylistsSidebarAndCache();
      } catch (err) {
        showToast(`Failed to create playlist: ${err.message}`);
      }
    });

    document.addEventListener('click', (e) => {
      const menu = $('track-context-menu');
      if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target)) {
        closeTrackContextMenu();
      }
    });

    // Shortcuts Modal
    $('nav-shortcuts-btn').addEventListener('click', () => {
      state.shortcutsModalOpen = true;
      $('shortcuts-modal').classList.remove('hidden');
    });
    $('shortcuts-close-btn').addEventListener('click', () => {
      state.shortcutsModalOpen = false;
      $('shortcuts-modal').classList.add('hidden');
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;

      // Cmd+K or Ctrl+K always opens Search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
        return;
      }

      if (e.key === 'Escape') {
        if (!$('track-context-menu').classList.contains('hidden')) {
          closeTrackContextMenu();
          return;
        }
        if (state.lyricsSourceModalOpen) {
          closeLyricsSourceModal();
          return;
        }
        if (state.shortcutsModalOpen) {
          state.shortcutsModalOpen = false;
          $('shortcuts-modal').classList.add('hidden');
          return;
        }
        if (state.signatureOpen) {
          closeSignatureView();
          return;
        }
        if (state.queueOpen) {
          toggleQueueDrawer(false);
          return;
        }
        return;
      }

      if (isTyping) return;

      if (e.key === '/') {
        e.preventDefault();
        closeSignatureView();
        navigateTo('search');
      } else if (e.key === '?') {
        e.preventDefault();
        state.shortcutsModalOpen = !state.shortcutsModalOpen;
        $('shortcuts-modal').classList.toggle('hidden', !state.shortcutsModalOpen);
      } else if (e.code === 'Space') {
        e.preventDefault();
        audioEngine.togglePlayPause();
      } else if (e.key === ']' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        audioEngine.next();
      } else if (e.key === '[' || e.key.toLowerCase() === 'p') {
        e.preventDefault();
        audioEngine.previous();
      } else if (e.key.toLowerCase() === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        audioEngine.seek((audioEngine.currentTime || 0) + 10);
      } else if (e.key.toLowerCase() === 'j' || e.key === 'ArrowLeft') {
        e.preventDefault();
        audioEngine.seek(Math.max(0, (audioEngine.currentTime || 0) - 10));
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        audioEngine.toggleShuffle();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        audioEngine.cycleRepeatMode();
      } else if (e.key.toLowerCase() === 'q') {
        e.preventDefault();
        toggleQueueDrawer();
      } else if (e.key.toLowerCase() === 'u') {
        e.preventDefault();
        if (state.signatureOpen) closeSignatureView();
        else openSignatureView();
      }
    });
  }

  // ============================================================================
  // View Template Loader (Fetches modular HTML partials from ./views/*.html)
  // ============================================================================
  async function loadViewTemplates() {
    const viewMount = $('view-mount');
    const overlayMount = $('overlay-mount');

    try {
      const [viewHtmlList, signatureHtml] = await Promise.all([
        Promise.all(
          ALL_VIEWS.map(async (viewName) => {
            const res = await fetch(`./views/${viewName}.html`, { cache: 'no-cache' });
            if (!res.ok) throw new Error(`HTTP ${res.status} loading ./views/${viewName}.html`);
            return res.text();
          })
        ),
        fetch('./views/signature-room.html', { cache: 'no-cache' }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status} loading ./views/signature-room.html`);
          return res.text();
        }),
      ]);

      if (viewMount) viewMount.innerHTML = viewHtmlList.join('\n');
      if (overlayMount) overlayMount.innerHTML = signatureHtml;
    } catch (err) {
      if (viewMount) {
        viewMount.innerHTML = `
          <div class="p-8 max-w-xl mx-auto mt-10 rounded-lg bg-[#18181b] border border-[#f87171] space-y-3">
            <h2 class="text-base font-semibold text-[#f4f4f5]">Could not load view templates from ./views/</h2>
            <p class="text-xs text-[#a1a1aa]">
              Browser security blocks fetching separate HTML files over the <code class="font-mono text-[#f4f4f5]">file://</code> protocol.
              Serve this folder over any local HTTP server (for example VS Code Live Server or <code class="font-mono text-[#34d399]">python -m http.server 8080</code>).
            </p>
            <p class="text-[11px] font-mono text-[#f87171]">${escapeHtml(err.message)}</p>
          </div>
        `;
      }
      throw err;
    }
  }

  // ============================================================================
  // Application Bootstrap
  // ============================================================================
  async function init() {
    applySidebarState();
    await loadViewTemplates();

    audioEngine = new GaplessAudioEngine(client, historyStore, lastFm, () => {
      updatePlayerBarUI();
      if (state.queueOpen) renderQueueDrawer();
    });

    setupSearchHandlers();
    bindAllEvents();
    updatePlayerBarUI();
    refreshIcons();

    // Handle Last.fm OAuth callback token if present in URL query
    const urlParams = new URLSearchParams(window.location.search);
    const lfmToken = urlParams.get('token');
    if (lfmToken) {
      window.history.replaceState({}, document.title, window.location.pathname);
      lastFm
        .handleCallbackToken(lfmToken)
        .then((session) => {
          showToast(`Connected to Last.fm as ${session.name}`);
          navigateTo('settings');
        })
        .catch((err) => {
          showToast(`Last.fm auth failed: ${err.message}`);
        });
    }

    // Initial server sync
    await Promise.all([
      syncStarredFromServer(),
      refreshPlaylistsSidebarAndCache(),
      loadHomeView(false),
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

