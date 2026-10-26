import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';

const EARTH_CIRCUMFERENCE_METERS = 40075016.68557849;
const EARTH_RADIUS_METERS = 6371008.8;
const MAX_MERCATOR_LATITUDE = 85;

export type NearbyMarkerRange = {
  center: [number, number];
  enterRadiusMeters: number;
  exitRadiusMeters: number;
};

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
  const lat1 = range.center[1] * Math.PI / 180, lat2 = point[1] * Math.PI / 180;
  const deltaLat = lat2 - lat1;
  const deltaLngDegrees = ((point[0] - range.center[0] + 540) % 360) - 180;
  const deltaLng = deltaLngDegrees * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2), sinLng = Math.sin(deltaLng / 2);
  const a = Math.min(1, Math.max(0, sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng));
  const distance = EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distance <= (wasAttached ? range.exitRadiusMeters : range.enterRadiusMeters);
}
