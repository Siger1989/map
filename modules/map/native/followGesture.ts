import type { ScreenPoint } from '../../tracks/drawing.ts';

export type NativeFollowGesture = {
  gestureId: string | number | null;
  start: ScreenPoint;
  multiTouch: boolean;
  endedFollow: boolean;
};

export function beginNativeFollowGesture(
  gestureId: string | number | null,
  start: ScreenPoint,
  pointerCount: number,
): NativeFollowGesture {
  return { gestureId, start: { ...start }, multiTouch: pointerCount > 1, endedFollow: false };
}

export function advanceNativeFollowGesture(
  gesture: NativeFollowGesture | null,
  action: number,
  pointerCount: number,
  point: ScreenPoint,
  touchSlop: number,
): { gesture: NativeFollowGesture | null; endedFollow: boolean } {
  if (!gesture) return { gesture: null, endedFollow: false };
  if (action === 1 || action === 3) return { gesture: null, endedFollow: false };
  if (action === 5 || pointerCount > 1) {
    return { gesture: { ...gesture, multiTouch: true }, endedFollow: false };
  }
  if (action !== 2 || gesture.multiTouch || pointerCount !== 1 || gesture.endedFollow) return { gesture, endedFollow: false };
  const threshold = Number.isFinite(touchSlop) ? Math.max(0, touchSlop) : 8;
  const crossedSlop = Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > threshold;
  if (!crossedSlop) return { gesture, endedFollow: false };
  return { gesture: { ...gesture, endedFollow: true }, endedFollow: true };
}
