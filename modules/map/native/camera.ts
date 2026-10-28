import { navigationCameraOptions, type NavigationCameraOptions } from '../../guidance/forwardCamera.ts';
import { twoFingerGestureDelta } from '../../collections/boxSelection.ts';
import type { Coordinate } from '../../navigation/types.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';
import type { CameraSnapshot } from '../../controls/useMapFocusLock.ts';
import type { NavigationCameraRequest } from '../TerrainMap.tsx';
import type { RouteGap } from '../../tracks/routeInfo.ts';

export type NativeCameraCommand = CameraSnapshot & {
  offset?: [number, number];
  duration?: number;
};

export function nativeFocusCamera(
  current: CameraSnapshot,
  center: Coordinate,
  zoom?: number,
  pitch?: number,
): NativeCameraCommand {
  return {
    center: [center[0], center[1]],
    zoom: zoom === undefined ? current.zoom : clamp(zoom, 3, 20),
    pitch: pitch === undefined ? current.pitch : clamp(pitch, 0, 80),
    bearing: current.bearing,
    duration: 700,
  };
}

export function nativeFocusPositionCamera(
  current: CameraSnapshot,
  center: Coordinate,
  zoom: number,
  pitch: number,
): NativeCameraCommand {
  return {
    center: [center[0], center[1]],
    zoom: clamp(zoom, 3, 16),
    pitch: clamp(pitch, 0, 80),
    bearing: 0,
    duration: 700,
  };
}

export function nativeNavigationCamera(
  current: CameraSnapshot,
  request: NavigationCameraRequest,
  center: Coordinate,
  height: number,
  usableRect?: { top: number; bottom: number },
): NativeCameraCommand {
  const options = navigationCameraOptions({
    center,
    heading: request.heading ?? undefined,
    path: request.path,
    progress: request.progress,
    height,
    forward: request.forward,
    animate: request.animate,
    close: request.close,
    travelMode: request.travelMode,
    pose: request.pose,
    bearing: current.bearing,
    usableRect,
  });
  return mergeNavigationOptions(current, options);
}

export function nativePreviewNavigationCamera(
  current: CameraSnapshot,
  center: Coordinate,
  path: Coordinate[],
  forward: boolean,
  height: number,
  zoom?: number,
  usableRect?: { top: number; bottom: number },
): NativeCameraCommand {
  const options = navigationCameraOptions({
    center,
    path,
    progress: 0,
    height,
    forward,
    animate: true,
    bearing: current.bearing,
    usableRect,
  });
  return mergeNavigationOptions(current, { ...options, ...(zoom === undefined ? {} : { zoom }) });
}

function mergeNavigationOptions(current: CameraSnapshot, options: NavigationCameraOptions): NativeCameraCommand {
  return {
    center: options.center,
    zoom: options.zoom ?? current.zoom,
    pitch: options.pitch,
    bearing: options.bearing ?? current.bearing,
    offset: options.offset,
    duration: options.duration,
  };
}

export function nativeViewCamera(current: CameraSnapshot, pitch: number, bearing: number, animate: boolean): NativeCameraCommand {
  return {
    center: current.center,
    zoom: current.zoom,
    pitch: clamp(pitch, 0, 80),
    bearing,
    duration: animate ? 700 : 0,
  };
}

export function nativeRouteGapCamera(current: CameraSnapshot, gap: RouteGap, width: number, height: number): NativeCameraCommand {
  const latitude = (gap.from[1] + gap.to[1]) / 2;
  const pixels = Math.max(80, Math.min(width * 0.5, height * 0.35));
  const zoom = clamp(Math.log2(78271.5 * Math.cos(latitude * Math.PI / 180) * pixels / Math.max(gap.distance, 0.1)), 4, 18);
  const longitudeDelta = ((gap.to[0] - gap.from[0] + 540) % 360) - 180;
  return { center: [gap.from[0] + longitudeDelta / 2, latitude], zoom, pitch: 0, bearing: 0, duration: 0 };
}

export function nativeRouteIssueCamera(point: Coordinate): NativeCameraCommand {
  return { center: [point[0], point[1]], zoom: 17, pitch: 0, bearing: 0, duration: 0 };
}

export function nativeAnchoredGesture(
  current: CameraSnapshot,
  previous: [ScreenPoint, ScreenPoint],
  next: [ScreenPoint, ScreenPoint],
  anchorCoordinate: Coordinate,
): { camera: CameraSnapshot; anchor: { coordinate: Coordinate; from: ScreenPoint; to: ScreenPoint } } {
  const delta = twoFingerGestureDelta(previous, next);
  const camera: CameraSnapshot = {
    center: current.center,
    zoom: clamp(current.zoom + delta.zoom, 0, 24),
    pitch: current.pitch,
    bearing: normalizeBearing(current.bearing + delta.rotation),
  };
  return {
    camera,
    anchor: {
      coordinate: [anchorCoordinate[0], anchorCoordinate[1]],
      from: { x: delta.around.x - delta.pan.x, y: delta.around.y - delta.pan.y },
      to: delta.around,
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}
