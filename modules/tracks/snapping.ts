import { metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing';

export const SNAP_RADIUS = 14;
const SNAP_CELL_SIZE = SNAP_RADIUS;
export function sameNode(a: Coordinate, b: Coordinate) {
  return metresBetween(a, b) < 0.15;
}
export function endpoints(segments: Coordinate[][]): Coordinate[] {
  return segments.flatMap((line) =>
    line.length ? [line[0], line.at(-1)!] : [],
  );
}
/** A continued/branched draft must reconnect to interior vertices, including
 * legacy freehand/road bends without an explicit nodes list. Keep exact values. */
export function draftSnapNodes(segments: Coordinate[][]): Coordinate[] {
  return [
    ...new Map(
      segments.flat().map((point) => [point.join(','), point]),
    ).values(),
  ];
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
  unproject?: (p: ScreenPoint) => Coordinate | null,
) {
  // Route forks can expose thousands of vertices as snap targets. On every
  // touch-move, reject candidates outside the geographic footprint of the
  // 14px snap circle before asking MapLibre to project them to screen space.
  let bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    centerLng: number;
  } | null = null;
  if (unproject) {
    const center = unproject(point);
    const corners = [
      unproject({ x: point.x - SNAP_RADIUS, y: point.y - SNAP_RADIUS }),
      unproject({ x: point.x + SNAP_RADIUS, y: point.y - SNAP_RADIUS }),
      unproject({ x: point.x - SNAP_RADIUS, y: point.y + SNAP_RADIUS }),
      unproject({ x: point.x + SNAP_RADIUS, y: point.y + SNAP_RADIUS }),
    ];
    if (center && corners.every((p): p is Coordinate => !!p)) {
      const longitudes = corners.map(
        ([lng]) => center[0] + ((((lng - center[0]) + 540) % 360) - 180),
      );
      bounds = {
        minLat: Math.min(...corners.map((p) => p[1])),
        maxLat: Math.max(...corners.map((p) => p[1])),
        minLng: Math.min(...longitudes),
        maxLng: Math.max(...longitudes),
        centerLng: center[0],
      };
    }
  }
  let best: { coordinate: Coordinate; screen: ScreenPoint } | null = null,
    distance = SNAP_RADIUS;
  for (const coordinate of candidates) {
    if (bounds) {
      const lng =
        bounds.centerLng +
        ((((coordinate[0] - bounds.centerLng) + 540) % 360) - 180);
      if (
        coordinate[1] < bounds.minLat ||
        coordinate[1] > bounds.maxLat ||
        lng < bounds.minLng ||
        lng > bounds.maxLng
      )
        continue;
    }
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

/** A screen-space index whose cached projections remain valid for one camera pose. */
export class ProjectedSnapGrid {
  private cells = new Map<string, { coordinate: Coordinate; screen: ScreenPoint; order: number }[]>();
  constructor(
    candidates: Coordinate[],
    project: (c: Coordinate) => ScreenPoint | null,
  ) {
    candidates.forEach((coordinate, order) => {
      const screen = project(coordinate);
      if (!screen) return;
      const key = this.cellKey(screen.x, screen.y);
      const cell = this.cells.get(key);
      const entry = { coordinate, screen, order };
      if (cell) cell.push(entry);
      else this.cells.set(key, [entry]);
    });
  }
  nearest(point: ScreenPoint) {
    const cellX = Math.floor(point.x / SNAP_CELL_SIZE);
    const cellY = Math.floor(point.y / SNAP_CELL_SIZE);
    const nearby: { coordinate: Coordinate; screen: ScreenPoint; order: number }[] = [];
    for (let x = cellX - 1; x <= cellX + 1; x++)
      for (let y = cellY - 1; y <= cellY + 1; y++)
        nearby.push(...(this.cells.get(`${x},${y}`) ?? []));
    nearby.sort((a, b) => a.order - b.order);
    let best: { coordinate: Coordinate; screen: ScreenPoint } | null = null;
    let distance = SNAP_RADIUS;
    for (const entry of nearby) {
      const d = Math.hypot(entry.screen.x - point.x, entry.screen.y - point.y);
      // Keep findSnap's <= tie rule: equal-distance later candidates win.
      if (d <= distance) {
        best = { coordinate: entry.coordinate, screen: entry.screen };
        distance = d;
      }
    }
    return best;
  }
  private cellKey(x: number, y: number) {
    return `${Math.floor(x / SNAP_CELL_SIZE)},${Math.floor(y / SNAP_CELL_SIZE)}`;
  }
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

/** Connection copies can contain source edges again. Count each physical edge once
 * before checking junction degree; real branches and gaps remain separate. */
export function joinUniqueSegments(input: Coordinate[][]): Coordinate[][] {
  const seen = new Set<string>();
  const runs: Coordinate[][] = [];
  for (const line of input) {
    let run: Coordinate[] = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1],
        b = line[i];
      if (sameNode(a, b)) continue;
      const key = [a.join(','), b.join(',')].sort().join('|');
      if (seen.has(key)) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      seen.add(key);
      if (!run.length) run.push(a);
      run.push(b);
    }
    if (run.length > 1) runs.push(run);
  }
  const joined = joinSegments(runs);
  const vertices = joined.flat();
  return [
    ...joined,
    ...input.filter(
      (line) =>
        line.length === 1 && !vertices.some((p) => sameNode(p, line[0])),
    ),
  ];
}
