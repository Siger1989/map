import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

test('session end stops pending floating start and a later start is not suppressed', async (t) => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.setInterval = globalThis.setInterval;
  window.clearInterval = globalThis.clearInterval;
  const calls = { starts: 0, stops: 0 };
  window.ShantuFloatingNavigation = {
    status: () => JSON.stringify({ available: true, enabled: false, visible: false, mode: 'north', message: '权限待处理' }),
    start: () => { calls.starts += 1; },
    update: () => {},
    stop: () => { calls.stops += 1; },
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });

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
  const act = React.act;
  await act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.stops, 0, 'initial null session does not send an unnecessary stop');

  const session = { route: { coordinates: [[103, 30], [103.01, 30.01]], stops: [{ name: '目标' }] } };
  await act(async () => root.render(React.createElement(Probe, { session })));
  await act(async () => { controls.start(); });
  assert.equal(calls.starts, 1);
  await act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.stops, 1, 'ending while permission is pending cancels the native request');

  await act(async () => root.render(React.createElement(Probe, { session })));
  await act(async () => { controls.start(); });
  await act(async () => root.render(React.createElement(Probe, { session: null })));
  assert.equal(calls.stops, 2, 'a later start clears the previous stop guard');
  await act(async () => root.unmount());
});
