/** Screen presentation only: geographic anchors and touch target sizes never change. */
export function markerScale(zoom: number) {
  return Number.isFinite(zoom) ? Math.max(0.35, Math.min(1, 0.35 + (zoom - 4) * 0.65 / 12)) : 1;
}
