import type { Coordinate } from '../navigation/types.ts';
import { routeBounds } from '../routeShare/data.ts';

export type FocusObjectKind = 'marker' | 'route' | 'area' | 'other';

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
