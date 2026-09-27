const APP_BACK_SELECTOR = '[data-app-back],dialog[open],[role="dialog"][aria-modal="true"]';

function isVisible(element: Element): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true')
    return false;
  const view = element.ownerDocument.defaultView;
  const style = typeof view?.getComputedStyle === 'function' ? view.getComputedStyle(element) : null;
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0)
    return false;
  return true;
}

function priority(element: Element): number {
  if (element.matches('dialog[open],[role="dialog"][aria-modal="true"]')) return 100;
  const raw = element.getAttribute('data-app-back');
  if (raw === null || raw.trim() === '') return 10;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 10;
}

function dispatchEscape(target: Element): boolean {
  const document = target.ownerDocument;
  const view = document.defaultView;
  const KeyboardEventCtor = view?.KeyboardEvent ?? globalThis.KeyboardEvent;
  const EventCtor = view?.Event ?? globalThis.Event;
  const event = KeyboardEventCtor
    ? new KeyboardEventCtor('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    : new EventCtor('keydown', { bubbles: true, cancelable: true });
  if (!('key' in event)) Object.defineProperty(event, 'key', { value: 'Escape' });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Dispatches Escape to the topmost visible app-back surface, then the app root. */
export function requestAppBack(document: Document): boolean {
  const surfaces = Array.from(document.querySelectorAll(APP_BACK_SELECTOR)).filter(isVisible);
  let target: Element | null = null;
  if (surfaces.length) {
    let topPriority = -Infinity;
    for (const surface of surfaces) {
      const candidatePriority = priority(surface);
      if (candidatePriority >= topPriority) {
        topPriority = candidatePriority;
        target = surface;
      }
    }
  }

  const focused = document.activeElement;
  const focusedTarget = target && focused && target.contains(focused) ? focused : null;
  if (target && dispatchEscape(focusedTarget ?? target)) return true;

  const appRoot = document.querySelector('.observatory');
  return appRoot ? dispatchEscape(appRoot) : false;
}
