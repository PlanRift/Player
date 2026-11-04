# Plenrip Audio

A lightweight, modern web music player and NAS companion streaming directly from [Navidrome](https://www.navidrome.org/) via the Subsonic API. Built with React 19, TypeScript, Tailwind CSS v4, and Bun workspaces.

---

## Features

- **Direct Subsonic Streaming**: Connects directly from the browser to your self-hosted Navidrome instance with MD5 salt + token authentication. Static hosting friendly.
- **Two-Deck Gapless Audio Engine**: Preloads the upcoming queue track on an idle deck for uninterrupted playback, configurable crossfade ramps, and repeat modes.
- **Dynamic Discovery Virtual Playlists**:
  - **Daylist**: Adapts 4x daily based on time-window listening habits.
  - **Discover Weekly**: 30 library tracks with zero plays, refreshed weekly.
  - **Release Radar**: Recent library additions from your favorite artists.
  - **Daily Mixes & On This Day**: Artist clusters and historical calendar plays.
  - Instant playback and one-click "Save as Playlist" support.
- **Multi-Provider Synced Lyrics**: Live auto-scrolling lyrics powered by LRCLIB, NetEase, QQ, Kugou, LyricsPlus, and Unison with offset nudge buttons (±0.2s) and manual search modal.
- **Full Playlist Management**: Complete CRUD operations synchronized to your Navidrome server, with client-side 2x2 cover collages.
- **Dedicated Search View**: Instant debounced search for artists, albums, and tracks with keyboard navigation (`⌘K` / `Ctrl+K` / `/`).
- **Signature Room View**: Immersive fullscreen now-playing experience with Geist Serif display typography.
- **Last.fm Scrobbler**: Direct API key and secret configuration in Settings, tracking scrobbles at 50% or 240 seconds.
- **Studio Matte Aesthetic**: Owner's zinc and emerald palette with accessible WCAG AA contrast and full keyboard navigation.

---

## Prerequisites

- [Bun](https://bun.sh/) (v1.1+ recommended).
- A running [Navidrome](https://www.navidrome.org/) instance on your home server or NAS (accessible over your local network or via a domain / Cloudflare Tunnel).

---

## Getting Started

### 1. Configure Server Credentials

Set your Navidrome NAS endpoint and credentials in `apps/web/.env`:

```bash
cp apps/web/.env.example apps/web/.env
```

Open `apps/web/.env` and update the values:

```env
# Point this to your NAS IP or custom domain:
VITE_NAVIDROME_URL=https://music.yourdomain.com
VITE_NAVIDROME_USER=your-navidrome-username
VITE_NAVIDROME_PASSWORD=your-navidrome-password
```

### 2. Install Dependencies

Install workspace dependencies from the project root:

```bash
bun install
```

### 3. Run Development Server

Start the application with hot module reloading:

```bash
bun run dev
```

Open [http://localhost:5173/](http://localhost:5173/) in your web browser.

---

## Production Build and Static Hosting

Because Plenrip Audio uses direct client-side authentication, you can host the compiled static files anywhere (Cloudflare Pages, Vercel, Nginx, Caddy, or a static web folder on your NAS):

```bash
bun run build
```

The production output will be generated in `apps/web/dist/`. Simply serve the contents of this folder with any static web server.

---

## Monorepo Layout

- `apps/web`: React 19 single-page application built with Vite and Tailwind CSS v4.
- `packages/shared`: Subsonic client, authentication utilities, multi-provider lyrics scrapers, and Last.fm scrobbler.
- `packages/ui`: Design tokens (`tokens.css`), studio panel motifs, and self-hosted Geist fonts.

---

## Keyboard Shortcuts

- `Space`: Toggle play / pause
- `j` / `k`: Next track / Previous track
- `l` / `h`: Seek forward 10s / Seek backward 10s
- `[` / `]`: Nudge lyrics offset -0.2s / +0.2s
- `s`: Toggle shuffle mode
- `q`: Toggle queue drawer
- `r`: Open Signature Room ("Now Playing")
- `⌘K` / `Ctrl+K` / `/`: Open search view
- `?`: Toggle keyboard shortcuts cheat sheet
- `Esc`: Close modals, drawers, or return to Home
