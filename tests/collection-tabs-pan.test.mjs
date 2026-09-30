import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadTabs() {
  await build({
    entryPoints: ['modules/collections/CollectionTabs.tsx'],
    outfile: '.openai/collection-tabs-pan/CollectionTabs.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
  });
  return (await import('../.openai/collection-tabs-pan/CollectionTabs.js')).CollectionTabs;
}

function setupDom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const captures = new WeakMap();
  window.PointerEvent = window.Event;
  window.HTMLElement.prototype.setPointerCapture = function (id) { captures.set(this, id); };
  window.HTMLElement.prototype.hasPointerCapture = function (id) { return captures.get(this) === id; };
  window.HTMLElement.prototype.releasePointerCapture = function (id) {
    if (captures.get(this) === id) captures.delete(this);
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return window;
}

function pointer(window, type, { id = 1, kind = 'mouse', x = 20, y = 10 } = {}) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: kind, isPrimary: true, button: 0, clientX: x, clientY: y });
  return event;
}

test('category tabs pan with mouse and touch, reorder only after stationary long press, and retain keyboard actions', async t => {
  const window = setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const CollectionTabs = await loadTabs();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => act(async () => root.unmount()));
  const selected = [], reordered = [];
  await act(async () => root.render(React.createElement(CollectionTabs, {
    order: ['regions', 'all', 'hidden', 'route'], selected: 'all', regions: false,
    onSelect: key => selected.push(key), onReorder: order => { reordered.push(order); return true; },
  })));
  const nav = host.querySelector('nav');
  Object.defineProperties(nav, {
    clientWidth: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 400 },
  });
  nav.scrollLeft = 0;
  const all = () => host.querySelector('[data-collection-tab="all"]');
  const route = () => host.querySelector('[data-collection-tab="route"]');
  const setButtonRects = () => {
    const positions = { regions: 10, all: 60, hidden: 110, route: 160 };
    for (const button of nav.querySelectorAll('[data-collection-tab]')) {
      const left = positions[button.dataset.collectionTab];
      button.getBoundingClientRect = () => ({ left, right: left + 40, top: 0, bottom: 36, width: 40, height: 36 });
    }
  };
  setButtonRects();

  await act(async () => {
    all().dispatchEvent(pointer(window, 'pointerdown', { kind: 'mouse', x: 70 }));
    nav.dispatchEvent(pointer(window, 'pointermove', { kind: 'mouse', x: 35 }));
    nav.dispatchEvent(pointer(window, 'pointerup', { kind: 'mouse', x: 35 }));
  });
  assert.equal(nav.scrollLeft, 35, 'mouse drag scrolls the horizontal tab strip');
  assert.deepEqual(reordered, [], 'mouse pan never reorders');
  assert.deepEqual(selected, [], 'mouse pan never selects');

  await act(async () => {
    all().dispatchEvent(pointer(window, 'pointerdown', { id: 2, kind: 'touch', x: 70 }));
    nav.dispatchEvent(pointer(window, 'pointermove', { id: 2, kind: 'touch', x: 45 }));
    nav.dispatchEvent(pointer(window, 'pointerup', { id: 2, kind: 'touch', x: 45 }));
  });
  assert.equal(nav.scrollLeft, 60, 'touch drag also pans horizontally');
  assert.deepEqual(reordered, []);
  assert.deepEqual(selected, []);

  await act(async () => {
    all().dispatchEvent(pointer(window, 'pointerdown', { id: 3, kind: 'touch', x: 70 }));
    await new Promise(resolve => setTimeout(resolve, 480));
    nav.dispatchEvent(pointer(window, 'pointermove', { id: 3, kind: 'touch', x: 180 }));
    nav.dispatchEvent(pointer(window, 'pointerup', { id: 3, kind: 'touch', x: 180 }));
  });
  assert.equal(reordered.length, 1, 'stationary long press activates reorder');
  assert.equal(reordered[0][3], 'all');
  assert.deepEqual(selected, [], 'reorder gesture does not select');

  await act(async () => {
    route().dispatchEvent(pointer(window, 'pointerdown', { id: 4, kind: 'mouse', x: 170 }));
    nav.dispatchEvent(pointer(window, 'pointercancel', { id: 4, kind: 'mouse', x: 170 }));
  });
  assert.equal(reordered.length, 1, 'cancel does not commit a reorder');
  assert.deepEqual(selected, [], 'cancel does not select');

  const keyClick = new window.Event('click', { bubbles: true });
  Object.assign(keyClick, { detail: 0 });
  await act(async () => all().dispatchEvent(keyClick));
  assert.deepEqual(selected, ['all'], 'keyboard-style click still selects');
  const altLeft = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(altLeft, { key: 'ArrowLeft', altKey: true });
  await act(async () => all().dispatchEvent(altLeft));
  assert.equal(reordered.length, 2, 'Alt+Arrow keeps the keyboard reorder action');
  assert.equal(reordered[1][0], 'all');

  nav.scrollLeft = 0;
  const verticalWheel = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(verticalWheel, { deltaX: 0, deltaY: 24 });
  nav.dispatchEvent(verticalWheel);
  assert.equal(nav.scrollLeft, 24, 'vertical wheel pans when horizontal overflow is available');
  assert.equal(verticalWheel.defaultPrevented, true);
  const horizontalWheel = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(horizontalWheel, { deltaX: 24, deltaY: 0 });
  nav.dispatchEvent(horizontalWheel);
  assert.equal(horizontalWheel.defaultPrevented, false, 'horizontal touchpad motion is left alone');
  const zoomWheel = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(zoomWheel, { ctrlKey: true, deltaX: 0, deltaY: 24 });
  nav.dispatchEvent(zoomWheel);
  assert.equal(zoomWheel.defaultPrevented, false, 'browser zoom gesture is left alone');
  nav.scrollLeft = 300;
  const edgeWheel = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(edgeWheel, { deltaX: 0, deltaY: 24 });
  nav.dispatchEvent(edgeWheel);
  assert.equal(edgeWheel.defaultPrevented, false, 'wheel bubbles at the horizontal end');
  Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 100 });
  nav.scrollLeft = 0;
  const noOverflowWheel = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.assign(noOverflowWheel, { deltaX: 0, deltaY: 24 });
  nav.dispatchEvent(noOverflowWheel);
  assert.equal(noOverflowWheel.defaultPrevented, false, 'wheel bubbles when tabs do not overflow');
});
