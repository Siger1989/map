import type { Coordinate } from '../../navigation/types.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';

export type NativeDrawingGroundHit = { point: ScreenPoint; coordinate: Coordinate; cameraKey: string };
export type NativeDrawingCamera = { center: Coordinate; zoom: number; pitch: number; bearing: number; detailZoom?: number } | null;

export function drawingCameraKey(camera: NativeDrawingCamera): string {
  return camera ? JSON.stringify([camera.center[0], camera.center[1], camera.zoom, camera.detailZoom ?? null, camera.pitch, camera.bearing]) : '';
}

export function updateNativeDrawingGroundHit(
  previous: NativeDrawingGroundHit | null,
  event: { type: string; point?: ScreenPoint | null; groundPoint?: ScreenPoint | null; coordinate?: Coordinate | null; pointerCount?: number },
  active: boolean,
  camera: NativeDrawingCamera,
): NativeDrawingGroundHit | null {
  if (!active || event.type === 'cancel' || event.pointerCount !== undefined && event.pointerCount > 1) return null;
  if (event.type === 'end') return previous;
  if (event.type !== 'start' && event.type !== 'move') return previous;
  // New hosts provide a real terrain hit for DrawingSession's offset aim point.
  // Older payloads omit groundPoint and retain their exact finger-hit behavior.
  const hitPoint = event.groundPoint !== undefined ? event.groundPoint : event.point;
  if (!hitPoint || !event.coordinate || !camera) return null;
  return { point: { ...hitPoint }, coordinate: [event.coordinate[0], event.coordinate[1]], cameraKey: drawingCameraKey(camera) };
}

export function invalidateNativeDrawingGroundHit(hit: NativeDrawingGroundHit | null, camera: NativeDrawingCamera): NativeDrawingGroundHit | null {
  return hit && hit.cameraKey === drawingCameraKey(camera) ? hit : null;
}

export function nativeDrawingCoordinateAt(
  hit: NativeDrawingGroundHit | null, point: ScreenPoint, active: boolean, camera: NativeDrawingCamera,
  toleranceCssPixels = 1.5,
): Coordinate | null {
  if (!active || !hit || hit.cameraKey !== drawingCameraKey(camera) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return Math.hypot(point.x - hit.point.x, point.y - hit.point.y) <= toleranceCssPixels ? hit.coordinate : null;
}
