# Plenrip Audio

Lightweight, zero-framework personal music streaming web client for a self-hosted **Navidrome** instance over the **Subsonic API (`v1.16.1`)**.

Built with pure **Vanilla JavaScript, HTML5, and CSS** (no React, no TypeScript, no bundler, no `node_modules`). Run the client with any static web server (such as `node serve.js`, `python3 -m http.server 5500`, or VS Code Live Server).

---

## Quick Start

### Option 1: Built-in Node / Bun Static Server
```bash
node serve.js
# or:
bun serve.js
```
Then open `http://localhost:5500/` in your browser.

### Option 2: Python
```bash
python3 -m http.server 5500
```
Then open `http://localhost:5500/` in your browser.

### Option 3: Automated Scripts (Linux / macOS / Windows)
If you run Navidrome locally alongside the player:
- **Windows**:
  ```powershell
  $env:ND_MUSICFOLDER = "D:\Music\Mornye"
  .\run-windows.cmd
  ```
- **macOS / Linux**:
  ```bash
  export ND_MUSICFOLDER="$HOME/Music"
  ./run.sh
  ```

---

## File Structure

```
├── index.html                   # Persistent app shell (Sidebar, View Mount, Queue Drawer, Bottom Transport Bar)
├── style.css                    # Monochrome + Sage theme tokens, Geist font faces, and motion rules
├── engine.js                    # Subsonic API client, Dual-deck Gapless Audio Engine, Multi-provider Lyrics & Translations
├── app.js                       # View loader, router, UI controllers, Honest History, playlists CRUD, keyboard shortcuts
├── serve.js                     # Zero-dependency local static server (Node.js, Bun, Deno)
├── title-translations.json      # Bundled offline title translations cache
├── views/                       # Modular HTML view templates mounted into index.html
│   ├── home.html                # Honest History (Continue Listening, Forgotten Favourite?, Listen Again, Quick Pick) + Made For You
│   ├── now-playing.html         # Dedicated full-view player (Desktop 2-column layout + Mobile layout)
│   ├── search.html              # Dedicated Search bar + grouped Artists, Albums, Songs results
│   ├── artists.html             # Layer 1: Artists grid with live filter
│   ├── artist-detail.html       # Layer 2: Artist hero, albums grid, and virtual "Singles" collection
│   ├── albums.html              # Full albums catalog with sort selector and pagination
│   ├── album-detail.html        # Layer 3: Album / Singles tracklist, separate Play and Shuffle buttons, star button
│   ├── songs.html               # Paginated library songs table with Play All and Shuffle
│   ├── playlists.html           # All Playlists grid (2x2 Canvas collages) + inline playlist creator
│   ├── playlist-detail.html     # Playlist tracklist, inline rename, track removal, and deletion
│   ├── favourites.html          # Starred / Favourite Songs collection
│   ├── discovery-detail.html    # Virtual Discovery mix tracklist + Save as Playlist
│   ├── settings.html            # Audio Sink, Crossfade, ReplayGain, Preamp, Stream Quality, Title Translations, Navidrome credentials
│   └── signature-room.html      # Fullscreen Listening Room, Word-Level Karaoke, Romaji / English toggle, Lyrics Sources modal
└── fonts/                       # Self-hosted Geist Sans, Geist Mono, and Geist Serif variable .woff2 fonts
```

---

## Core Features

1. **Monochrome + Sage Design System**:
   - Near-black `#101010` background with subtle `#2a2a2a` hairline borders, `#161616` panels, and calm `#8ab8a0` sage green accent.
   - Strict `border-radius: 0` aesthetic throughout the interface.
   - Self-hosted Geist Sans, Geist Mono, and Geist Serif typography.

2. **Album Detail Play & Shuffle Buttons**:
   - Album detail header features independent, dedicated **PLAY** (normal playback in track order) and **SHUFFLE** buttons side-by-side.

3. **Multi-Provider Lyrics & Word-Level Karaoke**:
   - 7 built-in browser-direct lyric providers: `LRCLIB`, `NetEase`, `KuGou`, `QQ Music`, `Unison`, `LrcRed`, and `LyricsPlus`.
   - Word-level sync karaoke animation with progressive character gradient fills.
   - Built-in Hepburn kana-to-romaji converter + English lyric translations for Japanese tracks.
   - Per-track timing offset adjustment (`-0.2s`, `+0.2s`, `[RESET]`).
   - "Lyrics Sources" modal allowing manual provider switching and custom LRCLIB title/artist search.

4. **In-Browser Title Translations**:
   - Automatic non-Latin / Japanese / Chinese track title translation with bundled offline cache (`title-translations.json`), iTunes / Deezer resolver, and Google Translate fallback.
   - Rendered inline beside native titles in emerald font (`- {translated}`).

5. **Two-Deck Gapless Audio Engine**:
   - Dual `HTMLAudioElement` architecture (`deckA` and `deckB`) preloading the next track in the idle deck for zero-stall transitions.
   - Equal-power crossfade (configurable from `0s` up to `12s` in Settings; intelligently suppressed on consecutive tracks from the same album).
   - ReplayGain normalization with configurable Preamp (`-12 dB` to `+12 dB`).
   - Audio sink routing (headphones/speakers selection via `setSinkId`).
   - Balanced shuffle, repeat modes (`off`, `all`, `one`), and OS `navigator.mediaSession` integration.

6. **Honest History & Discovery Mixes**:
   - 4 Honest History sections on Home: `Continue Listening` (tracks in progress with progress bar), `Forgotten Favourite?` (songs starred but unplayed in 30+ days), `Listen Again` (frequently played songs), and `Quick Pick` (deterministic daily recommendation).
   - 5 Discovery mixes: `Daylist`, `Discover Weekly`, `Release Radar`, `Daily Mix`, and `On This Day`.

7. **Collapsible Queue Drawer & Playlist Management**:
   - Slide-out right queue drawer (`Q` key) with HTML5 drag-and-drop reordering, Up/Down buttons, track removal, and **Save Queue as Playlist**.
   - Playlist creation, renaming, track removal, and deletion.

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
| `U` | Toggle Fullscreen Listening Room (Lyrics) |
| `⌘K` / `Ctrl+K` / `/` | Open Search |
| `?` | Keyboard Shortcuts Cheat Sheet |
| `Esc` | Close active modal or drawer |
