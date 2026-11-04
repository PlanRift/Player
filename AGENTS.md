# AGENTS.md: Plenrip Audio Coding Agent Instructions

This document is the absolute source of truth and operating handbook for any AI coding agent working on this repository (PlanRift/Player, branded as "Plenrip Audio"). Read this file entirely before inspecting or modifying code.

---

## 1. Project Context and Monorepo Structure

Plenrip Audio is a lightweight, responsive personal music streaming web client designed to stream directly from a self-hosted Navidrome instance over the Subsonic API.

The project is structured as a Bun/npm monorepo managed with Turbo:

```
├── apps/
│   └── web/                 # Primary frontend (React 19, Vite, Tailwind CSS v4)
├── packages/
│   ├── shared/              # Subsonic client, API types, lyrics engine, Last.fm scrobbler
│   └── ui/                  # Design tokens (tokens.css) and self-hosted Geist fonts
├── package.json             # Root workspace manifest
├── turbo.json               # Turbo pipeline definitions (typecheck, test, dev, build)
└── AGENTS.md                # This instructions file
```

### Package Roles
- `apps/web`: React 19 single-page application. Handles views, routing, Zustand state stores, audio player components, and keyboard shortcuts.
- `packages/shared`: Pure TypeScript domain logic. Houses SubsonicClient (`client.ts`), MD5 salt+token authentication (`auth.ts`), multi-provider lyrics scrapers (`lyrics/`), Last.fm scrobble client (`lastfm/`), and shared TypeScript schemas (`types.ts`).
- `packages/ui`: Design tokens in `tokens.css` exposing Tailwind CSS v4 variables, studio panel motifs, and Geist font family declarations.

---

## 2. Locked Architecture (Do Not Relitigate)

1. **Workspaces**: Managed via Bun / npm workspaces and Turbo. Do not switch package managers or dissolve the monorepo.
2. **Direct Client-Side Auth (No Server Proxy)**:
   - The web app authenticates directly from the browser against the Subsonic API (`rest/*.view`) using MD5 salt + token (`u`, `t`, `s`, `v=1.16.1`, `f=json`).
   - Static hosting only (Cloudflare Pages, NAS local web server, Caddy, Nginx). No Node/Bun server proxy is needed or permitted in production.
3. **Library Scope**:
   - Queries the entire Navidrome library. Do not artificially pin `musicFolderId` to a specific folder.
4. **Single-User Architecture**:
   - Built specifically for the repository owner. There are no multi-user databases, user management tables, or profile-switching layers.

---

## 3. UI and Design System Rules

### Color Palette (Strict: Recolor Forbidden)
The owner's zinc and emerald palette is strictly locked. Do not introduce indigo, blue, purple, or arbitrary tints:

| Token / Role | Hex Value | Description |
|---|---|---|
| Background | `#0e0e11` | Deep studio matte black, lifted slightly off pure `#000000` |
| Surface / Panels | `#18181b` | Zinc-900 studio card and panel surfaces |
| Secondary / Muted | `#27272a` | Zinc-800 button backgrounds, hover states, queue active rows |
| Hairline Borders | `#3f3f46` | Zinc-700 crisp 1px borders on cards and dividers |
| Emphasis Borders | `#71717a` | Zinc-500 borders for active controls, badges, and buttons |
| Primary Accent | `#34d399` | Emerald-400 for active playback toggles, slider tracks, focus rings |
| Primary Text | `#f4f4f5` | Zinc-100 high-contrast readable headings and active titles |
| Muted Text | `#a1a1aa` | Zinc-400 secondary metadata, artists, durations (passes WCAG AA 4.5:1) |
| Destructive | `#f87171` | Red-400 for unstar, disconnect, and queue removal |

### Typography
- **Geist Sans**: Main UI labels, body text, buttons, and navigation.
- **Geist Mono**: Technical metadata, timestamps (`3:42`), durations, and series badges.
- **Geist Serif**: Display title in fullscreen Signature View ("Now Playing Room") only.
- Fonts are self-hosted via `packages/ui/src/fonts.css`. Never load fonts from Google Fonts CDN at runtime.

### UI Library Constraint
- Use Tailwind CSS v4 utility classes only.
- **shadcn/ui, Radix UI, Headless UI, Material UI, or other component libraries are strictly forbidden.** Write native, lightweight, accessible semantic HTML.

### Icons
- Use `lucide-react` exclusively for all application icons.
- Never install secondary icon sets (Heroicons, FontAwesome, etc.).
- Never use decorative emoji in UI components, headings, or code comments.

### Branding
- The official product title is **Plenrip Audio** (repo PlanRift/Player).

### Accessibility and Human Standards
- Full keyboard operability: all buttons, rows, and cards must be focusable with visible `:focus-visible` styling (`outline: 2px solid #34d399`).
- Modal views and drawers must close cleanly on `Escape`.
- Contrast: every text pairing must pass WCAG AA (4.5:1 for normal text against its immediate background).

### Data Honesty (Strict)
- Never invent listening stats, play counts, fake testimonials, or placeholder graphs.
- Never add dead navigation links. If a destination is not yet implemented, do not render a button for it.

---

## 4. Navigation Architecture

The app uses an Apple Music-style grouped sidebar layout. TopBar search bars and duplicate header back buttons have been permanently removed.

### Sidebar Sections:
1. **Top Actions**:
   - `Search` (Dedicated `/search` view, activated by clicking or pressing `⌘K` / `Ctrl+K` / `/`).
   - `Home` (`/home`, Recently Added album grid + Discovery virtual playlists).
2. **LIBRARY**:
   - `Artists` (`/artists`, artist index with album counts).
   - `Albums` (`/albums`, full album grid with covers).
   - `Songs` (`/songs`, full songs list with pagination).
3. **PLAYLISTS**:
   - `All Playlists` (`/playlists`, custom playlists with 2x2 collage covers).
   - `Favourite Songs` (`/favourite-songs`, starred tracks from `getStarred2.view`).
   - User-created playlists list with quick `+ NEW` creation button.

### Sidebar States:
- Collapsible between Expanded (icon + label) and Collapsed (icon only with tooltip).
- State persisted in `localStorage` under `planrift.sidebar.collapsed`.

---

## 5. Audio Engine and Lyrics Architecture

### Two-Deck Gapless Audio Engine (`audioEngine.ts`)
- Utilizes two HTMLAudioElements (`deckA` and `deckB`).
- **Next-Track Preloading**: While track N is playing on the active deck, track N+1 is loaded in the idle deck (`preload="metadata"`).
- **Transitions**: When track N reaches `'ended'` or enters the crossfade window, playback shifts seamlessly to the idle deck with zero buffer stalls.
- **Crossfade**: Linear volume ramp between 0s and 12s, configurable in Settings (`STORAGE_CROSSFADE`). Default is 0s (gapless cut).
- **Seeking Protection**: Position seeking is guarded with `isSeeking` and clamped to `safeMax = duration - 0.5s` to prevent premature end-of-track triggers and zero-time resets.
- **Repeat Modes**:
  - `off`: Natural progression through queue, stops at end.
  - `all`: Loops queue indefinitely.
  - `one`: Replays on the same active deck without deck swapping.

### Multi-Provider Lyrics Architecture (`packages/shared/src/lyrics/`)
- Unified `LyricsProvider` interface: `{ id, name, bestKind, fetch(req) }`.
- **Primary Provider**: `lrclib` (browser-direct API, returns synced LRC or plain text).
- **Secondary Providers**: `netease`, `qq`, `kugou`, `lyricsplus`, `unison`.
  - Non-LRCLIB providers are expected to fail CORS in browser environments. Wrap calls in try/catch and report status as `unreachable`. Do NOT burn time trying to debug or proxy them.
  - Baidu (no public API key) and YouTube Music (requires innertube engine) are intentionally excluded.
- **Resolver**: "Otomatis" priority order configurable in Settings; per-track source override persisted in `localStorage` (`planrift.lyrics.provider.<trackId>`); manual search dialog fallback.

---

## 6. Developer Workflow and Quality Gates

### Git Rules:
1. **NEVER push or commit directly to `main`**.
2. Work exclusively on feature branches or `monorepo-migration`.
3. Open clean pull requests against `main`. **Only the repository owner may review and merge PRs.** Never merge your own pull request.

### Gate Requirements:
Before claiming any task or feature as complete, execute and pass:
1. **Typecheck**: `bun run typecheck` must pass across all packages with **0 errors**.
2. **Unit Tests**: `bun test apps/web packages/shared` must pass **100% of tests**.
3. **Live Verification**: Verify observable behavior against the real Navidrome server instance.
4. **Build Rule**: Do not run `bun run build` during daily rapid iteration unless creating a production distribution archive.

---

## 7. Strict "Don't" List

- **Do NOT recolor**: The zinc/emerald theme is final. No blue/purple AI gradients, no cyan accents.
- **Do NOT install UI component libraries**: No shadcn, Radix, Chakra, or DaisyUI.
- **Do NOT install new icon sets**: Use `lucide-react` exclusively.
- **Do NOT fabricate data**: Never create mock listening statistics, fake play counts, or fake reviews.
- **Do NOT touch `main`**: All work lives on `monorepo-migration` or designated feature branches.
- **Do NOT try to "fix" CORS on lyrics**: Third-party Chinese lyric services block browser origins; "unreachable" is an expected and accepted status.
