# Plenrip Audio

A lightweight, zero-framework web player for streaming music from a self-hosted Navidrome instance via the Subsonic API.

## Features

- Apple Music-style collapsible sidebar
- Two-deck gapless audio engine with configurable crossfade
- Multi-provider synchronized lyrics with offset controls
- Full playlist management and 2x2 collage covers
- Slide-out queue drawer with drag-and-drop reordering
- Global keyboard shortcuts

## Setup & Running

Start all services (Navidrome, lyrics relay, file bridge, and frontend):

```bash
# Linux / macOS
./scripts/run.sh

# Windows
./scripts/run-windows.cmd
```

Or run the web client standalone:

```bash
# Node
npm start
# or: npx serve client

# Python
python -m http.server 5500 --directory client
```

Open the local address in your browser, head to Settings, and connect your Navidrome server credentials.

## Keyboard Shortcuts

- `Space`: Play / Pause
- `]` / `N`: Next track
- `[` / `P`: Previous track
- `J` / `L` or `Left` / `Right`: Seek -10s / +10s
- `S`: Toggle shuffle
- `R`: Cycle repeat modes
- `Q`: Toggle queue drawer
- `U`: Toggle Now Playing room & lyrics
- `Cmd+K` / `Ctrl+K` / `/`: Search library
- `?`: Shortcuts cheat sheet
- `Esc`: Close modals / drawer
