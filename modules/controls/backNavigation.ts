import { useEffect, useRef, type RefObject } from 'react';
type Entry = { node: () => HTMLElement | null; back: () => void };
const entries = new Set<Entry>();
let dispatching = false;
declare global {
  interface Window {
    shantuBack?: () => boolean;
  }
}
const visible = (node: HTMLElement) =>
  node.isConnected &&
  node.getClientRects().length > 0 &&
  getComputedStyle(node).visibility !== 'hidden';
function rank(node: HTMLElement) {
  const values: number[] = [];
  for (let el: HTMLElement | null = node; el; el = el.parentElement) {
    const style = getComputedStyle(el),
      z = Number.parseInt(style.zIndex);
    if (Number.isFinite(z)) values.unshift(z);
  }
  if (node.closest('dialog[open]')) values.unshift(100000);
  return values;
}
function compare(a: HTMLElement, b: HTMLElement) {
  if (a.contains(b)) return -1;
  if (b.contains(a)) return 1;
  const x = rank(a),
    y = rank(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const delta = (x[i] ?? 0) - (y[i] ?? 0);
    if (delta) return delta;
  }
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}
/** Transitional adapters for existing independent windows; new windows register their own back action. */
const legacy =
  'dialog[open],.trip-photo-viewer,.route-dialog,.section-list,.area-editor,.area-selection,.area-drawing-tools,.section-profile,.quick-add,.layer-window,.control-dock.is-expanded,.object-gizmo[data-active="true"]';
export function dispatchBack() {
  const registered = [...entries].flatMap((entry) => {
    const node = entry.node();
    return node && visible(node) ? [{ node, back: entry.back }] : [];
  });
  const candidates = [
    ...registered,
    ...Array.from(document.querySelectorAll<HTMLElement>(legacy))
      .filter(
        (node) => visible(node) && !registered.some((r) => r.node === node),
      )
      .map((node) => ({
        node,
        back: () => {
          dispatching = true;
          try {
            node.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
              }),
            );
          } finally {
            dispatching = false;
          }
        },
      })),
  ].sort((a, b) => compare(a.node, b.node));
  const top = candidates.at(-1);
  if (top) {
    top.back();
    return true;
  }
  const root = document.querySelector<HTMLElement>('.observatory');
  if (!root) return false;
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  dispatching = true;
  try {
    root.dispatchEvent(event);
  } finally {
    dispatching = false;
  }
  return event.defaultPrevented;
}
export function registerBackHandler(node: Entry['node'], back: Entry['back']) {
  const entry = { node, back };
  entries.add(entry);
  return () => {
    entries.delete(entry);
  };
}
export function useBackHandler(
  active: boolean,
  root: RefObject<HTMLElement | null>,
  back: () => void,
) {
  const current = useRef(back);
  current.current = back;
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(
      () => root.current,
      () => current.current(),
    );
  }, [active, root]);
}
export function useBackDispatcher() {
  useEffect(() => {
    window.shantuBack = dispatchBack;
    const key = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.defaultPrevented ||
        dispatching ||
        e.isComposing
      )
        return;
      // Field editors retain their local Escape-to-revert behavior.
      if (
        e.target instanceof HTMLElement &&
        e.target.matches('input,textarea,[contenteditable="true"]')
      )
        return;
      if (dispatchBack()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      if (window.shantuBack === dispatchBack) delete window.shantuBack;
    };
  }, []);
}
