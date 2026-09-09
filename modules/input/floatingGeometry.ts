type Rect = { top: number; bottom: number; left: number; width: number };
export function floatingGeometry(anchor: Rect, viewport: { top: number; left: number; width: number; height: number }, maxHeight = 200) {
  const top = viewport.top + 4, bottom = viewport.top + viewport.height - 4;
  const width = Math.max(0, Math.min(320, Math.max(240, anchor.width), viewport.width - 8));
  const left = Math.max(viewport.left + 4, Math.min(anchor.left, viewport.left + viewport.width - width - 4));
  const belowTop = Math.max(top, anchor.bottom + 4), aboveBottom = Math.min(bottom, anchor.top - 4);
  const below = Math.max(0, bottom - belowTop), above = Math.max(0, aboveBottom - top);
  const useBelow = below >= 120 || below >= above;
  const height = Math.min(maxHeight, useBelow ? below : above);
  return { left, width, top: useBelow ? Math.min(bottom, belowTop) : Math.max(top, aboveBottom - height), maxHeight: height };
}

/** IME-resized WebViews use visualViewport; overlay keyboards may expose a rectangle. */
export function searchViewport() {
  const v = window.visualViewport;
  const top = v?.offsetTop ?? 0, left = v?.offsetLeft ?? 0;
  const keyboard = (navigator as Navigator & { virtualKeyboard?: EventTarget & { boundingRect: DOMRectReadOnly } }).virtualKeyboard;
  const rect = keyboard?.boundingRect;
  const bottom = Math.min(top + (v?.height ?? innerHeight), rect && rect.height > 0 ? rect.top : Infinity);
  return { top, left, width: v?.width ?? innerWidth, height: Math.max(0, bottom - top) };
}
export function observeSearchViewport(update: () => void) {
  const keyboard = (navigator as Navigator & { virtualKeyboard?: EventTarget }).virtualKeyboard;
  window.addEventListener('resize', update);
  document.addEventListener('scroll', update, true);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  keyboard?.addEventListener('geometrychange', update);
  return () => {
    window.removeEventListener('resize', update);
    document.removeEventListener('scroll', update, true);
    window.visualViewport?.removeEventListener('resize', update);
    window.visualViewport?.removeEventListener('scroll', update);
    keyboard?.removeEventListener('geometrychange', update);
  };
}
