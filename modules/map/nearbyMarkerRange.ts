import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';

const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849;
const EARTH_RADIUS_METERS = 6371008.8;
const MAX_MERCATOR_LATITUDE = 85;

export type NearbyMarkerRange = {
  center: [number, number];
  enterRadiusMeters: number;
  exitRadiusMeters: number;
};

function metersBetween(a: [number, number], b: [number, number]): number {
  const lat1 = a[1] * Math.PI / 180, lat2 = b[1] * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLngDegrees = ((b[0] - a[0] + 540) % 360) - 180;
  const deltaLng = deltaLngDegrees * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2), sinLng = Math.sin(deltaLng / 2);
  const h = Math.min(1, Math.max(0, sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng));
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function coordinatePair(coordinate: LngLatLike): [number, number] | null {
  try {
    if (Array.isArray(coordinate)) return [Number(coordinate[0]), Number(coordinate[1])];
    if ('lng' in coordinate) return [Number(coordinate.lng), Number(coordinate.lat)];
    return [Number(coordinate.lon), Number(coordinate.lat)];
  } catch { return null; }
}

export function getNearbyMarkerRange(map: MapLibreMap): NearbyMarkerRange | null {
  try {
    const centerValue = map.getCenter();
    const center = [Number(centerValue.lng), Number(centerValue.lat)] as [number, number];
    const zoom = map.getZoom();
    const canvas = map.getCanvas();
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!center.every(Number.isFinite) || Math.abs(center[1]) >= MAX_MERCATOR_LATITUDE ||
      !Number.isFinite(zoom) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      return null;
    const metersPerPixel = EARTH_CIRCUMFERENCE_METERS * Math.cos(center[1] * Math.PI / 180) /
      (512 * 2 ** zoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
    const radius = Math.max(150, metersPerPixel * Math.hypot(width, height) * 0.6);
    return { center, enterRadiusMeters: radius * 0.9, exitRadiusMeters: radius };
  } catch { return null; }
}

export function isCoordinateWithinNearbyRange(
  range: NearbyMarkerRange | null, coordinate: LngLatLike, wasAttached = false,
): boolean {
  if (!range) return true;
  const point = coordinatePair(coordinate);
  if (!point || !point.every(Number.isFinite) || Math.abs(point[1]) >= MAX_MERCATOR_LATITUDE ||
    !range.center.every(Number.isFinite) || Math.abs(range.center[1]) >= MAX_MERCATOR_LATITUDE)
    return true;
  return metersBetween(range.center, point) <= (wasAttached ? range.exitRadiusMeters : range.enterRadiusMeters);
}

/** A bounded candidate filter for high-pitch viewports before doing terrain projection work. */
export function isCoordinateWithinNearbyCandidateRange(
  range: NearbyMarkerRange | null,
  coordinate: LngLatLike,
  multiplier: number,
): boolean {
  if (!range || !Number.isFinite(multiplier) || multiplier < 1) return false;
  const distance = distanceFromNearbyCenterMeters(range, coordinate);
  return distance !== null && distance <= range.exitRadiusMeters * multiplier;
}

export function distanceFromNearbyCenterMeters(range: NearbyMarkerRange | null, coordinate: LngLatLike): number | null {
  if (!range) return null;
  const point = coordinatePair(coordinate);
  return point && point.every(Number.isFinite) ? metersBetween(range.center, point) : null;
}

export type ProjectedVisibilityCheck = {
  visible: boolean;
  actualPixel: { x: number; y: number } | null;
  onCanvas: boolean;
  roundTripMeters: number | null;
  toleranceMeters: number | null;
};

/** Measures the projected ground point and terrain-aware reverse projection. */
export function inspectProjectedCoordinateVisibility(
  map: Pick<MapLibreMap, 'project' | 'unproject' | 'getCanvas' | 'getCenter' | 'getZoom'>,
  coordinate: LngLatLike,
): ProjectedVisibilityCheck {
  try {
    const canvas = map.getCanvas();
    const point = map.project(coordinate);
    if (![point.x, point.y].every(Number.isFinite))
      return { visible: false, actualPixel: null, onCanvas: false, roundTripMeters: null, toleranceMeters: null };
    const actualPixel = { x: point.x, y: point.y };
    const onCanvas = point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
    if (!onCanvas)
      return { visible: false, actualPixel, onCanvas, roundTripMeters: null, toleranceMeters: null };
    const projected = coordinatePair(coordinate);
    const surface = coordinatePair(map.unproject([point.x, point.y]));
    if (!projected || !surface || !surface.every(Number.isFinite))
      return { visible: false, actualPixel, onCanvas, roundTripMeters: null, toleranceMeters: null };
    const center = map.getCenter();
    const metersPerPixel = EARTH_CIRCUMFERENCE_METERS * Math.cos(center.lat * Math.PI / 180) /
      (512 * 2 ** map.getZoom());
    const roundTripTolerance = Math.max(8, metersPerPixel * 2);
    const roundTripMeters = metersBetween(projected, surface);
    return {
      visible: Number.isFinite(roundTripTolerance) && roundTripMeters <= roundTripTolerance,
      actualPixel,
      onCanvas,
      roundTripMeters,
      toleranceMeters: roundTripTolerance,
    };
  } catch {
    return { visible: false, actualPixel: null, onCanvas: false, roundTripMeters: null, toleranceMeters: null };
  }
}

/** True only when the projected ground point is inside the viewport and survives a terrain-aware round trip. */
export function isProjectedCoordinateVisible(
  map: Pick<MapLibreMap, 'project' | 'unproject' | 'getCanvas' | 'getCenter' | 'getZoom'>,
  coordinate: LngLatLike,
): boolean {
  return inspectProjectedCoordinateVisibility(map, coordinate).visible;
}
