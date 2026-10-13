import {
  applyRouteMaskImage, createRouteMaskSvg, supportsLuminanceMask,
  type Bounds, type MaskPath, type MaskTargetMetrics,
} from './routeIconPriorityGeometry.ts';

const MAX_FRAME_PATHS = 2048;
const MAX_FRAME_SVG_CHARS = 256 * 1024;
type SharedUrlState = { svg: string; url: string; revoke: (url: string) => void };
const sharedUrls = new WeakMap<HTMLElement, SharedUrlState>();

export type FrameMaskEntry = {
  target: HTMLElement;
  markerBounds: Bounds;
  paths: MaskPath[];
  metrics: MaskTargetMetrics;
};

function finitePositive(value: number) { return Number.isFinite(value) && value > 0; }

function axisAlignedPositiveTransform(target: HTMLElement, container: HTMLElement): boolean {
  const view = target.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return false;
  let current: HTMLElement | null = target;
  let reachedContainer = false;
  while (current) {
    let style: CSSStyleDeclaration;
    try { style = view.getComputedStyle(current); } catch { return false; }
    const transform = style.transform;
    if ((style.perspective && style.perspective !== 'none') ||
      (style.rotate && style.rotate !== 'none' && !/^0(?:deg|rad|turn)$/.test(style.rotate.trim())) ||
      (style.scale && style.scale !== 'none' && style.scale.trim().split(/\s+/).some((value) => {
        const number = Number(value);
        return !Number.isFinite(number) || number <= 0;
      }))) return false;
    if (transform && transform !== 'none') {
      const matrix = transform.match(/^matrix\(([^)]+)\)$/);
      const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
      if (matrix) {
        const values = matrix[1].split(',').map(Number);
        if (values.length !== 6 || values.some((value) => !Number.isFinite(value)) ||
          Math.abs(values[1]) > 1e-8 || Math.abs(values[2]) > 1e-8 || values[0] <= 0 || values[3] <= 0) return false;
      } else if (matrix3d) {
        const values = matrix3d[1].split(',').map(Number);
        if (values.length !== 16 || values.some((value) => !Number.isFinite(value)) ||
          Math.abs(values[1]) > 1e-8 || Math.abs(values[2]) > 1e-8 || Math.abs(values[4]) > 1e-8 ||
          Math.abs(values[6]) > 1e-8 || values[0] <= 0 || values[5] <= 0 ||
          Math.abs(values[3]) > 1e-8 || Math.abs(values[7]) > 1e-8 ||
          Math.abs(values[8]) > 1e-8 || Math.abs(values[9]) > 1e-8 ||
          Math.abs(values[10] - 1) > 1e-8 || Math.abs(values[11]) > 1e-8 ||
          Math.abs(values[14]) > 1e-8 || Math.abs(values[15] - 1) > 1e-8) return false;
      } else return false;
    }
    if (current === container) reachedContainer = true;
    current = current.parentElement;
  }
  return reachedContainer;
}

function targetScale(entry: FrameMaskEntry, container: HTMLElement): [number, number] | null {
  const { metrics, target } = entry;
  if (!axisAlignedPositiveTransform(target, container) || !supportsLuminanceMask(target) ||
    !finitePositive(metrics.offsetWidth) || !finitePositive(metrics.offsetHeight) ||
    !finitePositive(metrics.width) || !finitePositive(metrics.height) ||
    !Number.isFinite(metrics.left) || !Number.isFinite(metrics.top)) return null;
  const sx = metrics.width / metrics.offsetWidth;
  const sy = metrics.height / metrics.offsetHeight;
  return finitePositive(sx) && finitePositive(sy) ? [sx, sy] : null;
}

function pathKey(path: MaskPath): string {
  return JSON.stringify([path.points, path.width, path.dash, path.cap]);
}

function sharedMaskUrl(container: HTMLElement, target: HTMLElement, svg: string) {
  const current = sharedUrls.get(container);
  if (current?.svg === svg) return current.url;
  if (current) current.revoke(current.url);
  const view = target.ownerDocument?.defaultView;
  try {
    const BlobCtor = view?.Blob;
    const URLApi = view?.URL;
    if (BlobCtor && URLApi?.createObjectURL && URLApi.revokeObjectURL) {
      const blob = new BlobCtor([svg], { type: 'image/svg+xml' });
      const url = URLApi.createObjectURL(blob);
      const state = { svg, url, revoke: (value: string) => URLApi.revokeObjectURL(value) };
      sharedUrls.set(container, state);
      return url;
    }
  } catch { /* an unavailable Blob URL falls back to a self-contained data URL */ }
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  sharedUrls.set(container, { svg, url, revoke: () => {} });
  return url;
}

export function releaseSharedFrameMask(container: HTMLElement) {
  const current = sharedUrls.get(container);
  if (!current) return;
  current.revoke(current.url);
  sharedUrls.delete(container);
}

/** Applies one CSS-pixel canvas mask to eligible targets. Returns false without writes if unsafe/over budget. */
export function tryApplySharedFrameMask(
  container: HTMLElement, canvasRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  entries: FrameMaskEntry[],
): boolean {
  if (!entries.length || !finitePositive(canvasRect.width) || !finitePositive(canvasRect.height)) return false;
  const scales = entries.map((entry) => targetScale(entry, container));
  if (scales.some((scale) => !scale)) return false;
  const union = entries.reduce((bounds, entry) => ({
    left: Math.min(bounds.left, entry.markerBounds.left),
    top: Math.min(bounds.top, entry.markerBounds.top),
    right: Math.max(bounds.right, entry.markerBounds.right),
    bottom: Math.max(bounds.bottom, entry.markerBounds.bottom),
  }), { ...entries[0].markerBounds });
  const unionWidth = union.right - union.left, unionHeight = union.bottom - union.top;
  if (!finitePositive(unionWidth) || !finitePositive(unionHeight)) return false;

  const pathsByKey = new Map<string, MaskPath>();
  for (const entry of entries) {
    const offsetX = entry.markerBounds.left - union.left;
    const offsetY = entry.markerBounds.top - union.top;
    for (const path of entry.paths) {
      const globalPath: MaskPath = {
        ...path,
        points: path.points.map(([x, y]) => [x + offsetX, y + offsetY] as [number, number]),
      };
      const key = pathKey(globalPath);
      if (!pathsByKey.has(key)) {
        pathsByKey.set(key, globalPath);
        if (pathsByKey.size > MAX_FRAME_PATHS) return false;
      }
    }
  }
  const svg = createRouteMaskSvg([...pathsByKey.values()], unionWidth, unionHeight, 'luminance', {
    maxPaths: MAX_FRAME_PATHS, maxChars: MAX_FRAME_SVG_CHARS, rejectOverflow: true,
  });
  if (!svg || svg.length > MAX_FRAME_SVG_CHARS) return false;
  const url = `url("${sharedMaskUrl(container, entries[0].target, svg)}")`;
  entries.forEach((entry, index) => {
    const [sx, sy] = scales[index]!;
    const size = `${unionWidth / sx}px ${unionHeight / sy}px`;
    const position = `${(union.left - entry.metrics.left) / sx}px ${(union.top - entry.metrics.top) / sy}px`;
    applyRouteMaskImage(entry.target, url, size, position, 'luminance');
  });
  return true;
}
