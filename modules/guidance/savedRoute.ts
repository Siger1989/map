import type { ManualTrack } from '../tracks/drawing';
import { hasLoosePoints, joinSegments } from '../tracks/snapping.ts';
import {
  coordinate,
  type Coordinate,
  type TravelMode,
} from '../navigation/types.ts';
import type { RouteFavorite } from '../navigation/favorites';
import { pathOf, project } from './geometry.ts';
import { connectedNetwork, networkPath } from './network.ts';

/** Adapt saved geometry without requesting a replacement road route or editing the archive. */
export function trackNavigation(
  track: ManualTrack,
  now = Date.now(),
  mode: TravelMode = track.navigationMode ?? 'pedestrian',
  tracks: ManualTrack[] = [],
): RouteFavorite {
  if (!track.segments.every((line) => line.every(coordinate)))
    throw new Error('轨迹坐标无效，无法导航。');
  const lines = joinSegments(track.segments);
  if (!lines.length || hasLoosePoints(track.segments))
    throw new Error('轨迹含不相接的线段，请先连接成连续路线再导航。');
  const trackNetwork = connectedNetwork({ ...track, segments: lines }, tracks);
  const coordinates = (
    lines.length === 1
      ? lines[0]
      : networkPath(trackNetwork, lines[0][0], lines[0].at(-1)!).coordinates
  ).map((p) => [...p] as Coordinate);
  const distance = pathOf(coordinates).length;
  if (distance < 20) throw new Error('轨迹不足20米，请延长后再导航。');
  const stops = track.sharedRoute?.stops;
  const start = stops?.[0] ?? {
    name: `${track.name} · 起点`,
    coordinates: coordinates[0],
  };
  const end = stops?.at(-1) ?? {
    name: `${track.name} · 终点`,
    coordinates: coordinates.at(-1)!,
  };
  let floor = 0;
  const routeStops = stops ?? [start, end],
    path = pathOf(coordinates);
  const snapped = routeStops.map((s, i) => {
    if (i === 0) return coordinates[0];
    if (i === routeStops.length - 1) return coordinates.at(-1)!;
    const p = project(path, s.coordinates, floor);
    floor = p.distance;
    return p.point;
  });
  return {
    id: track.id,
    name: track.name,
    savedAt: now,
    start,
    end,
    route: {
      mode,
      geometryKind: 'track',
      trackNetwork,
      coordinates,
      distance,
      duration:
        distance /
        ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[mode] / 3600),
      steps: [],
      snapped,
      stops: routeStops,
      createdAt: now,
    },
  };
}
