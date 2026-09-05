import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing';

export const SNAP_RADIUS = 14;
export function sameNode(a: Coordinate, b: Coordinate) {
  return metresBetween(a, b) < 0.15;
}
export function endpoints(segments: Coordinate[][]): Coordinate[] {
  return segments.flatMap((line) =>
    line.length ? [line[0], line.at(-1)!] : [],
  );
}
export function hasLoosePoints(segments: Coordinate[][]) {
  const ends = endpoints(segments.filter((line) => line.length >= 2));
  return segments.some(
    (line) => line.length === 1 && !ends.some((p) => sameNode(p, line[0])),
  );
}
export function findSnap(
  point: ScreenPoint,
  candidates: Coordinate[],
  project: (c: Coordinate) => ScreenPoint | null,
) {
  let best: { coordinate: Coordinate; screen: ScreenPoint } | null = null,
    distance = SNAP_RADIUS;
  for (const coordinate of candidates) {
    const screen = project(coordinate);
    if (!screen) continue;
    const d = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (d <= distance) {
      best = { coordinate, screen };
      distance = d;
    }
  }
  return best;
}
/** Join only unambiguous endpoints. Never bridge gaps or choose a branch for the user. */
export function joinSegments(input: Coordinate[][]): Coordinate[][] {
  const lines = input
    .filter((line) => line.length >= 2)
    .map((line) => line.slice());
  const allEnds = endpoints(lines);
  const unambiguous = (point: Coordinate) =>
    allEnds.filter((p) => sameNode(point, p)).length === 2;
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < lines.length; a++)
      for (let b = a + 1; b < lines.length; b++) {
        for (const reverseA of [false, true])
          for (const reverseB of [false, true]) {
            const left = reverseA ? lines[a].slice().reverse() : lines[a];
            const right = reverseB ? lines[b].slice().reverse() : lines[b];
            if (sameNode(left.at(-1)!, right[0]) && unambiguous(right[0])) {
              lines[a] = [...left, ...right.slice(1)];
              lines.splice(b, 1);
              changed = true;
              break outer;
            }
          }
      }
  }
  return lines;
}
export function connectedTracks<
  T extends { id: string; segments: Coordinate[][] },
>(seed: T, tracks: T[]): T[] {
  const connected = [seed];
  let changed = true;
  while (changed) {
    changed = false;
    for (const track of tracks) {
      if (connected.some((t) => t.id === track.id)) continue;
      const ends = endpoints(connected.flatMap((t) => t.segments));
      if (
        endpoints(track.segments).some((p) =>
          ends.some((end) => sameNode(p, end)),
        )
      ) {
        connected.push(track);
        changed = true;
      }
    }
  }
  return connected;
}
