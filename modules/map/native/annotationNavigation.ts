import type { Annotation } from '../../annotations/data.ts';
import { markerPresentation, markerScale } from '../../annotations/markerScale.ts';
import type { Coordinate } from '../../navigation/types.ts';
import type { NativeProjectionFrame } from './types.ts';

const MAX_OCCLUSION_GROUND_ERROR_METERS = 8;

export type NativeAnnotationNavigationPin = { annotation: Annotation; x: number; y: number; scale: number };

/** Resolve only label-mode pins whose ground point is currently visible above the DEM. */
export function nativeAnnotationNavigationPins(
  annotations: Annotation[], selectedId: string | null, frame: NativeProjectionFrame | null,
  geometry: {
    elevation: (coordinate: Coordinate) => { status: 'ready'; value: number } | { status: 'blocked'; reason?: string };
    project: (coordinate: Coordinate) => { status: 'ready'; value: { x: number; y: number } } | { status: 'blocked'; reason?: string };
    unproject: (point: { x: number; y: number }) => { status: 'ready'; value: { coordinate: Coordinate } } | { status: 'blocked'; reason?: string };
  },
): NativeAnnotationNavigationPin[] {
  if (!frame || !Number.isFinite(frame.cssScale) || frame.cssScale <= 0) return [];
  const width = frame.viewport.width / frame.cssScale, height = frame.viewport.height / frame.cssScale;
  if (!(width > 0 && height > 0)) return [];
  const result: NativeAnnotationNavigationPin[] = [];
  for (const annotation of annotations) {
    if (!annotation.visible || annotation.kind !== 'pin' || markerPresentation(frame.camera.zoom, annotation.id === selectedId) !== 'label') continue;
    if (frame.terrainEnabled !== false && geometry.elevation(annotation.coordinates).status !== 'ready') continue;
    const projected = geometry.project(annotation.coordinates);
    if (projected.status !== 'ready') continue;
    const { x, y } = projected.value;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) continue;
    const ground = geometry.unproject({ x, y });
    if (ground.status !== 'ready' || greatCircleMeters(annotation.coordinates, ground.value.coordinate) > MAX_OCCLUSION_GROUND_ERROR_METERS) continue;
    result.push({ annotation, x, y, scale: markerScale(frame.camera.zoom) });
  }
  return result;
}

function greatCircleMeters(a: Coordinate, b: Coordinate): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(b[1] - a[1]), dLon = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]), lat2 = toRadians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
