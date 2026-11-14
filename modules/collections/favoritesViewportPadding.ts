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

/** Screen offset that centers a camera target in the padded map area. */
export function favoritesViewportCenterOffset(padding: ViewportPadding) {
  return {
    x: (padding.left - padding.right) / 2,
    y: (padding.top - padding.bottom) / 2,
  };
}

/** Shared favorites-panel occlusion measurement for primary and comparison maps. */
export function favoritesViewportPaddingForMap(
  mapElement: HTMLElement,
  margin = 16,
  base: ViewportPadding = { top: 0, right: 0, bottom: 0, left: 0 },
): ViewportPadding | null {
  const panel = mapElement.ownerDocument.querySelector<HTMLElement>(
    '#map-control-panel[data-panel-kind="favorites"]',
  );
  if (!panel?.querySelector('.collection-workbench')) return null;
  const mapRect = mapElement.getBoundingClientRect();
  const toolbar = mapElement.ownerDocument.querySelector<HTMLElement>('.control-dock > .map-toolbar');
  const toolbarRect = toolbar?.getBoundingClientRect();
  const toolbarStyle = toolbar && mapElement.ownerDocument.defaultView?.getComputedStyle(toolbar);
  const footer = toolbarRect && toolbarRect.width > 0 && toolbarRect.height > 0 &&
    toolbarStyle?.display !== 'none' && toolbarStyle?.visibility !== 'hidden'
      ? toolbarRect
      : null;
  return favoritesViewportPaddingForOcclusions(
    mapRect,
    mapElement.clientWidth,
    mapElement.clientHeight,
    panel.getBoundingClientRect(),
    footer,
    margin,
    base,
  );
}

/** Combines the favorites sheet and bottom toolbar within one map viewport. */
export function favoritesViewportPaddingForOcclusions(
  map: ViewportRect,
  width: number,
  height: number,
  panel: ViewportRect | null,
  footer: ViewportRect | null,
  margin = 16,
  base: ViewportPadding = { top: 0, right: 0, bottom: 0, left: 0 },
): ViewportPadding | null {
  if (width <= 0 || height <= 0) return null;
  const requested: ViewportPadding = { top: 0, right: 0, bottom: 0, left: 0 };
  const panelRequested = panel ? requestedOcclusionInsets(map, panel, width, height, margin) : null;
  if (panelRequested) addInsets(requested, panelRequested);
  else if (panel && Math.abs(map.top - panel.bottom) <= 1 && panel.right - panel.left >= width * 0.7) {
    // Favorites layout can place the map immediately below the sheet. The
    // sheet no longer overlaps the map element, but keep the same clear gap.
    requested.top += margin;
  }
  const footerRequested = footer ? requestedOcclusionInsets(map, footer, width, height, margin) : null;
  if (footerRequested) addInsets(requested, footerRequested);
  const result = constrainPadding(base, requested, width, height);
  return result.top + result.right + result.bottom + result.left > 0 ? result : null;
}

/** Extra fitBounds padding for the part of the map covered by the favorites workbench. */
export function favoritesViewportPadding(
  map: ViewportRect,
  panel: ViewportRect,
  width: number,
  height: number,
  margin = 16,
  base: ViewportPadding = { top: 0, right: 0, bottom: 0, left: 0 },
): ViewportPadding | null {
  const requested = requestedOcclusionInsets(map, panel, width, height, margin);
  if (!requested) return null;
  const result = constrainPadding(base, requested, width, height);
  if (result.top + result.right + result.bottom + result.left === 0) return null;
  return result;
}

function requestedOcclusionInsets(
  map: ViewportRect,
  panel: ViewportRect,
  width: number,
  height: number,
  margin: number,
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
  return {
    top: horizontalBand && overlapsMapEdge(map.top, panel.top) ? overlapBottom - map.top + margin : 0,
    right: verticalBand && overlapsMapEdge(map.right, panel.right) ? map.right - overlapLeft + margin : 0,
    bottom: horizontalBand && overlapsMapEdge(map.bottom, panel.bottom) ? map.bottom - overlapTop + margin : 0,
    left: verticalBand && overlapsMapEdge(map.left, panel.left) ? overlapRight - map.left + margin : 0,
  };
}

function addInsets(target: ViewportPadding, addition: ViewportPadding) {
  target.top += addition.top;
  target.right += addition.right;
  target.bottom += addition.bottom;
  target.left += addition.left;
}

function constrainPadding(base: ViewportPadding, requested: ViewportPadding, width: number, height: number): ViewportPadding {
  const maxSafeInset = (size: number) => Math.max(0, size - Math.min(size, Math.max(96, size * 0.35)));
  const top = Math.min(Math.max(base.top, requested.top), maxSafeInset(height));
  const bottom = Math.min(Math.max(base.bottom, requested.bottom), Math.max(0, maxSafeInset(height) - top));
  const left = Math.min(Math.max(base.left, requested.left), maxSafeInset(width));
  const right = Math.min(Math.max(base.right, requested.right), Math.max(0, maxSafeInset(width) - left));
  return { top, right, bottom, left };
}
