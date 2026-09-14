import { useMemo } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { Recording } from './recording';
import { recordingTrack } from './savedRecording';

/** Derive geometry only when fixes change; errors and pause status do not redraw tracks. */
export function useRecordingTracks(record: Recording, saved: ManualTrack[]) {
  const track = useMemo(
    () =>
      record.id && record.segments.some((line) => line.length)
        ? recordingTrack(record, true)
        : null,
    [record.id, record.startedAt, record.segments, record.style],
  );
  const live = useMemo(() => {
    if (!track) return null;
    const segments = track.segments.filter((line) => line.length >= 2);
    return segments.length
      ? {
          id: 'live-recording',
          name: '实走记录',
          createdAt: track.createdAt,
          style: track.style,
          segments,
          samples: track.samples?.filter(
            (_, i) => track.segments[i].length >= 2,
          ),
        }
      : null;
  }, [track]);
  const photos = useMemo(
    () =>
      track
        ? [
            { ...track, name: '当前实走记录' },
            ...saved.filter((item) => item.id !== track.id),
          ]
        : saved,
    [track, saved],
  );
  return { live, photos };
}
