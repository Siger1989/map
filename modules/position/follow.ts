import type { Recording } from '../outdoor/recording.ts';
import { coordinate } from '../navigation/types.ts';
import type { PositionFix } from './types.ts';

/** A resumed recording can have an empty last segment. Never invent a new fix. */
export function recordingPosition(record: Recording): PositionFix | null {
  for (let i = record.segments.length - 1; i >= 0; i--) {
    const point = record.segments[i].at(-1);
    if (point)
      return {
        coordinates: point.coordinates,
        accuracy: point.accuracy,
        timestamp: point.time,
      };
  }
  return null;
}

export function canFollow(
  fix: PositionFix | null,
  now = Date.now(),
): fix is PositionFix {
  return (
    !!fix &&
    coordinate(fix.coordinates) &&
    Number.isFinite(fix.accuracy) &&
    fix.accuracy >= 0 &&
    fix.accuracy <= (fix.source === 'network' ? 50000 : 80) &&
    Number.isFinite(fix.timestamp) &&
    now - fix.timestamp <= 20000 &&
    fix.timestamp <= now + 5000
  );
}

/** Keep the error circle in view; this changes only the camera, never the fix. */
export function positionZoom(fix: PositionFix) {
  return Math.max(
    3,
    Math.min(
      16,
      Math.log2(
        (40075016.7 *
          Math.max(0.01, Math.cos((fix.coordinates[1] * Math.PI) / 180)) *
          240) /
          (512 * Math.max(100, fix.accuracy * 3)),
      ),
    ),
  );
}

export function cameraMoved(previous: PositionFix | null, next: PositionFix) {
  if (
    !previous ||
    previous.source !== next.source ||
    next.accuracy < previous.accuracy / 2
  )
    return true;
  const lat = ((previous.coordinates[1] + next.coordinates[1]) * Math.PI) / 360;
  const lngDelta =
    ((next.coordinates[0] - previous.coordinates[0] + 540) % 360) - 180;
  const distance =
    Math.hypot(
      lngDelta * Math.cos(lat),
      next.coordinates[1] - previous.coordinates[1],
    ) * 111320;
  const tolerance =
    next.source === 'network'
      ? Math.max(5, Math.min(500, next.accuracy / 2))
      : Math.max(2, Math.min(5, next.accuracy / 4));
  return distance > tolerance;
}
