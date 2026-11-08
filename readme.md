# Plenrip Audio

A lightweight, zero-framework web player for streaming music from a self-hosted Navidrome instance via the Subsonic API.

The project is finished and fully functional.

## Features

- Apple Music-style collapsible sidebar
- Two-deck gapless audio engine with configurable crossfade
- Multi-provider synchronized lyrics with offset controls
- Full playlist management and 2x2 collage covers
- Slide-out queue drawer with drag-and-drop reordering
- Global keyboard shortcuts

## Setup & Running

Serve the directory using any static web server:

```bash
# Python
python -m http.server 8080

# Node (http-server / npx serve)
npx serve .
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
