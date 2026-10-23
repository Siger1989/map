type KeyboardRect = { top: number; height: number };
type FocusWindow = Window & {
  visualViewport?: VisualViewport | null;
  navigator: Navigator & {
    virtualKeyboard?: EventTarget & { boundingRect?: KeyboardRect; overlaysContent?: boolean };
  };
};

type KeyboardGeometryInput = {
  layoutHeight: number;
  visualHeight: number;
  offsetTop?: number;
  innerHeight?: number;
  keyboardRect?: KeyboardRect | null;
  viewportKeyboardOpen?: boolean;
  minimumOcclusion?: number;
};

export type KeyboardOcclusion = {
  top: number;
  height: number;
  mode: 'overlay' | 'resized' | 'native';
};

/** Find a real bottom keyboard occlusion from a resized viewport or native overlay. */
export function keyboardOcclusion(input: KeyboardGeometryInput): KeyboardOcclusion | null {
  const { layoutHeight } = input;
  if (!Number.isFinite(layoutHeight) || layoutHeight <= 0) return null;
  const threshold = input.minimumOcclusion ?? 120;
  const candidates: Array<{ top: number; mode: KeyboardOcclusion['mode'] }> = [];
  const rect = input.keyboardRect;
  if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.height) && rect.height >= 80 && rect.top < layoutHeight) {
    candidates.push({ top: Math.max(0, rect.top), mode: 'native' });
  }
  if (input.viewportKeyboardOpen && Number.isFinite(input.visualHeight) && input.visualHeight > 0) {
    const visualBottom = Math.max(0, Math.min(layoutHeight, (input.offsetTop ?? 0) + input.visualHeight));
    const occluded = layoutHeight - visualBottom;
    if (occluded >= threshold && occluded >= layoutHeight * 0.2) {
      const resized = Number.isFinite(input.innerHeight) && input.innerHeight! < layoutHeight - threshold;
      candidates.push({ top: visualBottom, mode: resized ? 'resized' : 'overlay' });
    }
  }
  if (!candidates.length) return null;
  const selected = candidates.reduce((a, b) => a.top <= b.top ? a : b);
  return { ...selected, height: Math.max(0, layoutHeight - selected.top) };
}

export type SurfaceAdjustment = { top: number; maxHeight: number };

/** Move a floating surface above the keyboard and cap it to the remaining viewport. */
export function keyboardSurfaceAdjustment(input: {
  surfaceTop: number;
  surfaceBottom: number;
  viewportTop: number;
  keyboardTop: number;
  margin?: number;
}): SurfaceAdjustment {
  const margin = input.margin ?? 8;
  const safeTop = input.viewportTop + margin;
  const safeBottom = input.keyboardTop - margin;
  const shift = Math.max(0, input.surfaceBottom - safeBottom);
  const top = Math.max(safeTop, input.surfaceTop - shift);
  return { top, maxHeight: Math.max(0, safeBottom - top) };
}

const SURFACE_SELECTOR = [
  '.home-route-card', '.control-popover', '.route-edit-dock', '.marker-workspace',
  '.pin-editor', '.collection-action-dialog', '.collection-workbench', '.survey-dock',
  '.section-panel', '.section-list', '.section-profile', '.survey-sheet', '.survey-info-modal', '.route-dialog', '.map-comparison-edit-window',
  '.map-comparison-property', '.map-comparison-planned-route', '.map-comparison-marker-menu',
  '.collection-action-backdrop', '.track-tools', '.area-editor', '.object-gizmo',
  '.photo-lightbox', 'dialog', '[role="dialog"]',
].join(',');
const STYLE_PROPERTIES = ['top', 'bottom', 'max-height', 'min-height', 'overflow-y'] as const;
type StyleSnapshot = Map<(typeof STYLE_PROPERTIES)[number], { value: string; priority: string }>;
export type KeyboardFocusVisibilityController = { schedule: () => void; cleanup: () => void };
const installations = new WeakMap<Document, KeyboardFocusVisibilityController>();

export function snapshotKeyboardSurfaceStyles(style: CSSStyleDeclaration): StyleSnapshot {
  return new Map(STYLE_PROPERTIES.map((property) => [property, {
    value: style.getPropertyValue(property), priority: style.getPropertyPriority(property),
  }]));
}

export function restoreKeyboardSurfaceStyles(style: CSSStyleDeclaration, original: StyleSnapshot) {
  for (const property of STYLE_PROPERTIES) {
    const value = original.get(property)!;
    if (value.value) style.setProperty(property, value.value, value.priority);
    else style.removeProperty(property);
  }
}

function setTemporaryStyle(style: CSSStyleDeclaration, property: string, value: string) {
  style.setProperty(property, value, 'important');
}

function editable(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  if (element.isContentEditable || element.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  if (element.matches('textarea:not([disabled]):not([readonly])')) return true;
  if (!element.matches('input:not([disabled]):not([readonly])')) return false;
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(
    (element as HTMLInputElement).type.toLowerCase(),
  );
}

function cssPixels(style: CSSStyleDeclaration, property: string, fallback: number) {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Adjust only the active overlay containing an editable field while a keyboard occludes it. */
export function installKeyboardFocusVisibility(documentRef: Document, windowRef: FocusWindow): KeyboardFocusVisibilityController {
  const existing = installations.get(documentRef);
  if (existing) return existing;
  const root = documentRef.documentElement;
  const virtualKeyboard = windowRef.navigator.virtualKeyboard;
  const snapshots = new Map<HTMLElement, StyleSnapshot>();
  const scrollHostSnapshots = new Map<HTMLElement, StyleSnapshot>();
  let activeSurface: HTMLElement | null = null;
  let frame = 0;
  let timer: number | ReturnType<typeof globalThis.setTimeout> = 0;
  let disposed = false;

  const restore = (surface: HTMLElement) => {
    const original = snapshots.get(surface);
    if (!original) return;
    restoreKeyboardSurfaceStyles(surface.style, original);
    snapshots.delete(surface);
  };
  const restoreActive = () => {
    if (activeSurface) {
      restore(activeSurface);
      activeSurface = null;
    }
    for (const [host, original] of scrollHostSnapshots)
      restoreKeyboardSurfaceStyles(host.style, original);
    scrollHostSnapshots.clear();
  };
  const schedule = () => {
    if (disposed) return;
    if (frame) windowRef.cancelAnimationFrame(frame);
    if (timer) globalThis.clearTimeout(timer);
    if (typeof windowRef.requestAnimationFrame === 'function')
      frame = windowRef.requestAnimationFrame(() => { frame = 0; reveal(); });
    else timer = globalThis.setTimeout(() => { timer = 0; reveal(); }, 16);
  };
  const reveal = () => {
    if (disposed) return;
    const active = documentRef.activeElement as HTMLElement | null;
    const visual = windowRef.visualViewport;
    const layoutHeight = cssPixels(root.style, '--shantu-layout-height', Math.max(windowRef.innerHeight, root.clientHeight));
    const visualHeight = cssPixels(root.style, '--shantu-visual-height', visual?.height ?? windowRef.innerHeight);
    const geometry = keyboardOcclusion({
      layoutHeight,
      visualHeight,
      offsetTop: visual?.offsetTop ?? 0,
      innerHeight: windowRef.innerHeight,
      keyboardRect: virtualKeyboard?.boundingRect ?? null,
      viewportKeyboardOpen: root.dataset.shantuKeyboard === 'open',
    });
    if (!geometry) { restoreActive(); windowRef.dispatchEvent?.(new Event('shantu-keyboard-layout')); return; }
    // Some IMEs briefly blur the field while a candidate is selected. Keep the
    // current surface in place until the keyboard closes or focus moves hosts.
    if (!editable(active)) return;
    const nearestSurface = active.closest<HTMLElement>(SURFACE_SELECTOR);
    if (!nearestSurface || !documentRef.documentElement.contains(nearestSurface)) { restoreActive(); return; }
    // The route editor's name-field hook owns this specific IME lift.
    if (nearestSurface.matches('.route-edit-dock[data-name-keyboard="open"]')) { restoreActive(); return; }
    const surface = nearestPositionedSurface(active, windowRef);
    if (!surface) {
      if (activeSurface) restoreActive();
      revealWithinScrollHost(active, geometry.top, visual?.offsetTop ?? 0, windowRef);
      windowRef.dispatchEvent?.(new Event('shantu-keyboard-layout'));
      return;
    }
    if (activeSurface && activeSurface !== surface) restoreActive();
    if (!snapshots.has(surface)) {
      snapshots.set(surface, new Map(STYLE_PROPERTIES.map((property) => [property, {
        value: surface.style.getPropertyValue(property),
        priority: surface.style.getPropertyPriority(property),
      }])));
    }
    activeSurface = surface;

    const margin = 8;
    const safeBottom = geometry.top - margin;
    const bounds = surface.getBoundingClientRect();
    const computed = windowRef.getComputedStyle(surface);
    const offsetParent = surface.offsetParent as HTMLElement | null;
    const parentTop = computed.position === 'fixed'
      ? 0
      : offsetParent?.getBoundingClientRect().top ?? 0;
    const adjustment = keyboardSurfaceAdjustment({
      surfaceTop: bounds.top,
      surfaceBottom: bounds.bottom,
      viewportTop: visual?.offsetTop ?? 0,
      keyboardTop: geometry.top,
      margin,
    });
    // Moving `top` by the difference between target and current visual rect
    // preserves centered transforms and auto margins without applying their
    // translation a second time.
    const currentTop = Number.parseFloat(computed.top);
    const baseTop = Number.isFinite(currentTop)
      ? currentTop
      : surface.offsetTop || bounds.top - parentTop;
    const topDelta = adjustment.top - bounds.top;
    setTemporaryStyle(surface.style, 'top', `${Math.max(0, baseTop + topDelta)}px`);
    setTemporaryStyle(surface.style, 'bottom', 'auto');
    setTemporaryStyle(surface.style, 'max-height', `${adjustment.maxHeight}px`);
    setTemporaryStyle(surface.style, 'min-height', '0px');
    setTemporaryStyle(surface.style, 'overflow-y', 'auto');

    // Sizing can reduce the scrollport, so perform the final field visibility
    // correction after the surface has been constrained.
    revealWithinScrollHost(
      active, Math.min(safeBottom, surface.getBoundingClientRect().bottom - margin),
      visual?.offsetTop ?? 0, windowRef,
    );
    windowRef.dispatchEvent?.(new Event('shantu-keyboard-layout'));
  };
  function nearestPositionedSurface(field: HTMLElement, win: FocusWindow): HTMLElement | null {
    let node: HTMLElement | null = field;
    while (node && node !== documentRef.documentElement) {
      if (node.matches(SURFACE_SELECTOR)) {
        const position = win.getComputedStyle(node).position;
        if (position === 'fixed' || position === 'absolute') return node;
      }
      node = node.parentElement;
    }
    return null;
  }
  function revealWithinScrollHost(field: HTMLElement, safeBottom: number, viewportTop: number, win: FocusWindow) {
    const safeTop = viewportTop + 8;
    // A parent scroll can change the clipping rectangle after an inner list
    // has moved. Revisit the inner-to-outer chain once with the new geometry.
    for (let pass = 0; pass < 2; pass += 1) {
      let host: HTMLElement | null = field.parentElement;
      while (host) {
        if (host.matches('.observatory.home-map')) break;
        const style = win.getComputedStyle(host);
        const isDocumentScroller = host === documentRef.body || host === documentRef.documentElement;
        // Hidden overflow still has a programmatic scrollport (unlike clip).
        // Compact editors use it around an inner list, so include that layer.
        if (!isDocumentScroller && host.scrollHeight > host.clientHeight + 2 && /^(auto|scroll|overlay|hidden)$/.test(style.overflowY)) {
          const fieldBounds = field.getBoundingClientRect();
          if (host.clientHeight < fieldBounds.height + 8) {
            if (host !== activeSurface && !scrollHostSnapshots.has(host)) {
              scrollHostSnapshots.set(host, snapshotKeyboardSurfaceStyles(host.style));
            }
            // A flex child can shrink its scrollport below one editable row.
            // Give the focused row enough room while the keyboard is open.
            setTemporaryStyle(host.style, 'min-height', `${Math.ceil(fieldBounds.height + 8)}px`);
          }
          const rect = field.getBoundingClientRect();
          const hostBounds = host.getBoundingClientRect();
          const visibleTop = Math.max(safeTop, hostBounds.top);
          const visibleBottom = Math.min(safeBottom, hostBounds.bottom);
          const delta = rect.bottom > visibleBottom ? rect.bottom - visibleBottom
            : rect.top < visibleTop ? rect.top - visibleTop : 0;
          if (delta) {
            const next = Math.max(0, Math.min(host.scrollHeight - host.clientHeight, host.scrollTop + delta));
            if (next !== host.scrollTop) host.scrollTop = next;
          }
        }
        host = host.parentElement;
      }
    }
  }

  windowRef.addEventListener('resize', schedule, { passive: true });
  windowRef.addEventListener('orientationchange', schedule, { passive: true });
  windowRef.visualViewport?.addEventListener('resize', schedule, { passive: true });
  windowRef.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  virtualKeyboard?.addEventListener('geometrychange', schedule);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (frame) windowRef.cancelAnimationFrame(frame);
    if (timer) globalThis.clearTimeout(timer);
    windowRef.removeEventListener('resize', schedule);
    windowRef.removeEventListener('orientationchange', schedule);
    windowRef.visualViewport?.removeEventListener('resize', schedule);
    windowRef.visualViewport?.removeEventListener('scroll', schedule);
    virtualKeyboard?.removeEventListener('geometrychange', schedule);
    for (const surface of snapshots.keys()) restore(surface);
    for (const [host, original] of scrollHostSnapshots)
      restoreKeyboardSurfaceStyles(host.style, original);
    scrollHostSnapshots.clear();
    activeSurface = null;
    installations.delete(documentRef);
  };
  const controller = { schedule, cleanup };
  installations.set(documentRef, controller);
  return controller;
}
