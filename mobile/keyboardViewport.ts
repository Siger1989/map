import { installKeyboardFocusVisibility, type KeyboardFocusVisibilityController } from './keyboardFocus.ts';

type ViewportWindow = Window & {
  visualViewport?: VisualViewport | null;
  navigator?: Navigator & { userAgentData?: { mobile?: boolean } };
  frameElement?: Element | null;
};

type Snapshot = { value: string; priority: string };
type OriginalState = {
  variables: Map<string, Snapshot>;
  hadKeyboardAttribute: boolean;
  keyboardAttribute: string | undefined;
  hadLayoutBandAttribute: boolean;
  layoutBandAttribute: string | undefined;
};

const installations = new WeakMap<Document, () => void>();
const VH_PROPERTY = '--shantu-vh';
const VISUAL_HEIGHT_PROPERTY = '--shantu-visual-height';
const LAYOUT_HEIGHT_PROPERTY = '--shantu-layout-height';
const KEYBOARD_ATTRIBUTE = 'shantuKeyboard';
const MIN_KEYBOARD_SHRINK = 120;
const KEYBOARD_SHRINK_FRACTION = 0.2;
const RESTORE_TOLERANCE_PX = 4;
const WIDTH_CHANGE_FRACTION = 0.08;

function supportsOnScreenKeyboard(windowRef: ViewportWindow): boolean {
  const navigatorRef = windowRef.navigator;
  if (navigatorRef?.userAgentData?.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigatorRef?.userAgent ?? '')) return true;
  try {
    return windowRef.frameElement?.getAttribute('data-shantu-preview-keyboard') === 'open';
  } catch {
    return false;
  }
}

function layoutHeight(windowRef: Window, visualViewport: VisualViewport | null | undefined) {
  const innerHeight = windowRef.innerHeight;
  if (Number.isFinite(innerHeight) && innerHeight > 0) return innerHeight;
  const visualHeight = visualViewport?.height ?? 0;
  return Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : 0;
}

function liveVisualHeight(windowRef: Window, visualViewport: VisualViewport | null | undefined) {
  const candidates = [windowRef.innerHeight, visualViewport?.height ?? 0]
    .filter((height) => Number.isFinite(height) && height > 0);
  return candidates.length ? Math.min(...candidates) : 0;
}

function editable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.matches !== 'function') return false;
  if (element.isContentEditable) return true;
  if (element.matches('textarea:not([disabled]):not([readonly]), [contenteditable]:not([contenteditable="false"])'))
    return true;
  if (!element.matches('input:not([disabled]):not([readonly])')) return false;
  const type = (element as HTMLInputElement).type?.toLowerCase() ?? 'text';
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function readStyle(root: HTMLElement, property: string): Snapshot {
  return { value: root.style.getPropertyValue(property), priority: root.style.getPropertyPriority(property) };
}

function restoreStyle(root: HTMLElement, property: string, snapshot: Snapshot) {
  if (snapshot.value) root.style.setProperty(property, snapshot.value, snapshot.priority);
  else root.style.removeProperty(property);
}

function layoutBand(height: number) {
  if (height <= 520) return 'short';
  if (height <= 600) return 'compact';
  if (height <= 740) return 'medium';
  return 'tall';
}

/** Freeze only the dvh compatibility unit while an editable field's IME is resizing the viewport. */
export function installKeyboardViewportCompatibility(
  documentRef: Document, windowRef: ViewportWindow, supportsDvh: boolean,
): () => void {
  const existing = installations.get(documentRef);
  if (existing) return existing;

  const root = documentRef.documentElement;
  const visualViewport = windowRef.visualViewport;
  const original: OriginalState = {
    variables: new Map([VH_PROPERTY, VISUAL_HEIGHT_PROPERTY, LAYOUT_HEIGHT_PROPERTY]
      .map((property) => [property, readStyle(root, property)])),
    hadKeyboardAttribute: Object.prototype.hasOwnProperty.call(root.dataset, KEYBOARD_ATTRIBUTE),
    keyboardAttribute: root.dataset[KEYBOARD_ATTRIBUTE],
    hadLayoutBandAttribute: Object.prototype.hasOwnProperty.call(root.dataset, 'shantuLayoutBand'),
    layoutBandAttribute: root.dataset.shantuLayoutBand,
  };
  let baselineHeight = layoutHeight(windowRef, visualViewport);
  let baselineWidth = windowRef.innerWidth;
  let focusedEditable = false;
  let keyboardOpen = false;
  let disposed = false;
  let focusVisibility: KeyboardFocusVisibilityController | null = null;

  const setLayoutMode = (height: number) => {
    const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
    root.style.setProperty(VH_PROPERTY, keyboardOpen
      ? `${baselineHeight / 100}px`
      : supportsDvh ? '1dvh' : `${liveVisualHeight(windowRef, visualViewport) / 100}px`);
    root.style.setProperty(VISUAL_HEIGHT_PROPERTY, `${liveVisualHeight(windowRef, visualViewport)}px`);
    root.style.setProperty(LAYOUT_HEIGHT_PROPERTY, `${keyboardOpen ? baselineHeight : safeHeight}px`);
    root.dataset.shantuLayoutBand = layoutBand(keyboardOpen ? baselineHeight : safeHeight);
    if (keyboardOpen) root.dataset[KEYBOARD_ATTRIBUTE] = 'open';
    else delete root.dataset[KEYBOARD_ATTRIBUTE];
    focusVisibility?.schedule();
  };

  const onFocusIn = (event: FocusEvent) => {
    focusVisibility?.schedule();
    if (!editable(event.target)) return;
    focusedEditable = true;
    if (!keyboardOpen) {
      baselineHeight = layoutHeight(windowRef, visualViewport);
      baselineWidth = windowRef.innerWidth;
      setLayoutMode(baselineHeight);
    }
  };

  const onFocusOut = (event: FocusEvent) => {
    if (editable(event.target)) focusedEditable = false;
    // Do not release here: a candidate click or a switch to another input can blur briefly.
    focusVisibility?.schedule();
  };

  const onViewportChange = () => {
    if (disposed) return;
    const visualHeight = liveVisualHeight(windowRef, visualViewport);
    const currentWidth = windowRef.innerWidth;
    const widthChanged = Number.isFinite(currentWidth) && Number.isFinite(baselineWidth) &&
      Math.abs(currentWidth - baselineWidth) > Math.max(24, baselineWidth * WIDTH_CHANGE_FRACTION);
    if (widthChanged) {
      // Orientation or a genuine layout-width change invalidates the old freeze.
      keyboardOpen = false;
      baselineWidth = currentWidth;
      baselineHeight = layoutHeight(windowRef, visualViewport);
      setLayoutMode(baselineHeight);
      return;
    }

    if (keyboardOpen) {
      const recoveredBy = baselineHeight - visualHeight;
      if (recoveredBy <= RESTORE_TOLERANCE_PX) {
        keyboardOpen = false;
        baselineHeight = layoutHeight(windowRef, visualViewport);
        setLayoutMode(baselineHeight);
        return;
      }
    } else if (focusedEditable && supportsOnScreenKeyboard(windowRef)) {
      const shrink = baselineHeight - visualHeight;
      if (shrink > MIN_KEYBOARD_SHRINK && shrink > baselineHeight * KEYBOARD_SHRINK_FRACTION) {
        keyboardOpen = true;
        setLayoutMode(baselineHeight);
        return;
      }
    } else if (!keyboardOpen) {
      // Normal browser, system-bar, and desktop resizing remains live.
      baselineHeight = layoutHeight(windowRef, visualViewport);
      baselineWidth = currentWidth;
    }
    setLayoutMode(layoutHeight(windowRef, visualViewport));
  };

  documentRef.addEventListener('focusin', onFocusIn, true);
  documentRef.addEventListener('focusout', onFocusOut, true);
  windowRef.addEventListener('resize', onViewportChange, { passive: true });
  windowRef.addEventListener('orientationchange', onViewportChange, { passive: true });
  visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
  visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });
  focusVisibility = installKeyboardFocusVisibility(documentRef, windowRef);
  setLayoutMode(baselineHeight);

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    documentRef.removeEventListener('focusin', onFocusIn, true);
    documentRef.removeEventListener('focusout', onFocusOut, true);
    windowRef.removeEventListener('resize', onViewportChange);
    windowRef.removeEventListener('orientationchange', onViewportChange);
    visualViewport?.removeEventListener('resize', onViewportChange);
    visualViewport?.removeEventListener('scroll', onViewportChange);
    focusVisibility?.cleanup();
    focusVisibility = null;
    for (const [property, snapshot] of original.variables) restoreStyle(root, property, snapshot);
    if (original.hadKeyboardAttribute) root.dataset[KEYBOARD_ATTRIBUTE] = original.keyboardAttribute ?? '';
    else delete root.dataset[KEYBOARD_ATTRIBUTE];
    if (original.hadLayoutBandAttribute) root.dataset.shantuLayoutBand = original.layoutBandAttribute ?? '';
    else delete root.dataset.shantuLayoutBand;
    if (installations.get(documentRef) === cleanup) installations.delete(documentRef);
  };
  installations.set(documentRef, cleanup);
  return cleanup;
}
