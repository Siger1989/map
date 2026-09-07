export const clampPitch = (pitch: number) => Math.max(0, Math.min(80, pitch));
export const wrapBearing = (bearing: number) =>
  ((((bearing + 180) % 360) + 360) % 360) - 180;
/** Shortest signed movement across north, without a 360-degree jump. */
export const ringDelta = (previous: number, next: number) =>
  wrapBearing(next - previous);
export const ringAngle = (x: number, y: number) =>
  (Math.atan2(x / 46, -y / 23) * 180) / Math.PI;

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
