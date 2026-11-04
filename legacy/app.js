const SUBSONIC_CONFIG = {
    serverUrl: 'http://localhost:4533',
    username: '',
    password: 'pas', // Replace with your Navidrome password
    version: '1.16.1',
    client: 'planrift-web',
    format: 'json'
};

const FALLBACK_COVER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
    '<rect width="300" height="300" fill="#09090b"/>' +
    '<circle cx="150" cy="150" r="88" fill="none" stroke="#52525b" stroke-width="4"/>' +
    '<circle cx="150" cy="150" r="24" fill="none" stroke="#34d399" stroke-width="4"/>' +
    '<circle cx="150" cy="150" r="6" fill="#34d399"/>' +
    '</svg>'
)}`;

const albumCoverCache = new Map();
const albumTracksCache = new Map();

const state = {
    view: 'artists', // 'artists' (Layer 1) | 'albums' (Layer 2) | 'songs' (Layer 3)
    artists: [],
    selectedArtist: null,
    currentAlbums: [],
    selectedAlbum: null,
    currentSongs: [],
    queue: [],
    unshuffledQueue: [],
    queueIndex: -1,
    isShuffle: false,
    isQueueOpen: false
};

const audio = new Audio();
audio.preload = 'metadata';

const dom = {
    backButton: document.getElementById('back-button'),
    backButtonLabel: document.getElementById('back-button-label'),
    breadcrumbBadge: document.getElementById('breadcrumb-badge'),
    connectionBadge: document.getElementById('connection-badge'),
    statusRegion: document.getElementById('status-region'),
    statusTitle: document.getElementById('status-title'),
    statusMessage: document.getElementById('status-message'),
    retryButton: document.getElementById('retry-button'),
    artistsView: document.getElementById('artists-view'),
    artistCount: document.getElementById('artist-count'),
    artistGrid: document.getElementById('artist-grid'),
    albumsView: document.getElementById('albums-view'),
    albumsArtistCover: document.getElementById('albums-artist-cover'),
    albumsArtistHeading: document.getElementById('albums-artist-heading'),
    albumCount: document.getElementById('album-count'),
    albumGrid: document.getElementById('album-grid'),
    songsView: document.getElementById('songs-view'),
    albumDetailCover: document.getElementById('album-detail-cover'),
    albumDetailSubtitle: document.getElementById('album-detail-subtitle'),
    currentAlbumHeading: document.getElementById('current-album-heading'),
    songCount: document.getElementById('song-count'),
    albumPlayBtn: document.getElementById('album-play-btn'),
    albumShuffleBtn: document.getElementById('album-shuffle-btn'),
    albumShuffleLabel: document.getElementById('album-shuffle-label'),
    songList: document.getElementById('song-list'),
    queueDrawer: document.getElementById('queue-drawer'),
    queueCount: document.getElementById('queue-count'),
    queueCloseBtn: document.getElementById('queue-close-btn'),
    queueEmpty: document.getElementById('queue-empty'),
    queueList: document.getElementById('queue-list'),
    playerCover: document.getElementById('player-cover'),
    playerTitle: document.getElementById('player-title'),
    playerArtist: document.getElementById('player-artist'),
    playerShuffleBtn: document.getElementById('player-shuffle-btn'),
    prevBtn: document.getElementById('prev-btn'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    nextBtn: document.getElementById('next-btn'),
    queueToggleBtn: document.getElementById('queue-toggle-btn'),
    queueBadgeCount: document.getElementById('queue-badge-count'),
    iconPlay: document.getElementById('icon-play'),
    iconPause: document.getElementById('icon-pause'),
    currentTime: document.getElementById('current-time'),
    totalDuration: document.getElementById('total-duration'),
    progressContainer: document.getElementById('progress-container'),
    progressBar: document.getElementById('progress-bar')
};

function generateSalt(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let salt = '';
    for (let i = 0; i < length; i += 1) {
        salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return salt;
}

// Subsonic token auth requires t = MD5(password + salt) alongside the salt on every URL.
function createSubsonicAuthParams(extraParams = {}) {
    const salt = generateSalt(10);
    const token = CryptoJS.MD5(SUBSONIC_CONFIG.password + salt).toString();
    const params = new URLSearchParams({
        u: SUBSONIC_CONFIG.username,
        s: salt,
        t: token,
        v: SUBSONIC_CONFIG.version,
        c: SUBSONIC_CONFIG.client,
        f: SUBSONIC_CONFIG.format
    });

    Object.entries(extraParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });

    return params.toString();
}

function buildSubsonicUrl(endpoint, extraParams = {}) {
    const cleanBase = SUBSONIC_CONFIG.serverUrl.replace(/\/+$/, '');
    const cleanPath = endpoint.replace(/^\/+/, '').replace(/^rest\/+/, '');
    const queryString = createSubsonicAuthParams(extraParams);
    return `${cleanBase}/rest/${cleanPath}?${queryString}`;
}

async function subsonicFetch(endpoint, extraParams = {}) {
    const url = buildSubsonicUrl(endpoint, extraParams);
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const payload = await response.json();
    const subsonicResponse = payload?.['subsonic-response'];

    if (!subsonicResponse) {
        throw new Error('Invalid Subsonic JSON payload returned by server.');
    }

    if (subsonicResponse.status !== 'ok') {
        const apiError = subsonicResponse.error?.message || 'Subsonic API request failed.';
        throw new Error(apiError);
    }

    return subsonicResponse;
}

function normalizeArray(value) {
    if (!value) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

// Endpoint: GET /rest/getArtists (Layer 1)
async function getArtists() {
    const data = await subsonicFetch('getArtists');
    const indexGroups = normalizeArray(data.artists?.index);
    return indexGroups.flatMap((group) => normalizeArray(group.artist));
}

// Endpoint: GET /rest/getArtist?id={artist_id} (Layer 2 primary)
async function getArtist(artistId) {
    const data = await subsonicFetch('getArtist', { id: artistId });
    return data.artist || { id: artistId, name: '', album: [] };
}

// Endpoint: GET /rest/getAlbum?id={album_id} (Layer 3 primary)
async function getAlbum(albumId) {
    const data = await subsonicFetch('getAlbum', { id: albumId });
    return data.album || { id: albumId, name: '', song: [] };
}

// Endpoint: GET /rest/getMusicDirectory?id={id} (Folder structure & loose singles check)
async function getMusicDirectory(id) {
    const data = await subsonicFetch('getMusicDirectory', { id });
    return data.directory || { id, name: '', child: [] };
}

// Endpoint: GET /rest/getCoverArt?id={id}&size=300
function getCoverArtUrl(id, size = 300) {
    if (!id) {
        return FALLBACK_COVER_SVG;
    }
    return buildSubsonicUrl('getCoverArt', { id, size });
}

// Endpoint: GET /rest/stream?id={song_id}
function getStreamUrl(songId) {
    return buildSubsonicUrl('stream', { id: songId });
}

// Parse ID3v2 APIC or FLAC picture block from the first 256KB of an audio stream if server cover art is absent.
async function extractEmbeddedPictureFromStream(songId) {
    if (!songId) {
        return null;
    }
    try {
        const response = await fetch(getStreamUrl(songId), {
            headers: { Range: 'bytes=0-262143' }
        });
        if (!response.ok) {
            return null;
        }
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Scan for JPEG (FF D8 FF) or PNG (89 50 4E 47) magic headers inside the tag header region.
        for (let i = 0; i < bytes.length - 16; i += 1) {
            if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) {
                for (let j = i + 8; j < bytes.length - 8; j += 1) {
                    if (bytes[j] === 0x49 && bytes[j + 1] === 0x45 && bytes[j + 2] === 0x4E && bytes[j + 3] === 0x44) {
                        const slice = bytes.slice(i, j + 8);
                        return URL.createObjectURL(new Blob([slice], { type: 'image/png' }));
                    }
                }
            }
            if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
                for (let j = i + 4; j < bytes.length - 2; j += 1) {
                    if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
                        const slice = bytes.slice(i, j + 2);
                        return URL.createObjectURL(new Blob([slice], { type: 'image/jpeg' }));
                    }
                }
            }
        }
    } catch {
        return null;
    }
    return null;
}

async function resolveAlbumSongs(album) {
    if (!album) {
        return [];
    }
    if (album.isVirtualSingles && Array.isArray(album.songs)) {
        return album.songs;
    }
    if (albumTracksCache.has(album.id)) {
        return albumTracksCache.get(album.id);
    }

    try {
        const albumData = await getAlbum(album.id);
        const tracks = normalizeArray(albumData.song);
        if (tracks.length > 0) {
            albumTracksCache.set(album.id, tracks);
            return tracks;
        }
    } catch {
        // Fall back to getMusicDirectory when the ID references a folder directory.
    }

    try {
        const directory = await getMusicDirectory(album.id);
        const children = normalizeArray(directory.child).filter((item) => !item.isDir);
        albumTracksCache.set(album.id, children);
        return children;
    } catch {
        return [];
    }
}

// Fetch artist albums via getArtist and group any loose folderless tracks into a virtual "Singles" album.
async function resolveArtistAlbums(artist) {
    const [artistDetails, rootDirectory] = await Promise.all([
        getArtist(artist.id).catch(() => ({ album: [] })),
        getMusicDirectory(artist.id).catch(() => ({ child: [] }))
    ]);

    const rawAlbums = normalizeArray(artistDetails.album);
    const dirChildren = normalizeArray(rootDirectory.child);
    const directLooseSongs = dirChildren.filter((item) => !item.isDir);

    const standardAlbums = [];
    const unknownAlbumBuckets = [];

    rawAlbums.forEach((album) => {
        const albumTitle = (album.name || album.title || '').trim();
        const isUntaggedBucket = !albumTitle || albumTitle.toLowerCase() === '[unknown album]';
        if (isUntaggedBucket) {
            unknownAlbumBuckets.push(album);
        } else {
            standardAlbums.push({
                ...album,
                name: albumTitle,
                artist: album.artist || artist.name
            });
        }
    });

    // Include folder subdirectories if Navidrome returned folder items not present in getArtist.
    if (standardAlbums.length === 0) {
        const folderDirs = dirChildren.filter((item) => item.isDir);
        folderDirs.forEach((dir) => {
            standardAlbums.push({
                id: dir.id,
                name: dir.title || dir.name || 'Album Folder',
                artist: dir.artist || artist.name,
                coverArt: dir.coverArt || dir.id,
                songCount: dir.songCount
            });
        });
    }

    let looseSongs = [...directLooseSongs];

    if (unknownAlbumBuckets.length > 0) {
        const bucketTracksList = await Promise.all(
            unknownAlbumBuckets.map((bucket) => resolveAlbumSongs(bucket))
        );
        const existingIds = new Set(looseSongs.map((s) => String(s.id)));
        bucketTracksList.flat().forEach((track) => {
            if (!existingIds.has(String(track.id))) {
                existingIds.add(String(track.id));
                looseSongs.push(track);
            }
        });
    }

    if (looseSongs.length > 0) {
        const virtualSinglesAlbum = {
            id: `virtual-singles-${artist.id}`,
            name: 'Singles',
            artist: artist.name,
            isVirtualSingles: true,
            songs: looseSongs,
            songCount: looseSongs.length,
            coverArt: looseSongs[0]?.coverArt || looseSongs[0]?.id || null
        };
        albumTracksCache.set(virtualSinglesAlbum.id, looseSongs);
        standardAlbums.push(virtualSinglesAlbum);
    }

    return standardAlbums;
}

// Try getCoverArt?id={album_id} first; on failure, extract cover art from the first song in that album.
function attachAlbumCoverWithFallback(imgElement, album) {
    if (!album) {
        imgElement.src = FALLBACK_COVER_SVG;
        return;
    }

    if (albumCoverCache.has(album.id)) {
        imgElement.src = albumCoverCache.get(album.id);
        return;
    }

    const primaryUrl = album.isVirtualSingles
        ? getCoverArtUrl(album.songs?.[0]?.id || album.coverArt, 300)
        : getCoverArtUrl(album.id, 300);

    let attemptedFirstSongCover = false;
    let attemptedStreamExtraction = false;

    imgElement.addEventListener('load', () => {
        if (imgElement.src && imgElement.src !== FALLBACK_COVER_SVG) {
            albumCoverCache.set(album.id, imgElement.src);
        }
    });

    imgElement.addEventListener('error', async () => {
        if (!attemptedFirstSongCover) {
            attemptedFirstSongCover = true;
            const songs = await resolveAlbumSongs(album);
            const firstSong = songs[0];

            if (firstSong) {
                const songCoverId = firstSong.id || firstSong.coverArt;
                const songCoverUrl = getCoverArtUrl(songCoverId, 300);
                if (songCoverUrl && songCoverUrl !== imgElement.src) {
                    imgElement.src = songCoverUrl;
                    return;
                }
            }
        }

        if (!attemptedStreamExtraction) {
            attemptedStreamExtraction = true;
            const songs = await resolveAlbumSongs(album);
            const firstSong = songs[0];

            if (firstSong) {
                const embeddedBlobUrl = await extractEmbeddedPictureFromStream(firstSong.id);
                if (embeddedBlobUrl) {
                    albumCoverCache.set(album.id, embeddedBlobUrl);
                    imgElement.src = embeddedBlobUrl;
                    return;
                }
            }
        }

        if (imgElement.src !== FALLBACK_COVER_SVG) {
            imgElement.src = FALLBACK_COVER_SVG;
        }
    });

    imgElement.src = primaryUrl;
}

function attachSongOrArtistCoverFallback(imgElement, songOrArtist) {
    let attemptedStream = false;

    imgElement.addEventListener('error', async () => {
        if (!attemptedStream && songOrArtist && !songOrArtist.albumCount && songOrArtist.id) {
            attemptedStream = true;
            const embeddedBlobUrl = await extractEmbeddedPictureFromStream(songOrArtist.id);
            if (embeddedBlobUrl) {
                imgElement.src = embeddedBlobUrl;
                return;
            }
        }

        if (imgElement.src !== FALLBACK_COVER_SVG) {
            imgElement.src = FALLBACK_COVER_SVG;
        }
    });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function shuffleArray(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = copy[i];
        copy[i] = copy[j];
        copy[j] = temp;
    }
    return copy;
}

function showStatus({ title, message, showRetry = false }) {
    dom.statusTitle.textContent = title;
    dom.statusMessage.textContent = message;
    dom.retryButton.classList.toggle('hidden', !showRetry);
    dom.statusRegion.classList.remove('hidden');
}

function hideStatus() {
    dom.statusRegion.classList.add('hidden');
}

function switchView(targetView) {
    state.view = targetView;

    dom.artistsView.classList.toggle('hidden', targetView !== 'artists');
    dom.albumsView.classList.toggle('hidden', targetView !== 'albums');
    dom.songsView.classList.toggle('hidden', targetView !== 'songs');

    if (targetView === 'artists') {
        dom.backButton.classList.add('hidden');
        dom.breadcrumbBadge.textContent = 'Library / Artists';
    } else if (targetView === 'albums') {
        dom.backButton.classList.remove('hidden');
        dom.backButtonLabel.textContent = 'Artists';
        dom.backButton.setAttribute('aria-label', 'Back to artists');
        dom.breadcrumbBadge.textContent = `Artists / ${state.selectedArtist?.name || 'Albums'}`;
    } else if (targetView === 'songs') {
        dom.backButton.classList.remove('hidden');
        dom.backButtonLabel.textContent = 'Albums';
        dom.backButton.setAttribute('aria-label', 'Back to albums');
        dom.breadcrumbBadge.textContent = `${state.selectedArtist?.name || 'Artist'} / ${state.selectedAlbum?.name || 'Album'}`;
    }
}

function renderArtistGrid(artists) {
    dom.artistGrid.innerHTML = '';
    dom.artistCount.textContent = `${artists.length} ${artists.length === 1 ? 'artist' : 'artists'}`;

    const fragment = document.createDocumentFragment();

    artists.forEach((artist) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.artistId = artist.id;
        card.className = 'artist-card studio-panel rounded-lg p-3 text-left flex flex-col gap-3 hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors group w-full';

        const coverWrapper = document.createElement('div');
        coverWrapper.className = 'w-full aspect-square rounded-md overflow-hidden bg-zinc-950 border border-zinc-500';

        const img = document.createElement('img');
        img.src = getCoverArtUrl(artist.coverArt || artist.id, 300);
        img.alt = `${artist.name} cover art`;
        img.width = 300;
        img.height = 300;
        img.loading = 'lazy';
        img.className = 'w-full h-full object-cover';
        attachSongOrArtistCoverFallback(img, artist);

        coverWrapper.appendChild(img);

        const meta = document.createElement('div');
        meta.className = 'min-w-0 w-full';

        const nameEl = document.createElement('p');
        nameEl.className = 'text-sm font-semibold text-zinc-100 truncate group-hover:text-emerald-400 transition-colors';
        nameEl.textContent = artist.name;

        const albumMeta = document.createElement('p');
        albumMeta.className = 'text-xs font-mono text-zinc-300 mt-0.5 truncate';
        albumMeta.textContent = artist.albumCount
            ? `${artist.albumCount} ${artist.albumCount === 1 ? 'release' : 'releases'}`
            : 'Open discography';

        meta.appendChild(nameEl);
        meta.appendChild(albumMeta);

        card.appendChild(coverWrapper);
        card.appendChild(meta);

        card.addEventListener('click', () => {
            openArtistAlbumsView(artist);
        });

        fragment.appendChild(card);
    });

    dom.artistGrid.appendChild(fragment);
}

function renderAlbumGrid(artist, albums) {
    dom.albumGrid.innerHTML = '';
    dom.albumsArtistHeading.textContent = artist.name;
    dom.albumCount.textContent = `${albums.length} ${albums.length === 1 ? 'release' : 'releases'} available`;

    dom.albumsArtistCover.src = getCoverArtUrl(artist.coverArt || artist.id, 300);
    dom.albumsArtistCover.alt = `${artist.name} cover art`;
    attachSongOrArtistCoverFallback(dom.albumsArtistCover, artist);

    const fragment = document.createDocumentFragment();

    albums.forEach((album) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.albumId = album.id;
        card.className = 'album-card studio-panel rounded-lg p-3 text-left flex flex-col gap-3 hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors group w-full';

        const coverWrapper = document.createElement('div');
        coverWrapper.className = 'w-full aspect-square rounded-md overflow-hidden bg-zinc-950 border border-zinc-500 relative';

        const img = document.createElement('img');
        img.alt = `${album.name} album art`;
        img.width = 300;
        img.height = 300;
        img.loading = 'lazy';
        img.className = 'w-full h-full object-cover';
        attachAlbumCoverWithFallback(img, album);

        coverWrapper.appendChild(img);

        if (album.isVirtualSingles) {
            const badge = document.createElement('span');
            badge.className = 'absolute top-2 left-2 text-xs font-mono px-2 py-0.5 rounded bg-emerald-400 text-zinc-950 font-semibold';
            badge.textContent = 'Singles';
            coverWrapper.appendChild(badge);
        }

        const meta = document.createElement('div');
        meta.className = 'min-w-0 w-full';

        const titleEl = document.createElement('p');
        titleEl.className = 'text-sm font-semibold text-zinc-100 truncate group-hover:text-emerald-400 transition-colors';
        titleEl.textContent = album.name;

        const detailsParts = [];
        if (album.year) {
            detailsParts.push(String(album.year));
        }
        if (album.songCount) {
            detailsParts.push(`${album.songCount} ${album.songCount === 1 ? 'song' : 'songs'}`);
        } else if (album.isVirtualSingles) {
            detailsParts.push('Loose tracks');
        } else {
            detailsParts.push('Album');
        }

        const subEl = document.createElement('p');
        subEl.className = 'text-xs font-mono text-zinc-300 mt-0.5 truncate';
        subEl.textContent = detailsParts.join(' · ');

        meta.appendChild(titleEl);
        meta.appendChild(subEl);

        card.appendChild(coverWrapper);
        card.appendChild(meta);

        card.addEventListener('click', () => {
            openAlbumSongsView(album);
        });

        fragment.appendChild(card);
    });

    dom.albumGrid.appendChild(fragment);
}

function renderSongList(album, songs) {
    dom.songList.innerHTML = '';
    dom.currentAlbumHeading.textContent = album.name;
    dom.albumDetailSubtitle.textContent = `Layer 3 · ${album.artist || state.selectedArtist?.name || 'Artist'}`;
    dom.songCount.textContent = `${songs.length} ${songs.length === 1 ? 'track' : 'tracks'} in release`;

    dom.albumDetailCover.alt = `${album.name} cover art`;
    attachAlbumCoverWithFallback(dom.albumDetailCover, album);

    const fragment = document.createDocumentFragment();

    songs.forEach((song, index) => {
        const item = document.createElement('div');
        item.setAttribute('role', 'listitem');

        const rowButton = document.createElement('button');
        rowButton.type = 'button';
        rowButton.dataset.songId = song.id;
        rowButton.dataset.songIndex = String(index);
        rowButton.className = 'song-row studio-panel w-full min-h-[56px] px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-3 text-left hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors';

        const leftGroup = document.createElement('div');
        leftGroup.className = 'flex items-center gap-3 min-w-0 flex-1';

        const indexLabel = document.createElement('span');
        indexLabel.className = 'text-xs font-mono text-zinc-300 w-6 text-right shrink-0';
        indexLabel.textContent = String(index + 1).padStart(2, '0');

        const coverImg = document.createElement('img');
        coverImg.src = getCoverArtUrl(song.coverArt || song.id, 300);
        coverImg.alt = `${song.title || 'Track'} cover art`;
        coverImg.width = 44;
        coverImg.height = 44;
        coverImg.loading = 'lazy';
        coverImg.className = 'w-11 h-11 rounded object-cover bg-zinc-950 border border-zinc-500 shrink-0';
        attachSongOrArtistCoverFallback(coverImg, song);

        const textGroup = document.createElement('div');
        textGroup.className = 'min-w-0 flex-1';

        const titleEl = document.createElement('p');
        titleEl.className = 'song-title text-sm font-semibold text-zinc-100 truncate';
        titleEl.textContent = song.title || 'Untitled Track';

        const subEl = document.createElement('p');
        subEl.className = 'text-xs text-zinc-300 truncate mt-0.5';
        subEl.textContent = song.artist || album.artist || state.selectedArtist?.name || 'Unknown Artist';

        textGroup.appendChild(titleEl);
        textGroup.appendChild(subEl);

        leftGroup.appendChild(indexLabel);
        leftGroup.appendChild(coverImg);
        leftGroup.appendChild(textGroup);

        const rightGroup = document.createElement('div');
        rightGroup.className = 'flex items-center gap-3 shrink-0';

        const stateBadge = document.createElement('span');
        stateBadge.className = 'song-state-badge hidden text-xs font-mono px-2 py-0.5 rounded bg-emerald-400 text-zinc-950 font-semibold';
        stateBadge.textContent = 'Playing';

        const durationEl = document.createElement('span');
        durationEl.className = 'text-xs font-mono text-zinc-300';
        durationEl.textContent = formatTime(song.duration);

        rightGroup.appendChild(stateBadge);
        rightGroup.appendChild(durationEl);

        rowButton.appendChild(leftGroup);
        rowButton.appendChild(rightGroup);

        // Clicking a song populates the queue from this song to the end of the album.
        rowButton.addEventListener('click', () => {
            startQueueFromAlbumTrack(songs, index);
        });

        item.appendChild(rowButton);
        fragment.appendChild(item);
    });

    dom.songList.appendChild(fragment);
    syncActiveSongHighlight();
}

function renderQueueDrawer() {
    const total = state.queue.length;
    dom.queueCount.textContent = `${total} ${total === 1 ? 'track' : 'tracks'} queued`;
    dom.queueBadgeCount.textContent = `Queue (${total})`;

    if (total === 0) {
        dom.queueEmpty.classList.remove('hidden');
        dom.queueList.classList.add('hidden');
        dom.queueList.innerHTML = '';
        return;
    }

    dom.queueEmpty.classList.add('hidden');
    dom.queueList.classList.remove('hidden');
    dom.queueList.innerHTML = '';

    const fragment = document.createDocumentFragment();

    state.queue.forEach((song, idx) => {
        const isCurrent = idx === state.queueIndex;
        const item = document.createElement('div');
        item.setAttribute('role', 'listitem');

        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.dataset.queueIndex = String(idx);
        rowBtn.dataset.active = isCurrent ? 'true' : 'false';
        rowBtn.className = 'queue-row studio-panel w-full min-h-[52px] px-3 py-2 rounded-md flex items-center justify-between gap-2.5 text-left hover:bg-zinc-800 hover:border-zinc-300 active:bg-zinc-700 transition-colors';

        const left = document.createElement('div');
        left.className = 'flex items-center gap-2.5 min-w-0 flex-1';

        const posLabel = document.createElement('span');
        posLabel.className = 'text-xs font-mono text-zinc-300 w-5 text-right shrink-0';
        posLabel.textContent = String(idx + 1).padStart(2, '0');

        const thumb = document.createElement('img');
        thumb.src = getCoverArtUrl(song.coverArt || song.id, 300);
        thumb.alt = `${song.title || 'Track'} cover`;
        thumb.width = 36;
        thumb.height = 36;
        thumb.loading = 'lazy';
        thumb.className = 'w-9 h-9 rounded object-cover bg-zinc-950 border border-zinc-500 shrink-0';
        attachSongOrArtistCoverFallback(thumb, song);

        const textWrap = document.createElement('div');
        textWrap.className = 'min-w-0 flex-1';

        const titleEl = document.createElement('p');
        titleEl.className = `text-xs font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-zinc-100'}`;
        titleEl.textContent = song.title || 'Untitled Track';

        const metaEl = document.createElement('p');
        metaEl.className = 'text-xs text-zinc-300 truncate';
        metaEl.textContent = song.artist || state.selectedArtist?.name || 'Unknown Artist';

        textWrap.appendChild(titleEl);
        textWrap.appendChild(metaEl);

        left.appendChild(posLabel);
        left.appendChild(thumb);
        left.appendChild(textWrap);

        const right = document.createElement('div');
        right.className = 'flex items-center gap-2 shrink-0';

        if (isCurrent) {
            const activeBadge = document.createElement('span');
            activeBadge.className = 'text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-400 text-zinc-950 font-semibold';
            activeBadge.textContent = audio.paused ? 'Paused' : 'Playing';
            right.appendChild(activeBadge);
        } else if (idx > state.queueIndex) {
            const nextTag = document.createElement('span');
            nextTag.className = 'text-xs font-mono text-zinc-300';
            nextTag.textContent = formatTime(song.duration);
            right.appendChild(nextTag);
        } else {
            const playedTag = document.createElement('span');
            playedTag.className = 'text-xs font-mono text-zinc-300';
            playedTag.textContent = 'Played';
            right.appendChild(playedTag);
        }

        rowBtn.appendChild(left);
        rowBtn.appendChild(right);

        rowBtn.addEventListener('click', () => {
            playQueueIndex(idx);
        });

        item.appendChild(rowBtn);
        fragment.appendChild(item);
    });

    dom.queueList.appendChild(fragment);
}

// Populate global queue starting from the clicked song through the end of the album.
function startQueueFromAlbumTrack(albumSongs, startIndex) {
    const sequentialSlice = albumSongs.slice(startIndex);
    if (sequentialSlice.length === 0) {
        return;
    }

    state.unshuffledQueue = [...sequentialSlice];

    if (state.isShuffle && sequentialSlice.length > 1) {
        const firstSong = sequentialSlice[0];
        const remainingShuffled = shuffleArray(sequentialSlice.slice(1));
        state.queue = [firstSong, ...remainingShuffled];
    } else {
        state.queue = [...sequentialSlice];
    }

    playQueueIndex(0);
}

function updateShuffleButtonsUI() {
    const pressedValue = state.isShuffle ? 'true' : 'false';
    dom.playerShuffleBtn.setAttribute('aria-pressed', pressedValue);
}

// Randomize the remaining items in the active playback queue when shuffle is toggled ON.
function applyShuffleToRemainingQueue() {
    if (state.queue.length <= 1 || state.queueIndex < 0) {
        renderQueueDrawer();
        return;
    }

    const lockedPrefix = state.queue.slice(0, state.queueIndex + 1);
    const remainingItems = state.queue.slice(state.queueIndex + 1);

    if (state.isShuffle) {
        state.queue = [...lockedPrefix, ...shuffleArray(remainingItems)];
    } else {
        const lockedIds = new Set(lockedPrefix.map((song) => String(song.id)));
        const restoredUpcoming = state.unshuffledQueue.filter(
            (song) => !lockedIds.has(String(song.id))
        );
        state.queue = [...lockedPrefix, ...restoredUpcoming];
    }

    updateTransportButtonsState();
    renderQueueDrawer();
}

function togglePlayerShuffle() {
    state.isShuffle = !state.isShuffle;
    updateShuffleButtonsUI();
    applyShuffleToRemainingQueue();
}

function handleAlbumPlayClick() {
    if (state.currentSongs.length === 0) {
        return;
    }

    state.isShuffle = false;
    updateShuffleButtonsUI();
    state.unshuffledQueue = [...state.currentSongs];
    state.queue = [...state.currentSongs];
    playQueueIndex(0);
}

function handleAlbumShuffleClick() {
    if (state.currentSongs.length === 0) {
        return;
    }

    state.isShuffle = true;
    updateShuffleButtonsUI();
    state.unshuffledQueue = [...state.currentSongs];
    state.queue = shuffleArray(state.currentSongs);
    playQueueIndex(0);
}

function toggleQueueDrawer(forceOpen) {
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.isQueueOpen;
    state.isQueueOpen = nextOpen;

    dom.queueDrawer.dataset.open = nextOpen ? 'true' : 'false';
    dom.queueDrawer.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    dom.queueDrawer.classList.toggle('translate-x-full', !nextOpen);
    dom.queueDrawer.classList.toggle('translate-x-0', nextOpen);

    dom.queueToggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    dom.queueToggleBtn.setAttribute('aria-pressed', nextOpen ? 'true' : 'false');
}

function syncActiveSongHighlight() {
    const activeSong = state.queue[state.queueIndex];
    const rows = dom.songList.querySelectorAll('.song-row');

    rows.forEach((row) => {
        const isCurrent = Boolean(activeSong && row.dataset.songId === String(activeSong.id));
        row.dataset.active = isCurrent ? 'true' : 'false';

        const badge = row.querySelector('.song-state-badge');
        const title = row.querySelector('.song-title');

        if (badge) {
            badge.classList.toggle('hidden', !isCurrent);
            badge.textContent = audio.paused ? 'Paused' : 'Playing';
        }

        if (title) {
            title.classList.toggle('text-emerald-400', isCurrent);
            title.classList.toggle('text-zinc-100', !isCurrent);
        }
    });

    renderQueueDrawer();
}

function updateTransportButtonsState() {
    const hasActiveSong = state.queueIndex >= 0 && state.queueIndex < state.queue.length;
    dom.playPauseBtn.disabled = !hasActiveSong;
    dom.prevBtn.disabled = !hasActiveSong;
    dom.nextBtn.disabled = !hasActiveSong || state.queueIndex + 1 >= state.queue.length;
    dom.progressContainer.setAttribute('aria-disabled', hasActiveSong ? 'false' : 'true');
}

function updatePlayPauseButtonUI() {
    const isPlaying = !audio.paused && !audio.ended && Boolean(audio.src);
    dom.iconPlay.classList.toggle('hidden', isPlaying);
    dom.iconPause.classList.toggle('hidden', !isPlaying);
    dom.playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    updateTransportButtonsState();
    syncActiveSongHighlight();
}

function playQueueIndex(index) {
    if (index < 0 || index >= state.queue.length) {
        return;
    }

    const song = state.queue[index];
    state.queueIndex = index;

    const coverUrl = getCoverArtUrl(song.coverArt || song.id, 300);
    dom.playerCover.src = coverUrl;
    dom.playerCover.alt = `${song.title || 'Track'} album cover`;
    attachSongOrArtistCoverFallback(dom.playerCover, song);

    dom.playerTitle.textContent = song.title || 'Untitled Track';
    dom.playerArtist.textContent = song.artist || state.selectedArtist?.name || 'Unknown Artist';

    dom.progressBar.style.width = '0%';
    dom.currentTime.textContent = '0:00';
    dom.totalDuration.textContent = formatTime(song.duration || 0);

    audio.src = getStreamUrl(song.id);
    audio.play().catch((error) => {
        showStatus({
            title: 'Playback Error',
            message: `Could not stream "${song.title || 'track'}". Verify Navidrome stream permissions (${error.message}).`,
            showRetry: false
        });
    });

    updatePlayPauseButtonUI();
}

function playNextInQueue() {
    if (state.queueIndex + 1 < state.queue.length) {
        playQueueIndex(state.queueIndex + 1);
    }
}

function playPreviousInQueue() {
    if (audio.currentTime > 3 || state.queueIndex <= 0) {
        audio.currentTime = 0;
        return;
    }
    playQueueIndex(state.queueIndex - 1);
}

function togglePlayPause() {
    if (!audio.src) {
        return;
    }

    if (audio.paused) {
        audio.play().catch((error) => {
            showStatus({
                title: 'Playback Interrupted',
                message: `Unable to resume audio playback (${error.message}).`,
                showRetry: false
            });
        });
    } else {
        audio.pause();
    }
}

function seekToFraction(fraction) {
    const duration = Number.isFinite(audio.duration)
        ? audio.duration
        : state.queue[state.queueIndex]?.duration || 0;

    if (!duration || duration <= 0) {
        return;
    }

    const clamped = Math.max(0, Math.min(1, fraction));
    audio.currentTime = clamped * duration;
}

// Layer 1 Loader: Fetch all artists
async function loadArtistsView() {
    switchView('artists');
    dom.artistGrid.innerHTML = '';
    dom.artistCount.textContent = '';

    showStatus({
        title: 'Loading Artists',
        message: `Requesting artist index from ${SUBSONIC_CONFIG.serverUrl}...`,
        showRetry: false
    });

    try {
        const artists = await getArtists();
        state.artists = artists;

        if (artists.length === 0) {
            dom.connectionBadge.textContent = 'Connected (0 artists)';
            showStatus({
                title: 'Library Is Empty',
                message: 'Navidrome returned no artists. Add audio files to your Navidrome music folder and trigger a library scan.',
                showRetry: true
            });
            return;
        }

        hideStatus();
        dom.connectionBadge.textContent = 'Subsonic Connected';
        renderArtistGrid(artists);
    } catch (error) {
        dom.connectionBadge.textContent = 'Connection Offline';
        showStatus({
            title: 'Cannot Reach Navidrome Server',
            message: `Failed to fetch artists from ${SUBSONIC_CONFIG.serverUrl} (${error.message}). Check SUBSONIC_CONFIG in app.js and verify Navidrome is running.`,
            showRetry: true
        });
    }
}

// Layer 2 Loader: Fetch albums and virtual Singles for a selected artist
async function openArtistAlbumsView(artist) {
    state.selectedArtist = artist;
    switchView('albums');
    dom.albumGrid.innerHTML = '';
    dom.albumsArtistHeading.textContent = artist.name;
    dom.albumCount.textContent = 'Loading releases...';
    dom.albumsArtistCover.src = getCoverArtUrl(artist.coverArt || artist.id, 300);
    attachSongOrArtistCoverFallback(dom.albumsArtistCover, artist);

    showStatus({
        title: `Loading ${artist.name}`,
        message: 'Fetching albums and singles from Navidrome...',
        showRetry: false
    });

    try {
        const albums = await resolveArtistAlbums(artist);
        state.currentAlbums = albums;

        if (albums.length === 0) {
            dom.albumCount.textContent = '0 releases found';
            showStatus({
                title: 'No Albums or Singles Found',
                message: `No albums or loose tracks were returned for ${artist.name}.`,
                showRetry: true
            });
            return;
        }

        hideStatus();
        renderAlbumGrid(artist, albums);
    } catch (error) {
        dom.albumCount.textContent = 'Discography unavailable';
        showStatus({
            title: `Could Not Load ${artist.name}`,
            message: `Error fetching artist albums (${error.message}).`,
            showRetry: true
        });
    }
}

// Layer 3 Loader: Fetch songs inside a selected album or virtual Singles card
async function openAlbumSongsView(album) {
    state.selectedAlbum = album;
    switchView('songs');
    dom.songList.innerHTML = '';
    dom.currentAlbumHeading.textContent = album.name;
    dom.albumDetailSubtitle.textContent = `Layer 3 · ${album.artist || state.selectedArtist?.name || 'Artist'}`;
    dom.songCount.textContent = 'Loading tracklist...';
    attachAlbumCoverWithFallback(dom.albumDetailCover, album);

    showStatus({
        title: `Loading ${album.name}`,
        message: 'Fetching album tracklist...',
        showRetry: false
    });

    try {
        const songs = await resolveAlbumSongs(album);
        state.currentSongs = songs;

        if (songs.length === 0) {
            dom.songCount.textContent = '0 tracks found';
            showStatus({
                title: 'No Songs in Album',
                message: `No playable audio tracks were returned inside ${album.name}.`,
                showRetry: true
            });
            return;
        }

        hideStatus();
        renderSongList(album, songs);
    } catch (error) {
        dom.songCount.textContent = 'Tracklist unavailable';
        showStatus({
            title: `Could Not Load ${album.name}`,
            message: `Error fetching album tracks (${error.message}).`,
            showRetry: true
        });
    }
}

function bindEvents() {
    dom.backButton.addEventListener('click', () => {
        hideStatus();
        if (state.view === 'songs' && state.selectedArtist) {
            switchView('albums');
            if (state.currentAlbums.length === 0) {
                openArtistAlbumsView(state.selectedArtist);
            }
        } else {
            switchView('artists');
            if (state.artists.length === 0) {
                loadArtistsView();
            }
        }
    });

    dom.retryButton.addEventListener('click', () => {
        if (state.view === 'songs' && state.selectedAlbum) {
            openAlbumSongsView(state.selectedAlbum);
        } else if (state.view === 'albums' && state.selectedArtist) {
            openArtistAlbumsView(state.selectedArtist);
        } else {
            loadArtistsView();
        }
    });

    dom.playPauseBtn.addEventListener('click', togglePlayPause);
    dom.nextBtn.addEventListener('click', playNextInQueue);
    dom.prevBtn.addEventListener('click', playPreviousInQueue);
    dom.playerShuffleBtn.addEventListener('click', togglePlayerShuffle);
    dom.albumPlayBtn.addEventListener('click', handleAlbumPlayClick);
    dom.albumShuffleBtn.addEventListener('click', handleAlbumShuffleClick);

    dom.queueToggleBtn.addEventListener('click', () => {
        toggleQueueDrawer();
    });

    dom.queueCloseBtn.addEventListener('click', () => {
        toggleQueueDrawer(false);
        dom.queueToggleBtn.focus();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && state.isQueueOpen) {
            toggleQueueDrawer(false);
            dom.queueToggleBtn.focus();
        }
    });

    dom.progressContainer.addEventListener('click', (event) => {
        if (dom.progressContainer.getAttribute('aria-disabled') === 'true') {
            return;
        }
        const rect = dom.progressContainer.getBoundingClientRect();
        if (rect.width <= 0) {
            return;
        }
        const clickX = event.clientX - rect.left;
        seekToFraction(clickX / rect.width);
    });

    dom.progressContainer.addEventListener('keydown', (event) => {
        if (dom.progressContainer.getAttribute('aria-disabled') === 'true') {
            return;
        }
        const duration = Number.isFinite(audio.duration)
            ? audio.duration
            : state.queue[state.queueIndex]?.duration || 0;

        if (!duration) {
            return;
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            audio.currentTime = Math.min(duration, audio.currentTime + 5);
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            audio.currentTime = Math.max(0, audio.currentTime - 5);
        } else if (event.key === 'Home') {
            event.preventDefault();
            audio.currentTime = 0;
        } else if (event.key === 'End') {
            event.preventDefault();
            audio.currentTime = duration;
        }
    });

    audio.addEventListener('play', updatePlayPauseButtonUI);
    audio.addEventListener('pause', updatePlayPauseButtonUI);

    audio.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
            dom.totalDuration.textContent = formatTime(audio.duration);
        }
    });

    audio.addEventListener('timeupdate', () => {
        const fallbackDuration = state.queue[state.queueIndex]?.duration || 0;
        const duration = Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : fallbackDuration;

        const current = audio.currentTime || 0;
        dom.currentTime.textContent = formatTime(current);

        if (duration > 0) {
            const percent = Math.min(100, Math.max(0, (current / duration) * 100));
            dom.progressBar.style.width = `${percent}%`;
            dom.totalDuration.textContent = formatTime(duration);
            dom.progressContainer.setAttribute('aria-valuenow', String(Math.round(percent)));
            dom.progressContainer.setAttribute(
                'aria-valuetext',
                `${formatTime(current)} of ${formatTime(duration)}`
            );
        }
    });

    // Automatically advance to the next song in the active queue until the end of the list.
    audio.addEventListener('ended', () => {
        if (state.queueIndex + 1 < state.queue.length) {
            playQueueIndex(state.queueIndex + 1);
        } else {
            updatePlayPauseButtonUI();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    dom.playerCover.src = FALLBACK_COVER_SVG;
    renderQueueDrawer();
    bindEvents();
    loadArtistsView();
});
