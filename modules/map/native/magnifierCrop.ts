import type { ScreenPoint } from '../../tracks/drawing.ts';

export type CssRect = { x: number; y: number; width: number; height: number };
export type MagnifierCropWindow = { source: CssRect; destination: CssRect };

/** Returns the pointer-centered 32 CSS px source window within a captured ROI. */
export function magnifierCropWindow(point: ScreenPoint, roi: CssRect, span = 32): MagnifierCropWindow | null {
  if (![point.x, point.y, roi.x, roi.y, roi.width, roi.height, span].every(Number.isFinite) ||
      roi.width <= 0 || roi.height <= 0 || span <= 0 ||
      point.x < roi.x || point.x > roi.x + roi.width || point.y < roi.y || point.y > roi.y + roi.height) return null;
  const x = point.x - span / 2, y = point.y - span / 2;
  const left = Math.max(x, roi.x), top = Math.max(y, roi.y);
  const right = Math.min(x + span, roi.x + roi.width), bottom = Math.min(y + span, roi.y + roi.height);
  if (right <= left || bottom <= top) return null;
  return {
    source: { x: left - roi.x, y: top - roi.y, width: right - left, height: bottom - top },
    destination: { x: (left - x) / span, y: (top - y) / span, width: (right - left) / span, height: (bottom - top) / span },
  };
}
