import type { ManualTrack } from './drawing.ts';

/** Legacy stores already contain samples even though their UI called every line hand drawn. */
export function hasTrackTime(track: ManualTrack) {
  return !!track.samples?.some((line) =>
    line.some(
      (sample) =>
        typeof sample.time === 'number' && Number.isFinite(sample.time),
    ),
  );
}

export function keepsOriginalPoints(track: ManualTrack) {
  return track.source === 'recorded' || track.samples !== undefined;
}

export function trackSourceLabel(track: ManualTrack) {
  if (track.source === 'recorded') return '实走轨迹';
  if (track.source === 'gpx') return 'GPX 轨迹';
  if (track.source === 'kml') return 'KML 轨迹';
  if (hasTrackTime(track)) return '带时间轨迹';
  return '手绘轨迹';
}

export function photoTrackChoice(
  tracks: ManualTrack[],
  target?: string | null,
  preferred?: string | null,
  locked = false,
) {
  const timed = tracks.filter(hasTrackTime);
  if (locked) return timed.find((t) => t.id === target);
  return (
    timed.find((t) => t.id === target) ??
    timed.find((t) => t.id === preferred) ??
    timed[0]
  );
}
