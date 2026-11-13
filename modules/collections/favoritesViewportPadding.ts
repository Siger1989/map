export type ViewportRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ViewportPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/** Extra fitBounds padding for the part of the map covered by the favorites workbench. */
export function favoritesViewportPadding(
  map: ViewportRect,
  panel: ViewportRect,
  width: number,
  height: number,
  margin = 16,
  base: ViewportPadding = { top: 0, right: 0, bottom: 0, left: 0 },
): ViewportPadding | null {
  const overlapLeft = Math.max(map.left, panel.left);
  const overlapTop = Math.max(map.top, panel.top);
  const overlapRight = Math.min(map.right, panel.right);
  const overlapBottom = Math.min(map.bottom, panel.bottom);
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop || width <= 0 || height <= 0) return null;

  const overlapsMapEdge = (edge: number, covered: number) => Math.abs(edge - covered) <= 1;
  const spansMapWidth = overlapRight - overlapLeft >= width * 0.7;
  const spansMapHeight = overlapBottom - overlapTop >= height * 0.7;
  // A tall top sheet can cover >70% of both axes. Treat it as one band,
  // otherwise it would incorrectly reserve the entire left/right edge too.
  const horizontalBand = spansMapWidth && (!spansMapHeight ||
    (overlapRight - overlapLeft) / width >= (overlapBottom - overlapTop) / height);
  const verticalBand = spansMapHeight && !horizontalBand;
  const requested: ViewportPadding = {
    top: horizontalBand && overlapsMapEdge(map.top, panel.top) ? overlapBottom - map.top + margin : 0,
    right: verticalBand && overlapsMapEdge(map.right, panel.right) ? map.right - overlapLeft + margin : 0,
    bottom: horizontalBand && overlapsMapEdge(map.bottom, panel.bottom) ? map.bottom - overlapTop + margin : 0,
    left: verticalBand && overlapsMapEdge(map.left, panel.left) ? overlapRight - map.left + margin : 0,
  };

  const maxSafeInset = (size: number) => Math.max(0, size - Math.min(size, Math.max(96, size * 0.35)));
  const top = Math.min(base.top + requested.top, maxSafeInset(height));
  const bottom = Math.min(base.bottom + requested.bottom, Math.max(0, maxSafeInset(height) - top));
  const left = Math.min(base.left + requested.left, maxSafeInset(width));
  const right = Math.min(base.right + requested.right, Math.max(0, maxSafeInset(width) - left));
  if (top + right + bottom + left === 0) return null;
  return { top, right, bottom, left };
}
