import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { installDesktopPanReceiver } from '../modules/map/desktopPan.ts';

function receiverHarness() {
  const windowListeners = new Map();
  const mapListeners = new Map();
  const calls = { panBy: [], stop: 0 };
  const window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (windowListeners.get(name) === listener) windowListeners.delete(name);
    },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  globalThis.window = window;
  globalThis.document = { documentElement: { dataset: { shantuDesktop: 'true' } } };
  const element = {
    hidden: false,
    inert: false,
    parentElement: null,
    classList: { contains: () => false },
    getClientRects: () => [{ width: 100, height: 100 }],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
    closest: () => null,
    getAttribute: () => null,
  };
  const map = {
    on(name, listener) {
      const listeners = mapListeners.get(name) ?? new Set();
      listeners.add(listener);
      mapListeners.set(name, listeners);
    },
    off(name, listener) { mapListeners.get(name)?.delete(listener); },
    emit(name, event = {}) { for (const listener of mapListeners.get(name) ?? []) listener(event); },
    panBy(...args) { calls.panBy.push(args); },
    stop() { calls.stop++; },
  };
  const dispatch = (detail) => {
    const listener = windowListeners.get('shantu-desktop-pan');
    listener?.({ detail });
    return detail;
  };
  const dispose = installDesktopPanReceiver(map, element);
  return { window, element, map, calls, dispatch, dispose, mapListeners, windowListeners };
}

function shellHarness() {
  let nextFrame = 1;
  const queuedFrames = new Map();
  const elements = new Map();
  const events = [];
  const listeners = (element) => {
    const handlers = new Map();
    element.addEventListener = (name, listener) => {
      const bucket = handlers.get(name) ?? [];
      bucket.push(listener);
      handlers.set(name, bucket);
    };
    element.fire = (name, event = {}) => {
      for (const listener of handlers.get(name) ?? []) listener(event);
    };
    return element;
  };
  const ids = [
    'fullscreen-toggle', 'help-toggle', 'mouse-help', 'desktop-message',
    'map-pan-overlay', 'map-pan', 'pan-thumb', 'help-close', 'map-frame',
    'industry-frame',
  ];
  for (const id of ids) {
    const element = listeners({ id, style: {}, attrs: {}, hidden: false, disabled: false, textContent: '' });
    element.setAttribute = (name, value) => { element.attrs[name] = value; };
    element.getAttribute = (name) => element.attrs[name] ?? null;
    element.focus = () => {};
    elements.set(id, element);
  }
  const panButton = elements.get('map-pan');
  panButton.capture = null;
  panButton.setPointerCapture = (id) => { panButton.capture = id; };
  panButton.hasPointerCapture = (id) => panButton.capture === id;
  panButton.releasePointerCapture = () => { panButton.capture = null; };
  panButton.getBoundingClientRect = () => ({ left: 0, top: 0, width: 96, height: 96 });
  class CustomEventMock {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
  const frame = elements.get('map-frame');
  frame.contentWindow = {
    CustomEvent: CustomEventMock,
    dispatchEvent(event) { events.push(event); return true; },
  };
  const documentHandlers = new Map();
  const document = {
    hidden: false,
    fullscreenElement: null,
    documentElement: { requestFullscreen: async () => {} },
    querySelectorAll: () => [],
    getElementById: (id) => elements.get(id),
    addEventListener(name, listener) { documentHandlers.set(name, listener); },
    removeEventListener(name, listener) { if (documentHandlers.get(name) === listener) documentHandlers.delete(name); },
  };
  const windowHandlers = new Map();
  const window = {
    addEventListener(name, listener) { windowHandlers.set(name, listener); },
    removeEventListener(name, listener) { if (windowHandlers.get(name) === listener) windowHandlers.delete(name); },
  };
  const context = {
    document,
    window,
    requestAnimationFrame(callback) { const id = nextFrame++; queuedFrames.set(id, callback); return id; },
    cancelAnimationFrame(id) { queuedFrames.delete(id); },
    console,
  };
  const flushFrame = (time) => {
    const batch = [...queuedFrames.values()];
    queuedFrames.clear();
    batch.forEach((callback) => callback(time));
  };
  return { context, elements, events, flushFrame };
}

test('receiver retargets one pan lifecycle and ends it even after map eligibility changes', () => {
  const h = receiverHarness();
  const first = h.dispatch({ phase: 'move', dx: 12, dy: -8, handled: false });
  const second = h.dispatch({ phase: 'move', dx: 9, dy: 3, handled: false });
  assert.equal(first.handled, true);
  assert.equal(second.handled, true);
  assert.equal(h.calls.panBy.length, 2);
  assert.deepEqual(h.calls.panBy[0][1], {
    duration: 250,
    easeId: 'shantu-desktop-pan',
    essential: true,
    easing: h.calls.panBy[0][1].easing,
  });
  assert.equal(typeof h.calls.panBy[0][1].easing, 'function');
  assert.deepEqual(h.calls.panBy[0][2], { shantuDesktopPan: true });
  h.element.hidden = true;
  const end = h.dispatch({ phase: 'end', handled: false });
  assert.equal(end.handled, true);
  assert.equal(h.calls.stop, 1);
  h.dispatch({ phase: 'end', handled: false });
  assert.equal(h.calls.stop, 1);
  h.dispose();
  assert.equal(h.calls.stop, 1);
});

test('receiver does not stop a camera after another camera movement takes ownership', () => {
  const h = receiverHarness();
  h.dispatch({ phase: 'move', dx: 4, dy: 2, handled: false });
  h.map.emit('movestart', { originalEvent: {} });
  const end = h.dispatch({ phase: 'end', handled: false });
  assert.equal(end.handled, false);
  assert.equal(h.calls.stop, 0);
  h.dispose();
  assert.equal(h.calls.stop, 0);
});

test('receiver retains hidden, invalid, already-handled, and secondary-map guards for move frames', () => {
  const h = receiverHarness();
  h.element.hidden = true;
  h.dispatch({ phase: 'move', dx: 4, dy: 2, handled: false });
  h.element.hidden = false;
  h.dispatch({ phase: 'move', dx: Number.NaN, dy: 2, handled: false });
  h.dispatch({ phase: 'move', dx: 4, dy: 2, handled: true });
  h.element.classList.contains = (name) => name === 'map-comparison-secondary';
  h.dispatch({ phase: 'move', dx: 4, dy: 2, handled: false });
  assert.equal(h.calls.panBy.length, 0);
  assert.equal(h.calls.stop, 0);
  h.dispose();
});

test('receiver cleanup stops only its own still-active pan', () => {
  const active = receiverHarness();
  active.dispatch({ phase: 'move', dx: 4, dy: 0, handled: false });
  active.dispose();
  assert.equal(active.calls.stop, 1);
  assert.equal(active.windowListeners.size, 0);
  assert.equal(active.mapListeners.get('movestart').size, 0);

  const superseded = receiverHarness();
  superseded.dispatch({ phase: 'move', dx: 4, dy: 0, handled: false });
  superseded.map.emit('movestart', { originalEvent: {} });
  superseded.dispose();
  assert.equal(superseded.calls.stop, 0);
});

test('shell ends the movement once when the pan vector returns to the deadzone', async () => {
  const { context, elements, events, flushFrame } = shellHarness();
  const source = await readFile(new URL('../desktop-app/shell/shell.js', import.meta.url), 'utf8');
  runInNewContext(source, context);
  const pan = elements.get('map-pan');
  pan.fire('pointerdown', {
    button: 0, pointerId: 7, clientX: 68, clientY: 48,
    preventDefault() {},
  });
  flushFrame(16);
  assert.equal(events.at(-1).detail.phase, 'move');
  pan.fire('pointermove', { pointerId: 7, clientX: 48, clientY: 48 });
  flushFrame(32);
  flushFrame(48);
  assert.deepEqual(events.map((event) => event.detail.phase), ['move', 'end']);
  pan.fire('pointerup', { pointerId: 7 });
  assert.deepEqual(events.map((event) => event.detail.phase), ['move', 'end']);
});

test('shell sends one end phase when a held pan is released', async () => {
  const { context, elements, events, flushFrame } = shellHarness();
  const source = await readFile(new URL('../desktop-app/shell/shell.js', import.meta.url), 'utf8');
  runInNewContext(source, context);
  const pan = elements.get('map-pan');
  pan.fire('pointerdown', {
    button: 0, pointerId: 8, clientX: 68, clientY: 48,
    preventDefault() {},
  });
  flushFrame(16);
  pan.fire('pointerup', { pointerId: 8 });
  assert.deepEqual(events.map((event) => event.detail.phase), ['move', 'end']);
});
