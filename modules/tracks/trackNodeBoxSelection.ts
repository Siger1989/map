import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import type { SelectionBox } from '../collections/boxSelection';

/** Resolve the closest visible handle, including nodes already in the marquee. */
export function nodeAtBoxTap(points: Coordinate[], tap: ScreenPoint,
  project: (p: Coordinate) => ScreenPoint | null, radius = 22): Coordinate | null {
  let closest: Coordinate | null = null;
  let distance = radius;
  for (const point of points) {
    const p = project(point);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const d = Math.hypot(p.x - tap.x, p.y - tap.y);
    if (d <= distance) { distance = d; closest = point; }
  }
  return closest;
}

/** Select visible vertex handles whose screen footprint touches the marquee rectangle. */
export function nodesInBox(
  points: Coordinate[],
  box: SelectionBox,
  project: (p: Coordinate) => ScreenPoint | null,
  hitRadius = 0,
): Coordinate[] {
  const radius = Number.isFinite(hitRadius) ? Math.max(0, hitRadius) : 0;
  return [...new Map(points.filter(point => {
    const p = project(point);
    return p && p.x + radius >= box.left && p.x - radius <= box.right &&
      p.y + radius >= box.top && p.y - radius <= box.bottom;
  }).map(point => [point.join(','), point])).values()];
}
