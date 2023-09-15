import Queue from './Queue';
import DarkCord, { DarkCordSearchOptions } from './Manager'; // Update this import if needed
import shoukaku, {
  LavalinkResponse,
  TrackExceptionEvent,
  PlayerUpdate,
  TrackStuckEvent,
  WebSocketClosedEvent, // Make sure to import these event types
} from 'shoukaku';
import { Snowflake } from 'zeneth';
class Player {
  private manager: DarkCord;
  private guildId: string;
  private voiceId: string;
  private textId: string;
  private volume: number;
  private shoukaku: shoukaku.Player;
  private queue: Queue;
  private paused: boolean;
  private playing: boolean;
  private data: Map<any, any>;
  private loop: LoopType;

  constructor(manager: DarkCord, options: PlayerOptions) {
    this.manager = manager;
    this.guildId = options.guildId;
    this.voiceId = options.voiceId;
    this.textId = options.textId;
    this.volume = options.volume;
    this.shoukaku = options.ShoukakuPlayer;
    this.queue = new Queue();
    this.paused = false;
    this.playing = false;
    this.data = new Map();
    this.loop = 'none';

    // Event listeners...

    this.shoukaku.on('start', () => {
      this.playing = true;
      this.manager.emit('trackStart', this, this.queue.current);
    });

    this.shoukaku.on('end', (data) => {
      if (this.state === PlayerState.DESTROYING || this.state === PlayerState.DESTROYED)
        return this.manager.emit('Debug', `Player ${this.guildId} destroyed from end event`);

      if (data.reason === 'REPLACED') return this.manager.emit('PlayerEnd', this);
      if (['LOAD_FAILED', 'CLEAN_UP'].includes(data.reason)) {
        this.queue.previous = this.queue.current;
        this.playing = false;
        if (!this.queue.length) return this.manager.emit('PlayerEmpty', this);
        this.manager.emit('PlayerEnd', this, this.queue.current);
        this.queue.current = null;
        return this.play();
      }
      if (this.loop === 'track' && this.queue.current)
        this.queue.unshift(this.queue.current);
      if (this.loop === 'queue' && this.queue.current)
        this.queue.push(this.queue.current);

      this.queue.previous = this.queue.current;
      const current = this.queue.current;
      this.queue.current = null;

      if (this.queue.length) {
        this.manager.emit('trackEnd', this, current);
      } else {
        this.playing = false;
        return this.manager.emit('queueEnd', this);
      }
      this.play();
    });

    this.shoukaku.on('closed', (data = WebSocketClosedEvent) => {
      this.playing = false;
      this.manager.emit('PlayerClosed', this, data);
    });

    this.shoukaku.on('exception', (data = TrackExceptionEvent) => {
      this.playing = false;
      this.manager.emit('trackException', this, data);
    });

    this.shoukaku.on('update', (data = PlayerUpdate) =>
      this.manager.emit('PlayerUpdate', this, data)
    );

    this.shoukaku.on('stuck', (data = TrackStuckEvent) =>
      this.manager.emit('trackStuck', this, data)
    );

    this.shoukaku.on('resumed', () => this.manager.emit('PlayerResumed', this));
  }

  pause(pause = true): Player {
    if (typeof pause !== 'boolean')
      throw new RangeError('[core] => Pause function must be passed with a boolean value.');
    if (this.paused === pause || !this.queue.totalSize) return this;
    this.paused = pause;
    this.playing = !pause;
    this.shoukaku.setPaused(pause);
    return this;
  }

  skip(): Player {
    if (this.state === PlayerState.DESTROYED) throw new Error('[core]Player is already destroyed');

    this.shoukaku.stopTrack();
    return this;
  }

  seekTo(position: number): Player {
    if (Number.isNaN(position))
      throw new RangeError('[core] => Seek Position must be a number.');
    this.shoukaku.seekTo(position);
    return this;
  }

  setVolume(volume: number): Player {
    if (Number.isNaN(volume))
      throw new RangeError('[core] => Volume level must be a number.');
    this.shoukaku.setVolume(volume / 100);
    this.volume = volume;
    return this;
  }

  setTextChannel(textId: string): Player {
    if (typeof textId !== 'string')
      throw new RangeError('[core] => textId must be a string.');
    this.textId = textId;
    return this;
  }

  setVoiceChannel(voiceId: string): Player {
    if (typeof voiceId !== 'string')
      throw a RangeError('[core] => voiceId must be a string.');
    this.voiceId = voiceId;
    return this;
  }

  setLoop(method: LoopType): Player {
    if (!method)
      throw new Error('[core] => You must provide a loop method as an argument for setLoop.');
    if (method === 'track' || method === 'queue') {
      this.loop = method;
      return this;
    }
    this.loop = 'none';
    return this;
  }

  async search(
    query: string,
    options: DarkCordSearchOptions = { engine: this.manager.defaultSearchEngine }
  ): Promise<LavalinkResponse> {
    if (/^https?:\/\//.test(query)) {
      if (options.engine === 'darkCordSpotify') {
        if (this.manager.spotify.check(query)) {
          return await this.manager.spotify.resolve(query);
        }
        return await this.shoukaku.node.rest.resolve(query);
      }
      return await this.shoukaku.node.rest.resolve(query);
    }
    if (options.engine === 'DarkCordSpotify') return await this.manager.spotify.search(query);
    const engineMap = {
      youtube: 'ytsearch',
      youtubemusic: 'ytmsearch',
      soundcloud: 'scsearch',
      spotify: 'spsearch',
      deezer: "dzsearch",
      yandex: 'ymsearch'
    };
    return await this.shoukaku.node.rest.resolve(`${engineMap[options.engine]}:${query}`);
  }

  async play(): Promise<void> {
    if (!this.queue.length) return;
    this.queue.current = this.queue.shift();
    try {
      if (!this.queue.current.track) this.queue.current = await this.manager.resolve(this.queue.current, this.shoukaku.node);
      this.shoukaku
        .setVolume(this.volume / 100)
        .playTrack({ track: this.queue.current.track });
    } catch (e) {
      this.manager.emit('trackError', this, this.queue.current, e);
    }
  }

  disconnect(): Player {
   if (this.state === PlayerState.DISCONNECTED || !this.voiceId)
      throw new Error('[core] => Player is already disconnected');
    this.state = PlayerState.DISCONNECTING;
 
    this.pause(true);
    const data = {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: null,
        self_mute: false,
        self_deaf: false,
      },
    };
    const guild = this.manager.shoukaku.connector.client.guilds.cache.get(this.guildId);
    if (guild) guild.shard.send(data);
    this.voiceId = null;
    this.state = PlayerState.DISCONNECTED;

    this.manager.emit('Debug', `Player disconnected; Guild id: ${this.guildId}`);

    return this;
  }

  destroy(): Player {
    this.disconnect();
    this.state = PlayerState.DESTROYED;
    this.shoukaku.connection.disconnect();
    this.shoukaku.removeAllListeners();
    this.manager.players.delete(this.guildId);
    
    this.state = PlayerState.DESTROYED;
    this.manager.emit('PlayerDestroy', this);
    this.manager.emit('Debug', `Player destroyed; Guild id: ${this.guildId}`);

  }
}

export = Player;

/**
 * @typedef PlayerOptions
 * @prop {string}
