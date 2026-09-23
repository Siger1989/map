import converter from 'coordtransform';
import type { LayerSettings } from '../map/types';
import { usesSentinel } from '../cartography/sentinel';

export type RasterDatum = 'wgs84' | 'gcj02' | 'bd09';
export const COORDINATES_KEY = 'shantu.map-source-coordinates.v1';
export function readRasterDatums(): Record<string, RasterDatum> {
  try {
    const value = JSON.parse(localStorage.getItem(COORDINATES_KEY) ?? '{}');
    return Object.fromEntries(Object.entries(value).filter(([key, datum]) =>
      key.length < 100 && ['wgs84', 'gcj02', 'bd09'].includes(String(datum)))) as Record<string, RasterDatum>;
  } catch { return {}; }
}
export function rasterDatumKey(settings: LayerSettings, customId?: string) {
  return customId ? `custom:${customId}` : usesSentinel(settings) ? 'sentinel'
    : settings.satelliteProvider === 'tianditu' && !settings.offlineBasemap ? `tianditu:${settings.tiandituBase ?? (settings.satellite ? 'img' : 'vec')}`
      : settings.satellite ? settings.imageryMode : 'terrain';
}
/** Source datum, not camera/output datum. All app features remain in WGS84. */
export function fromWgs84(lng: number, lat: number, datum: RasterDatum): [number, number] {
  if (datum === 'wgs84') return [lng, lat];
  const gcj = converter.wgs84togcj02(lng, lat);
  return datum === 'gcj02' ? gcj : converter.gcj02tobd09(...gcj);
}
export function worldPixel(lng: number, lat: number, size: number): [number, number] {
  const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
  return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}
export function pixelLngLat(x: number, y: number, size: number): [number, number] {
  return [x / size * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI];
}
export const WARP_GRID = 16;
/** Sample an output WGS84 tile into the original provider's Web Mercator pixels. */
export function warpPlan(z: number, x: number, y: number, tileSize: number, datum: RasterDatum) {
  const size = tileSize * 2 ** z, points: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let row = 0; row <= WARP_GRID; row++) for (let col = 0; col <= WARP_GRID; col++) {
    const ll = pixelLngLat((x + col / WARP_GRID) * tileSize, (y + row / WARP_GRID) * tileSize, size);
    const p = worldPixel(...fromWgs84(...ll, datum), size);
    points.push(...p);
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  const left = Math.floor((minX - 1) / tileSize), right = Math.floor((maxX + 1) / tileSize);
  const top = Math.max(0, Math.floor((minY - 1) / tileSize)), bottom = Math.min(2 ** z - 1, Math.floor((maxY + 1) / tileSize));
  if ((right - left + 1) * (bottom - top + 1) > 16) throw Error('坐标转换跨越边界，请使用 WGS84 图源');
  return { points, left, top, width: right - left + 1, height: bottom - top + 1, tileSize };
}
export type WarpPlan = ReturnType<typeof warpPlan>;
