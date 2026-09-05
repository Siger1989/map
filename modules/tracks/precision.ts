import type { ScreenPoint } from './drawing';
/** Keep the actual aim point clear of the finger while respecting viewport edges. */
export function aimPoint(
  finger: ScreenPoint,
  width: number,
  height: number,
): ScreenPoint {
  return {
    x: Math.max(8, Math.min(width - 8, finger.x)),
    y: Math.max(8, Math.min(height - 8, finger.y - 44)),
  };
}
export function handlePoint(
  anchor: ScreenPoint,
  length: number,
  height: number,
): ScreenPoint {
  return {
    x: anchor.x,
    y: anchor.y + length <= height - 76 ? anchor.y + length : anchor.y - length,
  };
}
export const nearHandle = (finger: ScreenPoint, handle: ScreenPoint) =>
  Math.hypot(finger.x - handle.x, finger.y - handle.y) <= 30;
