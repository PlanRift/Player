export interface SubsonicResponseHeader {
  status: 'ok' | 'failed';
  version: string;
  type?: string;
  serverVersion?: string;
  openSubsonic?: boolean;
  error?: {
    code: number;
    message: string;
  };
}

export interface SubsonicRootResponse<T = Record<string, unknown>> {
  'subsonic-response': SubsonicResponseHeader & T;
}

export interface SubsonicMusicFolder {
  id: string | number;
  name: string;
}

export interface SubsonicMusicFoldersResponse {
  musicFolders: {
    musicFolder?: SubsonicMusicFolder[] | SubsonicMusicFolder;
  };
}

export interface SubsonicReplayGain {
  trackGain?: number;
  albumGain?: number;
  trackPeak?: number;
  albumPeak?: number;
  baseGain?: number;
}

export interface SubsonicSong {
  id: string;
  parent?: string;
  title: string;
  album?: string;
  artist?: string;
  track?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  playCount?: number;
  created?: string;
  albumId?: string;
  artistId?: string;
  type?: 'music' | 'podcast' | 'audiobook';
  starred?: string;
  discNumber?: number;
  replayGain?: SubsonicReplayGain;
  isDir?: boolean;
}

export interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  created?: string;
  year?: number;
  genre?: string;
  starred?: string;
  song?: SubsonicSong[];
  isVirtualSingles?: boolean;
  songs?: SubsonicSong[];
}

export interface SubsonicArtist {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
  artistImageUrl?: string;
  starred?: string;
  album?: SubsonicAlbum[];
}

export interface SubsonicAlbumList2Response {
  albumList2: {
    album?: SubsonicAlbum[];
  };
}

export interface SubsonicAlbumResponse {
  album: SubsonicAlbum;
}

export interface SubsonicArtistResponse {
  artist: SubsonicArtist;
}

export interface SubsonicArtistsResponse {
  artists: {
    ignoredArticles?: string;
    index?: Array<{
      name: string;
      artist?: SubsonicArtist[];
    }>;
  };
}

export interface SubsonicDirectoryChild extends SubsonicSong {
  isDir?: boolean;
}

export interface SubsonicDirectoryResponse {
  directory: {
    id: string;
    name: string;
    parent?: string;
    child?: SubsonicDirectoryChild[];
  };
}

export interface SubsonicPlaylist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount?: number;
  duration?: number;
  created?: string;
  changed?: string;
  coverArt?: string;
  entry?: SubsonicSong[];
}

export interface SubsonicPlaylistsResponse {
  playlists: {
    playlist?: SubsonicPlaylist[];
  };
}

export interface SubsonicPlaylistResponse {
  playlist: SubsonicPlaylist;
}

export interface SubsonicSearchResult3 {
  artist?: SubsonicArtist[];
  album?: SubsonicAlbum[];
  song?: SubsonicSong[];
}

export interface SubsonicSearch3Response {
  searchResult3: SubsonicSearchResult3;
}

export interface SubsonicStarred2Response {
  starred2: {
    artist?: SubsonicArtist[];
    album?: SubsonicAlbum[];
    song?: SubsonicSong[];
  };
}
