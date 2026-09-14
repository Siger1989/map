import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
import type { RouteFavorite } from '../navigation/favorites';

/** Reverse one continuous section exactly. Pauses and crossings never become shortcuts. */
export function breadcrumbReturn(
  name: string,
  segments: Coordinate[][],
  index = segments.length - 1,
): RouteFavorite {
  const line = segments[index];
  if (!line || line.length < 2 || !line.every(coordinate))
    throw new Error('此连续段不足两个有效点');
  const coordinates = line.map((p) => [...p] as Coordinate).reverse();
  const distance = coordinates
    .slice(1)
    .reduce((sum, p, i) => sum + metresBetween(coordinates[i], p), 0);
  if (distance < 20) throw new Error('此连续段不足20米');
  const start = { name: '此段末端', coordinates: coordinates[0] };
  const end = { name: '此段起点', coordinates: coordinates.at(-1)! };
  return {
    id: 'breadcrumb-return',
    name: `${name} · 第${index + 1}段返航`,
    savedAt: Date.now(),
    start,
    end,
    route: {
      mode: 'pedestrian',
      geometryKind: 'track',
      coordinates,
      trackNetwork: [coordinates],
      preferredTrackPath: coordinates,
      distance,
      duration: distance / (4000 / 3600),
      steps: [],
      snapped: [start.coordinates, end.coordinates],
      stops: [start, end],
      createdAt: Date.now(),
    },
  };
}
export function returnBearing(from: Coordinate, to: Coordinate) {
  const r = Math.PI / 180,
    delta = (to[0] - from[0]) * r;
  return (
    (Math.atan2(
      Math.sin(delta) * Math.cos(to[1] * r),
      Math.cos(from[1] * r) * Math.sin(to[1] * r) -
        Math.sin(from[1] * r) * Math.cos(to[1] * r) * Math.cos(delta),
    ) /
      r +
      360) %
    360
  );
}
