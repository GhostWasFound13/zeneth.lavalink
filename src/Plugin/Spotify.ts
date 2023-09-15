import { fetch } from 'undici';
import { DarkCord, DarkCordOptions, DarkCordSearchOptions } from '../DarkCord'; // Replace with the actual import path
import { Track, LavalinkResponse } from 'shoukaku';

const Pattern = /^(?:https:\/\/open\.spotify\.com\/(?:user\/[A-Za-z0-9]+\/)?|spotify:)(album|playlist|track|artist)(?:[/:])([A-Za-z0-9]+).*$/;

class Spotify {
  private manager: DarkCord;
  private baseURL: string;
  private options: {
    playlistLimit: number;
    albumLimit: number;
    artistLimit: number;
    searchMarket: string;
    clientID: string | null;
    clientSecret: string | null;
  };
  private authorization: string | undefined;
  private interval: number;
  private token: string | undefined;

  constructor(manager: DarkCordOptions) {
    this.manager = manager;

    this.baseURL = 'https://api.spotify.com/v1';

    this.options = {
      playlistLimit: manager?.PlaylistLimit || 5,
      albumLimit: manager?.AlbumLimit || 5,
      artistLimit: manager?.ArtistLimit || 5,
      searchMarket: manager?.SearchMarket || 'US',
      clientID: manager?.ClientID || null,
      clientSecret: manager?.ClientSecret || null,
    };

    if (this.options.clientID && this.options.clientSecret) {
      this.authorization = Buffer.from(
        `${this.options.clientID}:${this.options.clientSecret}`
      ).toString('base64');
    }

    this.interval = 0;
  }

  check(url: string): boolean {
    return Pattern.test(url);
  }

  async requestAnonymousToken(): Promise<void> {
    try {
      const data = await fetch(
        'https://open.spotify.com/get_access_token?reason=transport&productType=embed',
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36',
          },
        }
      );

      const body = await data.json();
      this.token = `Bearer ${body.accessToken}`;
      this.interval = body.accessTokenExpirationTimestampMs * 1000;
    } catch (e) {
      if (e.status === 400) {
        throw new Error('Invalid Spotify client.');
      }
    }
  }

  async requestToken(): Promise<void> {
    if (!this.options.clientID && !this.options.clientSecret) return this.requestAnonymousToken();

    try {
      const data = await fetch('https://accounts.spotify.com/api/token?grant_type=client_credentials', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.authorization}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const body = await data.json();

      this.token = `Bearer ${body.access_token}`;
      this.interval = body.expires_in * 1000;
    } catch (e) {
      if (e.status === 400) {
        throw new Error('Invalid Spotify client.');
      }
    }
  }

  async renew(): Promise<void> {
    if (Date.now() >= this.interval) {
      await this.requestToken();
    }
  }

  async requestData(endpoint: string): Promise<unknown> {
    await this.renew();

    const req = await fetch(`${this.baseURL}${/^\//.test(endpoint) ? endpoint : `/${endpoint}`}`, {
      headers: { Authorization: this.token },
    });
    const data = await req.json();
    return data;
  }

  async resolve(url: string): Promise<LavalinkResponse> {
    if (!this.token) await this.requestToken();
    const [, type, id] = Pattern.exec(url) || [];

    switch (type) {
      case 'playlist': {
        return this.fetchPlaylist(id);
      }
      case 'track': {
        return this.fetchTrack(id);
      }
      case 'album': {
        return this.fetchAlbum(id);
      }
      case 'artist': {
        return this.fetchArtist(id);
      }
    }
  }

  async fetchPlaylist(id: string): Promise<LavalinkResponse> {
    try {
      const playlist = await this.requestData(`/playlists/${id}`);
      await this.fetchPlaylistTracks(playlist);

      const limitedTracks = this.options.playlistLimit
        ? playlist.tracks.items.slice(0, this.options.playlistLimit * 100)
        : playlist.tracks.items;

      const unresolvedPlaylistTracks = await Promise.all(
        limitedTracks.map((x: any) => this.buildUnresolved(x.track))
      );

      return this.buildResponse('PLAYLIST_LOADED', unresolvedPlaylistTracks, playlist.name);
    } catch (e) {
      return this.buildResponse(
        e.status === 404 ? 'NO_MATCHES' : 'LOAD_FAILED',
        [],
        undefined,
        e.body?.error.message ?? e.message
      );
    }
  }

  async fetchAlbum(id: string): Promise<LavalinkResponse> {
    try {
      const album = await this.requestData(`/albums/${id}`);

      const limitedTracks = this.options.albumLimit
        ? album.tracks.items.slice(0, this.options.albumLimit * 100)
        : album.tracks.items;

      const unresolvedPlaylistTracks = await Promise.all(
        limitedTracks.map((x: any) => this.buildUnresolved(x))
      );
      return this.buildResponse('PLAYLIST_LOADED', unresolvedPlaylistTracks, album.name);
    } catch (e) {
      return this.buildResponse(
        e.body?.error.message === 'invalid id' ? 'NO_MATCHES' : 'LOAD_FAILED',
        [],
        undefined,
        e.body?.error.message ?? e.message
      );
    }
  }

  async fetchArtist(id: string): Promise<LavalinkResponse> {
    try {
      const artist = await this.requestData(`/artists/${id}`);

      const data = await this.requestData(
        `/artists/${id}/top-tracks?market=${this.options.searchMarket ?? 'US'}`
      );

      const limitedTracks = this.options.artistLimit
        ? data.tracks.slice(0, this.options.artistLimit * 100)
        : data.tracks;

      const unresolvedPlaylistTracks = await Promise.all(
        limitedTracks.map((x: any) => this.buildUnresolved(x))
      );

      return this.buildResponse('PLAYLIST_LOADED', unresolvedPlaylistTracks, artist.name);
    } catch (e) {
      return this.buildResponse(
        e.body?.error.message === 'invalid id' ? 'NO_MATCHES' : 'LOAD_FAILED',
        [],
        undefined,
        e.body?.error.message ?? e.message
      );
    }
  }

  async fetchTrack(id: string): Promise<LavalinkResponse> {
    try {
      const data = await this.requestData(`/tracks/${id}`);
      const unresolvedTrack = await this.buildUnresolved(data);

      return this.buildResponse('TRACK_LOADED', [unresolvedTrack]);
    } catch (e) {
      return this.buildResponse(
        e.body?.error.message === 'invalid id' ? 'NO_MATCHES' : 'LOAD_FAILED',
        [],
        undefined,
        e.body?.error.message ?? e.message
      );
    }
  }

  async search(query: string): Promise<LavalinkResponse> {
    try {
      const data = await this.requestData(
        `/search/?q="${query}"&type=artist,album,track&market=${this.options.searchMarket ?? 'US'}`
      );
      const unresolvedTracks = await Promise.all(
        data.tracks.items.map((x: any) => this.buildUnresolved(x))
      );
      return this.buildResponse('TRACK_LOADED', unresolvedTracks);
    } catch (e) {
      return this.buildResponse(
        e.body?.error.message === 'invalid id' ? 'NO_MATCHES' : 'LOAD_FAILED',
        [],
        undefined,
        e.body?.error.message ?? e.message
      );
    }
  }

  async fetchPlaylistTracks(spotifyPlaylist: unknown): Promise<void> {
    let nextPage = (spotifyPlaylist as any).tracks.next;
    let pageLoaded = 1;
    while (nextPage) {
      if (!nextPage) break;
      const req = await fetch(nextPage, {
        headers: { Authorization: this.token },
      });
      const body = await req.json();
      if (body.error) break;
      (spotifyPlaylist as any).tracks.items.push(...body.items);

      nextPage = body.next;
      pageLoaded++;
    }
  }

  async buildUnresolved(track: unknown): Promise<LavalinkResponse> {
    if (!track) throw new ReferenceError('The Spotify track object was not provided');

    return {
      track: '',
      info: {
        identifier: (track as any).id,
        isSeekable: true,
        author: (track as any).artists[0]?.name,
        length: (track as any).duration_ms,
        isStream: false,
        position: 0,
        sourceName: 'spotify',
        title: (track as any).name,
        uri: `https://open.spotify.com/track/${(track as any).id}`,
        thumbnail: (track as any).album?.images[0]?.url,
      },
    };
  }

  async fetchMetaData(track: Track): Promise<Track> {
    const fetchResult = await this.manager.search(`${track.info.title} ${track.info.author}` as Track, {} as DarkCordSearchOptions);
    return fetchResult.tracks[0];
  }

  async buildTrack(unresolvedTrack: LavalinkResponse): Promise<LavalinkResponse> {
    const lavaTrack = await this.fetchMetaData(unresolvedTrack as Track);
    if (lavaTrack) {
      unresolvedTrack.track = lavaTrack.track;
      unresolvedTrack.info.identifier = lavaTrack.info.identifier;
      return unresolvedTrack;
    }
  }

  compareValue(value: unknown): boolean {
    return typeof value !== 'undefined' ? value !== null : typeof value !== 'undefined';
  }

  buildResponse(
    loadType: string,
    tracks: LavalinkResponse[],
    playlistName?: string,
    exceptionMsg?: string
  ): LavalinkResponse {
    const response: LavalinkResponse = {
      loadType,
      tracks,
      playlistInfo: playlistName ? { name: playlistName } : {},
    };
    if (exceptionMsg) {
      response.exception = { message: exceptionMsg, severity: 'COMMON' };
    }
    return response;
  }
}

export = Spotify;
