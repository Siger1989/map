import type { Coordinate, RouteOverlay } from '../../navigation/types.ts';
import { createRouteFeatures } from '../../navigation/routeFeatures.ts';
import type { TrackOverlay } from '../../tracks/TrackLayer.ts';
import { DRAFT_ID } from '../../tracks/editing.ts';
import { pickLinePoint, type TrackLinePoint } from '../../tracks/linePoint.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';

/** Preserve the web picker's 12 CSS px tolerance without widening rendered strokes. */
export const NATIVE_LINE_HIT_RADIUS = 12;
const HIT_EPSILON = 0.01;

export type NativeLineHit =
  | { kind: 'track'; point: TrackLinePoint; distance: number }
  | { kind: 'route'; point: TrackLinePoint; distance: number };

function projectedLineHit(
  id: string,
  segments: Coordinate[][],
  point: ScreenPoint,
  project: (coordinate: Coordinate) => ScreenPoint | null,
): NativeLineHit | null {
  const hit = pickLinePoint(id, segments, point, (coordinate) => project(coordinate) ?? { x: Number.NaN, y: Number.NaN }, NATIVE_LINE_HIT_RADIUS + HIT_EPSILON);
  if (!hit) return null;
  const projected = project(hit.coordinate);
  if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return null;
  const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
  return distance <= NATIVE_LINE_HIT_RADIUS + HIT_EPSILON ? { kind: 'track', point: hit, distance } : null;
}

function visibleRouteSegments(state: RouteOverlay | undefined): Coordinate[][][] {
  if (!state?.route || (state.route.displayOpacity ?? 1) <= 0) return [];
  // Use the shared route feature builder so navigation progress, display parts,
  // access gaps, and other route visibility rules match the actual renderer.
  return createRouteFeatures(state).features.flatMap((feature) =>
    feature.geometry.type === 'LineString' ? [[feature.geometry.coordinates as Coordinate[]]] : [],
  );
}

/** Find the actual closest visible route/track line in map-local CSS pixels. */
export function pickNearestVisibleLine(
  point: ScreenPoint,
  tracks: TrackOverlay,
  route: RouteOverlay | undefined,
  project: (coordinate: Coordinate) => ScreenPoint | null,
): NativeLineHit | null {
  let best: NativeLineHit | null = null;
  const consider = (hit: NativeLineHit | null) => {
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  };

  if (tracks.visible) {
    for (const track of tracks.saved) {
      if (track.hidden || (track.style?.opacity ?? 1) <= 0) continue;
      consider(projectedLineHit(track.id, track.segments, point, project));
    }
    if (tracks.draft.length && (tracks.style?.opacity ?? 1) > 0) {
      consider(projectedLineHit(DRAFT_ID, tracks.draft, point, project));
    }
  }

  for (const segments of visibleRouteSegments(route)) {
    const hit = pickLinePoint('__planned-route', segments, point,
      (coordinate) => project(coordinate) ?? { x: Number.NaN, y: Number.NaN }, NATIVE_LINE_HIT_RADIUS + HIT_EPSILON);
    if (!hit) continue;
    const projected = project(hit.coordinate);
    if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance <= NATIVE_LINE_HIT_RADIUS + HIT_EPSILON) consider({ kind: 'route', point: hit, distance });
  }
  return best;
}
