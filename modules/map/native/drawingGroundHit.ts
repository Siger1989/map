import type { Coordinate } from '../../navigation/types.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';

export type NativeDrawingProjection = {
  sequence?: number;
  viewProjection: readonly number[];
  inverseViewProjection: readonly number[];
  viewport: { x: number; y: number; width: number; height: number };
  cssScale: number;
  terrainEnabled?: boolean;
  verticalExaggeration?: number;
  demRevision: number;
};
export type NativeDrawingGroundHit = { point: ScreenPoint; coordinate: Coordinate; cameraKey: string; projectionKey: string };
export type NativeDrawingCamera = { center: Coordinate; zoom: number; pitch: number; bearing: number; detailZoom?: number } | null;

export function drawingProjectionKey(projection?: NativeDrawingProjection | null): string | null {
  if (!projection) return null;
  const values = [...(projection.sequence === undefined ? [] : [projection.sequence]), ...projection.viewProjection, ...projection.inverseViewProjection,
    projection.viewport.x, projection.viewport.y, projection.viewport.width, projection.viewport.height,
    projection.cssScale, projection.terrainEnabled !== false, projection.verticalExaggeration ?? 1, projection.demRevision];
  return values.every((value) => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'boolean')
    ? JSON.stringify(values) : null;
}

export function drawingCameraKey(camera: NativeDrawingCamera): string {
  return camera ? JSON.stringify([camera.center[0], camera.center[1], camera.zoom, camera.detailZoom ?? null, camera.pitch, camera.bearing]) : '';
}

export function updateNativeDrawingGroundHit(
  previous: NativeDrawingGroundHit | null,
  event: { type: string; point?: ScreenPoint | null; groundPoint?: ScreenPoint | null; coordinate?: Coordinate | null; pointerCount?: number; groundFrameSequence?: number | null },
  active: boolean,
  camera: NativeDrawingCamera,
  projection?: NativeDrawingProjection | null,
): NativeDrawingGroundHit | null {
  if (!active || event.type === 'cancel' || event.pointerCount !== undefined && event.pointerCount > 1) return null;
  if (event.type === 'end') return previous;
  if (event.type !== 'start' && event.type !== 'move') return previous;
  if (Object.prototype.hasOwnProperty.call(event, 'groundFrameSequence') &&
      (typeof event.groundFrameSequence !== 'number' || !Number.isSafeInteger(event.groundFrameSequence) ||
        event.groundFrameSequence !== projection?.sequence)) return null;
  // New hosts provide a real terrain hit for DrawingSession's offset aim point.
  // Older payloads omit groundPoint and retain their exact finger-hit behavior.
  const hitPoint = event.groundPoint !== undefined ? event.groundPoint : event.point;
  if (!hitPoint || !event.coordinate || !camera) return null;
  return { point: { ...hitPoint }, coordinate: [event.coordinate[0], event.coordinate[1]], cameraKey: drawingCameraKey(camera),
    projectionKey: drawingProjectionKey(projection) ?? drawingCameraKey(camera) };
}

export function invalidateNativeDrawingGroundHit(
  hit: NativeDrawingGroundHit | null, camera: NativeDrawingCamera, projection?: NativeDrawingProjection | null,
): NativeDrawingGroundHit | null {
  const projectionKey = drawingProjectionKey(projection);
  return hit && hit.cameraKey === drawingCameraKey(camera) &&
    (projectionKey === null || hit.projectionKey === projectionKey) ? hit : null;
}

export function nativeDrawingCoordinateAt(
  hit: NativeDrawingGroundHit | null, point: ScreenPoint, active: boolean, camera: NativeDrawingCamera,
  toleranceCssPixels = 1.5, projection?: NativeDrawingProjection | null,
): Coordinate | null {
  const projectionKey = drawingProjectionKey(projection);
  if (!active || !hit || hit.cameraKey !== drawingCameraKey(camera) ||
      projectionKey !== null && hit.projectionKey !== projectionKey ||
      !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return Math.hypot(point.x - hit.point.x, point.y - hit.point.y) <= toleranceCssPixels ? hit.coordinate : null;
}
