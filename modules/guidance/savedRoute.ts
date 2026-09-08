import type { ManualTrack } from '../tracks/drawing';
import { hasLoosePoints, joinSegments } from '../tracks/snapping.ts';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { RouteFavorite } from '../navigation/favorites';
import { pathOf } from './geometry.ts';

/** Adapt saved geometry without requesting a replacement road route or editing the archive. */
export function trackNavigation(
  track: ManualTrack,
  now = Date.now(),
): RouteFavorite {
  if (!track.segments.every((line) => line.every(coordinate)))
    throw new Error('轨迹坐标无效，无法导航。');
  const lines = joinSegments(track.segments);
  if (lines.length !== 1 || hasLoosePoints(track.segments))
    throw new Error('轨迹含不相接的线段，请先连接成连续路线再导航。');
  const coordinates = lines[0].map((p) => [...p] as Coordinate);
  const distance = pathOf(coordinates).length;
  if (distance < 20) throw new Error('轨迹不足20米，请延长后再导航。');
  const start = { name: `${track.name} · 起点`, coordinates: coordinates[0] };
  const end = {
    name: `${track.name} · 终点`,
    coordinates: coordinates.at(-1)!,
  };
  return {
    id: track.id,
    name: track.name,
    savedAt: now,
    start,
    end,
    route: {
      mode: 'pedestrian',
      coordinates,
      distance,
      duration: distance / (4000 / 3600),
      steps: [],
      snapped: [start.coordinates, end.coordinates],
      stops: [start, end],
      createdAt: now,
    },
  };
}
