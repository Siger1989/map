import type { ManualTrack } from '../tracks/drawing';
import type { TrackEdgeColors } from '../tracks/edgeColors';
import { metresBetween } from '../navigation/types.ts';
import { ANALYSIS_POLICY, SPEED_BANDS, SLOPE_BANDS } from './config.ts';
import { elevationLineParts } from './elevationLineParts.ts';

export type AnalysisMode = 'solid' | 'speed' | 'slope' | 'elevation';
export type RouteMetrics = {
  distance: number;
  maximumSpeedKmh: number | null;
  maximumSlopePercent: number | null;
  steepest50mPercent: number | null;
  steepSections: number;
  speeds: (number | null)[][];
  slopes: (number | null)[][];
};
type TrackSamples = Pick<ManualTrack, 'segments' | 'samples'>;
const altitude = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? value : null;

/** Pure analysis of measured points. Pause boundaries and missing heights stay disconnected. */
export function analyzeRoute(track: TrackSamples): RouteMetrics {
  const speeds: RouteMetrics['speeds'] = [],
    slopes: RouteMetrics['slopes'] = [];
  let distance = 0,
    maximumSpeedKmh: number | null = null,
    maximumSlopePercent: number | null = null,
    steepest50mPercent: number | null = null,
    steepSections = 0;
  track.segments.forEach((line, part) => {
    const samples = track.samples?.[part];
    const lengths = line
      .slice(1)
      .map((point, i) => metresBetween(line[i], point));
    const chainage = [0];
    lengths.forEach((length) => chainage.push(chainage.at(-1)! + length));
    distance += chainage.at(-1)!;
    const speedLine = lengths.map((length, i) => {
      const a = samples?.[i]?.time,
        b = samples?.[i + 1]?.time;
      if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b))
        return null;
      const seconds = (b - a) / 1000,
        speed = length / seconds;
      if (
        seconds <= 0 ||
        seconds > ANALYSIS_POLICY.maximumGapSeconds ||
        speed > ANALYSIS_POLICY.maximumSpeedMetresPerSecond ||
        !Number.isFinite(speed)
      )
        return null;
      const kmh = speed * 3.6;
      maximumSpeedKmh = Math.max(maximumSpeedKmh ?? 0, kmh);
      return kmh;
    });
    const slopeLine: (number | null)[] = lengths.map(() => null);
    let runStart = 0,
      anchor = 0,
      windowStart = 0,
      inSteep = false;
    for (let end = 1; end < line.length; end++) {
      const height = altitude(samples?.[end]?.altitude);
      if (height === null || altitude(samples?.[end - 1]?.altitude) === null) {
        runStart = end;
        anchor = end;
        windowStart = end;
        inSteep = false;
        continue;
      }
      const span = chainage[end] - chainage[anchor];
      if (span >= ANALYSIS_POLICY.minimumSlopeSpanMetres) {
        const grade = ((height - samples![anchor].altitude!) / span) * 100;
        for (let i = anchor; i < end; i++) slopeLine[i] = grade;
        maximumSlopePercent = Math.max(
          maximumSlopePercent ?? 0,
          Math.abs(grade),
        );
        anchor = end;
      }
      const startDistance =
        chainage[end] - ANALYSIS_POLICY.steepestWindowMetres;
      if (startDistance >= chainage[runStart]) {
        while (
          windowStart + 1 < end &&
          chainage[windowStart + 1] <= startDistance
        )
          windowStart++;
        const a = samples![windowStart].altitude!,
          b = samples![windowStart + 1].altitude!;
        const length = chainage[windowStart + 1] - chainage[windowStart];
        const startHeight =
          a +
          (b - a) *
            (length > 0 ? (startDistance - chainage[windowStart]) / length : 0);
        const grade =
          (Math.abs(height - startHeight) /
            ANALYSIS_POLICY.steepestWindowMetres) *
          100;
        steepest50mPercent = Math.max(steepest50mPercent ?? 0, grade);
        const steep = grade >= ANALYSIS_POLICY.steepThresholdPercent;
        if (steep && !inSteep) steepSections++;
        inSteep = steep;
      }
    }
    speeds.push(speedLine);
    slopes.push(slopeLine);
  });
  return {
    distance,
    maximumSpeedKmh,
    maximumSlopePercent,
    steepest50mPercent,
    steepSections,
    speeds,
    slopes,
  };
}

export function analysisColors(
  metrics: RouteMetrics,
  mode: 'speed' | 'slope',
): TrackEdgeColors {
  const bands = mode === 'speed' ? SPEED_BANDS : SLOPE_BANDS;
  return (mode === 'speed' ? metrics.speeds : metrics.slopes).map((line) =>
    line.map((value) =>
      value === null
        ? ANALYSIS_POLICY.missingColor
        : bands.find((band) => Math.abs(value) < band.maximum)!.color,
    ),
  );
}

/** Keep temporal edges in traversal order, including traversing the same road twice. */
export function metricLineParts(
  track: TrackSamples,
  mode: Exclude<AnalysisMode, 'solid'>,
) {
  if (mode === 'elevation') return elevationLineParts(track);
  const colors = analysisColors(analyzeRoute(track), mode);
  return track.segments.flatMap((line, part) => {
    const pieces: {
      coordinates: ManualTrack['segments'][number];
      color: string;
      muted: boolean;
    }[] = [];
    for (let i = 1; i < line.length; i++) {
      const color = colors[part][i - 1] ?? ANALYSIS_POLICY.missingColor;
      const previous = pieces.at(-1);
      if (previous?.color === color) previous.coordinates.push(line[i]);
      else
        pieces.push({
          coordinates: [line[i - 1], line[i]],
          color,
          muted: false,
        });
    }
    return pieces;
  });
}
