import type { RouteFavorite } from '../navigation/favorites';
import type { RoutePlace, TravelMode } from '../navigation/types';
import { pathOf } from './geometry.ts';
import { networkPath, vertexKey } from './network.ts';

/** Reorient a track copy. Road directions must instead be replanned by their provider. */
export function orientTrack(
  target: RouteFavorite,
  start: RoutePlace,
  end: RoutePlace,
  mode: TravelMode,
  reverseLoop = false,
): RouteFavorite {
  const original = target.route;
  if (original.geometryKind !== 'track')
    throw new Error('道路路线需要重新规划方向。');
  const reverse =
    vertexKey(start.coordinates) === vertexKey(target.end.coordinates);
  const closed =
    vertexKey(target.start.coordinates) === vertexKey(target.end.coordinates) &&
    vertexKey(start.coordinates) === vertexKey(target.start.coordinates) &&
    vertexKey(end.coordinates) === vertexKey(target.end.coordinates);
  const coordinates = closed
    ? reverseLoop
      ? original.coordinates.slice().reverse()
      : original.coordinates.slice()
    : original.trackNetwork
      ? networkPath(original.trackNetwork, start.coordinates, end.coordinates)
          .coordinates
      : reverse
        ? original.coordinates.slice().reverse()
        : original.coordinates.slice();
  const distance = pathOf(coordinates).length;
  if (distance < 20) throw new Error('起终点之间不足20米，请选择不同节点。');
  return {
    ...target,
    start,
    end,
    route: {
      ...original,
      mode,
      coordinates,
      distance,
      duration:
        distance /
        ({ pedestrian: 4000, bicycle: 15000, auto: 40000 }[mode] / 3600),
      steps: [],
      snapped: [coordinates[0], coordinates.at(-1)!],
      stops: [start, end],
    },
  };
}
