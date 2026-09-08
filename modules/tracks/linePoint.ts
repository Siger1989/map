import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing';

/** A temporary selection, never an editable vertex or a recorded GPS point. */
export type TrackLinePoint = {
  trackId: string;
  coordinate: Coordinate;
  distance: number;
};
export type TrackAnchor = { trackId: string; distance: number };
export function validTrackAnchor(value: unknown): value is TrackAnchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as TrackAnchor;
  return (
    typeof a.trackId === 'string' &&
    a.trackId.length > 0 &&
    a.trackId.length <= 100 &&
    Number.isFinite(a.distance) &&
    a.distance >= 0
  );
}
const interpolate = (a: Coordinate, b: Coordinate, t: number): Coordinate => [
  ((a[0] + (((b[0] - a[0] + 540) % 360) - 180) * t + 540) % 360) - 180,
  a[1] + (b[1] - a[1]) * t,
];

/** Pick the rendered segment, then refine against map.project for tilted terrain views. */
export function pickLinePoint(
  trackId: string,
  segments: Coordinate[][],
  point: ScreenPoint,
  project: (p: Coordinate) => ScreenPoint,
  tolerance = 12,
): TrackLinePoint | null {
  let travelled = 0,
    bestError = tolerance,
    best: TrackLinePoint | null = null;
  for (const line of segments)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i],
        length = metresBetween(a, b);
      const start = project(a),
        end = project(b);
      if (
        point.x >= Math.min(start.x, end.x) - tolerance &&
        point.x <= Math.max(start.x, end.x) + tolerance &&
        point.y >= Math.min(start.y, end.y) - tolerance &&
        point.y <= Math.max(start.y, end.y) + tolerance
      ) {
        const error = (t: number) => {
          const p = project(interpolate(a, b, t));
          return Math.hypot(p.x - point.x, p.y - point.y);
        };
        let low = 0,
          high = 1;
        for (let n = 0; n < 24; n++) {
          const x = low + (high - low) / 3,
            y = high - (high - low) / 3;
          if (error(x) < error(y)) high = y;
          else low = x;
        }
        const t = [0, (low + high) / 2, 1].sort(
          (x, y) => error(x) - error(y),
        )[0];
        const offset = error(t);
        if (offset <= bestError) {
          bestError = offset;
          best = {
            trackId,
            coordinate: interpolate(a, b, t),
            distance: travelled + length * t,
          };
        }
      }
      travelled += length;
    }
  return best;
}

/** Real marker coordinates stay fixed; recalculate chainage after route edits. Gaps add no distance. */
export function markerChainage(
  segments: Coordinate[][],
  point: Coordinate,
  preferred = 0,
) {
  let travelled = 0,
    best = { distance: 0, offset: Infinity };
  const scale = Math.cos((point[1] * Math.PI) / 180);
  for (const line of segments)
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i];
      const delta = (x: number, y: number) => ((y - x + 540) % 360) - 180;
      const dx = delta(a[0], b[0]) * scale,
        dy = b[1] - a[1];
      const px = delta(a[0], point[0]) * scale,
        py = point[1] - a[1];
      const t = Math.max(
        0,
        Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
      );
      const length = metresBetween(a, b),
        offset = metresBetween(point, interpolate(a, b, t));
      const distance = travelled + length * t;
      if (
        offset < best.offset - 0.05 ||
        (Math.abs(offset - best.offset) <= 0.05 &&
          Math.abs(distance - preferred) < Math.abs(best.distance - preferred))
      )
        best = { distance, offset };
      travelled += length;
    }
  return { ...best, fraction: travelled ? best.distance / travelled : 0 };
}

export function trackPointAt(
  segments: Coordinate[][],
  distance: number,
): Coordinate | null {
  let remaining = Math.max(0, distance);
  for (const line of segments)
    for (let i = 1; i < line.length; i++) {
      const length = metresBetween(line[i - 1], line[i]);
      if (remaining <= length)
        return interpolate(
          line[i - 1],
          line[i],
          length ? remaining / length : 0,
        );
      remaining -= length;
    }
  return segments.at(-1)?.at(-1) ?? null;
}
