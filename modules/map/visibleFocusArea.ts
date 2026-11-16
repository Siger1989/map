import type { ViewportRect } from '../collections/favoritesViewportPadding.ts';
import { searchViewport } from '../input/floatingGeometry.ts';

const PANELS = [
  '#map-control-panel[data-panel-kind]', '.place-search-results', '.place-selected-place',
  '.home-map-popup', '.marker-editor', '.guidance-card', '.selected-route-info',
  '.home-route-card', '.home-journey-points', '.route-display-settings',
  '.raster-level-panel', '.layer-window', '.section-list', '.map-comparison-property',
  '.map-comparison-edit-window', '.map-comparison-planned-route', '.map-comparison-track-selection',
].join(',');
const CHROME = [
  '.home-topbar', '.home-bottom-nav', '.control-dock > .map-toolbar',
  '.home-map-actions', '.home-position-dock', '.map-comparison-actions',
].join(',');

/** Largest clear rectangle inside one map viewport, expressed in local CSS pixels. */
export function largestClearMapRect(width: number, height: number, blockers: readonly ViewportRect[]): ViewportRect | null {
  const cuts = [...new Set([0, height, ...blockers.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b);
  const byLeft = [...blockers].sort((a, b) => a.left - b.left);
  let best: ViewportRect | null = null;
  let bestArea = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < cuts.length - 1; i++) {
    const top = cuts[i];
    for (const bottom of cuts.slice(i + 1)) {
      const consider = (left: number, right: number) => {
        const area = (right - left) * (bottom - top);
        const distance = Math.hypot((left + right - width) / 2, (top + bottom - height) / 2);
        if (right - left < Math.min(80, width) || bottom - top < Math.min(80, height)) return;
        if (area > bestArea || (area === bestArea && distance < bestDistance)) {
          best = { left, right, top, bottom };
          bestArea = area;
          bestDistance = distance;
        }
      };
      let left = 0;
      for (const blocker of byLeft) {
        if (blocker.top >= bottom || blocker.bottom <= top) continue;
        consider(left, blocker.left);
        left = Math.max(left, blocker.right);
      }
      consider(left, width);
    }
  }
  return best;
}

export function visibleMapFocusOffset(map: HTMLElement): [number, number] | null {
  const { clientWidth: width, clientHeight: height } = map;
  const bounds = map.getBoundingClientRect();
  const host = map.closest('.observatory.home-map');
  const win = map.ownerDocument.defaultView;
  if (!host || !win || !width || !height || !bounds.width || !bounds.height) return null;
  const sx = width / bounds.width, sy = height / bounds.height;
  const measure = (elements: Iterable<HTMLElement>, margin: number) =>
    Array.from(elements).flatMap(element => {
      const style = win.getComputedStyle(element);
      if (element.hidden || style.display === 'none' || style.visibility === 'hidden' ||
          element.closest('[inert],[aria-hidden="true"]')) return [];
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.right <= bounds.left || rect.left >= bounds.right ||
          rect.bottom <= bounds.top || rect.top >= bounds.bottom) return [];
      return [{
        left: Math.max(0, (rect.left - bounds.left) * sx - margin),
        right: Math.min(width, (rect.right - bounds.left) * sx + margin),
        top: Math.max(0, (rect.top - bounds.top) * sy - margin),
        bottom: Math.min(height, (rect.bottom - bounds.top) * sy + margin),
      }];
    });
  const panels = measure([
    ...host.querySelectorAll<HTMLElement>(PANELS),
    ...map.ownerDocument.querySelectorAll<HTMLElement>('body > .floating-search .place-search-results'),
  ], 14);
  if (!panels.length) return null;
  const { top, height: visibleHeight } = searchViewport();
  const bottom = Math.max(0, Math.min(height, (top + visibleHeight - bounds.top) * sy));
  const blockers = [...panels, ...measure(host.querySelectorAll<HTMLElement>(CHROME), 4)];
  if (bottom < height) blockers.push({ left: 0, right: width, top: bottom, bottom: height });
  const clear = largestClearMapRect(width, height, blockers);
  return clear ? [(clear.left + clear.right - width) / 2, (clear.top + clear.bottom - height) / 2] : null;
}
