import type { RefObject } from 'react';
import type { MapHandle } from '../map/TerrainMap';
import type { Coordinate } from '../navigation/types';

type MapRef = RefObject<Pick<MapHandle, 'toScreen'> | null>;
const projectors = new WeakMap<MapRef, {
  map: MapRef['current'];
  project: (point: Coordinate) => ReturnType<MapHandle['toScreen']>;
}>();

/** Keep screen-snap caches across parent renders, but invalidate on map replacement. */
export function drawingMapProjection(ref: MapRef) {
  const cached = projectors.get(ref);
  if (cached?.map === ref.current) return cached.project;
  const project = (point: Coordinate) => ref.current?.toScreen(point) ?? null;
  projectors.set(ref, { map: ref.current, project });
  return project;
}
