# Plenrip Audio

Lightweight, zero-framework personal music streaming web client for a self-hosted **Navidrome** instance over the **Subsonic API (`v1.16.1`)**.

Built with pure **Vanilla JavaScript, HTML5, and CSS** (no React, no TypeScript, no build pipeline, no `node_modules`). Serve the root folder with any static web server (such as VS Code Live Server or `python -m http.server 8080`).

---

## File Structure

```
├── index.html                   # Persistent app shell (Sidebar, View Mount, Queue Drawer, Bottom Transport Bar)
├── style.css                    # Self-hosted Geist font faces, zinc/emerald theme tokens, and motion rules
├── engine.js                    # Subsonic API client, Two-Deck Gapless Audio Engine, Lyrics, Discovery, Last.fm
├── app.js                       # View loader, router, UI controllers, playlists CRUD, keyboard shortcuts
├── views/                       # Modular HTML view templates mounted into index.html
│   ├── home.html                # Made For You (Discovery mixes) + Recently Added albums
│   ├── search.html              # Dedicated Search bar + grouped Artists, Albums, Songs results
│   ├── artists.html             # Layer 1: Artists grid with live filter
│   ├── artist-detail.html       # Layer 2: Artist hero, albums grid, and virtual "Singles" collection
│   ├── albums.html              # Full albums catalog with sort selector and pagination
│   ├── album-detail.html        # Layer 3: Album / Singles tracklist, cover art, and star button
│   ├── songs.html               # Paginated library songs table with Play All and Shuffle
│   ├── playlists.html           # All Playlists grid (2x2 Canvas collages) + inline playlist creator
│   ├── playlist-detail.html     # Playlist tracklist, inline rename, track removal, and deletion
│   ├── favourites.html          # Starred / Favourite Songs collection
│   ├── discovery-detail.html    # Virtual Discovery mix tracklist + Save as Playlist
│   ├── settings.html            # Navidrome credentials, Crossfade slider, Lyrics priority, Last.fm
│   └── signature-room.html      # Fullscreen Now Playing Room, Synced Lyrics, and Sumber Lirik modal
└── fonts/                       # Self-hosted Geist Sans, Geist Mono, and Geist Serif variable .woff2 fonts
```

---

## Core Features

1. **Apple Music-Style Collapsible Sidebar**:
   - **Top Actions**: `Search` (`⌘K` / `Ctrl+K` / `/`) and `Home`.
   - **Library**: `Artists` (3-layer drilldown: Artists -> Artist Albums + virtual **Singles** collection -> Tracklist), `Albums` (with sort modes and pagination), and `Songs`.
   - **Playlists**: `All Playlists` (with client-side 2x2 HTML5 Canvas cover collages), `Favourite Songs` (`getStarred2.view`), and custom playlists with inline creation, renaming, track removal, and deletion.
2. **Two-Deck Gapless Audio Engine**:
   - Dual `HTMLAudioElement` architecture (`deckA` and `deckB`) preloading the next track in the idle deck for zero-stall transitions.
   - Configurable linear crossfade (`0s` gapless cut up to `12s` smooth crossfade) in Settings.
   - Shuffle, Repeat (`off`, `all`, `one`), Volume mute memory, seek boundary protection, and OS `navigator.mediaSession` hardware key integration.
   - Automatic stream binary JPEG/PNG cover art extractor fallback when `getCoverArt.view` is missing on loose audio files.
3. **Now Playing Room (Signature View) & Multi-Provider Synced Lyrics**:
   - Fullscreen dark room (`U` key) with high-res artwork, Geist Serif display title, and interactive auto-scrolling LRC lyrics (click any line to seek).
   - Per-track timing offset nudge (`-0.2s`, `+0.2s`, `[RESET]`).
   - Multi-provider lyrics resolver (`LRCLIB` primary browser-direct API + `NetEase`, `QQ Music`, `KuGou`, `LyricsPlus`, and `Unison`) with configurable priority order, per-track provider override (`Sumber Lirik`), and manual LRCLIB search fallback.
4. **Discovery Mixes & Generative Canvas Artwork**:
   - Local listening history tracker (`planrift.history.v1`, recorded after 30s of playback) powering 5 virtual mixes on Home: `Daylist`, `Discover Weekly`, `Release Radar`, `Daily Mix`, and `On This Day`.
   - Procedural HTML5 Canvas geometric covers (`eclipse`, `rings`, `radar`, `grid`, `vinyl`) and one-click **Save as Playlist**.
5. **Collapsible Queue Drawer & 3-Dot Track Context Menu**:
   - Slide-out right queue drawer (`Q` key) with HTML5 drag-and-drop reordering, Up/Down buttons, track removal, and **Save Queue as Playlist**.
   - 3-dot context menu on every track row (`Play Next`, `Add to Queue`, `Star/Unstar`, `Add to Playlist`, `Go to Album`, `Go to Artist`).
6. **Last.fm Scrobbling**:
   - Built-in Last.fm OAuth session exchange, `track.updateNowPlaying`, and automatic scrobbling at 50% duration (or 240s).

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / Pause |
| `]` or `N` | Next track |
| `[` or `P` | Previous track |
| `J` / `L` or `←` / `→` | Seek -10s / +10s |
| `S` | Toggle Shuffle |
| `R` | Cycle Repeat (`off` -> `all` -> `one`) |
| `Q` | Toggle Queue Drawer |
| `U` | Toggle Now Playing Room (Lyrics) |
| `⌘K` / `Ctrl+K` / `/` | Open Search |
| `?` | Keyboard Shortcuts Cheat Sheet |
| `Esc` | Close active modal or drawer |
