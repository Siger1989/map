/** Screen presentation only: geographic anchors and touch target sizes never change. */
export function markerScale(zoom: number) {
  return Number.isFinite(zoom) ? Math.max(0.35, Math.min(1, 0.35 + (zoom - 4) * 0.65 / 12)) : 1;
}

/**
 * MapLibre's 512 px camera zoom is one level below the conventional 256 px UI
 * tile level, so labels start at raw zoom 11 (visible UI level 12).
 */
export function markerPresentation(zoom: number, selected: boolean) {
  if (selected || !Number.isFinite(zoom) || zoom >= 11) return 'label';
  return zoom < 10 ? 'dot' : 'icon';
}
