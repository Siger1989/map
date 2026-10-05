import type { PlannedRoute } from './types';

/** Restored routes are clones; match their identity and geographic endpoints. */
export function samePlannedRoute(a: PlannedRoute, b: PlannedRoute | null) {
  if (!b || a.createdAt !== b.createdAt || a.mode !== b.mode || a.coordinates.length !== b.coordinates.length) return false;
  const equal = (left: number[] | undefined, right: number[] | undefined) =>
    !!left && !!right && left[0] === right[0] && left[1] === right[1];
  return equal(a.coordinates[0], b.coordinates[0]) && equal(a.coordinates.at(-1), b.coordinates.at(-1));
}
