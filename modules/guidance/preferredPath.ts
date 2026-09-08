import type { Coordinate } from '../navigation/types.ts';
import { networkPath, vertexKey } from './network.ts';

/** Keep the chosen itinerary; only connected prefixes/suffixes may extend its endpoints. */
export function preferredPath(
  network: Coordinate[][],
  preferred: Coordinate[],
  start: Coordinate,
  end: Coordinate,
  reverseLoop = false,
): Coordinate[] {
  const index = new Map<string, number>();
  preferred.forEach((p, i) => {
    if (!index.has(vertexKey(p))) index.set(vertexKey(p), i);
  });
  const closed = vertexKey(preferred[0]) === vertexKey(preferred.at(-1)!);
  if (
    closed &&
    vertexKey(start) === vertexKey(preferred[0]) &&
    vertexKey(end) === vertexKey(start)
  )
    return reverseLoop ? preferred.slice().reverse() : preferred.slice();
  function attach(point: Coordinate, destination: Coordinate) {
    const at = index.get(vertexKey(point));
    if (at !== undefined) return { index: at, points: [point] };
    // Endpoints must really belong to the network; do not project across a gap.
    if (
      !network.some((line) =>
        line.some((p) => vertexKey(p) === vertexKey(point)),
      )
    )
      throw new Error('起终点不在相连路线节点上。');
    const path = networkPath(network, point, destination).coordinates;
    const join = path.findIndex((p) => index.has(vertexKey(p)));
    if (join < 0) throw new Error('所选端点无法接入当前路线方案。');
    const joinedIndex = index.get(vertexKey(path[join]))!,
      points = path.slice(0, join + 1);
    points[0] = point;
    points[points.length - 1] = preferred[joinedIndex];
    return { index: joinedIndex, points };
  }
  const a = attach(start, preferred[0]),
    b = attach(end, preferred.at(-1)!);
  const middle =
    a.index <= b.index
      ? preferred.slice(a.index, b.index + 1)
      : preferred.slice(b.index, a.index + 1).reverse();
  return [
    ...a.points.slice(0, -1),
    ...middle,
    ...b.points.slice(0, -1).reverse(),
  ];
}
