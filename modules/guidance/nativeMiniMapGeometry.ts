import type { Coordinate } from '../navigation/types.ts';
import type { CameraSnapshot } from '../controls/useMapFocusLock.ts';

export type MiniMapPadding = { top: number; right: number; bottom: number; left: number };
export const ROUTE_MINI_PADDING: MiniMapPadding = { top: 30, right: 86, bottom: 30, left: 30 };

const MAX_LATITUDE = 85.0511287798066;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mercatorY = (latitude: number) => {
  const radians = clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2;
};
const inverseMercatorY = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
const wrapLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180;
function minimalBounds(points: Coordinate[]): [Coordinate, Coordinate] | null {
  const longitudes = points.map(([longitude]) => ((longitude % 360) + 360) % 360).sort((a, b) => a - b);
  if (!longitudes.length) return null;
  let largestGap = -1, start = 0;
  for (let index = 0; index < longitudes.length; index++) {
    const gap = (index === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[index + 1]) - longitudes[index];
    if (gap > largestGap) { largestGap = gap; start = (index + 1) % longitudes.length; }
  }
  const westValue = longitudes[start];
  const west = westValue > 180 ? westValue - 360 : westValue;
  return [[west, Math.min(...points.map((point) => point[1]))], [west + 360 - largestGap, Math.max(...points.map((point) => point[1]))]];
}

/** MapLibre-compatible 512 CSS-pixel camera fit with the original mini-map padding. */
export function fitNativeRouteMiniMap(
  coordinates: Coordinate[],
  width: number,
  height: number,
  current: Pick<CameraSnapshot, 'pitch' | 'bearing'> = { pitch: 0, bearing: 0 },
  padding: MiniMapPadding = ROUTE_MINI_PADDING,
): CameraSnapshot | null {
  const points = coordinates.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length < 2 || width <= padding.left + padding.right || height <= padding.top + padding.bottom) return null;
  const bounds = minimalBounds(points);
  if (!bounds) return null;
  const [[west, south], [east, north]] = bounds;
  const minX = (west + 180) / 360;
  const maxX = (east + 180) / 360;
  const minY = mercatorY(north);
  const maxY = mercatorY(south);
  const dx = Math.max(1e-9, maxX - minX);
  const dy = Math.max(1e-9, maxY - minY);
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  const zoom = clamp(Math.min(
    Math.log2(usableWidth / (512 * dx)),
    Math.log2(usableHeight / (512 * dy)),
    16,
  ), 0, 16);
  const worldSize = 512 * 2 ** zoom;
  const centerX = (minX + maxX) / 2 - (padding.left - padding.right) / (2 * worldSize);
  const centerY = (minY + maxY) / 2 - (padding.top - padding.bottom) / (2 * worldSize);
  return {
    center: [wrapLongitude(centerX * 360 - 180), clamp(inverseMercatorY(centerY), -MAX_LATITUDE, MAX_LATITUDE)],
    zoom,
    pitch: current.pitch,
    bearing: current.bearing,
  };
}

export type NativeMiniLine = {
  key: string;
  coordinates: Coordinate[];
  color: string;
  opacity: number;
  width: number;
  selected: boolean;
  access: boolean;
};
export type MiniRouteOption = {
  id: string;
  coordinates: Coordinate[];
  color: string;
  segments?: { kind: 'road' | 'access'; coordinates: Coordinate[] }[];
  opacity?: number;
};

/** Preserve the original route-choice, selected outline, access dash, and opacity contract. */
export function nativeMiniRouteLines(options: MiniRouteOption[], selectedId: string): NativeMiniLine[] {
  return options.flatMap((route) => {
    const selected = route.id === selectedId;
    const segments = route.segments?.length ? route.segments : [{ kind: 'road' as const, coordinates: route.coordinates }];
    return segments.filter((segment) => segment.coordinates.length >= 2).map((segment, index) => ({
      key: `${route.id}:${index}`,
      coordinates: segment.coordinates,
      color: route.color,
      opacity: selected ? (route.opacity ?? 1) : 0.5,
      width: selected ? (segment.kind === 'access' ? 4 : 7) : 3,
      selected,
      access: segment.kind === 'access',
    }));
  });
}
