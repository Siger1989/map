/** Screen presentation only: geographic anchors and touch target sizes never change. */
export function markerScale(zoom: number) {
  return Number.isFinite(zoom) ? Math.max(0.35, Math.min(1, 0.35 + (zoom - 4) * 0.65 / 12)) : 1;
}

/**
 * MapLibre's 512 px camera zoom is one level below the conventional 256 px UI
 * tile level. Labels start at raw zoom 9, two raw levels earlier than before.
 * The displayed source level also depends on the raster sampling profile
 * (for example, raw zoom 8 is about UI level 10 in high mode and 9 in standard).
 * Labels show above raw zoom 9, icon badges at zoom 8–9, and compact dots below
 * zoom 8. Selection never pins a distant label on screen.
 */
export function markerPresentation(zoom: number, selected: boolean) {
  void selected;
  if (!Number.isFinite(zoom) || zoom >= 9) return 'label';
  return zoom < 8 ? 'dot' : 'icon';
}
