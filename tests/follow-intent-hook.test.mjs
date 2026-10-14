import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const followOutput = '.openai/follow-intent-hook.test.mjs';
const lockOutput = '.openai/map-focus-lock-hook.test.mjs';
await Promise.all([
  build({ entryPoints: ['modules/position/useFollowPosition.ts'], outfile: followOutput, bundle: true, packages: 'external', platform: 'node', format: 'esm' }),
  build({ entryPoints: ['modules/controls/useMapFocusLock.ts'], outfile: lockOutput, bundle: true, packages: 'external', platform: 'node', format: 'esm' }),
]);
const [{ useFollowPosition }, { useMapFocusLock }] = await Promise.all([
  import(`${pathToFileURL(`${process.cwd()}/${followOutput}`).href}?test=${Date.now()}`),
  import(`${pathToFileURL(`${process.cwd()}/${lockOutput}`).href}?test=${Date.now()}`),
]);
const React = await import('react');
const { createRoot } = await import('react-dom/client');

async function mount(t, renderProbe) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map();
  let timerId = 0;
  const setTimeoutFake = (callback, delay = 0, ...args) => {
    const id = ++timerId;
    timers.set(id, { delay, callback: () => callback(...args) });
    return id;
  };
  const clearTimeoutFake = id => timers.delete(id);
  const setIntervalFake = (callback, delay = 0) => setTimeoutFake(callback, delay);
  const clearIntervalFake = clearTimeoutFake;
  for (const [key, value] of Object.entries({
    window, document, IS_REACT_ACT_ENVIRONMENT: true,
    setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake,
    setInterval: setIntervalFake, clearInterval: clearIntervalFake,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  window.setTimeout = setTimeoutFake;
  window.clearTimeout = clearTimeoutFake;
  window.setInterval = setIntervalFake;
  window.clearInterval = clearIntervalFake;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });

  let value;
  const root = createRoot(document.getElementById('root'));
  function Probe() {
    value = renderProbe();
    return React.createElement('div');
  }
  const render = async () => React.act(async () => root.render(React.createElement(Probe)));
  await render();
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    window, document, timers, render, value: () => value,
    async fireDelay(delay) {
      const due = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of due) {
        timers.delete(id);
        await React.act(async () => { timer.callback(); await Promise.resolve(); });
      }
    },
  };
}

const fix = (timestamp, lng = 104) => ({ coordinates: [lng, 30], accuracy: 5, timestamp, source: 'gps' });

test('follow intent resumes on a valid fix and delivers the newest fix after a deferred gesture', async t => {
  let options = { fix: fix(Date.now()), phase: 'idle', blocked: false, defer: () => false };
  const delivered = [];
  const h = await mount(t, () => useFollowPosition({ ...options, onFollow: (...args) => { delivered.push(args); return true; } }));

  await React.act(async () => h.value().resume());
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0][0], options.fix.coordinates);
  assert.equal(h.value().following, true);

  options = { ...options, defer: () => true };
  await h.render();
  options = { ...options, fix: fix(Date.now() + 1, 104.002) };
  await h.render();
  assert.equal(delivered.length, 1, 'defer suppresses camera delivery during the gesture');
  assert.equal(h.value().following, true, 'defer does not clear follow intent');

  options = { ...options, defer: () => false };
  await h.render();
  await h.fireDelay(1000);
  assert.equal(delivered.length, 2, 'releasing defer delivers the latest GPS fix');
  assert.deepEqual(delivered.at(-1)[0], options.fix.coordinates);
  assert.equal(h.value().following, true);
});

test('blocked follow intent resumes automatically and paused recording does not cancel it', async t => {
  let options = { fix: fix(Date.now()), phase: 'recording', blocked: false };
  const delivered = [];
  const h = await mount(t, () => useFollowPosition({ ...options, onFollow: (...args) => { delivered.push(args); return true; } }));
  await React.act(async () => h.value().resume());
  assert.equal(h.value().following, true);
  assert.equal(delivered.length, 1);

  options = { ...options, blocked: true, fix: fix(Date.now() + 1, 104.001) };
  await h.render();
  assert.equal(h.value().following, false, 'blocked masks public following without cancelling internal intent');
  assert.equal(delivered.length, 1, 'blocked state suspends camera delivery');

  options = { ...options, blocked: false };
  await h.render();
  assert.equal(h.value().following, true);
  assert.equal(delivered.length, 2, 'unblocking restores follow and delivers the valid fix');

  options = { ...options, phase: 'paused', fix: fix(Date.now() + 2, 104.002) };
  await h.render();
  assert.equal(h.value().following, true, 'recording pause does not pause independent camera tracking');
  assert.equal(delivered.length, 3);

  await React.act(async () => h.value().pause());
  options = { ...options, fix: fix(Date.now() + 3, 104.003) };
  await h.render();
  assert.equal(h.value().following, false);
  assert.equal(delivered.length, 3, 'explicit pause prevents subsequent GPS camera delivery');
});

test('focus lock preserves active GPS following through pointer gestures and unlocks cleanly', async t => {
  const calls = { pause: 0, resume: 0, north: 0, free: 0, device: 0, motion: 0, restore: [] };
  const camera = { center: [104, 30], zoom: 12, pitch: 45, bearing: 72 };
  const map = { cameraSnapshot: () => ({ ...camera }), restoreCamera: value => calls.restore.push(value) };
  let options = {
    map: () => map, following: true, guiding: false, direction: 'motion', fix: [104.1, 30.1],
    pause: () => calls.pause++, resume: () => calls.resume++, north: () => calls.north++,
    free: () => calls.free++, device: async () => calls.device++, motion: () => calls.motion++,
  };
  const h = await mount(t, () => useMapFocusLock(options));
  await React.act(async () => h.value().toggle());
  assert.equal(h.value().locked, true);

  const target = h.document.createElement('div');
  target.className = 'map-canvas';
  h.document.body.append(target);
  const pointer = (type, id = 1) => {
    const event = new h.window.Event(type, { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: id });
    return event;
  };
  await React.act(async () => target.dispatchEvent(pointer('pointerdown')));
  assert.equal(h.value().browsing, true);
  assert.equal(calls.pause, 0);
  assert.equal(calls.free, 0, 'a gesture while following does not switch direction to free');
  await React.act(async () => target.dispatchEvent(pointer('pointerup')));
  await h.fireDelay(10000);
  assert.deepEqual(calls.restore, [], 'timeout does not restore the stale camera snapshot');
  assert.equal(calls.resume, 0);
  assert.equal(calls.motion, 0);
  assert.equal(h.value().browsing, false);

  await React.act(async () => h.value().toggle());
  assert.equal(h.value().locked, false, 'the lock remains reachable and can be released');
});

test('focus lock timeout cannot revive following after an explicit cancellation', async t => {
  const calls = { resume: 0, restore: 0, free: 0 };
  const map = { cameraSnapshot: () => ({ center: [104, 30], zoom: 12, pitch: 0, bearing: 0 }), restoreCamera: () => calls.restore++ };
  let options = {
    map: () => map, following: true, guiding: false, direction: 'north', fix: [104, 30],
    pause() {}, resume: () => calls.resume++, north() {}, free: () => calls.free++, device: async () => {}, motion() {},
  };
  const h = await mount(t, () => useMapFocusLock(options));
  await React.act(async () => h.value().toggle());
  const target = h.document.createElement('div');
  target.className = 'map-canvas';
  h.document.body.append(target);
  const event = new h.window.Event('pointerdown', { bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: 7 });
  await React.act(async () => target.dispatchEvent(event));

  options = { ...options, following: false };
  await h.render();
  await React.act(async () => target.dispatchEvent(Object.assign(new h.window.Event('pointerup', { bubbles: true }), { pointerId: 7 })));
  await h.fireDelay(10000);
  assert.equal(calls.resume, 0, 'timeout cannot undo an explicit follow cancellation');
  assert.equal(calls.restore, 0, 'timeout cannot restore the camera captured before the gesture');
  await React.act(async () => h.value().toggle());
  assert.equal(h.value().locked, false);
});
