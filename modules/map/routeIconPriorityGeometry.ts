import type { Feature, LineString, MultiLineString, Position } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';

export type Bounds = { left: number; top: number; right: number; bottom: number };
export type MaskPath = { points: Array<[number, number]>; width: number; dash: number[]; cap: string };
export type SavedMask = Array<[string, string, string]>;

const MAX_SAMPLES_PER_FEATURE = 12000;
const MAX_MASK_PATHS = 48;
const MAX_SVG_CHARS = 12000;
const maskProperties = [
  'mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size',
  'mask-position', '-webkit-mask-position', 'mask-repeat', '-webkit-mask-repeat',
  'mask-mode', '-webkit-mask-mode', 'mask-origin', '-webkit-mask-origin',
  'mask-clip', '-webkit-mask-clip',
] as const;
const finite = (n: number) => Number.isFinite(n);

export function saveRouteMask(element: HTMLElement): SavedMask {
  return maskProperties.map((name) => [
    name,
    element.style.getPropertyValue(name),
    element.style.getPropertyPriority(name),
  ]);
}

export function restoreRouteMask(element: HTMLElement, saved: SavedMask) {
  for (const [name, value, priority] of saved) {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}

export function markerMaskTargets(marker: HTMLElement): HTMLElement[] {
  const own = marker.getBoundingClientRect();
  if (own.width > 2 || own.height > 2) return [marker];
  const children = Array.from(marker.children).filter((child): child is HTMLElement => {
    const element = child as HTMLElement;
    if (!element?.getClientRects?.().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }).map((child) => child as HTMLElement);
  return children.length ? children : [marker];
}

export function markerScreenBounds(element: HTMLElement): Bounds | null {
  const own = element.getBoundingClientRect();
  if (!own.width && !own.height) return null;
  let left = own.left, top = own.top, right = own.right, bottom = own.bottom;
  for (const child of [element, ...element.querySelectorAll<HTMLElement>('*')]) {
    if (!child.getClientRects().length) continue;
    const rect = child.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
    const view = child.ownerDocument?.defaultView;
    if (!view?.getComputedStyle) continue;
    for (const pseudo of ['::before', '::after']) {
      const style = view.getComputedStyle(child, pseudo);
      if (style.display === 'none' || style.visibility === 'hidden' ||
        style.content === 'none' || style.content === 'normal') continue;
      const border = Math.max(
        parseFloat(style.borderTopWidth) || 0,
        parseFloat(style.borderRightWidth) || 0,
        parseFloat(style.borderBottomWidth) || 0,
        parseFloat(style.borderLeftWidth) || 0,
      );
      const extra = Math.max(12, border + 3);
      left = Math.min(left, rect.left - extra);
      top = Math.min(top, rect.top - extra);
      right = Math.max(right, rect.right + extra);
      bottom = Math.max(bottom, rect.bottom + extra);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

function lineCoordinates(feature: Feature): Position[][] {
  if (feature.geometry.type === 'LineString') return [feature.geometry.coordinates];
  if (feature.geometry.type === 'MultiLineString') return feature.geometry.coordinates;
  return [];
}

function interpolate(a: Position, b: Position, t: number): Position {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipSegment(a: [number, number], b: [number, number], bounds: Bounds): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let lo = 0, hi = 1;
  for (const [p, q] of [
    [-dx, a[0] - bounds.left], [dx, bounds.right - a[0]],
    [-dy, a[1] - bounds.top], [dy, bounds.bottom - a[1]],
  ]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}

export function clipRoutePaths(points: Array<[number, number]>, bounds: Bounds) {
  const output: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  const flush = () => { if (current.length > 1) output.push(current); current = []; };
  for (let i = 1; i < points.length; i++) {
    const clipped = clipSegment(points[i - 1], points[i], bounds);
    if (!clipped) { flush(); continue; }
    const [a, b] = clipped;
    const previous = current.at(-1);
    if (!previous || Math.hypot(previous[0] - a[0], previous[1] - a[1]) > 0.75) {
      flush();
      current.push(a);
    }
    current.push(b);
  }
  flush();
  return output;
}

function projectLine(map: MapLibreMap, coordinates: Position[], viewport: Bounds): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  let samples = 0;
  const project = (coordinate: Position): [number, number] | null => {
    const point = map.project(coordinate as [number, number]);
    if (!finite(point.x) || !finite(point.y)) return null;
    return [point.x, point.y];
  };
  const margin = 16;
  const clipBounds = { left: viewport.left - margin, top: viewport.top - margin,
    right: viewport.right + margin, bottom: viewport.bottom + margin };
  const flush = () => { if (run.length > 1) runs.push(run); run = []; };
  const intersects = (points: Array<[number, number]>) => {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return Math.max(...xs) >= clipBounds.left && Math.min(...xs) <= clipBounds.right &&
      Math.max(...ys) >= clipBounds.top && Math.min(...ys) <= clipBounds.bottom;
  };
  for (let i = 1; i < coordinates.length && samples < MAX_SAMPLES_PER_FEATURE; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const pa = project(a), pb = project(b);
    if (!pa || !pb) { flush(); continue; }
    const pm = project(interpolate(a, b, 0.5));
    if (!pm || !intersects([pa, pm, pb])) { flush(); continue; }
    const span = Math.hypot(pm[0] - pa[0], pm[1] - pa[1]) + Math.hypot(pb[0] - pm[0], pb[1] - pm[1]);
    const steps = Math.max(2, Math.min(64, Math.ceil(span / 8)));
    if (samples + steps > MAX_SAMPLES_PER_FEATURE) { flush(); break; }
    for (let step = 0; step <= steps; step++) {
      const point = step === 0 ? pa : step === steps ? pb : project(interpolate(a, b, step / steps));
      if (point && (!run.length || Math.hypot(run.at(-1)![0] - point[0], run.at(-1)![1] - point[1]) > 0.1)) run.push(point);
      samples++;
    }
  }
  flush();
  return runs.flatMap((points) => clipRoutePaths(points, clipBounds));
}

export function projectRouteFeature(map: MapLibreMap, feature: Feature, viewport: Bounds) {
  return lineCoordinates(feature).flatMap((coordinates) => projectLine(map, coordinates, viewport));
}

function svgMask(paths: MaskPath[], width: number, height: number) {
  let draw = '';
  for (const { points, width: strokeWidth, dash, cap } of paths.slice(0, MAX_MASK_PATHS)) {
    if (points.length < 2 || strokeWidth <= 0) continue;
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const dashArray = dash.length ? ` stroke-dasharray="${dash.map((v) => (v * strokeWidth).toFixed(1)).join(' ')}"` : '';
    const path = `<path d="${d}" fill="none" stroke="black" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="${cap}" stroke-linejoin="round"${dashArray}/>`;
    if (draw.length + path.length > MAX_SVG_CHARS) break;
    draw += path;
  }
  if (!draw) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}" height="${height.toFixed(1)}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}"><defs><mask id="m" mask-type="luminance"><rect width="100%" height="100%" fill="white"/>${draw}</mask></defs><rect width="100%" height="100%" fill="white" mask="url(#m)"/></svg>`;
}

export function setRouteMask(element: HTMLElement, saved: SavedMask, bounds: Bounds, paths: MaskPath[]) {
  const own = element.getBoundingClientRect();
  const scaleX = own.width > 0 && element.offsetWidth > 0 ? own.width / element.offsetWidth : 1;
  const scaleY = own.height > 0 && element.offsetHeight > 0 ? own.height / element.offsetHeight : 1;
  const sx = finite(scaleX) && scaleX > 0 ? scaleX : 1;
  const sy = finite(scaleY) && scaleY > 0 ? scaleY : 1;
  const local = {
    left: (bounds.left - own.left) / sx,
    top: (bounds.top - own.top) / sy,
    width: (bounds.right - bounds.left) / sx,
    height: (bounds.bottom - bounds.top) / sy,
  };
  const scaledPaths = paths.map((path) => ({
    ...path,
    points: path.points.map(([x, y]) => [x / sx, y / sy] as [number, number]),
    width: path.width / ((sx + sy) / 2),
  }));
  const svg = svgMask(scaledPaths, local.width, local.height);
  if (!svg) { restoreRouteMask(element, saved); return; }
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  element.style.setProperty('mask-image', url);
  element.style.setProperty('-webkit-mask-image', url);
  element.style.setProperty('mask-size', `${local.width}px ${local.height}px`);
  element.style.setProperty('-webkit-mask-size', `${local.width}px ${local.height}px`);
  const position = `${local.left}px ${local.top}px`;
  element.style.setProperty('mask-position', position);
  element.style.setProperty('-webkit-mask-position', position);
  element.style.setProperty('mask-repeat', 'no-repeat');
  element.style.setProperty('-webkit-mask-repeat', 'no-repeat');
  element.style.setProperty('mask-mode', 'alpha');
  element.style.setProperty('-webkit-mask-mode', 'alpha');
  element.style.setProperty('mask-origin', 'border-box');
  element.style.setProperty('-webkit-mask-origin', 'border-box');
  element.style.setProperty('mask-clip', 'no-clip');
  element.style.setProperty('-webkit-mask-clip', 'no-clip');
}
