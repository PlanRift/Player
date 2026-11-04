import { describe, it, expect, mock } from 'bun:test';
import { SubsonicClient } from '../src/client';

describe('SubsonicClient Playlists API', () => {
  it('calls deletePlaylist.view with playlist id', async () => {
    const client = new SubsonicClient({
      serverUrl: 'http://localhost:4533',
      username: 'test',
      password: 'pwd',
    });

    let requestedEndpoint = '';
    let requestedParams: Record<string, string | number | undefined> = {};

    // Mock the internal request method
    client['request'] = mock(async (endpoint: string, params: Record<string, any>) => {
      requestedEndpoint = endpoint;
      requestedParams = params;
      return {};
    });

    await client.deletePlaylist('pl-99');
    expect(requestedEndpoint).toBe('deletePlaylist.view');
    expect(requestedParams.id).toBe('pl-99');
  });

  it('calls createPlaylist.view with name and songs', async () => {
    const client = new SubsonicClient({
      serverUrl: 'http://localhost:4533',
      username: 'test',
      password: 'pwd',
    });

    client['request'] = mock(async (_endpoint: string, _params: Record<string, any>) => {
      return {
        playlist: {
          id: 'pl-created-1',
          name: 'My New Playlist',
          songCount: 2,
          duration: 360,
        },
      };
    });

    const res = await client.createPlaylist('My New Playlist', ['song-1', 'song-2']);
    expect(res.id).toBe('pl-created-1');
    expect(res.name).toBe('My New Playlist');
  });
});
