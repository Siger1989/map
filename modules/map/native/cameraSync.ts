import type { CameraSnapshot } from '../../controls/useMapFocusLock.ts';

const copy = (camera: CameraSnapshot): CameraSnapshot => ({ ...camera, center: [...camera.center] });
const wrappedDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

// WorldWind reconstructs its camera from eye position and terrain elevation.
// A camera restored from a rounded zoom/center can therefore return a slightly
// different snapshot even though no one touched the map. Keep this tolerance
// tight enough to reject an actual pan/zoom while absorbing that round trip.
const ROUND_TRIP = {
  centerDegrees: 0.0001,
  zoom: 0.12,
  pitchDegrees: 0.5,
  bearingDegrees: 0.5,
};

const closeTo = (a: CameraSnapshot, b: CameraSnapshot) =>
  wrappedDelta(a.center[0], b.center[0]) <= ROUND_TRIP.centerDegrees &&
  Math.abs(a.center[1] - b.center[1]) <= ROUND_TRIP.centerDegrees &&
  Math.abs(a.zoom - b.zoom) <= ROUND_TRIP.zoom &&
  Math.abs(a.pitch - b.pitch) <= ROUND_TRIP.pitchDegrees &&
  wrappedDelta(a.bearing, b.bearing) <= ROUND_TRIP.bearingDegrees;

const sameSnapshot = (a: CameraSnapshot, b: CameraSnapshot) =>
  wrappedDelta(a.center[0], b.center[0]) < 1e-7 && Math.abs(a.center[1] - b.center[1]) < 1e-7 &&
  Math.abs(a.zoom - b.zoom) < 1e-7 && Math.abs(a.pitch - b.pitch) < 1e-7 && wrappedDelta(a.bearing, b.bearing) < 1e-7;

type CameraIntent = { token: number; target: CameraSnapshot; before: CameraSnapshot | null; acknowledged: boolean };
const MAX_RECENT_INTENTS = 12;

/**
 * Tracks camera commands sent to the native map so their rendered frames do
 * not echo back as new input. Native camera snapshots are reconstructed from
 * terrain/eye state and are not expected to compare exactly with the request.
 */
export class NativeCameraSync {
  private nextToken = 1;
  private lastGestureToken = 0;
  private intents: CameraIntent[] = [];

  /** Returns an intent token for native bridges that can echo command origin. */
  apply(camera: CameraSnapshot, previous: CameraSnapshot | null): number {
    const token = this.nextToken++;
    this.intents.push({ token, target: copy(camera), before: previous ? copy(previous) : null, acknowledged: false });
    if (this.intents.length > MAX_RECENT_INTENTS) this.intents.splice(0, this.intents.length - MAX_RECENT_INTENTS);
    return token;
  }

  /** A real DOWN cancels camera-response suppression so the user's gesture wins. */
  beginUserGesture() {
    this.intents = [];
    this.lastGestureToken = this.nextToken - 1;
  }

  isProgrammatic(camera: CameraSnapshot, originToken?: number | null) {
    if (originToken !== undefined) {
      if (originToken === null) {
        const latest = this.intents[this.intents.length - 1];
        // A captured pre-command frame can arrive before the host has applied/acknowledged
        // the request. Suppress only that exact prior pose, never a different navigation move.
        return !!latest && !latest.acknowledged && !!latest.before && sameSnapshot(camera, latest.before);
      }
      const intent = this.intents.find(item => item.token === originToken);
      if (intent) intent.acknowledged = true;
      return Number.isSafeInteger(originToken) && originToken > 0 && originToken < this.nextToken;
    }
    // Some native event paths do not yet include the command token. Accept a
    // bounded history of intended frames and their immediately prior camera;
    // a mismatch is not evidence of a user gesture, since it can be an
    // intermediate animation frame or the terrain-adjusted final frame.
    return this.intents.some(intent => closeTo(camera, intent.target) ||
      (intent.before !== null && closeTo(camera, intent.before)));
  }

  /**
   * A command echo from before the latest real gesture is stale. Callers may
   * suppress its business callback without replacing their current camera,
   * which may already contain frames from that gesture.
   */
  isStaleProgrammatic(originToken?: number | null) {
    if (originToken === undefined || originToken === null || !Number.isSafeInteger(originToken) ||
        originToken <= 0 || originToken >= this.nextToken) return false;
    const latestToken = this.nextToken - 1;
    // A later command replaces the older target; a real DOWN invalidates every
    // command already issued. In either case, a delayed frame must not replace
    // a newer camera snapshot held by the map runtime.
    return originToken < latestToken || originToken <= this.lastGestureToken;
  }
}
