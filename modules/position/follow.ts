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
    fix.accuracy <= 80 &&
    Number.isFinite(fix.timestamp) &&
    now - fix.timestamp <= 20000 &&
    fix.timestamp <= now + 5000
  );
}
