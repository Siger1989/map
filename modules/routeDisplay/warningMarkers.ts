import type { ManualTrack } from '../tracks/drawing';
import type { RouteMetrics } from '../routeAnalysis/metrics';
import type { RouteWarning } from './RouteWarnings';
import { ANALYSIS_POLICY } from '../routeAnalysis/config.ts';
import { metresBetween, type Coordinate } from '../navigation/types.ts';
import { ROUTE_WARNING_POLICY } from './config.ts';

type Edge = { a: Coordinate; b: Coordinate; length: number; grade: number };
const interpolate = (
  a: Coordinate,
  b: Coordinate,
  fraction: number,
): Coordinate => [
  ((a[0] + (((b[0] - a[0] + 540) % 360) - 180) * fraction + 540) % 360) - 180,
  a[1] + (b[1] - a[1]) * fraction,
];

/** Mark every steep run, splitting uphill/downhill and repeating along long runs.
 * Uses the same derived slopes as point details and route colouring. No track writes.
 */
export function steepWarningMarkers(
  track: Pick<ManualTrack, 'segments'>,
  slopes: RouteMetrics['slopes'],
): RouteWarning[] {
  const marks: RouteWarning[] = [];
  const emit = (edges: Edge[]) => {
    if (!edges.length) return;
    const length = edges.reduce((sum, edge) => sum + edge.length, 0);
    const spacing = Math.max(
      ROUTE_WARNING_POLICY.repeatDistanceMetres,
      length / ROUTE_WARNING_POLICY.maximumMarkersPerRun,
    );
    let filled = 0;
    let peak: { grade: number; coordinate: Coordinate } | null = null;
    const flush = () => {
      if (peak)
        marks.push({
          coordinate: peak.coordinate,
          label: `${peak.grade > 0 ? '陡上' : '陡下'} ${Math.round(Math.abs(peak.grade))}%`,
        });
      filled = 0;
      peak = null;
    };
    for (const edge of edges) {
      let offset = 0;
      while (offset < edge.length - 1e-6) {
        const span = Math.min(spacing - filled, edge.length - offset);
        if (!peak || Math.abs(edge.grade) > Math.abs(peak.grade))
          peak = {
            grade: edge.grade,
            coordinate: interpolate(
              edge.a,
              edge.b,
              (offset + span / 2) / edge.length,
            ),
          };
        filled += span;
        offset += span;
        if (filled >= spacing - 1e-6) flush();
      }
    }
    flush();
  };
  track.segments.forEach((line, part) => {
    let run: Edge[] = [];
    for (let i = 0; i + 1 < line.length; i++) {
      const grade = slopes[part]?.[i];
      if (
        grade == null ||
        !Number.isFinite(grade) ||
        Math.abs(grade) < ANALYSIS_POLICY.steepThresholdPercent
      ) {
        emit(run);
        run = [];
        continue;
      }
      if (run.length && Math.sign(run[0].grade) !== Math.sign(grade)) {
        emit(run);
        run = [];
      }
      const length = metresBetween(line[i], line[i + 1]);
      if (!Number.isFinite(length)) {
        emit(run);
        run = [];
      } else if (length > 1e-6) {
        run.push({ a: line[i], b: line[i + 1], length, grade });
      }
    }
    emit(run);
  });
  return marks;
}
