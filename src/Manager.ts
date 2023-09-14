import { EventEmitter } from 'events';
import { Shoukaku, NodeOptions } from 'shoukaku';
import Player from './Player';
import Spotify from './module/Spotify';

class DarkCord extends EventEmitter {
  private shoukaku: Shoukaku;
  private players: Map<string, Player>;
  private defaultSearchEngine: string;
  private spotify?: Spotify;

  constructor(options: DarkCordOptions, connector: NodeOptions) {
    super();

    if (typeof options !== 'object') throw new Error("[DarkCord] => DarkCordOptions must be an object");
    if (!options.nodes) throw new Error('[DarkCord] => DarkCordOptions must contain a nodes property');
    if (!Array.isArray(options.nodes)) throw new Error('[DarkCord] => DarkCordOptions.nodes must be an array');
    if (options.nodes.length === 0) throw new Error('[DarkCord] => DarkCordOptions.nodes must contain at least one node');
    if (!options.shoukakuoptions) throw new Error('[DarkCord] => DarkCordOptions must contain shoukakuoptions property');

    if (options?.spotify) {
      if (!options.spotify[0]?.ClientID) throw new Error('[DarkCord] => DarkCordOptions.spotify must have ClientID');
      if (!options.spotify[0]?.ClientSecret) throw new Error('[DarkCord] => DarkCordOptions.spotify must have ClientSecret');

      if (options.spotify?.length === 1) {
        this.spotify = new Spotify({ ClientID: options.spotify[0]?.ClientID, ClientSecret: options.spotify[0]?.ClientSecret });
      } else {
        for (const client of options.spotify) { this.spotify = new Spotify(client); }
        console.warn("[DarkCord Spotify] => You are using multi-client mode, which may still result in rate limiting.");
      }
    }

    this.shoukaku = new Shoukaku(connector, options.nodes, options.shoukakuoptions);
    this.players = new Map();
    this.defaultSearchEngine = options?.defaultSearchEngine || 'youtube';
  }

  async createPlayer(options: DarkCordCreatePlayerOptions): Promise<Player> {
    const existing = this.players.get(options.guildId);
    if (existing) return existing;

    let node;
    if (options.loadBalancer === true) {
      node = this.getLeastUsedNode();
    } else { 
      node = this.shoukaku.getNode('auto'); 
    }
    if (!node) throw new Error('[DarkCord] => No nodes are online.');

    const ShoukakuPlayer = await node.joinChannel({
      guildId: options.guildId,
      channelId: options.voiceId,
      shardId: options.shardId,
      deaf: options.deaf || true
    });
    const DarkCordPlayer = new Player(this, {
      guildId: options.guildId,
      voiceId: options.voiceId,
      textId: options.textId,
      volume: `${options.volume}` || '80',
      ShoukakuPlayer
    });
    this.players.set(options.guildId, DarkCordPlayer);
    this.emit('PlayerCreate', DarkCordPlayer);
    return DarkCordPlayer;
  }

  getLeastUsedNode(): Shoukaku {
    const nodes = [...this.shoukaku.nodes.values()];
    const onlineNodes = nodes.filter((node) => node);
    if (!onlineNodes.length) throw new Error("[DarkCord] => No nodes are online.");
    return onlineNodes.reduce((a, b) => (a.players.size < b.players.size ? a : b));
  }

  async resolve(track: shoukaku.Track, node: Shoukaku): Promise<shoukaku.Track | undefined> {
    const query = [track.info.author, track.info.title].filter(x => !!x).join(' - ');
    let result = await node.rest.resolve(`ytmsearch:${query}`);
    if (!result || !result.tracks.length) {
      result = await node.rest.resolve(`ytsearch:${query}`);
      if (!result || !result.tracks.length) return;
    }
    track.track = result.tracks[0].track;
    return track;
  }

  async search(query: string, options: DarkCordSearchOptions = { engine: this.defaultSearchEngine }): Promise<shoukaku.LavalinkResponse> {
    if (/^https?:\/\//.test(query)) {
      if (options.engine === 'DarkCordSpotify') {
        if (this.spotify?.check(query)) {
          return await this.spotify.resolve(query);
        }
        return await this.shoukaku.getNode()?.rest.resolve(query);
      }
      return await this.shoukaku.getNode()?.rest.resolve(query);
    }
    if (options.engine === 'DarkCordSpotify' && this.spotify) return await this.spotify.search(query);
    const engineMap: Record<string, string> = {
      youtube: 'ytsearch',
      youtubemusic: 'ytmsearch',
      soundcloud: 'scsearch',
      spotify: 'spsearch',
      deezer: "dzsearch",
      yandex: 'ymsearch'
    };
    return await this.shoukaku.getNode()?.rest.resolve(`${engineMap[options.engine]}:${query}`);
  }

  async getPlayer(guildId: string): Promise<Player | undefined> {
    return this.players.get(guildId);
  }

  async destroyPlayer(guildId: string): Promise<void> {
    const player = this.getPlayer(guildId);
    if (!player) return;
    player.destroy();
    this.players.delete(guildId);
  }

  on(event: keyof DarkCordEvents, listener: (...args: DarkCordEvents[keyof DarkCordEvents]) => any): this {
    super.on(event, listener);
    return this;
  }

  once(event: keyof DarkCordEvents, listener: (...args: DarkCordEvents[keyof DarkCordEvents]) => any): this {
    super.once(event, listener);
    return this;
  }
}

export = DarkCord;

/**
 * @typedef DarkCordOptions
 * @property {DarkCordSpotifyOptions[]} [spotify]
 * @property {NodeOptions[]} nodes
 * @property {any} shoukakuoptions
 * @property {string} [defaultSearchEngine]
 */

/**
 * @typedef DarkCordSpotifyOptions
 * @property {number} playlistLimit
 * @property {number} albumLimit
 * @property {number} artistLimit
 * @property {string} searchMarket
 * @property {string} ClientID
 * @property {string} ClientSecret
 */

/**
 * @typedef DarkCordCreatePlayerOptions
 * @prop {string} guildId
 * @prop {string} voiceId
 * @prop {string} textId
 * @prop {number} shardId
 * @prop {number} [volume]
 * @prop {boolean} [deaf]
 */

/**
 * @typedef DarkCordSearchOptions
 * @prop {'ytsearch' | 'ytmsearch' | 'spsearch' | 'scsearch'} [engine]
 */



/**
 * @typedef DarkCordEvents
 * @prop {[player: Player, track: shoukaku.Track]} trackStart
 * @prop {[player: Player, track: shoukaku.Track]} trackEnd
 * @prop {[player: Player]} queueEnd
 * @prop {[player: Player,  data: shoukaku.WebSocketClosedEvent]} PlayerClosed
 * @prop {[player: Player, data: shoukaku.TrackExceptionEvent]} trackException
 * @prop {[player: Player, data: shoukaku.PlayerUpdate]} PlayerUpdate
 * @prop {[player: Player, data: shoukaku.TrackStuckEvent]} trackStuck
 * @prop {[player: Player]} PlayerResumed
 * @prop {[player: Player]} playerDestroy
 * @prop {[player: Player]} playerCreate
 */
