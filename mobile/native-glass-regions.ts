/** Native map pixels sit outside WebView's backdrop-filter input. Publish only
 * the geometry/filter of visible glass; color and UI rendering remain in CSS. */
import { comparisonChromeSources } from '../modules/mapComparison/comparisonChromeBackdrop.ts';
export type GlassRect = { left: number; top: number; right: number; bottom: number };
export type NativeGlassRegion = GlassRect & {
  radii: [number, number, number, number];
  blur: number;
  saturation: number;
  opacity: number;
  /** Only the explicit comparison chrome bands may extend a named map edge. */
  sourceMapId?: string;
  edgeExtend?: 'comparison-chrome';
};

// Deliberately scoped to surface hosts, not every DOM node or every map frame.
export const NATIVE_GLASS_SELECTOR = [
  '.glass', '.control-popover', '.route-dialog', '.route-surface', '.home-route-card',
  '.home-journey-points', '.home-recording-panel', '.marker-workspace', '.pin-editor',
  '.measurement-panel', '.section-panel', '.raster-level-panel', '.track-tools',
  '.track-draw-tools', '.track-draw-hint', '.map-toolbar', '.home-map-actions',
  '.global-focus-lock', '.home-recording-toggle', '.selected-route-info', '.home-map-popup',
  '.quick-add-card', '.route-display-settings', '.survey-panel', '.trip-photo-viewer',
  '.place-share-panel', '.offline-region-actions', '.offline-download-dock', '.survey-workbar',
  '.survey-dock', '.object-gizmo-actions', '.guidance-card', '.geology-panel', '.area-drawing-tools',
  '.area-editor', '.direction-menu', '.rail-detail-compact', '.rally-elevation', '.layer-window',
  '.route-edit-dock', '.route-editor-dialog', '.map-box-tools',
  '.text-suggestions', '.floating-search', '.route-search-results', '.place-search-results',
  '.collection-action-dialog', '.workbench-share-dialog', '.workbench-sort-menu',
  '.appearance-settings', '.app-color-picker', '.industry-tools', '.layout-editor-panel',
  '.layout-mobile', '.offline-map-progress-prompt', '[class*="comparison-"]',
].join(',');
const PSEUDO_HOST_SELECTOR = '.observatory.home-map,.home-position-dock';
const clipped = /^(auto|scroll|hidden|clip)$/;
const round = (value: number) => Math.round(value * 1000) / 1000;
const number = (value: string | undefined, fallback = 0) => {
  const parsed = parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function parseNativeGlassFilter(filter: string | undefined): { blur: number; saturation: number } | null {
  if (!filter || filter === 'none') return null;
  let variance = 0, saturation = 1;
  for (const match of filter.matchAll(/(blur|saturate)\(\s*([\d.]+)(px|%)?\s*\)/g)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) return null;
    if (match[1] === 'blur' && (match[3] === 'px' || value === 0)) variance += value * value;
    if (match[1] === 'saturate') saturation *= value / (match[3] === '%' ? 100 : 1);
  }
  if (variance <= 0) return null;
  return { blur: Math.min(64, Math.sqrt(variance)), saturation: Math.min(3, Math.max(0, saturation)) };
}

export function intersectGlassRect(rect: GlassRect, clip: GlassRect): GlassRect | null {
  const result = { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top),
    right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) };
  return Object.values(result).every(Number.isFinite) && result.right > result.left && result.bottom > result.top ? result : null;
}

/** Absolute pseudo-element border box within its host's padding box. Computed
 * used sizes avoid assuming the header height or the current right rail size. */
export function absolutePseudoRect(host: GlassRect, width: number, height: number,
  style: Pick<CSSStyleDeclaration, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height' | 'boxSizing' |
  'paddingLeft' | 'paddingRight' | 'paddingTop' | 'paddingBottom' | 'borderLeftWidth' | 'borderRightWidth' |
  'borderTopWidth' | 'borderBottomWidth' | 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom'>): GlassRect | null {
  if (!(width > 0 && height > 0)) return null;
  const px = (value: string) => /^-?[\d.]+px$/.test(value || '') || value === '0' ? Number.parseFloat(value) : null;
  const left = px(style.left), right = px(style.right), top = px(style.top), bottom = px(style.bottom);
  let w = px(style.width), h = px(style.height);
  const ml = number(style.marginLeft), mr = number(style.marginRight), mt = number(style.marginTop), mb = number(style.marginBottom);
  if (w === null && left !== null && right !== null) w = width - left - right - ml - mr;
  else if (w !== null && style.boxSizing !== 'border-box') w += number(style.paddingLeft) + number(style.paddingRight) + number(style.borderLeftWidth) + number(style.borderRightWidth);
  if (h === null && top !== null && bottom !== null) h = height - top - bottom - mt - mb;
  else if (h !== null && style.boxSizing !== 'border-box') h += number(style.paddingTop) + number(style.paddingBottom) + number(style.borderTopWidth) + number(style.borderBottomWidth);
  if (w === null || h === null || w <= 0 || h <= 0) return null;
  const x = left !== null ? left + ml : right !== null ? width - right - mr - w : null;
  const y = top !== null ? top + mt : bottom !== null ? height - bottom - mb - h : null;
  if (x === null || y === null) return null;
  const sx = (host.right - host.left) / width, sy = (host.bottom - host.top) / height;
  return { left: host.left + x * sx, top: host.top + y * sy, right: host.left + (x + w) * sx, bottom: host.top + (y + h) * sy };
}

function visible(style: CSSStyleDeclaration, element: Element): boolean {
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
    number(style.opacity, 1) > 0 && !element.hasAttribute('hidden') && !element.hasAttribute('inert');
}

function cornerRadius(value: string, width: number, height: number, scale: number): number {
  const parts = (value || '0').trim().split(/\s+/);
  const size = (part: string, axis: number) => part.endsWith('%') ? number(part) * axis / 100 : number(part);
  return Math.max(0, Math.min(size(parts[0], width), size(parts[1] ?? parts[0], height)) * scale);
}

export function collectNativeGlassRegions(doc: Document = document): { regions: NativeGlassRegion[]; elements: Element[] } {
  const regions: NativeGlassRegion[] = [], elements: Element[] = [];
  const styleFor = (element: Element, pseudo?: string) => getComputedStyle(element, pseudo);
  const viewport = { left: 0, top: 0, right: doc.documentElement.clientWidth, bottom: doc.documentElement.clientHeight };
  const add = (element: HTMLElement, pseudo?: '::before') => {
    if (regions.length >= 32 || element.closest('[hidden],[inert]')) return;
    const hostStyle = styleFor(element), style = pseudo ? styleFor(element, pseudo) : hostStyle;
    if (!visible(hostStyle, element) || !visible(style, element)) return;
    if (pseudo && (style.content === 'none' || style.content === 'normal' || style.position !== 'absolute' || (style.transform && style.transform !== 'none'))) return;
    const chrome = pseudo ? [] : comparisonChromeSources(element);
    const filter = parseNativeGlassFilter(style.backdropFilter && style.backdropFilter !== 'none'
      ? style.backdropFilter : style.getPropertyValue?.('-webkit-backdrop-filter'))
      ?? (chrome.length ? parseNativeGlassFilter(style.getPropertyValue?.('--ui-glass-filter')) : null);
    if (!filter) return;
    const host = element.getBoundingClientRect();
    const scaleX = element.offsetWidth > 0 ? host.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight > 0 ? host.height / element.offsetHeight : 1;
    let bounds: GlassRect | null = host;
    if (pseudo) {
      // Absolute children use the host padding box, excluding its border.
      const insetX = number(hostStyle.borderLeftWidth) * scaleX, insetY = number(hostStyle.borderTopWidth) * scaleY;
      const paddingBox = { left: host.left + insetX, top: host.top + insetY,
        right: host.right - number(hostStyle.borderRightWidth) * scaleX,
        bottom: host.bottom - number(hostStyle.borderBottomWidth) * scaleY };
      bounds = absolutePseudoRect(paddingBox, element.clientWidth, element.clientHeight, style);
    }
    if (!bounds) return;
    const original = bounds;
    bounds = intersectGlassRect(bounds, viewport);
    let opacity = number(style.opacity, 1) * (pseudo ? number(hostStyle.opacity, 1) : 1);
    // A pseudo child can also be clipped by its own host's overflow.
    for (let parent: HTMLElement | null = pseudo ? element : element.parentElement; parent && bounds; parent = parent.parentElement) {
      const parentStyle = styleFor(parent);
      if (!visible(parentStyle, parent)) return;
      if (parent !== element) opacity *= number(parentStyle.opacity, 1);
      if (clipped.test(parentStyle.overflowX) || clipped.test(parentStyle.overflowY)) {
        const r = parent.getBoundingClientRect();
        bounds = intersectGlassRect(bounds, {
          left: clipped.test(parentStyle.overflowX) ? r.left : bounds.left,
          right: clipped.test(parentStyle.overflowX) ? r.right : bounds.right,
          top: clipped.test(parentStyle.overflowY) ? r.top : bounds.top,
          bottom: clipped.test(parentStyle.overflowY) ? r.bottom : bounds.bottom,
        });
      }
    }
    if (!bounds || opacity <= 0) return;
    const width = (original.right - original.left) / scaleX, height = (original.bottom - original.top) / scaleY;
    const scale = Math.min(scaleX, scaleY);
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius]
      .map(value => Math.min((bounds!.right - bounds!.left) / 2, (bounds!.bottom - bounds!.top) / 2, cornerRadius(value, width, height, scale))) as NativeGlassRegion['radii'];
    // clientWidth/clientHeight are integer CSS pixels while DOMRects can be
    // fractional. Subpixel viewport rounding must not square one card corner.
    // A genuinely clipped edge is still not a newly rounded card edge.
    const clippedBeyondRounding = (edge: number, originalEdge: number) => Math.abs(edge - originalEdge) > 1;
    if (clippedBeyondRounding(bounds.left, original.left)) { radii[0] = 0; radii[3] = 0; }
    if (clippedBeyondRounding(bounds.right, original.right)) { radii[1] = 0; radii[2] = 0; }
    if (clippedBeyondRounding(bounds.top, original.top)) { radii[0] = 0; radii[1] = 0; }
    if (clippedBeyondRounding(bounds.bottom, original.bottom)) { radii[2] = 0; radii[3] = 0; }
    const next: NativeGlassRegion = { left: round(bounds.left), top: round(bounds.top), right: round(bounds.right), bottom: round(bounds.bottom),
      radii: radii.map(round) as NativeGlassRegion['radii'], blur: round(filter.blur * scale), saturation: round(filter.saturation), opacity: round(Math.min(1, opacity)) };
    const candidates = chrome.some(source => source.map.dataset.nativeMapId || source.map.dataset.mapId) ? chrome.flatMap(source => {
      const rect = intersectGlassRect(next, source.rect);
      const sourceMapId = source.map.dataset.nativeMapId || source.map.dataset.mapId;
      return rect && sourceMapId ? [{ ...next, ...rect, sourceMapId, edgeExtend: 'comparison-chrome' as const }] : [];
    }) : [next];
    for (const candidate of candidates) {
      if (regions.length < 32 && !regions.some(region => JSON.stringify(region) === JSON.stringify(candidate))) { regions.push(candidate); elements.push(element); }
    }
  };
  // Header decoration is behind every other surface, as in the CSS painting order.
  for (const element of doc.querySelectorAll<HTMLElement>(PSEUDO_HOST_SELECTOR)) add(element, '::before');
  for (const element of doc.querySelectorAll<HTMLElement>(NATIVE_GLASS_SELECTOR)) add(element);
  return { regions, elements };
}
