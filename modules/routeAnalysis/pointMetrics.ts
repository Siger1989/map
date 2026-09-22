import type { ManualTrack } from '../tracks/drawing';
import type { TrackLinePoint } from '../tracks/linePoint';
import { markerChainage } from '../tracks/linePoint.ts';
import { metresBetween } from '../navigation/types.ts';
import { analyzeRoute, type RouteMetrics } from './metrics.ts';
import { ANALYSIS_POLICY } from './config.ts';

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Find the continuous part first; crossings prefer the user's selected chainage. */
function locate(track: ManualTrack, point: TrackLinePoint) {
  let offset = 0;
  const choices = track.segments
    .map((line, part) => {
      const local =
        line.length === 1
          ? { distance: 0, offset: metresBetween(line[0], point.coordinate) }
          : markerChainage(
              [line],
              point.coordinate,
              Math.max(0, (point.sourceDistance ?? point.distance) - offset),
            );
      const distances = [0];
      for (let i = 1; i < line.length; i++)
        distances.push(distances[i - 1] + metresBetween(line[i - 1], line[i]));
      const result = {
        part,
        line,
        distances,
        distance: offset + local.distance,
        local: local.distance,
        offset: local.offset,
      };
      offset += distances.at(-1) ?? 0;
      return result;
    })
    .filter((v) => v.line.length > 0);
  choices.sort((a, b) =>
    Math.abs(a.offset - b.offset) > 0.05
      ? a.offset - b.offset
      : Math.abs(a.distance - (point.sourceDistance ?? point.distance)) -
        Math.abs(b.distance - (point.sourceDistance ?? point.distance)),
  );
  const chosen = choices[0];
  if (!chosen) return null;
  if (chosen.line.length === 1)
    return { ...chosen, edge: 0, ratio: 0, pointIndex: 0 };
  let edge = 0;
  while (
    edge < chosen.line.length - 2 &&
    chosen.distances[edge + 1] < chosen.local - 0.01
  )
    edge++;
  const length = chosen.distances[edge + 1] - chosen.distances[edge];
  const ratio =
    length > 0
      ? Math.max(
          0,
          Math.min(1, (chosen.local - chosen.distances[edge]) / length),
        )
      : 0;
  return {
    ...chosen,
    edge,
    ratio,
    pointIndex: ratio < 1e-6 ? edge : ratio > 1 - 1e-6 ? edge + 1 : null,
  };
}

function interpolateSample(
  track: ManualTrack,
  hit: NonNullable<ReturnType<typeof locate>>,
  key: 'altitude' | 'time',
) {
  const samples = track.samples?.[hit.part];
  if (hit.pointIndex !== null)
    return finite(samples?.[hit.pointIndex]?.[key])
      ? samples![hit.pointIndex][key]
      : null;
  const a = samples?.[hit.edge]?.[key],
    b = samples?.[hit.edge + 1]?.[key];
  if (!finite(a) || !finite(b)) return null;
  if (
    key === 'time' &&
    (b <= a || (b - a) / 1000 > ANALYSIS_POLICY.maximumGapSeconds)
  )
    return null;
  return a + (b - a) * hit.ratio;
}

/** Display-only point data. Never join pause segments or synthesize recording times. */
export function routePointMetrics(
  track: ManualTrack,
  point: TrackLinePoint,
  profile: ManualTrack = track,
  profileAnalysis: RouteMetrics = analyzeRoute(profile),
  originalAnalysis: RouteMetrics = analyzeRoute(track),
) {
  const original = locate(track, point),
    sampled = locate(profile, point);
  if (!original) return null;
  const nativeHeight = interpolateSample(track, original, 'altitude');
  const terrainHeight = sampled
    ? interpolateSample(profile, sampled, 'altitude')
    : null;
  const elevation = nativeHeight ?? terrainHeight;
  const slopePercent = sampled
    ? (profileAnalysis.slopes[sampled.part]?.[sampled.edge] ?? null)
    : null;
  const timestamp = interpolateSample(track, original, 'time');
  return {
    coordinate: point.coordinate,
    distance: original.distance,
    profileDistance: sampled?.distance ?? original.distance,
    part: original.part,
    pointIndex: original.pointIndex,
    elevation,
    elevationSource:
      elevation === null
        ? 'missing'
        : nativeHeight === null
          ? 'terrain'
          : original.pointIndex === null
            ? 'interpolated'
            : 'original',
    slopePercent,
    slopeDegrees:
      slopePercent === null
        ? null
        : (Math.atan(slopePercent / 100) * 180) / Math.PI,
    speedKmh: originalAnalysis.speeds[original.part]?.[original.edge] ?? null,
    timestamp,
    timeInterpolated: timestamp !== null && original.pointIndex === null,
  };
}
