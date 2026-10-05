import converter from 'coordtransform';
import type { LayerSettings } from '../map/types';
import { usesSentinel } from '../cartography/sentinel.ts';

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
  for (let row = 0; row <= WARP_GRID; row++) for (let col = 0; col <= WARP_GRID; col++) {
    const ll = pixelLngLat((x + col / WARP_GRID) * tileSize, (y + row / WARP_GRID) * tileSize, size);
    const p = worldPixel(...fromWgs84(...ll, datum), size);
    points.push(...p);
  }

  // Resampling evaluates only output pixel centers. Within each warp-grid
  // cell, each source coordinate is bilinear and therefore stays within the
  // extrema at the four corners of the sampled pixel-center rectangle. The
  // worker's output size is the decoded input width (256 or 512), so compute
  // both grids even when the nominal source tileSize is 1024/2048.
  const interpolate = (a: number, b: number, c: number, d: number, u: number, v: number) =>
    (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  const gridSize = WARP_GRID + 1;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const pixels of new Set([256, 512, tileSize])) {
    const step = pixels / WARP_GRID, ratio = pixels / tileSize;
    const firstPixel = (cell: number) => Math.max(0, Math.ceil(cell * step - 0.5));
    const lastPixel = (cell: number) => Math.min(pixels - 1, Math.ceil((cell + 1) * step - 0.5) - 1);
    let sampleMinX = Infinity, sampleMinY = Infinity, sampleMaxX = -Infinity, sampleMaxY = -Infinity;
    for (let row = 0; row < WARP_GRID; row++) for (let col = 0; col < WARP_GRID; col++) {
      const x0 = firstPixel(col), x1 = lastPixel(col);
      const y0 = firstPixel(row), y1 = lastPixel(row);
      const u0 = (x0 + 0.5) / step - col, u1 = (x1 + 0.5) / step - col;
      const v0 = (y0 + 0.5) / step - row, v1 = (y1 + 0.5) / step - row;
      const a = (row * gridSize + col) * 2, b = a + 2;
      const c = a + gridSize * 2, d = c + 2;
      const ax = points[a] * ratio, bx = points[b] * ratio;
      const cx = points[c] * ratio, dx = points[d] * ratio;
      const ay = points[a + 1] * ratio, by = points[b + 1] * ratio;
      const cy = points[c + 1] * ratio, dy = points[d + 1] * ratio;
      for (const v of [v0, v1]) for (const u of [u0, u1]) {
        const sx = interpolate(ax, bx, cx, dx, u, v);
        const sy = interpolate(ay, by, cy, dy, u, v);
        sampleMinX = Math.min(sampleMinX, sx); sampleMinY = Math.min(sampleMinY, sy);
        sampleMaxX = Math.max(sampleMaxX, sx); sampleMaxY = Math.max(sampleMaxY, sy);
      }
    }
    const firstX = Math.floor(sampleMinX - 0.5), lastX = Math.floor(sampleMaxX - 0.5 + 0.001) + 1;
    const firstY = Math.floor(sampleMinY - 0.5), lastY = Math.floor(sampleMaxY - 0.5 + 0.001) + 1;
    left = Math.min(left, Math.floor(firstX / pixels));
    right = Math.max(right, Math.floor(lastX / pixels));
    top = Math.min(top, Math.floor(firstY / pixels));
    bottom = Math.max(bottom, Math.floor(lastY / pixels));
  }
  top = Math.max(0, top);
  bottom = Math.min(2 ** z - 1, bottom);
  if ((right - left + 1) * (bottom - top + 1) > 16) throw Error('坐标转换跨越边界，请使用 WGS84 图源');
  return { points, left, top, width: right - left + 1, height: bottom - top + 1, tileSize };
}
export type WarpPlan = ReturnType<typeof warpPlan>;

/** Keep the same geographic footprint when a provider returns retina pixels. */
export function rasterPixelPlan(plan: WarpPlan, pixels: number): WarpPlan {
  if (pixels !== 256 && pixels !== 512) return plan;
  if (pixels === plan.tileSize) return plan;
  const ratio = pixels / plan.tileSize;
  return { ...plan, tileSize: pixels, points: plan.points.map(value => value * ratio) };
}
