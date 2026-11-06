import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

async function mountProbe(t, bridge) {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, globalThis[key]]));
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.setInterval = () => 1;
  window.clearInterval = () => {};
  window.ShantuFloatingNavigation = bridge;
  const output = '.openai/guidance-floating-navigation-hook-test';
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: ['modules/guidance/useFloatingNavigation.ts'],
    outfile: `${output}/useFloatingNavigation.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useFloatingNavigation } = await import('../.openai/guidance-floating-navigation-hook-test/useFloatingNavigation.js');
  let controls;
  function Probe({ session }) {
    controls = useFloatingNavigation(session);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  return { React, root, Probe, get controls() { return controls; } };
}

test('restore is used without permission prompts, session follows route then position, independent switches persist natively', async (t) => {
  const native = { available: true, enabled: false, visible: false, mode: 'motion', kind: 'position', windowEnabled: true, lockscreenEnabled: true, energySaving: false, lockscreenKeepOn: false, outdoorContours: false, message: '' };
  const calls = { starts: [], updates: [], restores: [], options: [], stops: 0 };
  const bridge = {
    status: () => JSON.stringify(native),
    start: (raw) => { calls.starts.push(JSON.parse(raw)); Object.assign(native, JSON.parse(raw), { enabled: true, message: '' }); },
    update: (raw) => { calls.updates.push(JSON.parse(raw)); Object.assign(native, JSON.parse(raw)); if (!native.windowEnabled && !native.lockscreenEnabled) native.enabled = false; },
    restore: (raw) => { calls.restores.push(JSON.parse(raw)); Object.assign(native, JSON.parse(raw), { enabled: true }); },
    setOptions: (raw) => {
      calls.options.push(JSON.parse(raw));
      Object.assign(native, JSON.parse(raw));
      if (!native.windowEnabled && !native.lockscreenEnabled) native.enabled = false;
    },
    stop: () => { calls.stops++; native.enabled = false; },
  };
  const mounted = await mountProbe(t, bridge);
  const { React, root, Probe } = mounted;
  const act = React.act;
  await act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.restores.length, 1, 'new bridge restores saved native settings without start()');
  assert.equal(calls.restores[0].kind, 'position');
  assert.equal(calls.restores[0].mode, 'motion', 'persisted native mode is read even while stopped');
  assert.equal(calls.restores[0].outdoorContours, false);

  const coordinates = [[103, 30], [103.01, 30.01]];
  const session = { route: { coordinates, stops: [{ name: '起点' }, { name: '终点' }] } };
  await act(async () => root.render(React.createElement(Probe, { session })));
  assert.equal(calls.updates.at(-1).kind, 'route');
  assert.deepEqual(calls.updates.at(-1).coordinates, coordinates);

  await act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.updates.at(-1).kind, 'position', 'ending navigation changes the live payload to location-only mode');
  assert.deepEqual(calls.updates.at(-1).coordinates, []);
  assert.equal(calls.stops, 0, 'ending navigation does not stop the cross-app service');

  await act(async () => mounted.controls.setWindowEnabled(false));
  assert.deepEqual(calls.options.at(-1), { windowEnabled: false });
  assert.equal(calls.stops, 0, 'closing one surface preserves the other');
  await act(async () => mounted.controls.setLockscreenEnabled(false));
  assert.deepEqual(calls.options.at(-1), { lockscreenEnabled: false });
  assert.equal(calls.stops, 0, 'both-off is persisted with setOptions, not stop()');

  await act(async () => mounted.controls.setEnergySaving(true));
  assert.deepEqual(calls.options.at(-1), { energySaving: true });
  await act(async () => mounted.controls.setLockscreenKeepOn(true));
  assert.deepEqual(calls.options.at(-1), { lockscreenKeepOn: true });
  assert.equal(calls.starts.length, 0, 'energy and keep-screen options never start the service');
  await act(async () => mounted.controls.setMode('compass'));
  assert.deepEqual(calls.options.at(-1), { mode: 'compass' });
  await act(async () => mounted.controls.setOutdoorContours(true));
  assert.deepEqual(calls.options.at(-1), { outdoorContours: true });

  await act(async () => mounted.controls.setWindowEnabled(true));
  assert.equal(calls.starts.length, 1, 'turning a surface back on uses the explicit permission flow');
  assert.equal(calls.starts[0].kind, 'position');
  assert.equal(calls.starts[0].outdoorContours, true, 'explicit start carries the saved outdoor-contour option');
  assert.equal(calls.starts[0].windowEnabled, undefined, 'start never sends a stale second preference');
  assert.equal(calls.starts[0].lockscreenEnabled, undefined, 'native persisted preferences remain authoritative');
});

test('legacy bridge never auto-starts; its explicit start remains available to the user', async (t) => {
  const calls = { starts: 0, updates: 0, stops: 0 };
  const bridge = {
    status: () => JSON.stringify({ available: true, enabled: false, visible: false, mode: 'north', message: '' }),
    start: () => { calls.starts++; },
    update: () => { calls.updates++; },
    stop: () => { calls.stops++; },
  };
  const mounted = await mountProbe(t, bridge);
  const { React, root, Probe } = mounted;
  await React.act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.starts, 0, 'legacy bridge without restore is not auto-started');
  await React.act(async () => mounted.controls.setOutdoorContours(true));
  assert.equal(calls.starts, 0, 'legacy mode cannot pretend to save outdoor contours by starting the service');
  await React.act(async () => mounted.controls.start());
  assert.equal(calls.starts, 1, 'manual start still works on the legacy bridge');
});

test('rapid independent switch updates send only changed keys and preserve both final native values', async (t) => {
  const native = { available: true, enabled: false, visible: false, mode: 'north', kind: 'position', windowEnabled: true, lockscreenEnabled: true, energySaving: false, lockscreenKeepOn: false, outdoorContours: false, message: '' };
  const pendingOptions = [];
  const bridge = {
    status: () => JSON.stringify(native),
    start: () => {},
    update: () => {},
    stop: () => {},
    setOptions: (raw) => pendingOptions.push(JSON.parse(raw)),
  };
  const mounted = await mountProbe(t, bridge);
  const { React, root, Probe } = mounted;
  await React.act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(pendingOptions.length, 0, 'legacy mode without restore is never auto-started');
  await React.act(async () => mounted.controls.setWindowEnabled(false));
  await React.act(async () => mounted.controls.setLockscreenEnabled(false));
  await React.act(async () => mounted.controls.setEnergySaving(true));
  await React.act(async () => mounted.controls.setLockscreenKeepOn(true));
  await React.act(async () => mounted.controls.setOutdoorContours(true));
  assert.deepEqual(pendingOptions, [{ windowEnabled: false }, { lockscreenEnabled: false }, { energySaving: true }, { lockscreenKeepOn: true }, { outdoorContours: true }]);
  for (const update of pendingOptions) Object.assign(native, update);
  assert.equal(native.windowEnabled, false);
  assert.equal(native.lockscreenEnabled, false, 'delayed writes do not overwrite the other switch with stale React state');
  assert.equal(native.energySaving, true);
  assert.equal(native.lockscreenKeepOn, true);
  assert.equal(native.outdoorContours, true);
});
