import type { ManualTrack } from './drawing.ts';
import type { Coordinate } from '../navigation/types.ts';
import { metresBetween } from '../navigation/types.ts';
import type { ElevationSample } from '../journey/metrics.ts';
import { trackAlternatives } from './alternatives.ts';

const samePoint = (a: Coordinate, b: Coordinate) => a[0] === b[0] && a[1] === b[1];
const finiteHeight = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function segmentOnMain(line: Coordinate[], main: Coordinate[]): number[] | null {
  if (line.length < 2 || line.length > main.length) return null;
  for (let start = 0; start <= main.length - line.length; start++) {
    if (line.every((point, index) => samePoint(point, main[start + index])))
      return line.map((_, index) => start + index);
    if (line.every((point, index) => samePoint(point, main[start + line.length - 1 - index])))
      return line.map((_, index) => start + line.length - 1 - index);
  }
  return null;
}

function elevationAt(samples: ElevationSample[], distance: number): number | null {
  let low = 0, high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].distance < distance) low = middle + 1;
    else high = middle;
  }
  const right = samples[low];
  if (right && Math.abs(right.distance - distance) < 0.01)
    return finiteHeight(right.elevation) ? right.elevation : null;
  const left = samples[low - 1];
  if (!left || !right || !finiteHeight(left.elevation) || !finiteHeight(right.elevation) || right.distance <= left.distance)
    return null;
  return left.elevation + (right.elevation - left.elevation) * ((distance - left.distance) / (right.distance - left.distance));
}

/** Attach only the already-read main-route DEM profile to a share-only track copy. */
export function withTerrainProfileSamples(
  track: ManualTrack,
  profileLines: Coordinate[][],
  profileSamples: ElevationSample[],
): ManualTrack {
  const main = trackAlternatives(track.segments, track.style?.color)[0]?.coordinates;
  if (!main || profileLines.length !== 1 || profileLines[0].length !== main.length ||
      !profileLines[0].every((point, index) => samePoint(point, main[index])) ||
      !profileSamples.length || profileSamples.some((sample) => sample.part !== 0 || !Number.isFinite(sample.distance)))
    return track;
  const measured = [...profileSamples].sort((a, b) => a.distance - b.distance);
  if (!measured.some((sample) => finiteHeight(sample.elevation))) return track;

  const distances = [0];
  for (let index = 1; index < main.length; index++)
    distances.push(distances[index - 1] + metresBetween(main[index - 1], main[index]));
  const samples = track.segments.map((line, part) => {
    const indices = segmentOnMain(line, main);
    return line.map((_, index) => {
      const original = track.samples?.[part]?.[index];
      const altitude = finiteHeight(original?.altitude)
        ? original.altitude
        : indices ? elevationAt(measured, distances[indices[index]]) : null;
      return { time: original?.time ?? null, altitude };
    });
  });
  return { ...track, samples };
}
