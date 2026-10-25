import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const output = '.openai/mac-recording-config-hooks/hooks.mjs';
await build({
  stdin: {
    contents: "export { useRecordingPreferences } from './modules/outdoor/useRecordingPreferences.ts'; export { useSamplingPolicy } from './modules/outdoor/useSamplingPolicy.ts';",
    resolveDir: process.cwd(),
    sourcefile: 'mac-recording-config-hooks-entry.ts',
    loader: 'ts',
  },
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});
const { useRecordingPreferences, useSamplingPolicy } = await import(`${pathToFileURL(`${process.cwd()}/${output}`).href}?test=${Date.now()}`);

test('Mac precision and sampling hooks synchronously reject duplicate saves', async t => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const descriptors = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const sampling = { mode: 'standard', intervalSeconds: 4, distanceMetres: 5, stationarySeconds: 10, adaptive: true, distanceOnly: false, recordOnNavigation: false };
  let config = { maximumAccuracy: 15, sampling: { ...sampling } };
  let releaseConfigure;
  const configGate = new Promise(resolve => { releaseConfigure = resolve; });
  const requests = [];
  window.ShantuMac = { version: 1, request: async (action, args) => {
    requests.push(action);
    if (action === 'record.state') return structuredClone(config);
    if (action === 'record.configure') {
      await configGate;
      config = structuredClone(args);
      return structuredClone(config);
    }
    return null;
  } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  let state;
  function Probe() {
    state = { preferences: useRecordingPreferences(), sampling: useSamplingPolicy() };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => { root.render(React.createElement(Probe)); await Promise.resolve(); await Promise.resolve(); });
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  let firstAccuracy, duplicateAccuracy, firstSampling, duplicateSampling;
  await React.act(async () => {
    firstAccuracy = state.preferences.update(10);
    duplicateAccuracy = state.preferences.update(11);
    firstSampling = state.sampling.update({ ...sampling, mode: 'power', intervalSeconds: 10 });
    duplicateSampling = state.sampling.update({ ...sampling, mode: 'accuracy', intervalSeconds: 1 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  assert.equal(state.preferences.pending, true);
  assert.equal(state.sampling.pending, true);
  assert.equal(await duplicateAccuracy, false);
  assert.equal(await duplicateSampling, false);
  assert.equal(requests.filter(action => action === 'record.configure').length, 1);

  releaseConfigure();
  await React.act(async () => { assert.equal(await firstAccuracy, true); assert.equal(await firstSampling, true); });
  assert.equal(state.preferences.pending, false);
  assert.equal(state.sampling.pending, false);
  assert.equal(requests.filter(action => action === 'record.configure').length, 2);
  assert.equal(config.maximumAccuracy, 10);
  assert.equal(config.sampling.mode, 'power');
});
