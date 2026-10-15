import { coordinate, metresBetween, type Coordinate, type TravelMode } from '../navigation/types.ts';
import { pathOf, pointAt, project, type Path } from './geometry.ts';

export type NavigationCameraOptionsInput = {
  center: Coordinate;
  heading?: number;
  path?: Coordinate[] | Path;
  /** Cumulative distance in metres from the start of path. */
  progress?: number;
  /** Height of the usable map viewport, in CSS pixels. */
  height: number;
  forward: boolean;
  animate?: boolean;
  /** Current map bearing, used only as a safe fallback and to unwrap the shortest turn. */
  bearing?: number;
  /** Optional visible vertical range within height. */
  usableRect?: { top: number; bottom: number };
  /** Only set on explicit entry/resume; ordinary fixes preserve the user's zoom. */
  close?: boolean;
  travelMode?: TravelMode;
  /** A user-adjusted pose persists while GPS continues moving the center. */
  pose?: { pitch: number; bearing: number } | null;
};

export type NavigationCameraOptions = {
  center: Coordinate;
  pitch: number;
  bearing?: number;
  offset: [number, number];
  duration: number;
  zoom?: number;
};

const FORWARD_PITCH = 60;
export const navigationCloseZoom = (mode?: TravelMode) => mode === 'pedestrian' ? 18.2 : mode === 'bicycle' ? 17.8 : 17.4;
const FORWARD_OFFSET_MARGIN = 8;
const FORWARD_PUCK_CLEARANCE = 32;
const TANGENT_SAMPLE_METRES = 45;
const MIN_TANGENT_METRES = 8;

function finiteAngle(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function unwrapNear(target: number, reference: number) {
  const shortestDelta = ((normalizeHeading(target) - normalizeHeading(reference) + 540) % 360) - 180;
  return reference + shortestDelta;
}

function bearingBetween(from: Coordinate, to: Coordinate): number | undefined {
  const deltaLongitude = ((to[0] - from[0] + 540) % 360) - 180;
  const phi1 = from[1] * Math.PI / 180;
  const phi2 = to[1] * Math.PI / 180;
  const lambda = deltaLongitude * Math.PI / 180;
  const y = Math.sin(lambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 1e-12) return undefined;
  return normalizeHeading(Math.atan2(y, x) * 180 / Math.PI);
}

function asPath(value: Coordinate[] | Path | undefined): Path | undefined {
  if (!value) return undefined;
  try {
    if (!Array.isArray(value) && 'points' in value && Array.isArray(value.points) && Array.isArray(value.cumulative)) {
      if (value.points.length < 2 || value.cumulative.length !== value.points.length ||
          !value.points.every(coordinate) || !value.cumulative.every(Number.isFinite) ||
          !Number.isFinite(value.length) || value.length < 0) return undefined;
      return value;
    }
    return pathOf(value as Coordinate[]);
  } catch {
    return undefined;
  }
}

function routeHeading(
  center: Coordinate,
  routePath: Path | undefined,
  progress: number | undefined,
) {
  if (!routePath || !Number.isFinite(routePath.length) || routePath.length < MIN_TANGENT_METRES) return undefined;

  let at: number;
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    at = Math.max(0, Math.min(routePath.length, progress));
  } else {
    const projection = project(routePath, center);
    if (!Number.isFinite(projection.offset) || projection.offset > 100) return undefined;
    at = projection.distance;
  }

  let fromDistance = at;
  let toDistance = Math.min(routePath.length, at + TANGENT_SAMPLE_METRES);
  if (toDistance - fromDistance < MIN_TANGENT_METRES) {
    fromDistance = Math.max(0, at - TANGENT_SAMPLE_METRES);
    toDistance = at;
  }
  if (toDistance - fromDistance < MIN_TANGENT_METRES) return undefined;

  const from = pointAt(routePath, fromDistance);
  const to = pointAt(routePath, toDistance);
  if (metresBetween(from, to) < MIN_TANGENT_METRES) return undefined;
  return bearingBetween(from, to);
}

function viewportOffset(height: number, usableRect: NavigationCameraOptionsInput['usableRect'], forward: boolean): number {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const rawTop = usableRect?.top ?? 0;
  const rawBottom = usableRect?.bottom ?? height;
  if (!Number.isFinite(rawTop) || !Number.isFinite(rawBottom)) return 0;
  const top = Math.max(0, Math.min(height, rawTop));
  const bottom = Math.max(0, Math.min(height, rawBottom));
  const safeTop = top + FORWARD_OFFSET_MARGIN;
  const safeBottom = bottom - (forward ? FORWARD_PUCK_CLEARANCE : FORWARD_OFFSET_MARGIN);
  const usableHeight = safeBottom - safeTop;
  if (usableHeight <= 0) return 0;
  // Keep space behind the puck as well as ahead, including when chrome is hidden.
  const preferredY = forward ? safeTop + usableHeight * 0.68 : height / 2;
  const targetY = Math.max(safeTop, Math.min(safeBottom, preferredY));
  return Math.max(safeTop - height / 2, Math.min(safeBottom - height / 2, targetY - height / 2));
}

/** Frame the next stretch of route; only explicit close-view entry changes zoom. */
export function navigationCameraOptions(input: NavigationCameraOptionsInput): NavigationCameraOptions {
  const center: Coordinate = [input.center[0], input.center[1]];
  const fallbackBearing = finiteAngle(input.bearing) ? input.bearing : undefined;
  if (!input.forward) {
    return { center, pitch: input.pose ? Math.max(0, Math.min(80, input.pose.pitch)) : 0, ...(input.pose ? { bearing: input.pose.bearing } : fallbackBearing === undefined ? {} : { bearing: fallbackBearing }), offset: [0, viewportOffset(input.height, input.usableRect, false)], duration: input.animate ? 650 : 0 };
  }

  const heading = finiteAngle(input.heading)
    ? input.heading
    : routeHeading(center, asPath(input.path), input.progress);
  const bearing = heading === undefined
    ? fallbackBearing
    : fallbackBearing === undefined ? normalizeHeading(heading) : unwrapNear(heading, fallbackBearing);

  return {
    center,
    pitch: input.pose ? Math.max(0, Math.min(80, input.pose.pitch)) : FORWARD_PITCH,
    ...(input.close ? { zoom: navigationCloseZoom(input.travelMode) } : {}),
    ...(input.pose ? { bearing: input.pose.bearing } : bearing === undefined ? {} : { bearing }),
    offset: [0, viewportOffset(input.height, input.usableRect, true)],
    duration: input.animate ? 650 : 0,
  };
}
