/**
 * Publishes the DOM hit regions and map viewports used by the Android native
 * map host. The module is inert in an ordinary browser: it only changes page
 * styling after the native bridge reports a live session.
 */

export type NativeUIRegionCommand = 'uiRegions' | 'viewport';

export type NativeUIRegionPacket = {
  command: NativeUIRegionCommand;
  payload: Record<string, unknown>;
};

export type NativeUIRegionTransport = {
  getSessionId: () => string | null | undefined;
  /** The host adapter forwards command/payload through NativeMapBridgeClient. */
  send: (packet: NativeUIRegionPacket) => void;
};

type Rect = { left: number; top: number; right: number; bottom: number };
type Region = Rect & { id: string; kind: 'control' | 'scroll' | 'overlay' | 'modal' };
type Viewport = Rect & { mapId: string };

const ROOT_SELECTOR = '#root';
const MAP_SELECTOR = '.map-canvas';
const STROKE_HIT_SELECTOR = '.gizmo-hit,.gizmo-hit-ring,.survey-hit-line';
const INTERACTIVE_SELECTOR = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled])', 'textarea:not([disabled])',
  'select:not([disabled])', 'summary', '[role="button"]', '[role="link"]',
  'label.import-file',
  '[role="menuitem"]', '[role="option"]', '[role="checkbox"]', '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])', '[draggable="true"]', '[contenteditable="true"]',
  '[data-native-map-ui]', '[data-native-map-interactive]',
  '[role="dialog"]', '[role="alertdialog"]', 'dialog[open]',
  '.maplibregl-marker', '.maplibregl-popup', '.object-gizmo-canvas .gizmo-hit', '.object-gizmo-canvas .gizmo-hit-ring',
  '.object-gizmo', '.object-gizmo-actions', '.trip-photo-viewer', '.photo-expand',
].join(',');
const MODAL_SELECTOR = [
  '[role="dialog"][aria-modal="true"]', '[role="alertdialog"][aria-modal="true"]',
  'dialog[open]', '[data-native-modal="true"]',
].join(',');

let transport: NativeUIRegionTransport | null = null;
let installed = false;
let running = false;
let nativeSession: string | null = null;
let cleanupCurrent: (() => void) | null = null;
let disposeInstalled: (() => void) | null = null;
let mapIdResolver: ((element: HTMLElement, index: number) => string) | undefined;

function visibleRect(element: Element, interactive = false): Rect | null {
  if (!(element instanceof HTMLElement || element instanceof SVGElement)) return null;
  const style = getComputedStyle(element);
  const transparentFileInput = interactive && element instanceof HTMLInputElement && element.type === 'file';
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 && !transparentFileInput || element.hasAttribute('hidden')) return null;
  if (interactive && (style.pointerEvents === 'none' || element.closest('[inert]'))) return null;
  if (interactive && element.matches('label.import-file') && element.querySelector('input[type="file"]:disabled')) return null;
  const r = element.getBoundingClientRect();
  const strokePadding = interactive && element instanceof SVGElement && element.matches(STROKE_HIT_SELECTOR)
    ? Math.max(4, (parseFloat(style.strokeWidth) || 8) / 2) : 0;
  let left = Math.max(0, r.left - strokePadding), top = Math.max(0, r.top - strokePadding);
  let right = Math.min(document.documentElement.clientWidth, r.right + strokePadding);
  let bottom = Math.min(document.documentElement.clientHeight, r.bottom + strokePadding);
  // Offscreen scroll rows must not intercept map touches outside their clipped panel.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const ancestorStyle = getComputedStyle(parent);
    if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) === 0 || parent.hasAttribute('hidden')) return null;
    const bounds = parent.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/.test(ancestorStyle.overflowX)) {
      left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
    }
    if (/^(auto|scroll|hidden|clip)$/.test(ancestorStyle.overflowY)) {
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function interactiveRects(element: Element): Rect[] {
  const clip = visibleRect(element, true);
  if (!clip) return [];
  // Publish real stroke cells rather than the empty corners/center of the bounds.
  // A horizontal or vertical survey path also needs stroke padding before clipping
  // because the SVG geometry bounds have zero height or width without its stroke.
  if (typeof SVGGeometryElement !== 'undefined' && element instanceof SVGGeometryElement && element.matches(STROKE_HIT_SELECTOR)) {
    try {
      const length = element.getTotalLength(), matrix = element.getScreenCTM();
      if (!matrix || !Number.isFinite(length) || length <= 0) return [];
      const steps = Math.min(256, Math.max(2, Math.ceil(length / 5)));
      const radius = Math.max(4, (parseFloat(getComputedStyle(element).strokeWidth) || 8) / 2);
      const rectangles: Rect[] = [];
      let previous = element.getPointAtLength(0).matrixTransform(matrix);
      for (let i = 1; i <= steps; i++) {
        const current = element.getPointAtLength(length * i / steps).matrixTransform(matrix);
        const rect = { left: Math.max(clip.left, Math.min(previous.x, current.x) - radius), top: Math.max(clip.top, Math.min(previous.y, current.y) - radius),
          right: Math.min(clip.right, Math.max(previous.x, current.x) + radius), bottom: Math.min(clip.bottom, Math.max(previous.y, current.y) + radius) };
        if (rect.right > rect.left && rect.bottom > rect.top) rectangles.push(rect);
        previous = current;
      }
      return rectangles;
    } catch { return [clip]; }
  }
  return [clip];
}

function stableMapId(element: HTMLElement, index: number): string {
  const explicit = element.dataset.nativeMapId || element.dataset.mapId ||
    element.closest<HTMLElement>('[data-native-map-id],[data-map-id]')?.dataset.nativeMapId ||
    element.closest<HTMLElement>('[data-native-map-id],[data-map-id]')?.dataset.mapId;
  if (explicit) return explicit;
  if (element.classList.contains('map-comparison-secondary')) return 'secondary';
  if (element.classList.contains('map-comparison-primary')) return 'primary';
  return index === 0 ? 'primary' : `map-${index + 1}`;
}

function regionKind(element: Element): Region['kind'] {
  if (element.matches(MODAL_SELECTOR) || element.closest(MODAL_SELECTOR)) return 'modal';
  if (element.matches('.maplibregl-marker,.maplibregl-popup,.object-gizmo-canvas .gizmo-hit,.object-gizmo-canvas .gizmo-hit-ring,.survey-hit-line,.photo-expand,[data-native-map-interactive]')) return 'overlay';
  const html = element as HTMLElement;
  if (html.scrollHeight > html.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(html).overflowY)) return 'scroll';
  return 'control';
}

/** Pure, exported geometry helpers keep the packet contract testable without a browser. */
export function nativeMapIdFor(element: { dataset?: Record<string, string>; classList?: { contains(name: string): boolean } }, index: number): string {
  const dataset = element.dataset ?? {};
  return dataset.nativeMapId || dataset.mapId || (element.classList?.contains('map-comparison-secondary') ? 'secondary'
    : element.classList?.contains('map-comparison-primary') ? 'primary' : index === 0 ? 'primary' : `map-${index + 1}`);
}

export function buildNativeUIRegionSnapshot(
  regions: Region[], viewports: Viewport[], width: number, height: number, dpr: number, modalActive: boolean,
): Record<string, unknown> {
  return {
    clientViewportWidth: width,
    clientViewportHeight: height,
    devicePixelRatio: dpr,
    modalActive,
    regions: regions.map(({ id, kind, left, top, right, bottom }) => ({ id, kind, left, top, right, bottom })),
    viewports: viewports.map(({ mapId, left, top, right, bottom }) => ({ mapId, left, top, right, bottom })),
  };
}

export function nativeUIRegionPackets(snapshot: Record<string, unknown>): NativeUIRegionPacket[] {
  const { regions, viewports, modalActive, ...metrics } = snapshot;
  return [
    { command: 'uiRegions', payload: { ...metrics, modalActive, regions } },
    { command: 'viewport', payload: { ...metrics, viewports } },
  ];
}

function applyNativeMapHostStyle(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const priorHtml = html.dataset.nativeMapHost;
  const priorBody = body.dataset.nativeMapHost;
  html.dataset.nativeMapHost = 'true';
  body.dataset.nativeMapHost = 'true';
  const style = document.createElement('style');
  style.dataset.nativeMapHostStyle = 'true';
  style.textContent = `
    html[data-native-map-host="true"], body[data-native-map-host="true"], body[data-native-map-host="true"] #root,
    body[data-native-map-host="true"] .observatory, body[data-native-map-host="true"] .map-canvas {
      background: transparent !important;
    }
  `;
  document.head.appendChild(style);
  return () => {
    style.remove();
    if (priorHtml === undefined) delete html.dataset.nativeMapHost; else html.dataset.nativeMapHost = priorHtml;
    if (priorBody === undefined) delete body.dataset.nativeMapHost; else body.dataset.nativeMapHost = priorBody;
  };
}

function startPublisher(): void {
  if (running || !transport || !nativeSession || !document.body) return;
  running = true;
  const clearStyle = applyNativeMapHostStyle();
  let raf = 0;
  let lastUiFingerprint = '';
  let lastViewportFingerprint = '';
  let resize: ResizeObserver | null = null;
  const observedSizes = new Set<Element>();
  const publish = () => {
    raf = 0;
    if (!running || !transport || !nativeSession) return;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const mapElements = Array.from(document.querySelectorAll<HTMLElement>(MAP_SELECTOR));
    const viewports: Viewport[] = mapElements.flatMap((element, index) => {
      const rect = visibleRect(element);
      return rect ? [{ ...rect, mapId: mapIdResolver?.(element, index) ?? stableMapId(element, index) }] : [];
    });
    const candidates = new Set<Element>(Array.from(document.querySelectorAll<Element>(INTERACTIVE_SELECTOR)));
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight + 2 && /(auto|scroll)/.test(style.overflowY)) candidates.add(element);
    }
    const seen = new Set<Element>();
    const regions: Region[] = [];
    for (const element of candidates) {
      if (seen.has(element)) continue;
      seen.add(element);
      const rectangles = interactiveRects(element);
      if (!rectangles.length) continue;
      const html = element as HTMLElement;
      const id = html.dataset.nativeUiId || html.id || `${element.tagName.toLowerCase()}-${regions.length}`;
      rectangles.forEach((rect, index) => regions.push({ ...rect, id: `${id}:${index}`, kind: regionKind(element) }));
    }
    const currentSizes = new Set<Element>([...mapElements, ...candidates]);
    for (const element of observedSizes) if (!currentSizes.has(element)) { resize?.unobserve(element); observedSizes.delete(element); }
    for (const element of currentSizes) if (!observedSizes.has(element)) { resize?.observe(element); observedSizes.add(element); }
    const modalActive = document.querySelector(MODAL_SELECTOR) !== null ||
      document.querySelector('.layout-mobile,[data-layout-editing="true"],[data-recovery-active="true"]') !== null ||
      document.body.dataset.layoutEditing === 'true' || document.body.dataset.recoveryActive === 'true';
    const snapshot = buildNativeUIRegionSnapshot(regions, viewports, width, height, window.devicePixelRatio || 1, modalActive);
    const [uiPacket, viewportPacket] = nativeUIRegionPackets(snapshot);
    const uiPayload = uiPacket.payload;
    const viewportPayload = viewportPacket.payload;
    const uiFingerprint = JSON.stringify(uiPayload);
    const viewportFingerprint = JSON.stringify(viewportPayload);
    try {
      if (uiFingerprint !== lastUiFingerprint) {
        lastUiFingerprint = uiFingerprint;
        transport.send(uiPacket);
      }
      if (viewportFingerprint !== lastViewportFingerprint) {
        lastViewportFingerprint = viewportFingerprint;
        transport.send(viewportPacket);
      }
    } catch {
      // Leave the last fingerprints stale so the next scheduled update retries both packets.
      lastUiFingerprint = '';
      lastViewportFingerprint = '';
    }
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(publish);
  };
  const forcePublish = () => {
    if (!running || !transport || !nativeSession) return;
    lastUiFingerprint = '';
    lastViewportFingerprint = '';
    schedule();
  };
  const resume = () => forcePublish();
  const visibility = () => { if (document.visibilityState === 'visible') forcePublish(); };
  const mutation = new MutationObserver(schedule);
  mutation.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-modal', 'data-native-map-id', 'data-map-id', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'transform', 'points'] });
  resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(document.documentElement);
  const scroll = () => schedule();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', scroll, { passive: true, capture: true });
  window.addEventListener('shantu:native-map-resume', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', visibility);
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
  schedule();
  cleanupCurrent = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    mutation.disconnect();
    resize?.disconnect();
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', scroll, true);
    window.removeEventListener('shantu:native-map-resume', resume);
    window.removeEventListener('focus', resume);
    document.removeEventListener('visibilitychange', visibility);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    clearStyle();
    cleanupCurrent = null;
  };
}

/** Configure with the Root-owned NativeMapBridgeClient adapter; no JS bridge is replaced here. */
export function configureNativeUIRegionTransport(
  next: NativeUIRegionTransport,
  options: { resolveMapId?: (element: HTMLElement, index: number) => string } = {},
): () => void {
  if (transport !== next) cleanupCurrent?.();
  transport = next;
  mapIdResolver = options.resolveMapId;
  const current = next.getSessionId?.();
  if (current) nativeSession = current;
  if (nativeSession) startPublisher();
  return () => {
    if (transport !== next) return;
    cleanupCurrent?.();
    transport = null;
    nativeSession = null;
    mapIdResolver = undefined;
  };
}

/** Install once from mobile/main.tsx. It remains inert until both host and bridge are ready. */
export function installNativeUIRegions(): () => void {
  if (installed) return disposeInstalled ?? (() => {});
  installed = true;
  const ready = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
    const sessionId = detail?.sessionId || transport?.getSessionId?.() || null;
    if (!sessionId) return;
    nativeSession = sessionId;
    cleanupCurrent?.();
    startPublisher();
  };
  window.addEventListener('shantu:native-map-ready', ready);
  const existing = transport?.getSessionId?.();
  if (existing) { nativeSession = existing; startPublisher(); }
  disposeInstalled = () => {
    window.removeEventListener('shantu:native-map-ready', ready);
    cleanupCurrent?.();
    nativeSession = null;
    installed = false;
    disposeInstalled = null;
  };
  return disposeInstalled;
}
