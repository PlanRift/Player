// The secret ships in client JS, which is acceptable for this single-user self-hosted app, NOT for a public multi-user service.

import { sign } from './sign';
import type { SubsonicSong } from '../types';

export interface LastFmSession {
  name: string;
  key: string;
  subscriber: number;
}

export class LastFmClient {
  private baseUrl = 'https://ws.audioscrobbler.com/2.0/';

  /**
   * Generates the Last.fm authentication redirect URL.
   */
  public getAuthUrl(apiKey: string, callbackUrl: string): string {
    return `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&cb=${encodeURIComponent(callbackUrl)}`;
  }

  /**
   * Exchanges an authorization token for a persistent session key and username.
   */
  public async getSession(
    token: string,
    apiKey: string,
    apiSecret: string
  ): Promise<LastFmSession> {
    const params: Record<string, string> = {
      api_key: apiKey,
      method: 'auth.getSession',
      token,
    };
    const api_sig = sign(params, apiSecret);

    const url = new URL(this.baseUrl);
    url.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    url.searchParams.set('api_sig', api_sig);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.message || `Last.fm auth failed (${data.error || res.status})`);
    }

    return {
      name: data.session.name,
      key: data.session.key,
      subscriber: Number(data.session.subscriber || 0),
    };
  }

  /**
   * Notifies Last.fm that a track has started playing (Now Playing).
   */
  public async updateNowPlaying(
    song: SubsonicSong,
    sessionKey: string,
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    if (!song.title || !song.artist) return;

    const params: Record<string, string> = {
      api_key: apiKey,
      artist: song.artist,
      method: 'track.updateNowPlaying',
      sk: sessionKey,
      track: song.title,
    };

    if (song.album) {
      params.album = song.album;
    }
    if (song.duration) {
      params.duration = String(Math.round(song.duration));
    }

    const api_sig = sign(params, apiSecret);

    const body = new URLSearchParams();
    body.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      body.set(k, v);
    }
    body.set('api_sig', api_sig);

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('Last.fm updateNowPlaying error:', data);
    }
  }

  /**
   * Scrobbles a track to Last.fm once threshold is reached.
   */
  public async scrobble(
    song: SubsonicSong,
    timestampSeconds: number,
    sessionKey: string,
    apiKey: string,
    apiSecret: string
  ): Promise<void> {
    if (!song.title || !song.artist) return;

    const params: Record<string, string> = {
      api_key: apiKey,
      artist: song.artist,
      method: 'track.scrobble',
      sk: sessionKey,
      timestamp: String(timestampSeconds),
      track: song.title,
    };

    if (song.album) {
      params.album = song.album;
    }
    if (song.duration) {
      params.duration = String(Math.round(song.duration));
    }

    const api_sig = sign(params, apiSecret);

    const body = new URLSearchParams();
    body.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      body.set(k, v);
    }
    body.set('api_sig', api_sig);

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.warn('Last.fm scrobble error:', data);
    }
  }
}

export const lastFmClient = new LastFmClient();
