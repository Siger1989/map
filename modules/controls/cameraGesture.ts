export const clampPitch = (pitch: number) => Math.max(0, Math.min(80, pitch));
export const wrapBearing = (bearing: number) =>
  ((((bearing + 180) % 360) + 360) % 360) - 180;
/** Shortest signed movement across north, without a 360-degree jump. */
export const ringDelta = (previous: number, next: number) =>
  wrapBearing(next - previous);
export const ringAngle = (x: number, y: number) =>
  (Math.atan2(x / 46, -y / 23) * 180) / Math.PI;
