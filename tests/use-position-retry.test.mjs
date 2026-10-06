import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const output = '.openai/use-position-retry-hook.mjs';
await build({
  entryPoints: ['modules/position/usePosition.ts'],
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  outfile: output,
  write: true,
});

const { usePosition } = await import(`${pathToFileURL(process.cwd() + '/' + output).href}?test=${Date.now()}`);
const React = await import('react');
const { createRoot } = await import('react-dom/client');

async function mount(t, nativeBridge) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const original = new Map();
  for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'setInterval', 'clearInterval'])
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));

  const watches = [];
  const cleared = [];
  const timers = [];
  const intervals = [];
  const clearedIntervals = [];
  const cancelledTimers = new Set();
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
  let nextWatch = 1;
  const navigatorStub = {
    userAgent: 'position-hook-test',
    geolocation: {
      watchPosition(success, error, options) {
        const handle = nextWatch++;
        watches.push({ handle, success, error, options });
        return handle;
      },
      clearWatch(handle) { cleared.push(handle); },
    },
  };
  Object.defineProperty(window, 'navigator', { configurable: true, value: navigatorStub });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  window.setTimeout = (callback, delay, ...args) => {
    const handle = realSetTimeout(callback, delay, ...args);
    timers.push({ handle, delay });
    return handle;
  };
  window.clearTimeout = handle => {
    cancelledTimers.add(handle);
    realClearTimeout(handle);
  };
  window.setInterval = globalThis.setInterval.bind(globalThis);
  window.clearInterval = globalThis.clearInterval.bind(globalThis);
  Object.defineProperty(globalThis, 'setInterval', { configurable: true, value: (callback, delay, ...args) => {
    const handle = intervals.length + 1;
    intervals.push({ handle, callback, delay, args });
    return handle;
  } });
  Object.defineProperty(globalThis, 'clearInterval', { configurable: true, value: handle => clearedIntervals.push(handle) });
  if (nativeBridge) Object.defineProperty(window, 'GuanyunNative', { configurable: true, value: nativeBridge });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorStub });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async () => new Response('{}', { status: 503 }) });

  let state;
  function Probe() { state = usePosition(); return React.createElement('div'); }
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { React, state: () => state, watches, cleared, timers, cancelledTimers, intervals, clearedIntervals };
}

function fixAt(timestamp, longitude = 104) {
  return {
    coords: { longitude, latitude: 30, accuracy: 4, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp,
  };
}

test('locate reuses an active web watch when its cached fix is still usable', async t => {
  const f = await mount(t);
  const timestamp = Date.now();
  await f.React.act(async () => f.watches[0].success(fixAt(timestamp)));
  assert.equal(f.state().locating, false);

  let callbackFix;
  await f.React.act(async () => f.state().locate(value => { callbackFix = value; }));

  assert.equal(f.watches.length, 1, 'a healthy watch with a fresh fix is reused');
  assert.deepEqual(f.cleared, []);
  assert.deepEqual(callbackFix.coordinates, [104, 30]);
  assert.equal(f.state().locating, false);
});

test('locate replaces a silently stale watch and schedules a fresh IP fallback timer', async t => {
  const f = await mount(t);
  const originalNow = Date.now;
  let offset = 0;
  Date.now = () => originalNow() + offset;
  t.after(() => { Date.now = originalNow; });
  await f.React.act(async () => f.watches[0].success(fixAt(Date.now())));
  assert.equal(f.timers.filter(timer => timer.delay === 6000 && !f.cancelledTimers.has(timer.handle)).length, 0,
    'a successful system fix clears the startup fallback timer');
  offset = 30_000;

  await f.React.act(async () => f.state().locate());

  assert.equal(f.watches.length, 2, 'an expired fix cannot keep the old watch through the reuse path');
  assert.deepEqual(f.cleared, [1], 'the prior watch is cleared before a replacement is started');
  assert.equal(f.timers.filter(timer => timer.delay === 6000 && !f.cancelledTimers.has(timer.handle)).length, 1,
    'the replacement web watch gets its own fallback timer');
  assert.equal(f.state().locating, true);
  assert.equal(f.state().watching, true);
});

test('locate retries after a web watch error and cleanup stops the replacement', async t => {
  const f = await mount(t);
  await f.React.act(async () => f.watches[0].error({ code: 3, message: 'timeout' }));
  assert.match(f.state().locationError, /定位超时|IP定位暂不可用/);

  await f.React.act(async () => f.state().locate());
  assert.equal(f.watches.length, 2, 'an errored watch is replaced on retry');
  assert.deepEqual(f.cleared, [1]);

  await f.React.act(async () => f.state().stopLocation());
  assert.deepEqual(f.cleared, [1, 2], 'stopLocation clears the replacement watch');
  assert.equal(f.timers.filter(timer => timer.delay === 6000 && !f.cancelledTimers.has(timer.handle)).length, 0,
    'stopLocation cancels the replacement fallback timer');
  assert.equal(f.state().watching, false);
});

function nativeFix(timestamp, longitude = 104) {
  return { longitude, latitude: 30, accuracy: 5, timestamp, source: 'gps' };
}

function nativeHarness() {
  let raw = JSON.stringify({ mode: 'auto', error: '', fix: null });
  const calls = [];
  const stops = [];
  return {
    calls,
    stops,
    setState(value) { raw = JSON.stringify(value); },
    bridge: {
      locate(mode) { calls.push(mode); },
      locationState() { return raw; },
      stopLocation() { stops.push(calls.length); },
      locationPermissionGranted() { return true; },
    },
  };
}

test('native bridge reuses its watcher after a fresh GPS fix', async t => {
  const native = nativeHarness();
  const f = await mount(t, native.bridge);
  await f.React.act(async () => f.state().locate());
  assert.equal(native.calls.length, 2, 'startup subscription is replaced by the requested foreground watcher');
  const poll = f.intervals.at(-1).callback;
  native.setState({ mode: 'auto', error: '', fix: nativeFix(Date.now()) });
  await f.React.act(async () => poll());
  assert.equal(f.state().locating, false);

  await f.React.act(async () => f.state().locate());
  assert.equal(native.calls.length, 2, 'fresh GPS keeps the existing native watcher');
  assert.equal(native.stops.length, 1, 'only the startup subscription was stopped');
  assert.deepEqual(f.state().fix.coordinates, [104, 30]);
});

test('native locate replaces an expired watcher and ignores its old-generation poll', async t => {
  const native = nativeHarness();
  const f = await mount(t, native.bridge);
  await f.React.act(async () => f.state().locate());
  const oldInterval = f.intervals.at(-1);
  const oldPoll = oldInterval.callback;
  native.setState({ mode: 'auto', error: '', fix: nativeFix(Date.now(), 104) });
  await f.React.act(async () => oldPoll());
  assert.equal(f.state().locating, false);

  const originalNow = Date.now;
  let offset = 31_000;
  Date.now = () => originalNow() + offset;
  t.after(() => { Date.now = originalNow; });
  await f.React.act(async () => f.state().locate());
  assert.equal(native.calls.length, 3, 'expired cached GPS starts a new native location request');
  assert.ok(native.stops.length >= 2, 'the stale native subscription was stopped before restarting');
  assert.ok(f.clearedIntervals.includes(oldInterval.handle), 'old polling generation was cancelled');

  native.setState({ mode: 'auto', error: '', fix: nativeFix(originalNow() + offset, 105) });
  await f.React.act(async () => oldPoll());
  assert.deepEqual(f.state().fix.coordinates, [104, 30], 'a callback from the stopped watcher cannot overwrite state');
  await f.React.act(async () => f.intervals.at(-1).callback());
  assert.deepEqual(f.state().fix.coordinates, [105, 30], 'the replacement watcher publishes the recovered fresh fix');
  assert.equal(f.state().locating, false);
});
