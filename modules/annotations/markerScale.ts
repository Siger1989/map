/** Screen presentation only: geographic anchors and touch target sizes never change. */
export function markerScale(zoom: number) {
  return Number.isFinite(zoom) ? Math.max(0.35, Math.min(1, 0.35 + (zoom - 4) * 0.65 / 12)) : 1;
}

/** Distant annotations become dots, intermediate ones icons, close ones labels. */
export function markerPresentation(zoom: number, selected: boolean) {
  if (selected || !Number.isFinite(zoom) || zoom >= 14) return 'label';
  return zoom < 10 ? 'dot' : 'icon';
}
