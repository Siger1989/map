import type { Annotation } from '../annotations/data';
import type { ManualTrack } from './drawing';
import { connectedNetwork } from '../guidance/network.ts';
import { hasLoosePoints } from './snapping.ts';
import { metresBetween, type Coordinate } from '../navigation/types.ts';
export const linkedRouteMarkers = (
  track: Pick<ManualTrack, 'id' | 'sourceTrackIds'>,
  markers: Annotation[],
) =>
  markers.filter(
    (m) =>
      m.trackAnchor &&
      (m.trackAnchor.trackId === track.id ||
        track.sourceTrackIds?.includes(m.trackAnchor.trackId)),
  );
export function routeConnectionLabel(
  track: Pick<ManualTrack, 'segments'>,
): string {
  if (!track.segments.length || hasLoosePoints(track.segments))
    return '含未完成线段';
  try {
    connectedNetwork(
      { id: 'check', name: '', createdAt: 0, segments: track.segments },
      [],
    );
    return track.segments.length > 1 ? '已连通分叉' : '已连通';
  } catch {
    return '存在断开路段';
  }
}

export type RouteGap = {
  /** The closest endpoints belonging to two separate route components. */
  from: Coordinate;
  to: Coordinate;
  distance: number;
};

/**
 * Find a real missing connection without adding geometry to the saved route.
 * Screen crossings deliberately stay separate: only identical stored vertices
 * make segments part of the same component, matching navigation's graph rule.
 */
export function routeGap(
  track: Pick<ManualTrack, 'segments'>,
): RouteGap | null {
  const lines = track.segments.filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const parent = lines.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const join = (a: number, b: number) => {
    const left = root(a), right = root(b);
    if (left !== right) parent[right] = left;
  };
  const owners = new Map<string, number>();
  for (const [index, line] of lines.entries())
    for (const point of line) {
      const key = `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, index);
      else join(index, owner);
    }
  let best: RouteGap | null = null;
  for (const [leftIndex, left] of lines.entries())
    for (let rightIndex = leftIndex + 1; rightIndex < lines.length; rightIndex++) {
      if (root(leftIndex) === root(rightIndex)) continue;
      const right = lines[rightIndex];
      // A gap can only be repaired at a line end; don't point to an unrelated bend.
      for (const from of [left[0], left.at(-1)!])
        for (const to of [right[0], right.at(-1)!]) {
          const distance = metresBetween(from, to);
          if (!best || distance < best.distance)
            best = { from, to, distance };
        }
    }
  return best;
}
