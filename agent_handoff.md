# Agent Handoff: Plenrip Audio

Current-state technical handoff for the next coding agent working on PlanRift/Player.

---

## 1. Project and Repository Overview

- **Repository**: PlanRift/Player ("Plenrip Audio")
- **Active Branch**: `monorepo-migration`
- **Monorepo Structure**:
  - `apps/web`: React 19, Vite, Tailwind CSS v4, Zustand stores.
  - `packages/shared`: SubsonicClient, lyrics providers, Last.fm scrobbler, TypeScript interfaces.
  - `packages/ui`: Token definitions (`tokens.css`), Geist web fonts.
- **Package Manager**: Bun 1.x workspaces with Turbo pipeline.

---

## 2. Feature Implementation Status (Phases A through E)

### Phase A: Monorepo Foundation and Parity Port (Status: COMPLETE)
- Monorepo scaffolded with clean TypeScript configurations and Turbo pipelines.
- Ported all original vanilla JS views to React 19:
  - Artists view with live album/song counts (`getArtists.view`).
  - Albums view with cover art grid (`getAlbumList2.view`).
  - Album Detail view with tracklist, duration formatting, quick play, and shuffle actions.
  - BottomPlayerBar with seekable timeline, volume, shuffle, and repeat modes.
  - QueueDrawer with track jumping, active index highlight, and empty state.
  - CoverImage fallback chain: cache $\to$ coverArt API $\to$ embedded picture extractor $\to$ inline SVG placeholder.
  - Connection error card and status indicator with retry functionality.
- Collapsible Apple Music-style sidebar with state stored in `localStorage` (`planrift.sidebar.collapsed`).
- Recently Added albums section on Home view (`getAlbumList2?type=newest`).

### Phase B: Playlists and Signature View (Status: COMPLETE)
- Full playlist CRUD write-through to Navidrome server:
  - `createPlaylist.view`, `updatePlaylist.view`, `deletePlaylist.view`.
  - Changes immediately update the server and reload state.
- Dynamic 2x2 cover collage generated client-side via HTML5 canvas with zero external dependencies.
- Playlist Detail view with "PLAY ALL" and "ENQUEUE ALL" actions.
- Fullscreen Signature View ("Now Playing Room") with Geist Serif typography, cover art, and transport controls.

### Phase C: Roadmap Ports and Navigation Restructure (Status: COMPLETE)
- **C.1 Multi-Provider Synced Lyrics**:
  - Provider interface: `LyricsProvider` in `packages/shared/src/lyrics/`.
  - Implemented providers: LRCLIB (primary browser-direct), NetEase, QQ, Kugou, LyricsPlus, Unison.
  - CORS errors on non-LRCLIB providers are safely caught and reported as "unreachable".
  - Baidu and YouTube Music intentionally skipped per spec.
  - "Otomatis" priority order configurable in Settings; per-track source override in `localStorage` (`planrift.lyrics.provider.<trackId>`).
  - Manual lyrics search modal with track/artist fields querying LRCLIB.
  - Offset nudge buttons (±0.2s) with keyboard shortcuts `[` and `]`.
- **C.2 Dedicated Search View**:
  - Dedicated `/search` view (replacing earlier dropdown and modal concepts).
  - Shortcut `⌘K` / `Ctrl+K` / `/` navigates to search with input autofocus.
  - 250ms debounced queries against `search3.view`.
  - Results grouped inline: Artists, Albums, and Tracks with full keyboard arrow and Enter navigation.
- **C.3 Track Context Menu (3-Dots)**:
  - Options: Star/Unstar, Play Next, Add to Queue, Add to Playlist (with dynamic submenu), Remove from Queue (visible in queue context).
- **C.4 Queue Reorder and Remove**:
  - HTML5 drag-and-drop reordering with drag indicator.
  - Fallback up/down arrow buttons on each row for keyboard and mouse accessibility.
  - Remove button per row.
- **C.5 Keyboard Shortcuts and Cheat Sheet**:
  - Global key listeners: Space (play/pause), j (next), k (prev), l (+10s), h (-10s), s (shuffle), q (queue), r (signature room), ? (cheat sheet).
  - Clean cheat sheet overlay showing all keyboard shortcuts.
- **C.6 MediaSession Integration**:
  - Native OS media controls, lock screen metadata, artwork, and action handlers (`play`, `pause`, `previoustrack`, `nexttrack`, `seekto`).
- **C.7 Star / Like Feature**:
  - Calls `star.view` and `unstar.view` on the Navidrome server.
  - Star states reflect live on track rows, album headers, and sidebar "Favourite Songs".
- **C.8 Navigation and Layout Restructure**:
  - Apple Music grouped sidebar: Search, Home, LIBRARY (Artists, Albums, Songs), PLAYLISTS (All Playlists, Favourite Songs, custom playlists with `+ NEW`).
  - Songs View (`/songs`): full library song list with client-side pagination.
  - Removed topbar connection badge, duplicate back buttons, and divider lines.

### Phase D: Listening History and Discovery Engine (Status: COMPLETE)
- **D.1 HistoryStore**:
  - Tracks every play passing 30 seconds or reaching track end.
  - Persisted in `localStorage` under `planrift.history.v1` with a 10,000 item FIFO cap.
  - Automatic `PlaybackTracker` listens to audio engine progress.
- **D.2 Discovery Engine**:
  - Virtual playlists generated dynamically on Home: Daylist (4x daily time windows), Discover Weekly (30 unplayed library tracks), Release Radar (recent additions from top artists), Daily Mixes, and On This Day.
  - Strict data integrity: cards without sufficient history render without play buttons. No fake plays are ever invented.
- **D.3 Generative Canvas Art**:
  - Implemented in `GenerativeThumbnail.tsx`.
  - High-precision studio monochrome matte background (`#09090b` to `#16161a`) with fine corner crop marks and restrained emerald-400 (`#34d399`) focal accents.

### Phase E: Two-Deck Gapless, Last.fm, Openable Discovery Cards (Status: COMPLETE)
- **E.1 Two-Deck Gapless Engine (`audioEngine.ts`)**:
  - Two HTMLAudioElements (`deckA`/`deckB`).
  - Automatic next-track preloading on the idle deck.
  - Crossfade volume ramps (0s to 12s, default 0s gapless cut).
  - Single engine-level volume control.
  - Seek boundary clamping (`safeMax = duration - 0.5s`) and `isSeeking` guard to prevent premature end-of-track triggers and zero-time resets.
- **E.2 Last.fm Scrobbler (`lastFmStore.ts` & `scrobbleTracker.ts`)**:
  - Direct credentials configuration in Settings view (persisted in `localStorage`).
  - Standard Last.fm scrobble threshold: 50% or 240 seconds for tracks $\ge$ 30s.
  - MD5 signature generation and session authentication (`auth.getSession`).
- **Discovery Cards Detail View (`DiscoveryDetailView.tsx`)**:
  - Discovery cards are fully interactive and open a detail view displaying tracklist, metadata, PLAY ALL, and "Save as Playlist" via `createPlaylist`.

### Parked and Out-of-Scope Items
- **Frontend Profiles**: PARKED (single-user application).
- **Light/Dark Theme Switcher**: PARKED (owner's dark zinc/emerald palette is locked).
- **Bun Server Proxy**: PARKED / REJECTED (direct client-side Subsonic API auth was locked in Phase A).

---

## 3. Locked Decisions (Do Not Relitigate)

1. **Direct Subsonic Authentication**: Do not create or deploy a server-side proxy. Static hosting on NAS/Cloudflare is required.
2. **Component Libraries**: Do not install shadcn/ui or other UI frameworks. Use Tailwind CSS v4 utilities only.
3. **Color Palette**: Do not modify the `#0e0e11` background or `#34d399` emerald accent.
4. **Icons**: Use `lucide-react` only.
5. **No Data Fabrication**: Never create mock data, dummy stats, or fake listening history.
6. **No `bun build` in Dev Loops**: Use `bun run typecheck` and `bun test` for verification.

---

## 4. Working Agreements and Quality Gates

- **Git Branch**: All work must be conducted on `monorepo-migration` or designated feature branches. Never push to `main`.
- **Verification Gates**:
  - `bun run typecheck` must pass with 0 errors.
  - `bun test apps/web packages/shared` must pass completely.
  - Observable changes must be verified against the real Navidrome server.
- **Visual Checks**: Visual confirmation of UI and contrast beats theoretical assumption.
