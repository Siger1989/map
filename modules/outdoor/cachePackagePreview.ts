import type { TripPackage } from './offline.ts';
import type { Coordinate } from '../navigation/types.ts';

export type CachePreviewGeometryStatus = 'available' | 'missing' | 'invalid';
export type CachePreviewCacheState = 'not-started' | 'partial' | 'complete';

export type CachePackagePreviewFeature = {
  type: 'Feature';
  properties: {
    role: 'route' | 'planning-range' | 'area-range';
    segmentIndex?: number;
    label?: string;
  };
  geometry:
    | { type: 'LineString'; coordinates: Coordinate[] }
    | { type: 'Polygon'; coordinates: Coordinate[][] };
};

/**
 * Preview-only geometry and honest package counters. The polygon is the saved
 * planning bounds; it does not describe which individual tiles are available.
 */
export type CachePackagePreview = {
  geojson: { type: 'FeatureCollection'; features: CachePackagePreviewFeature[] };
  routeGeometry: CachePreviewGeometryStatus;
  areaGeometry: CachePreviewGeometryStatus;
  areaBoundary: Coordinate[] | null;
  rangeKind: 'planning-bounds';
  plannedBounds: TripPackage['bounds'] | null;
  bufferKm: number | null;
  progress: { done: number; total: number; state: CachePreviewCacheState };
};

function validCoordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length >= 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
}

function validBounds(value: unknown): value is TripPackage['bounds'] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] >= -180 && value[2] <= 180 && value[1] >= -90 && value[3] <= 90 &&
    value[0] < value[2] && value[1] < value[3];
}

export function cachePackagePreview(trip: TripPackage): CachePackagePreview {
  const features: CachePackagePreviewFeature[] = [];
  const savedSegments = trip.routeSegments;
  let routeGeometry: CachePreviewGeometryStatus = 'missing';
  if (Array.isArray(savedSegments) && savedSegments.length) {
    const valid = savedSegments.every(segment => Array.isArray(segment) && segment.length >= 2 && segment.every(validCoordinate));
    if (!valid) routeGeometry = 'invalid';
    else {
      routeGeometry = 'available';
      savedSegments.forEach((segment, segmentIndex) => features.push({
        type: 'Feature',
        properties: { role: 'route', segmentIndex },
        geometry: { type: 'LineString', coordinates: segment.map(([lon, lat]) => [lon, lat]) },
      }));
    }
  }

  let areaBoundary: Coordinate[] | null = null;
  let areaGeometry: CachePreviewGeometryStatus = 'missing';
  if (Array.isArray(trip.areaBoundary) && trip.areaBoundary.length) {
    const valid = trip.areaBoundary.length >= 3 && trip.areaBoundary.length <= 2000 &&
      trip.areaBoundary.every(point => validCoordinate(point) && Math.abs(point[1]) <= 85);
    if (!valid) areaGeometry = 'invalid';
    else {
      areaGeometry = 'available';
      areaBoundary = trip.areaBoundary.map(([lon, lat]) => [lon, lat]);
      if (areaBoundary[0][0] !== areaBoundary.at(-1)![0] || areaBoundary[0][1] !== areaBoundary.at(-1)![1])
        areaBoundary.push([...areaBoundary[0]]);
      features.push({
        type: 'Feature',
        properties: { role: 'area-range', label: '所选区域边界' },
        geometry: { type: 'Polygon', coordinates: [areaBoundary] },
      });
    }
  }

  let plannedBounds: TripPackage['bounds'] | null = null;
  if (validBounds(trip.bounds)) {
    const [west, south, east, north] = trip.bounds;
    plannedBounds = [west, south, east, north];
    features.push({
      type: 'Feature',
      properties: { role: 'planning-range', label: '规划范围（不代表实际已缓存覆盖）' },
      geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    });
  }

  const done = Number.isFinite(trip.done) ? Math.max(0, trip.done) : 0;
  const totalValue = trip.urlCount ?? trip.urls.length;
  const total = Number.isFinite(totalValue) ? Math.max(0, totalValue) : 0;
  const complete = trip.complete === true && total > 0 && done >= total;
  return {
    geojson: { type: 'FeatureCollection', features },
    routeGeometry,
    areaGeometry,
    areaBoundary,
    rangeKind: 'planning-bounds',
    plannedBounds,
    bufferKm: typeof trip.bufferKm === 'number' && Number.isFinite(trip.bufferKm) ? trip.bufferKm : null,
    progress: { done, total, state: complete ? 'complete' : done > 0 ? 'partial' : 'not-started' },
  };
}
