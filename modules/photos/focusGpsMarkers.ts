import { coordinate, type Coordinate } from '../navigation/types.ts';

type PhotoMapView = {
  cameraSnapshot: () => { zoom: number } | null;
  focusPoint: (point: Coordinate, zoom?: number) => void;
  fitCollection: (points: Coordinate[], padding?: { top: number; right: number; bottom: number; left: number }) => void;
};

/** Viewing a saved batch must never turn a successful photo save into a reported failure. */
export function focusGpsPhotoMarkers(view: PhotoMapView | null, coordinates: Coordinate[], panelOpen = true) {
  if (!view) return false;
  const seen = new Set<string>();
  const points = coordinates.filter((point) => {
    if (!coordinate(point)) return false;
    const key = `${point[0]},${point[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!points.length) return false;
  try {
    if (points.length === 1) {
      const currentZoom = view.cameraSnapshot()?.zoom;
      view.focusPoint(points[0], Number.isFinite(currentZoom) ? Math.max(16, currentZoom!) : 16);
    } else {
      view.fitCollection(points, { top: panelOpen ? 260 : 90, right: 84, bottom: 90, left: 24 });
    }
    return true;
  } catch {
    return false;
  }
}
