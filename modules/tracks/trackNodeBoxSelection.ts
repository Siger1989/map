import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import type { SelectionBox } from '../collections/boxSelection';

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
