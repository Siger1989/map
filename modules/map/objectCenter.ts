import type { Coordinate } from '../navigation/types.ts';
import { routeBounds } from '../routeShare/data.ts';

export type FocusObjectKind = 'marker' | 'route' | 'area' | 'other';

export type ObjectRecenterPlan =
  | { kind: 'fitCollection'; coordinates: Coordinate[] }
  | { kind: 'focusPoint'; coordinate: Coordinate; zoom: number };

/** Common detail target for explicit recenter actions; never zoom out from the current view. */
export function objectFocusZoom(currentZoom: number, kind: FocusObjectKind): number {
  const normal = kind === 'marker' ? 16 : kind === 'route' || kind === 'area' ? 15 : 16;
  return Math.max(Number.isFinite(currentZoom) ? currentZoom : normal, normal);
}

/** Center the smallest longitude arc and latitude bounds without changing camera scale. */
export function objectCenter(coordinates: readonly Coordinate[]): Coordinate | null {
  if (!coordinates.length) return null;
  if (coordinates.length === 1) return [...coordinates[0]!] as Coordinate;
  const [[west, south], [east, north]] = routeBounds([coordinates as Coordinate[]]);
  const longitude = west + (east - west) / 2;
  return [((longitude + 180) % 360 + 360) % 360 - 180, south + (north - south) / 2];
}

/** Routes recenter to their complete bounds; point-like objects retain the existing center/zoom behavior. */
export function objectRecenterPlan(
  coordinates: readonly Coordinate[],
  kind: FocusObjectKind,
  currentZoom: number,
): ObjectRecenterPlan | null {
  if (!coordinates.length) return null;
  if (kind === 'route') return { kind: 'fitCollection', coordinates: coordinates.map(([lng, lat]) => [lng, lat] as Coordinate) };
  const coordinate = objectCenter(coordinates);
  return coordinate ? { kind: 'focusPoint', coordinate, zoom: objectFocusZoom(currentZoom, kind) } : null;
}
