import type { ManualTrack } from '../tracks/drawing';
import { ANALYSIS_POLICY } from './config.ts';

export const ELEVATION_RAMP = [
  '#267bd2',
  '#20a879',
  '#d6ce39',
  '#ee8a32',
  '#d84240',
];
type Heights = Pick<ManualTrack, 'samples'>;
export type ElevationScale = { min: number; max: number } | null;
export const finiteHeight = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);
export function routeElevationScale(track: Heights): ElevationScale {
  let min = Infinity,
    max = -Infinity;
  for (const line of track.samples ?? [])
    for (const sample of line) {
      if (!finiteHeight(sample.altitude)) continue;
      min = Math.min(min, sample.altitude);
      max = Math.max(max, sample.altitude);
    }
  return min === Infinity ? null : { min, max };
}
/** Same ramp and bounds drive the map, legend and profile. Negative/flat heights are valid. */
export function elevationColor(height: number | null, scale: ElevationScale) {
  if (!finiteHeight(height) || !scale) return ANALYSIS_POLICY.missingColor;
  const t =
    scale.max === scale.min
      ? 0.5
      : Math.max(
          0,
          Math.min(1, (height - scale.min) / (scale.max - scale.min)),
        );
  const p = (Math.round(t * 32) / 32) * (ELEVATION_RAMP.length - 1);
  const i = Math.min(ELEVATION_RAMP.length - 2, Math.floor(p)),
    mix = p - i;
  const a = ELEVATION_RAMP[i],
    b = ELEVATION_RAMP[i + 1];
  return (
    '#' +
    [1, 3, 5]
      .map((k) =>
        Math.round(
          parseInt(a.slice(k, k + 2), 16) * (1 - mix) +
            parseInt(b.slice(k, k + 2), 16) * mix,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function elevationEdgeColors(
  track: Pick<ManualTrack, 'segments' | 'samples'>,
) {
  const scale = routeElevationScale(track);
  return track.segments.map((line, part) =>
    line.slice(1).map((_, i) => {
      const a = track.samples?.[part]?.[i]?.altitude,
        b = track.samples?.[part]?.[i + 1]?.altitude;
      return elevationColor(
        finiteHeight(a) && finiteHeight(b) ? (a + b) / 2 : null,
        scale,
      );
    }),
  );
}
