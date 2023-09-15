import { Track } from 'shoukaku';

/**
 * @extends Array<Track>
 */
class Queue extends Array<Track> {
  /** @type {Track|null|undefined} */
  current: Track | null | undefined = null;

  /** @type {Track|null|undefined} */
  previous: Track | null | undefined = null;

  /**
   * Get the queue size
   * @returns {number}
   */
  get size(): number {
    return this.length;
  }

  /**
   * Get the queue total size (plus the current track)
   * @returns {number}
   */
  get totalSize(): number {
    return this.length + (this.current ? 1 : 0);
  }

  /**
   * Check if the queue is empty
   * @returns {boolean}
   */
  get isEmpty(): boolean {
    return this.length === 0;
  }

  /**
   * Get the queue duration
   * @returns {number}
   */
  get durationLength(): number {
    return this.reduce((acc, cur) => acc + (cur.length || 0), 0);
  }

  /**
   * Add a track to the queue
   * @param {Track} track
   * @param {QueueAddOptions} options
   * @returns {Queue}
   */
  add(track: Track, options?: QueueAddOptions): Queue {
    track.info.requester = options?.requester || null;
    this.push(track);
    return this;
  }

  /**
   * Remove a track from the queue
   * @param {number} index
   * @returns {Track}
   */
  remove(index: number): Track {
    return this.splice(index, 1)[0];
  }

  /**
   * Clear the queue
   * @returns {Queue}
   */
  clear(): Queue {
    return this.splice(0);
  }

  /**
   * Randomize the queue
   * @returns {void}
   */
  shuffle(): void {
    for (let i = this.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }
  }
}

export default Queue;

/**
 * @typedef {Object} QueueAddOptions
 * @property {string|null} requester
 */
