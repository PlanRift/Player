# Plenrip Audio

A custom, lightweight, self-hosted web music player and NAS companion designed to stream directly from a local home server running Navidrome, paired with a clean Tailwind CSS frontend.

---

## Architecture & Stack

* **Backend & Indexer:** [Navidrome](https://www.navidrome.org/) (Runs 24/7 on the home server/NAS, indexing the 3TB HDD and serving the Subsonic API).


* **File Management:** [Filebrowser](https://filebrowser.org/) (Lightweight web UI for managing files on the NAS, protected by Cloudflare Zero Trust PIN).


* **Networking:** Cloudflare Tunnels (Safely routes custom subdomains like `music.planrift.me` and `nas.planrift.me` without exposing local home IPs).


* **Frontend:** Vanilla JavaScript, Tailwind CSS (via CDN), and CryptoJS for Subsonic API authentication, built to easily integrate GSAP animations.

---

## Getting Started

1. **Clone the repository:**
`git clone [https://github.com/your-username/plenrip-audio.git](https://github.com/your-username/plenrip-audio.git)`
2. **Configure Navidrome:**
* Download the official Navidrome binary for your server OS.
* Point your Navidrome config to your local music directory.


3. **Run the Frontend:**
* Open the project folder in VS Code.
* Use the **Live Server** extension to launch `apps/web/index.html` locally, or run `npm run dev` from the repository root.
* Update your server credentials and endpoints in `apps/web/app.js`.



---

## Development Roadmap & Feature Checklist

Here is the active feature checklist and upcoming updates we are coding for the custom web frontend:

* [ ] **Search Feature:** Implement a fast frontend search bar querying Navidrome's search APIs for artists, albums, and tracks.
* [ ] **Synced Lyrics:** Pull and display synchronized lyrics for playing tracks.
* [ ] **Personal Playlists:** Support creating, managing, and syncing custom playlists back to the server.
* [ ] **Song Options Menu (3-Dots):** Add a dropdown menu to individual tracks offering quick actions (Play Next, Add to Playlist, etc.).
* [ ] **Queue Management:** Fully functional drag-and-drop or click-to-reorder queue drawer with "Play Next" and "Remove from Queue" capabilities.