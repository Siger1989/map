export type MarkerBounds = { left: number; top: number; right: number; bottom: number };
export type MarkerRect = MarkerBounds & { width: number; height: number };
export type MarkerTargetMetrics = MarkerRect & { offsetWidth: number; offsetHeight: number };

export type MarkerLayoutMeasurement = {
  visualBounds: MarkerBounds | null;
  targets: HTMLElement[];
  targetMetrics: MarkerTargetMetrics[];
};

export type MarkerLayoutEntry = {
  rootRect: MarkerRect;
  visualBounds: MarkerBounds | null;
  targets: HTMLElement[];
  targetMetrics: MarkerTargetMetrics[];
  readonly observedElements: readonly Element[];
};

type CachedEntry = {
  rootRect: MarkerRect;
  transformSignature: string;
  visualRelative: MarkerBounds | null;
  targets: HTMLElement[];
  targetRelativeMetrics: MarkerTargetMetrics[];
  observedElements: Element[];
};

const rectOf = (rect: DOMRect | DOMRectReadOnly): MarkerRect => ({
  left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
  width: rect.width, height: rect.height,
});

function rootTransformSignature(marker: HTMLElement): string {
  const view = marker.ownerDocument?.defaultView;
  const style = view?.getComputedStyle?.(marker);
  if (!style) return '';
  let transform = style.transform || 'none';
  const matrix2d = transform.match(/^matrix\(([^)]+)\)$/);
  if (matrix2d) {
    const values = matrix2d[1].split(',').map(Number);
    if (values.length === 6 && values.every(Number.isFinite)) transform = `matrix:${values.slice(0, 4).join(',')}`;
  } else {
    const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
    if (matrix3d) {
      const values = matrix3d[1].split(',').map(Number);
      if (values.length === 16 && values.every(Number.isFinite))
        transform = `matrix3d:${values.slice(0, 12).join(',')},${values[15]}`;
    }
  }
  return [transform, style.rotate || 'none', style.scale || 'none', style.transformOrigin || ''].join('|');
}

function observedElements(marker: HTMLElement): Element[] {
  return [marker, ...Array.from(marker.querySelectorAll('*'))];
}

function overflowBoundsForZeroSizeRoot(marker: HTMLElement, rootRect: MarkerRect): MarkerBounds | null {
  let left = rootRect.left, top = rootRect.top, right = rootRect.right, bottom = rootRect.bottom;
  let found = rootRect.width > 0 || rootRect.height > 0;
  for (const child of observedElements(marker)) {
    const html = child as HTMLElement;
    if (!html.getClientRects?.().length) continue;
    const rect = html.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    found = true;
    left = Math.min(left, rect.left); top = Math.min(top, rect.top);
    right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    const view = html.ownerDocument?.defaultView;
    if (!view?.getComputedStyle) continue;
    for (const pseudo of ['::before', '::after']) {
      const style = view.getComputedStyle(html, pseudo);
      if (style.display === 'none' || style.visibility === 'hidden' ||
        style.content === 'none' || style.content === 'normal') continue;
      const border = Math.max(parseFloat(style.borderTopWidth) || 0, parseFloat(style.borderRightWidth) || 0,
        parseFloat(style.borderBottomWidth) || 0, parseFloat(style.borderLeftWidth) || 0);
      const extra = Math.max(12, border + 3);
      left = Math.min(left, rect.left - extra); top = Math.min(top, rect.top - extra);
      right = Math.max(right, rect.right + extra); bottom = Math.max(bottom, rect.bottom + extra);
    }
  }
  return found && right > left && bottom > top ? { left, top, right, bottom } : null;
}

function relativeBounds(bounds: MarkerBounds | null, root: MarkerRect): MarkerBounds | null {
  return bounds && { left: bounds.left - root.left, top: bounds.top - root.top,
    right: bounds.right - root.left, bottom: bounds.bottom - root.top };
}

function absoluteBounds(bounds: MarkerBounds | null, root: MarkerRect): MarkerBounds | null {
  return bounds && { left: bounds.left + root.left, top: bounds.top + root.top,
    right: bounds.right + root.left, bottom: bounds.bottom + root.top };
}

/** Caches expensive descendant geometry while a marker only translates during map panning. */
export class MarkerLayoutCache {
  private readonly entries = new Map<HTMLElement, CachedEntry>();
  private readonly activeEntries = new Set<CachedEntry>();

  private readonly measure: (marker: HTMLElement, rootRect: MarkerRect) => MarkerLayoutMeasurement;
  constructor(measure: (marker: HTMLElement, rootRect: MarkerRect) => MarkerLayoutMeasurement) {
    this.measure = measure;
  }

  get(marker: HTMLElement): MarkerLayoutEntry {
    const rootRect = rectOf(marker.getBoundingClientRect());
    const signature = rootTransformSignature(marker);
    let cached = this.entries.get(marker);
    if (!cached || cached.rootRect.width !== rootRect.width || cached.rootRect.height !== rootRect.height ||
      cached.transformSignature !== signature) {
      if (cached) this.activeEntries.delete(cached);
      const measured = this.measure(marker, rootRect);
      const visualBounds = (rootRect.width === 0 && rootRect.height === 0)
        ? overflowBoundsForZeroSizeRoot(marker, rootRect) ?? measured.visualBounds
        : measured.visualBounds;
      cached = {
        rootRect, transformSignature: signature, visualRelative: relativeBounds(visualBounds, rootRect),
        targets: measured.targets,
        targetRelativeMetrics: measured.targetMetrics.map(metrics => ({ ...metrics,
          left: metrics.left - rootRect.left, top: metrics.top - rootRect.top,
          right: metrics.right - rootRect.left, bottom: metrics.bottom - rootRect.top })),
        observedElements: observedElements(marker),
      };
      this.entries.set(marker, cached);
      this.activeEntries.add(cached);
    } else {
      cached.rootRect = rootRect;
    }

    const entry = cached;
    const visualBounds = absoluteBounds(entry.visualRelative, rootRect);
    const targetMetrics = entry.targetRelativeMetrics.map(metrics => ({ ...metrics,
      left: metrics.left + rootRect.left, top: metrics.top + rootRect.top,
      right: metrics.right + rootRect.left, bottom: metrics.bottom + rootRect.top }));
    return {
      rootRect, visualBounds, targets: entry.targets, targetMetrics,
      get observedElements() { return entry.observedElements; },
    };
  }

  invalidate(marker: HTMLElement) {
    const entry = this.entries.get(marker);
    if (!entry) return;
    this.entries.delete(marker);
    this.activeEntries.delete(entry);
  }

  clear() {
    this.entries.clear();
    this.activeEntries.clear();
  }

  /** Returns the current roots/descendants for a caller-owned ResizeObserver. */
  get observedElements(): readonly Element[] {
    const elements = new Set<Element>();
    for (const entry of this.activeEntries) for (const element of entry.observedElements) elements.add(element);
    return [...elements];
  }
}
