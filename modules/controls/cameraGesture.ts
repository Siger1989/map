export const clampPitch = (pitch: number) => Math.max(0, Math.min(80, pitch));
export const wrapBearing = (bearing: number) =>
  ((((bearing + 180) % 360) + 360) % 360) - 180;
/** Shortest signed movement across north, without a 360-degree jump. */
export const ringDelta = (previous: number, next: number) =>
  wrapBearing(next - previous);
export const ringAngle = (x: number, y: number) =>
  (Math.atan2(x / 46, -y / 23) * 180) / Math.PI;

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
    pitch: clampPitch(start.pitch - dy * 1.35),
    bearing: wrapBearing(start.bearing + dx * 1.35),
  };
}
