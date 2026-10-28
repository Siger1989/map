import type { NativeMapBridgeClient } from './client.ts';
import type { Coordinate } from '../../navigation/types.ts';

export type NativeLocalPoint = { x: number; y: number };

/**
 * Geometry project/unproject already use map-local CSS pixels. The viewport origin
 * locates the native surface; it must not be applied a second time by DOM callers.
 */
export function projectNativeLocal(client: NativeMapBridgeClient, mapId: string, coordinate: Coordinate): NativeLocalPoint | null {
  const frame = client.cameraFrame(mapId);
  if (!frame || !Number.isFinite(frame.cssScale) || frame.cssScale <= 0) return null;
  const projected = client.geometry(mapId).project(coordinate);
  if (projected.status !== 'ready') return null;
  const x = projected.value.x;
  const y = projected.value.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function unprojectNativeLocal(client: NativeMapBridgeClient, mapId: string, point: NativeLocalPoint): Coordinate | null {
  const frame = client.cameraFrame(mapId);
  if (!frame || !Number.isFinite(frame.cssScale) || frame.cssScale <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const result = client.geometry(mapId).unproject(point);
  return result.status === 'ready' ? result.value.coordinate : null;
}
