import type { CameraSnapshot } from '../../controls/useMapFocusLock.ts';

const copy = (camera: CameraSnapshot): CameraSnapshot => ({ ...camera, center: [...camera.center] });
const matches = (a: CameraSnapshot, b: CameraSnapshot) =>
  Math.abs(((a.center[0] - b.center[0] + 540) % 360) - 180) < 1e-7 &&
  Math.abs(a.center[1] - b.center[1]) < 1e-7 && Math.abs(a.zoom - b.zoom) < 1e-7 &&
  Math.abs(a.pitch - b.pitch) < 1e-7 && Math.abs(((a.bearing - b.bearing + 540) % 360) - 180) < 1e-7;

/** CameraSync's target contract, allowing an already queued native frame before the command arrives. */
export class NativeCameraSync {
  private target: CameraSnapshot | null = null;
  private beforeRequest: CameraSnapshot | null = null;

  apply(camera: CameraSnapshot, previous: CameraSnapshot | null) {
    this.target = copy(camera);
    this.beforeRequest = previous ? copy(previous) : null;
  }

  beginUserGesture() { this.target = null; this.beforeRequest = null; }

  isProgrammatic(camera: CameraSnapshot) {
    if (!this.target) return false;
    if (matches(camera, this.target)) { this.beforeRequest = null; return true; }
    // A Web jumpTo is synchronous; a native bridge may still deliver the prior frame.
    if (this.beforeRequest && matches(camera, this.beforeRequest)) return true;
    this.beginUserGesture();
    return false;
  }
}
