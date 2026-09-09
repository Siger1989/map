export const LAST_VIEW_KEY = 'shantu.map.last-view.v1';
export type SavedMapView = { center: [number, number]; zoom: number; bearing: number; pitch: number };
export function parseLastView(raw: string | null): SavedMapView | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    if (!v || !Array.isArray(v.center) || v.center.length !== 2 ||
      ![...v.center, v.zoom, v.bearing, v.pitch].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(v.center[0]) > 180 || Math.abs(v.center[1]) > 85.051129 ||
      v.zoom < 0 || v.zoom > 20 || v.pitch < 0 || v.pitch > 80) return null;
    return { center: [v.center[0], v.center[1]], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch };
  } catch { return null; }
}
export function readLastView(): SavedMapView | null {
  try { return parseLastView(localStorage.getItem(LAST_VIEW_KEY)); } catch { return null; }
}
export function saveLastView(view: SavedMapView) {
  try { const valid = parseLastView(JSON.stringify(view)); if (valid) localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(valid)); } catch { /* A disabled/full store must not interrupt map gestures. */ }
}
