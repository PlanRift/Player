import { createSubsonicAuthParams } from './auth';

declare const process: { env?: Record<string, string | undefined> } | undefined;

import type {
  SubsonicAlbum,
  SubsonicAlbumList2Response,
  SubsonicAlbumResponse,
  SubsonicArtist,
  SubsonicArtistResponse,
  SubsonicArtistsResponse,
  SubsonicDirectoryResponse,
  SubsonicMusicFoldersResponse,
  SubsonicPlaylist,
  SubsonicPlaylistResponse,
  SubsonicPlaylistsResponse,
  SubsonicRootResponse,
  SubsonicSearch3Response,
  SubsonicSearchResult3,
  SubsonicSong,
  SubsonicStarred2Response,
} from './types';

export interface SubsonicClientConfig {
  serverUrl: string;
  username: string;
  password: string;
  clientName?: string;
  musicFolderId?: string; // Optional folder pin for testing
}

export class SubsonicApiError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(`Subsonic error [${code}]: ${message}`);
    this.name = 'SubsonicApiError';
  }
}

type FlatArray<T> = T extends (infer U)[] ? U : T;

function ensureArray<T>(val: T): Array<FlatArray<NonNullable<T>>> {
  if (val === undefined || val === null) return [];
  return (Array.isArray(val) ? val : [val]) as any;
}

export type SubsonicParamValue =
  | string
  | number
  | boolean
  | Array<string | number>
  | undefined;

export class SubsonicClient {
  private config: SubsonicClientConfig;
  private albumTracksCache = new Map<string, SubsonicSong[]>();

  constructor(config: SubsonicClientConfig) {
    this.config = {
      ...config,
      serverUrl: config.serverUrl.replace(/\/+$/, ''),
      clientName: config.clientName || 'planrift-web',
    };
  }

  public updateConfig(newConfig: Partial<SubsonicClientConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
      serverUrl: (newConfig.serverUrl || this.config.serverUrl).replace(/\/+$/, ''),
    };
  }

  public getConfig(): Readonly<SubsonicClientConfig> {
    return this.config;
  }

  private buildAuthQuery(extraParams: Record<string, SubsonicParamValue> = {}): URLSearchParams {
    const auth = createSubsonicAuthParams(
      this.config.password,
      this.config.username,
      this.config.clientName
    );

    const params = new URLSearchParams({
      u: auth.u,
      s: auth.s,
      t: auth.t,
      v: auth.v,
      c: auth.c,
      f: auth.f,
    });

    // Append folder pin if configured and not explicitly overridden
    if (this.config.musicFolderId && extraParams.musicFolderId === undefined) {
      params.set('musicFolderId', this.config.musicFolderId);
    }

    for (const [key, val] of Object.entries(extraParams)) {
      if (val !== undefined && val !== null && val !== '') {
        if (Array.isArray(val)) {
          for (const item of val) {
            params.append(key, String(item));
          }
        } else {
          params.set(key, String(val));
        }
      }
    }

    return params;
  }

  public buildUrl(endpoint: string, extraParams: Record<string, SubsonicParamValue> = {}): string {
    const cleanEndpoint = endpoint.replace(/^\/+/, '').replace(/^rest\/+/, '');
    const query = this.buildAuthQuery(extraParams);
    return `${this.config.serverUrl}/rest/${cleanEndpoint}?${query.toString()}`;
  }

  private async request<T>(endpoint: string, params: Record<string, SubsonicParamValue> = {}): Promise<T> {
    const url = this.buildUrl(endpoint, params);
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as SubsonicRootResponse<T>;
    const body = json['subsonic-response'];

    if (!body || body.status !== 'ok') {
      const code = body?.error?.code ?? 0;
      const msg = body?.error?.message ?? 'Unknown Subsonic error';
      throw new SubsonicApiError(code, msg);
    }

    return body as unknown as T;
  }

  // --- Endpoints ---

  async ping(): Promise<boolean> {
    try {
      await this.request('ping.view');
      return true;
    } catch {
      return false;
    }
  }

  async getMusicFolders(): Promise<Array<{ id: string | number; name: string }>> {
    const data = await this.request<SubsonicMusicFoldersResponse>('getMusicFolders.view');
    return ensureArray(data.musicFolders?.musicFolder);
  }

  async getArtists(): Promise<SubsonicArtist[]> {
    const data = await this.request<SubsonicArtistsResponse>('getArtists.view');
    const indexes = ensureArray(data.artists?.index);
    const result: SubsonicArtist[] = [];
    for (const idx of indexes) {
      result.push(...ensureArray(idx.artist));
    }
    return result;
  }

  async getArtist(id: string): Promise<SubsonicArtist> {
    const data = await this.request<SubsonicArtistResponse>('getArtist.view', { id });
    const artist = data.artist || { id, name: '', album: [] };
    if (artist) {
      artist.album = ensureArray(artist.album);
    }
    return artist;
  }

  async getAlbum(id: string): Promise<SubsonicAlbum> {
    const data = await this.request<SubsonicAlbumResponse>('getAlbum.view', { id });
    const album = data.album || { id, name: '', song: [] };
    if (album) {
      album.song = ensureArray(album.song);
    }
    return album;
  }

  async getAlbumList2(
    type: 'newest' | 'frequent' | 'recent' | 'alphabeticalByName' = 'newest',
    size = 30,
    offset = 0
  ): Promise<SubsonicAlbum[]> {
    const data = await this.request<SubsonicAlbumList2Response>('getAlbumList2.view', {
      type,
      size,
      offset,
    });
    return ensureArray(data.albumList2?.album);
  }

  async getMusicDirectory(id: string): Promise<SubsonicDirectoryResponse['directory']> {
    const data = await this.request<SubsonicDirectoryResponse>('getMusicDirectory.view', { id });
    const dir = data.directory || { id, name: '', child: [] };
    dir.child = ensureArray(dir.child);
    return dir;
  }

  async search3(
    query: string,
    options?: { songCount?: number; albumCount?: number; artistCount?: number }
  ): Promise<SubsonicSearchResult3> {
    const params: Record<string, string | number | undefined> = {
      query,
      songCount: options?.songCount,
      albumCount: options?.albumCount,
      artistCount: options?.artistCount,
    };
    const data = await this.request<SubsonicSearch3Response>('search3.view', params);
    const res = data.searchResult3 || {};
    return {
      artist: ensureArray(res.artist),
      album: ensureArray(res.album),
      song: ensureArray(res.song),
    };
  }

  async getPlaylists(): Promise<SubsonicPlaylist[]> {
    const data = await this.request<SubsonicPlaylistsResponse>('getPlaylists.view');
    return ensureArray(data.playlists?.playlist);
  }

  async getPlaylist(id: string): Promise<SubsonicPlaylist> {
    const data = await this.request<SubsonicPlaylistResponse>('getPlaylist.view', { id });
    const pl = data.playlist;
    if (pl) {
      pl.entry = ensureArray(pl.entry);
    }
    return pl;
  }

  async createPlaylist(name: string, songIds: string[] = []): Promise<SubsonicPlaylist> {
    const params: Record<string, SubsonicParamValue> = { name };
    if (songIds.length > 0) {
      params.songId = songIds;
    }
    const data = await this.request<SubsonicPlaylistResponse>('createPlaylist.view', params);
    return data.playlist;
  }

  async updatePlaylist(
    playlistId: string,
    songIdsToAdd: string[] = [],
    songIndexesToRemove: number[] = []
  ): Promise<void> {
    const params: Record<string, SubsonicParamValue> = { playlistId };
    if (songIdsToAdd.length > 0) {
      params.songIdToAdd = songIdsToAdd;
    }
    if (songIndexesToRemove.length > 0) {
      params.songIndexToRemove = songIndexesToRemove;
    }
    await this.request('updatePlaylist.view', params);
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.request('deletePlaylist.view', { id });
  }

  async star(id: string, type: 'song' | 'album' | 'artist' = 'song'): Promise<void> {
    const paramKey = type === 'song' ? 'id' : type === 'album' ? 'albumId' : 'artistId';
    await this.request('star.view', { [paramKey]: id });
  }

  async unstar(id: string, type: 'song' | 'album' | 'artist' = 'song'): Promise<void> {
    const paramKey = type === 'song' ? 'id' : type === 'album' ? 'albumId' : 'artistId';
    await this.request('unstar.view', { [paramKey]: id });
  }

  async getStarred2(): Promise<{ song: SubsonicSong[]; album: SubsonicAlbum[]; artist: SubsonicArtist[] }> {
    const data = await this.request<SubsonicStarred2Response>('getStarred2.view');
    return {
      song: ensureArray(data.starred2?.song),
      album: ensureArray(data.starred2?.album),
      artist: ensureArray(data.starred2?.artist),
    };
  }

  async getSongs(offset = 0, count = 50): Promise<SubsonicSong[]> {
    const data = await this.request<SubsonicSearch3Response>('search3.view', {
      query: '',
      songOffset: offset,
      songCount: count,
    });
    return ensureArray(data.searchResult3?.song);
  }

  // --- Parity resolution helpers ported faithfully from app.js ---

  async resolveAlbumSongs(album: SubsonicAlbum): Promise<SubsonicSong[]> {
    if (!album) return [];
    if (album.isVirtualSingles && Array.isArray(album.songs)) {
      return album.songs;
    }
    if (this.albumTracksCache.has(album.id)) {
      return this.albumTracksCache.get(album.id)!;
    }

    try {
      const albumData = await this.getAlbum(album.id);
      const tracks = ensureArray(albumData.song);
      if (tracks.length > 0) {
        this.albumTracksCache.set(album.id, tracks);
        return tracks;
      }
    } catch {
      // Fallback to getMusicDirectory
    }

    try {
      const dir = await this.getMusicDirectory(album.id);
      const children = (dir.child || []).filter((item) => !item.isDir);
      this.albumTracksCache.set(album.id, children);
      return children;
    } catch {
      return [];
    }
  }

  async resolveArtistAlbums(artist: SubsonicArtist): Promise<SubsonicAlbum[]> {
    const [artistDetails, rootDirectory] = await Promise.all([
      this.getArtist(artist.id).catch(() => ({ id: artist.id, name: artist.name, album: [] })),
      this.getMusicDirectory(artist.id).catch(() => ({ id: artist.id, name: artist.name, child: [] })),
    ]);

    const rawAlbums = ensureArray(artistDetails.album);
    const dirChildren = ensureArray(rootDirectory.child);
    const directLooseSongs = dirChildren.filter((item) => !item.isDir);

    const standardAlbums: SubsonicAlbum[] = [];
    const unknownAlbumBuckets: SubsonicAlbum[] = [];

    rawAlbums.forEach((album) => {
      const albumTitle = (album.name || '').trim();
      const isUntaggedBucket = !albumTitle || albumTitle.toLowerCase() === '[unknown album]';
      if (isUntaggedBucket) {
        unknownAlbumBuckets.push(album);
      } else {
        standardAlbums.push({
          ...album,
          name: albumTitle,
          artist: album.artist || artist.name,
        });
      }
    });

    if (standardAlbums.length === 0) {
      const folderDirs = dirChildren.filter((item) => item.isDir);
      folderDirs.forEach((dir) => {
        standardAlbums.push({
          id: dir.id,
          name: dir.title || (dir as { name?: string }).name || 'Album Folder',
          artist: dir.artist || artist.name,
          coverArt: dir.coverArt || dir.id,
          songCount: 0,
        });
      });
    }

    const looseSongs = [...directLooseSongs];

    if (unknownAlbumBuckets.length > 0) {
      const bucketTracksList = await Promise.all(
        unknownAlbumBuckets.map((bucket) => this.resolveAlbumSongs(bucket))
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
      const virtualSinglesAlbum: SubsonicAlbum = {
        id: `virtual-singles-${artist.id}`,
        name: 'Singles',
        artist: artist.name,
        isVirtualSingles: true,
        songs: looseSongs,
        songCount: looseSongs.length,
        coverArt: looseSongs[0]?.coverArt || looseSongs[0]?.id || undefined,
      };
      this.albumTracksCache.set(virtualSinglesAlbum.id, looseSongs);
      standardAlbums.push(virtualSinglesAlbum);
    }

    return standardAlbums;
  }

  // --- URL builders ---

  getStreamUrl(songId: string): string {
    return this.buildUrl('stream.view', { id: songId });
  }

  getCoverArtUrl(coverId: string | null | undefined, size = 300): string {
    if (!coverId) return '';
    return this.buildUrl('getCoverArt.view', { id: coverId, size });
  }
}

// Default instance using standard local test server / credentials
export const subsonicClient = new SubsonicClient({
  serverUrl: (typeof process !== 'undefined' && process.env?.VITE_NAVIDROME_URL) || 'http://127.0.0.1:4533',
  username: (typeof process !== 'undefined' && process.env?.VITE_NAVIDROME_USER) || 'localtest',
  password: (typeof process !== 'undefined' && process.env?.VITE_NAVIDROME_PASSWORD) || 'localtest-password',
});
