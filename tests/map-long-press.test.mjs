import test from 'node:test';
import assert from 'node:assert/strict';
import { MapLongPress } from '../modules/map/MapLongPress.ts';

function emitter() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    fire(name, event) {
      for (const fn of listeners.get(name) ?? []) fn(event);
    },
  };
}
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  const win = emitter(),
    container = emitter(),
    camera = emitter(),
    classes = new Set(),
    holds = [];
  container.classList = {
    add: (n) => classes.add(n),
    remove: (n) => classes.delete(n),
  };
  const canvas = {
    ownerDocument: { defaultView: win },
    clientWidth: 400,
    clientHeight: 800,
    getBoundingClientRect: () => ({
      left: 20,
      top: 10,
      width: 800,
      height: 1600,
    }),
  };
  const map = {
    getCanvas: () => canvas,
    getContainer: () => container,
    on: camera.addEventListener,
    off: camera.removeEventListener,
    project: (p) => ({ x: p[0] * 10, y: p[1] * 10 }),
    unproject: (p) => ({ toArray: () => [p[0] / 10, p[1] / 10] }),
    dragPan: {
      disable() {
        assert.fail('empty holds must keep map navigation enabled');
      },
    },
  };
  let enabled = true,
    occupied = false;
  const bridge = new MapLongPress(map, {
    enabled: () => enabled,
    occupied: () => occupied,
    hold: (v) => holds.push(v),
  });
  t.after(() => bridge.dispose());
  const event = (id = 1, x = 100, y = 200) => ({
    pointerId: id,
    button: 0,
    target: canvas,
    clientX: 20 + x * 2,
    clientY: 10 + y * 2,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  });
  return {
    win,
    container,
    camera,
    map,
    bridge,
    classes,
    holds,
    event,
    disable: () => {
      enabled = false;
    },
    occupy: () => {
      occupied = true;
    },
  };
}
test('stationary hold opens only on release, at CSS-pixel ground position, then suppresses trailing click', (t) => {
  const f = fixture(t);
  f.win.fire('pointerdown', f.event());
  t.mock.timers.tick(549);
  assert.equal(f.classes.size, 0);
  t.mock.timers.tick(1);
  assert.equal(f.classes.has('map-hold-ready'), true);
  assert.equal(f.holds.length, 0);
  f.win.fire('pointerup', f.event(1, 102, 199));
  assert.deepEqual(f.holds, [
    { coordinate: [10, 20], point: { x: 100, y: 200 } },
  ]);
  assert.equal(f.classes.size, 0);
  const click = f.event();
  f.container.fire('click', click);
  assert.equal(click.stopped, true);
  t.mock.timers.tick(601);
  assert.equal(f.bridge.blocksClick(), false);
  f.win.fire('pointerup', f.event());
  assert.equal(f.holds.length, 1);
});
test('short taps, pans, and moving away after a hold never open the card', (t) => {
  const f = fixture(t);
  for (const delay of [100, 600]) {
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(delay);
    f.win.fire('pointermove', f.event(1, 110, 200));
    f.win.fire('pointerup', f.event(1, 110, 200));
  }
  f.win.fire('pointerdown', f.event());
  t.mock.timers.tick(100);
  f.win.fire('pointerup', f.event());
  t.mock.timers.tick(700);
  assert.equal(f.holds.length, 0);
  assert.equal(f.classes.size, 0);
});
for (const delay of [100, 600])
  test(`second finger cancels at ${delay}ms, a new single hold still works`, (t) => {
    const f = fixture(t);
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(delay);
    f.win.fire('pointerdown', f.event(2));
    t.mock.timers.tick(600);
    f.win.fire('pointerup', f.event());
    f.win.fire('pointerup', f.event(2));
    assert.equal(f.holds.length, 0);
    assert.equal(f.classes.size, 0);
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(600);
    f.win.fire('pointerup', f.event());
    assert.equal(f.holds.length, 1);
  });
for (const reason of [
  'pointercancel',
  'blur',
  'Escape',
  'camera',
  'disabled',
  'occupied',
  'dispose',
])
  test(`${reason} cancels a ready hold without an action`, (t) => {
    const f = fixture(t);
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(600);
    if (reason === 'Escape')
      f.win.fire('keydown', { key: 'Escape', preventDefault() {} });
    else if (reason === 'camera') f.camera.fire('movestart');
    else if (reason === 'disabled') f.disable();
    else if (reason === 'occupied') f.occupy();
    else if (reason === 'dispose') f.bridge.dispose();
    else f.win.fire(reason, f.event());
    f.win.fire('pointerup', f.event());
    assert.equal(f.holds.length, 0);
    assert.equal(f.classes.size, 0);
  });
test('DOM markers/controls, occupied features and inactive drawing modes are left to their existing gestures', (t) => {
  const f = fixture(t);
  for (const target of ['button', 'occupied', 'disabled']) {
    const down = f.event();
    if (target === 'button') down.target = {};
    if (target === 'occupied') f.occupy();
    if (target === 'disabled') f.disable();
    f.win.fire('pointerdown', down);
    t.mock.timers.tick(600);
    f.win.fire('pointerup', f.event());
  }
  assert.equal(f.holds.length, 0);
});
test('invalid coordinates, sky roundtrip and points outside the canvas are refused', (t) => {
  const f = fixture(t);
  for (const point of [
    [-1, 200],
    [401, 200],
    [100, -1],
    [100, 801],
  ]) {
    f.win.fire('pointerdown', f.event(1, ...point));
    t.mock.timers.tick(600);
    f.win.fire('pointerup', f.event(1, ...point));
  }
  for (const value of [
    [NaN, 20],
    [10, 86],
    [10, 21],
  ]) {
    f.map.unproject = () => ({ toArray: () => value });
    f.win.fire('pointerdown', f.event());
    t.mock.timers.tick(600);
    f.win.fire('pointerup', f.event());
  }
  assert.equal(f.holds.length, 0);
});
test('dispose removes all listeners and pending timers', (t) => {
  const f = fixture(t);
  f.win.fire('pointerdown', f.event());
  f.bridge.dispose();
  t.mock.timers.tick(600);
  for (const source of [f.win, f.container, f.camera])
    assert.equal(
      [...source.listeners.values()].reduce((n, set) => n + set.size, 0),
      0,
    );
  assert.equal(f.classes.size, 0);
  assert.equal(f.holds.length, 0);
});
