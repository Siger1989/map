/** Vertical spacing in metres. DEM source/resolution stays unchanged. */
export type ContourInterval = 30 | 50 | 100 | 200;
export const CONTOUR_INTERVAL_KEY = 'shantu.contour-interval.v1';
export const CONTOUR_INTERVALS = [30, 50, 100, 200] as const;
export function contourInterval(value: unknown): ContourInterval {
  return value === 50 || value === 100 || value === 200 ? value : 30;
}
export function readContourInterval(): ContourInterval {
  try { return contourInterval(JSON.parse(localStorage.getItem(CONTOUR_INTERVAL_KEY) ?? '30')); }
  catch { return 30; }
}
export function saveContourInterval(value: ContourInterval) {
  try { localStorage.setItem(CONTOUR_INTERVAL_KEY, String(contourInterval(value))); } catch { /* Session setting still works. */ }
}
export function contourMinimumZoom(value: unknown) {
  const interval = contourInterval(value);
  return interval === 30 ? 11 : interval === 50 ? 10 : interval === 100 ? 9 : 8;
}
export function contourTileOptions(interval: unknown, z: number) {
  const minor = contourInterval(interval);
  return {
    // DemSource clamps to native z12 and splits the parent for the z13 output.
    overzoom: 0,
    // Match MapLibre's internal extent so loading does not re-quantize vertices.
    extent: 8192,
    levels: z < 7 ? [] : [minor, minor * 5],
    elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
  };
}
