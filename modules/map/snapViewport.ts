import type { Map } from 'maplibre-gl';
import { SNAP_RADIUS, type SnapViewport } from '../tracks/snapping.ts';

type LngLatLike = { lng: number; lat: number };
type BoundsLike = {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
};
type SnapViewportMap = Pick<
  Map,
  'getBounds' | 'getCenter' | 'getZoom' | 'getPitch' | 'getBearing' | 'getCanvas' | 'unproject' | 'project'
> & { getTerrain?: () => unknown };

const HIGH_PITCH_FALLBACK = 75;
const MAX_LONGITUDE_SPAN = 170;
const MAX_LATITUDE_SPAN = 120;
const PAD_FRACTION = 0.2;
const MIN_PAD_DEGREES = 0.0001;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function unwrapNear(reference: number, longitude: number): number {
  const delta = longitude - reference;
  return reference + (((delta % 360) + 540) % 360) - 180;
}

function boundsPart(bounds: BoundsLike, centerLng: number) {
  const rawWest = bounds.getWest();
  const rawEast = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  if (![rawWest, rawEast, south, north].every(Number.isFinite) || Math.abs(rawEast - rawWest) >= 360) return null;
  const west = unwrapNear(centerLng, rawWest);
  const east = unwrapNear(centerLng, rawEast);
  if (![west, east].every(Number.isFinite)) return null;
  // Preserve a wrapped bounds span, while making the representation continuous
  // around the camera center (SnapCandidateIndex accepts east > 180).
  let adjustedEast = east;
  if (adjustedEast < west) adjustedEast += 360;
  if (adjustedEast - west > 180) return null;
  return {
    west,
    east: adjustedEast,
    south,
    north,
  };
}

/**
 * Reads a sample-derived coarse viewport for snap-candidate filtering.
 * The bound includes a 14 CSS px margin for candidates that can snap from just
 * outside the canvas. Uncertain camera/horizon states return null so callers can
 * keep the full candidate set and use exact screen projection. Terrain curvature
 * between samples is not mathematically bounded by this geographic envelope.
 */
export function createSnapViewportReader(map: SnapViewportMap): {
  read(): SnapViewport | null;
  invalidate(): void;
} {
  let epoch = 0;
  let cachedKey = '';
  let cached: SnapViewport | null = null;
  let revision = 0;

  const poseKey = () => {
    const center = map.getCenter();
    const canvas = map.getCanvas();
    const terrain = map.getTerrain?.() ?? null;
    let terrainKey = '';
    try {
      terrainKey = JSON.stringify(terrain) ?? '';
    } catch {
      terrainKey = 'terrain-unknown';
    }
    return [
      epoch,
      center.lng,
      center.lat,
      map.getZoom(),
      map.getPitch(),
      map.getBearing(),
      canvas.clientWidth,
      canvas.clientHeight,
      terrainKey,
    ].join('|');
  };

  const read = (): SnapViewport | null => {
    let key: string;
    try {
      key = poseKey();
    } catch {
      cachedKey = `${epoch}|unavailable`;
      cached = null;
      revision += 1;
      return null;
    }
    if (key === cachedKey) return cached;
    cachedKey = key;
    cached = null;
    revision += 1;

    try {
      const center = map.getCenter();
      const width = map.getCanvas().clientWidth;
      const height = map.getCanvas().clientHeight;
      const pitch = map.getPitch();
      if (
        ![center.lng, center.lat, width, height, pitch, map.getZoom(), map.getBearing()].every(finite) ||
        width <= 0 ||
        height <= 0 ||
        Math.abs(center.lat) >= 84.5 ||
        pitch >= HIGH_PITCH_FALLBACK
      ) return cached;

      const area = boundsPart(map.getBounds(), center.lng);
      if (!area || area.south > area.north || area.south <= -90 || area.north >= 90) return cached;

      const xs = [-SNAP_RADIUS, width * 0.25, width * 0.5, width * 0.75, width + SNAP_RADIUS];
      const ys = [-SNAP_RADIUS, height * 0.25, height * 0.5, height * 0.75, height + SNAP_RADIUS];
      const longitudes = [area.west, area.east];
      const latitudes = [area.south, area.north];
      const perimeter: [number, number][] = [
        ...xs.map((x): [number, number] => [x, ys[0]]),
        ...xs.map((x): [number, number] => [x, ys[4]]),
        ...ys.slice(1, -1).map((y): [number, number] => [xs[0], y]),
        ...ys.slice(1, -1).map((y): [number, number] => [xs[4], y]),
      ];
      for (const [x, y] of perimeter) {
        const point = map.unproject([x, y]) as LngLatLike | null | undefined;
        if (!point || !finite(point.lng) || !finite(point.lat) || Math.abs(point.lat) >= 85) return cached;
        const projected = map.project([point.lng, point.lat]);
        if (
          !projected ||
          !finite(projected.x) ||
          !finite(projected.y) ||
          Math.hypot(projected.x - x, projected.y - y) > 1.5
        ) return cached;
        longitudes.push(unwrapNear(center.lng, point.lng));
        latitudes.push(point.lat);
      }

      let west = Math.min(...longitudes);
      let east = Math.max(...longitudes);
      let south = Math.min(...latitudes);
      let north = Math.max(...latitudes);
      const longitudeSpan = east - west;
      const latitudeSpan = north - south;
      // Near the horizon, inverse projection can jump to a distant ground point;
      // a world-scale bound gives no useful screen-space guarantee.
      if (
        ![west, east, south, north].every(Number.isFinite) ||
        longitudeSpan >= MAX_LONGITUDE_SPAN ||
        latitudeSpan >= MAX_LATITUDE_SPAN ||
        south <= -84.5 ||
        north >= 84.5
      ) return cached;

      // MercatorTransform.getBounds() samples four corners; the terrain-aware
      // unproject/project checks above sample the expanded perimeter at 16 points.
      // This slack helps between samples but is not a proof for arbitrary terrain
      // variation. Exact screen projection still decides the final snap target.
      const lngPad = Math.max(MIN_PAD_DEGREES, longitudeSpan * PAD_FRACTION);
      const latPad = Math.max(MIN_PAD_DEGREES, latitudeSpan * PAD_FRACTION);
      west -= lngPad;
      east += lngPad;
      south = Math.max(-85, south - latPad);
      north = Math.min(85, north + latPad);
      cached = { west, south, east, north, width, height, revision };
      return cached;
    } catch {
      // Projection may be transiently unavailable during style/context changes.
      // Cache null for this pose and let the caller use exact full-set projection.
      return cached;
    }
  };

  return {
    read,
    invalidate() {
      epoch += 1;
    },
  };
}
