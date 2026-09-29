import type { CameraSnapshot } from '../controls/useMapFocusLock';

type CameraView = {
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getPitch: () => number;
  getBearing: () => number;
};
type CameraMap = CameraView & { jumpTo: (camera: CameraSnapshot) => unknown };

const copyCamera = (camera: CameraSnapshot): CameraSnapshot => ({
  center: [...camera.center],
  zoom: camera.zoom,
  pitch: camera.pitch,
  bearing: camera.bearing,
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
    };
    this.queue(camera);
    return camera;
  }

  apply(map: CameraMap, camera: CameraSnapshot) {
    this.queue(camera);
    this.target = copyCamera(camera);
    map.jumpTo(this.target);
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
