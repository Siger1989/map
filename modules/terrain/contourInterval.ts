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
export function contourTileOptions(interval: unknown, z: number) {
  // Keep wide-area views bounded; high zoom uses the user's exact interval.
  const minimum = z < 10 ? 500 : z < 12 ? 200 : z < 14 ? 100 : 0;
  const minor = Math.max(contourInterval(interval), minimum);
  return {
    overzoom: Math.max(0, z - 12),
    levels: z < 7 ? [] : [minor, minor * 5],
    elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
  };
}
