import { Track } from 'shoukaku';
import { DarkCordTrack } from './Track';

export class KazagumoUtils {
  static convertDarkCordTrackToTrack(track: DarkCordTrack | Track): Track {
    if ((track as Track).info) return track as Track;
    track = track as DarkCordTrack;
    return {
      track: track.track,
      info: {
        isSeekable: track.isSeekable,
        isStream: track.isStream,
        title: track.title,
        uri: track.uri,
        identifier: track.identifier,
        sourceName: track.sourceName,
        author: track.author ?? '',
        length: track.length ?? 0,
        position: track.position ?? 0,
      },
    };
  }
}
