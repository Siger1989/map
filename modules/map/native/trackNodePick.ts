import type { Coordinate } from '../../navigation/types.ts';

export type NativeTrackNodePick = Readonly<{
  kind?: unknown;
  trackId?: unknown;
  coordinate?: unknown;
}>;
export type TrackNodeScreenPoint = Readonly<{ x: number; y: number }>;

function readCoordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]), latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return [longitude, latitude];
}

/** Prefer a true pixel hit, then choose the nearest candidate in the expanded touch box. */
export function closestNativeTrackNodePick(
  candidates: readonly NativeTrackNodePick[],
  exactCandidates: readonly NativeTrackNodePick[],
  trackId: string,
  touch: TrackNodeScreenPoint,
  project: (coordinate: Coordinate) => TrackNodeScreenPoint | null,
): NativeTrackNodePick | null {
  const exact = exactCandidates.filter(item => item.kind === 'trackNode' && item.trackId === trackId);
  const matching = (exact.length ? exact : candidates.filter(item => item.kind === 'trackNode' && item.trackId === trackId));
  let nearest: NativeTrackNodePick | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const item of matching) {
    const coordinate = readCoordinate(item.coordinate);
    if (!coordinate) continue;
    const screen = project(coordinate);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
    const distance = Math.hypot(screen.x - touch.x, screen.y - touch.y);
    if (distance < nearestDistance) { nearest = item; nearestDistance = distance; }
  }
  return nearest;
}
