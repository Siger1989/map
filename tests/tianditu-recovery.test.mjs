import test from 'node:test';
import assert from 'node:assert/strict';
import { installTiandituRecovery } from '../modules/mapSources/tiandituRecovery.ts';

class FakeClock {
  now = 1_800_000_000_000;
  nextId = 1;
  tasks = new Map();
  originalNow = Date.now;
  originalSetTimeout = globalThis.setTimeout;
  originalClearTimeout = globalThis.clearTimeout;

  install() {
    Date.now = () => this.now;
    globalThis.setTimeout = (callback, delay = 0) => {
      const id = this.nextId++;
      this.tasks.set(id, { at: this.now + Math.max(0, Number(delay) || 0), callback });
      return id;
    };
    globalThis.clearTimeout = id => this.tasks.delete(id);
  }

  advance(ms) {
    const target = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }

  restore() {
    Date.now = this.originalNow;
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.clearTimeout = this.originalClearTimeout;
  }
}

class MockMap {
  handlers = new Map();
  calls = [];
  bounds = { west: -100, east: -80, south: 10, north: 20 };
  zoom = 2;
  sourcePresent = true;
  layerVisibility = 'visible';

  on(type, listener) {
    const listeners = this.handlers.get(type) ?? new Set();
    listeners.add(listener);
    this.handlers.set(type, listeners);
  }

  off(type, listener) {
    this.handlers.get(type)?.delete(listener);
  }

  fire(type, event = {}) {
    for (const listener of this.handlers.get(type) ?? []) listener(event);
  }

  refreshTiles(sourceId, tiles) {
    this.calls.push({ sourceId, tiles });
  }

  getBounds() {
    return {
      getWest: () => this.bounds.west,
      getEast: () => this.bounds.east,
      getSouth: () => this.bounds.south,
      getNorth: () => this.bounds.north,
    };
  }

  getZoom() { return this.zoom; }
  getSource(id) { return id === 'tdt' && this.sourcePresent ? {} : undefined; }
  getStyle() {
    return { layers: [{ source: 'tdt', layout: { visibility: this.layerVisibility } }] };
  }
}

class FakeEventTarget {
  listeners = new Map();
  addEventListener(type, listener) {
    const items = this.listeners.get(type) ?? new Set();
    items.add(listener);
    this.listeners.set(type, items);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) { for (const listener of this.listeners.get(type) ?? []) listener({ type }); }
}

function errorEvent({ sourceId = 'tdt', tile = { z: 2, x: 1, y: 1 }, retryAt, retryable = true, code = 'network', name = 'TiandituLoadError' } = {}) {
  return {
    sourceId,
    tile: { tileID: { canonical: tile }, state: 'errored' },
    error: { name, code, retryAt, retryable },
  };
}

function loadedEvent(tile = { z: 2, x: 1, y: 1 }, state = 'loaded') {
  return { sourceId: 'tdt', tile: { tileID: { canonical: tile }, state } };
}

test('retries only the failed canonical tile after retryAt and ignores unrelated errors', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ name: 'Error', retryAt: clock.now }));
    map.fire('error', errorEvent({ retryAt: clock.now + 500 }));
    clock.advance(499);
    assert.equal(map.calls.length, 0);
    clock.advance(1);
    assert.deepEqual(map.calls, [{ sourceId: 'tdt', tiles: [{ z: 2, x: 1, y: 1 }] }]);
    dispose();
  } finally { clock.restore(); }
});

test('duplicate failures do not queue repeated refreshes and a loaded sourcedata clears failure', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    const event = errorEvent({ retryAt: clock.now });
    map.fire('error', event);
    map.fire('error', event);
    map.fire('sourcedata', loadedEvent(undefined, 'errored'));
    clock.advance(0);
    assert.equal(map.calls.length, 1);
    map.fire('sourcedata', loadedEvent());
    map.fire('moveend');
    clock.advance(10_000);
    assert.equal(map.calls.length, 1);
    dispose();
  } finally { clock.restore(); }
});

test('movestart cancels a waiting retry; moveend resets budget only for visible used tiles', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: clock.now + 100 }));
    map.fire('movestart');
    clock.advance(1_000);
    assert.equal(map.calls.length, 0);
    map.fire('moveend');
    clock.advance(0);
    assert.equal(map.calls.length, 1);

    map.fire('error', errorEvent({ retryAt: clock.now }));
    map.fire('movestart');
    map.bounds = { west: 20, east: 30, south: 10, north: 20 };
    map.fire('moveend');
    clock.advance(10_000);
    assert.equal(map.calls.length, 1);
    dispose();
  } finally { clock.restore(); }
});

test('caps automatic retries at three per stable view and honors fresh view budget', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: clock.now }));
    for (let attempt = 0; attempt < 3; attempt++) {
      clock.advance(attempt === 0 ? 0 : 750);
      map.fire('error', errorEvent({ retryAt: clock.now }));
    }
    clock.advance(750);
    assert.equal(map.calls.length, 3);
    map.fire('error', errorEvent({ retryAt: clock.now }));
    clock.advance(10_000);
    assert.equal(map.calls.length, 3);

    map.fire('moveend');
    clock.advance(0);
    assert.equal(map.calls.length, 4);
    dispose();
  } finally { clock.restore(); }
});

test('does not retry permanent authorization errors, hidden sources, or tiles outside bounds', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ code: 'unauthorized', retryable: false, retryAt: 0 }));
    map.layerVisibility = 'none';
    map.fire('error', errorEvent({ retryAt: clock.now }));
    clock.advance(20_000);
    assert.equal(map.calls.length, 0);
    dispose();

    const outsideMap = new MockMap();
    const disposeOutside = installTiandituRecovery(outsideMap);
    outsideMap.fire('error', errorEvent({ tile: { z: 2, x: 3, y: 1 }, retryAt: clock.now }));
    clock.advance(20_000);
    assert.equal(outsideMap.calls.length, 0);
    disposeOutside();
  } finally { clock.restore(); }
});

test('disposal cancels timers and removes every map listener', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: clock.now + 500 }));
    dispose();
    clock.advance(10_000);
    assert.equal(map.calls.length, 0);
    for (const type of ['error', 'sourcedata', 'movestart', 'moveend', 'styledata', 'remove'])
      assert.equal(map.handlers.get(type)?.size ?? 0, 0, `${type} listener removed`);
    dispose();
  } finally { clock.restore(); }
});

test('map removal automatically cancels pending retry work', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: clock.now + 500 }));
    map.fire('remove');
    clock.advance(10_000);
    assert.equal(map.calls.length, 0);
    assert.equal(map.handlers.get('error')?.size ?? 0, 0);
    assert.equal(map.handlers.get('remove')?.size ?? 0, 0);
  } finally { clock.restore(); }
});

test('visibility and online recovery resume due tiles without bypassing retryAt', () => {
  const clock = new FakeClock(); clock.install();
  const originalGlobals = new Map();
  const setGlobal = (name, value) => {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  try {
    const visibility = new FakeEventTarget(); visibility.visibilityState = 'hidden';
    const network = new FakeEventTarget();
    const navigatorState = { onLine: true };
    setGlobal('document', visibility);
    setGlobal('window', network);
    setGlobal('navigator', navigatorState);

    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: clock.now + 100 }));
    clock.advance(50);
    assert.equal(map.calls.length, 0);
    visibility.visibilityState = 'visible';
    visibility.dispatch('visibilitychange');
    clock.advance(49);
    assert.equal(map.calls.length, 0);
    clock.advance(1);
    assert.equal(map.calls.length, 1);

    navigatorState.onLine = false;
    network.dispatch('offline');
    map.fire('error', errorEvent({ tile: { z: 3, x: 2, y: 3 }, retryAt: clock.now }));
    clock.advance(2_000);
    assert.equal(map.calls.length, 1);
    navigatorState.onLine = true;
    network.dispatch('online');
    clock.advance(0);
    assert.equal(map.calls.length, 2);
    dispose();
  } finally {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    clock.restore();
  }
});

test('clamps long Retry-After timer delays and rechecks the absolute retryAt without early refresh', () => {
  const clock = new FakeClock(); clock.install();
  try {
    const map = new MockMap();
    const dispose = installTiandituRecovery(map);
    map.fire('error', errorEvent({ retryAt: Number.MAX_SAFE_INTEGER, code: 'rate-limited' }));
    assert.equal(map.calls.length, 0);
    assert.equal(clock.tasks.size, 1);
    let scheduled = [...clock.tasks.values()][0];
    assert.equal(scheduled.at - clock.now, 2_147_483_647);

    clock.advance(2_147_483_647);
    assert.equal(map.calls.length, 0, 'clamped wake must not retry before retryAt');
    assert.equal(clock.tasks.size, 1, 'remaining cooldown is scheduled again');
    scheduled = [...clock.tasks.values()][0];
    assert.equal(scheduled.at - clock.now, 2_147_483_647);
    dispose();
    assert.equal(clock.tasks.size, 0);
  } finally { clock.restore(); }
});
