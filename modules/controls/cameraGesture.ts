export const clampPitch = (pitch: number) => Math.max(0, Math.min(80, pitch));
export const wrapBearing = (bearing: number) =>
  ((((bearing + 180) % 360) + 360) % 360) - 180;
/** Shortest signed movement across north, without a 360-degree jump. */
export const ringDelta = (previous: number, next: number) =>
  wrapBearing(next - previous);
export const ringAngle = (x: number, y: number) =>
  (Math.atan2(x / 46, -y / 23) * 180) / Math.PI;
/** Elliptical radius in the same coordinate system as the visible bearing ring. */
export const ringRadius = (x: number, y: number) => Math.hypot(x / 46, y / 23);
export const RING_DEADZONE = 0.55;
export const canStartRingDrag = (x: number, y: number) => {
  const radius = ringRadius(x, y);
  // Include the outer edge of the 26-unit invisible stroke at the short axis.
  return radius >= RING_DEADZONE && radius <= 1.6;
};

// SVG-space touch displacement. Ignore sub-pixel/near-stationary touch noise,
// ease in gently, then return to the existing gain for deliberate larger drags.
const ORBIT_DEADZONE = 1.5;
const ORBIT_EASE_RANGE = 10;
const ORBIT_LOW_GAIN = 0.45;
const ORBIT_FULL_GAIN = 1.35;
export function shapeOrbitDisplacement(displacement: number) {
  const magnitude = Math.abs(displacement);
  if (magnitude <= ORBIT_DEADZONE) return 0;
  const eased = magnitude - ORBIT_DEADZONE;
  const shaped = eased <= ORBIT_EASE_RANGE
    ? ORBIT_LOW_GAIN * eased + ((ORBIT_FULL_GAIN - ORBIT_LOW_GAIN) * eased * eased) / (2 * ORBIT_EASE_RANGE)
    : ORBIT_LOW_GAIN * ORBIT_EASE_RANGE + ((ORBIT_FULL_GAIN - ORBIT_LOW_GAIN) * ORBIT_EASE_RANGE) / 2 + ORBIT_FULL_GAIN * (eased - ORBIT_EASE_RANGE);
  return Math.sign(displacement) * shaped;
}

/** Crossing the centre pauses rotation; re-entry establishes a new angle, not a jump. */
export function rotateCameraRing(
  previous: { angle: number | null; bearing: number; ringPoint?: { x: number; y: number } },
  x: number,
  y: number,
) {
  const ringPoint = { x, y };
  if (ringRadius(x, y) < RING_DEADZONE)
    return { angle: null, bearing: previous.bearing, ringPoint };
  const angle = ringAngle(x, y);
  let crossesCentre = false;
  if (previous.ringPoint) {
    const px = previous.ringPoint.x / 46, py = previous.ringPoint.y / 23;
    const dx = x / 46 - px, dy = y / 23 - py;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(px * dx + py * dy) / lengthSquared)) : 0;
    // A fast pointer can cross the whole deadzone between two delivered events.
    crossesCentre = Math.hypot(px + t * dx, py + t * dy) < RING_DEADZONE;
  }
  return {
    angle,
    ringPoint,
    bearing: previous.angle === null || crossesCentre
      ? previous.bearing
      : wrapBearing(previous.bearing + ringDelta(previous.angle, angle)),
  };
}

export type CameraGesturePose = { pitch: number; bearing: number };
export type CameraGesturePhase = 'move' | 'end' | 'cancel';

/** Coalesce pointer updates to one latest pose per frame and preserve the final pose. */
export function createCameraGestureFrame(
  publish: (pose: CameraGesturePose, phase: CameraGesturePhase) => void,
  requestFrame: (callback: FrameRequestCallback) => number = (callback) =>
    requestAnimationFrame(callback),
  cancelFrame: (frame: number) => void = (frame) => cancelAnimationFrame(frame),
) {
  let frame: number | null = null;
  let pending: CameraGesturePose | null = null;
  let applied: CameraGesturePose | null = null;
  let active = false;
  const flush = () => {
    frame = null;
    if (!pending) return;
    applied = pending;
    pending = null;
    active = true;
    publish(applied, 'move');
  };
  const clearFrame = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
  };
  return {
    move(pose: CameraGesturePose) {
      pending = pose;
      if (frame === null) frame = requestFrame(flush);
    },
    end(finalPose?: CameraGesturePose) {
      clearFrame();
      const hasPending = pending !== null;
      const final = finalPose ?? pending ?? applied;
      pending = null;
      if (final && (active || hasPending)) {
        applied = final;
        publish(final, 'end');
      }
      active = false;
    },
    cancel() {
      clearFrame();
      pending = null;
      if (active && applied) publish(applied, 'cancel');
      active = false;
    },
  };
}

/** Drag in SVG coordinates: horizontal orbits, upward tilts; keep the map centre. */
export function orbitCamera(
  start: { pitch: number; bearing: number },
  dx: number,
  dy: number,
) {
  return {
    pitch: clampPitch(start.pitch - shapeOrbitDisplacement(dy)),
    bearing: wrapBearing(start.bearing + shapeOrbitDisplacement(dx)),
  };
}
