import type { ManualTrack } from '../tracks/drawing';
import type { TripPhoto } from './storage';

/** Use the stable saved-recording ID. Names/nearby positions cannot establish ownership. */
export function photosForTrack<T extends TripPhoto>(
  track: Pick<ManualTrack, 'id'> | undefined,
  photos: T[],
): T[] {
  return track
    ? photos
        .filter((p) => p.trackId === track.id)
        .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    : [];
}
