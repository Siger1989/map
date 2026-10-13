import type { Map as MapLibreMap } from 'maplibre-gl';

export type SelectionCoordinate = [number, number] | null | undefined;

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_MERCATOR_LATITUDE = 85;
const MIN_NEAR_RADIUS_METERS = 150;

function finiteCoordinate(value: SelectionCoordinate): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function metersBetween(a: [number, number], b: [number, number]): number {
  const radians = Math.PI / 180;
  const latA = a[1] * radians;
  const latB = b[1] * radians;
  const deltaLat = latB - latA;
  // Normalize longitude delta so points on opposite sides of 180 degrees stay adjacent.
  const deltaLng = ((b[0] - a[0] + 540) % 360 - 180) * radians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function selectionMarkerNearRadiusMeters(
  centerLatitude: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): number | null {
  if (![centerLatitude, zoom, canvasWidth, canvasHeight].every(Number.isFinite) || canvasWidth <= 0 || canvasHeight <= 0) return null;
  const latitude = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, centerLatitude));
  const metersPerPixel = EARTH_CIRCUMFERENCE_METERS * Math.cos(latitude * Math.PI / 180) / (512 * 2 ** zoom);
  const radius = metersPerPixel * Math.min(canvasWidth, canvasHeight) * 0.75;
  return Number.isFinite(radius) ? Math.max(MIN_NEAR_RADIUS_METERS, radius) : null;
}

export function isSelectionMarkerWithinRadius(
  center: [number, number],
  coordinate: SelectionCoordinate,
  nearRadiusMeters: number,
): boolean {
  if (!finiteCoordinate(coordinate) || !center.every(Number.isFinite) || !Number.isFinite(nearRadiusMeters)) return true;
  return metersBetween(center, coordinate) <= nearRadiusMeters;
}

export function installSelectionMarkerVisibility(
  map: MapLibreMap,
  marker: HTMLElement,
  getSelectedCoordinate: () => SelectionCoordinate,
) {
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    try {
      const canvas = map.getCanvas();
      const center = map.getCenter();
      const radius = selectionMarkerNearRadiusMeters(center.lat, map.getZoom(), canvas.clientWidth, canvas.clientHeight);
      // Invalid or unavailable map state fails open, keeping the selected coordinate available.
      const visible = radius === null || isSelectionMarkerWithinRadius(
        [center.lng, center.lat], getSelectedCoordinate(), radius,
      );
      marker.classList.toggle('is-distance-hidden', !visible);
    } catch {
      marker.classList.remove('is-distance-hidden');
    }
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    map.off('move', refresh);
    map.off('resize', refresh);
    map.off('remove', cleanup);
    marker.classList.remove('is-distance-hidden');
  };

  map.on('move', refresh);
  map.on('resize', refresh);
  map.on('remove', cleanup);
  refresh();
  return { refresh, cleanup };
}
