import type { CameraSnapshot } from '../controls/useMapFocusLock';
import { cameraDetailZoom, withCameraDetailZoom } from './cameraDetailZoom.ts';

type CameraView = {
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getPitch: () => number;
  getBearing: () => number;
  on?: (type: 'zoom', listener: () => void) => unknown;
};
type CameraMap = CameraView & { jumpTo: (camera: CameraSnapshot) => unknown };

type FocusPointMap = {
  flyTo: (options: {
    center: CameraSnapshot['center'];
    zoom?: number;
    duration: number;
  }) => unknown;
};

/** Focuses a coordinate while leaving the current zoom untouched unless requested. */
export function focusPointCamera(
  map: FocusPointMap,
  center: CameraSnapshot['center'],
  zoom?: number,
) {
  map.flyTo({
    center,
    ...(zoom === undefined ? {} : { zoom: Math.max(3, Math.min(20, zoom)) }),
    duration: 700,
  });
}

const copyCamera = (camera: CameraSnapshot): CameraSnapshot => ({
  center: [...camera.center],
  zoom: camera.zoom,
  pitch: camera.pitch,
  bearing: camera.bearing,
  ...(camera.detailZoom === undefined ? {} : { detailZoom: camera.detailZoom }),
});

/** Suppresses only camera events whose snapshot still matches the last requested sync. */
export class CameraSync {
  private target: CameraSnapshot | null = null;
  private pending: CameraSnapshot | null = null;

  hasTarget() {
    return this.target !== null;
  }

  pendingCamera() {
    return this.pending ? copyCamera(this.pending) : null;
  }

  queue(camera: CameraSnapshot) {
    this.pending = copyCamera(camera);
  }

  remember(map: CameraView) {
    const center = map.getCenter();
    const camera = {
      center: [center.lng, center.lat] as CameraSnapshot['center'],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      detailZoom: cameraDetailZoom(map),
    };
    this.queue(camera);
    return camera;
  }

  apply(map: CameraMap, camera: CameraSnapshot) {
    this.queue(camera);
    this.target = copyCamera(camera);
    withCameraDetailZoom(map, camera.detailZoom ?? camera.zoom, () => map.jumpTo(this.target!));
  }

  isProgrammatic(map: CameraMap) {
    const target = this.target;
    if (!target) return false;
    const center = map.getCenter();
    const longitudeDelta = ((center.lng - target.center[0] + 540) % 360) - 180;
    const matches = Math.abs(longitudeDelta) < 1e-7 &&
      Math.abs(center.lat - target.center[1]) < 1e-7 &&
      Math.abs(map.getZoom() - target.zoom) < 1e-7 &&
      Math.abs(map.getPitch() - target.pitch) < 1e-7 &&
      Math.abs(map.getBearing() - target.bearing) < 1e-7;
    if (!matches) this.target = null;
    return matches;
  }
}
