import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { mkdir } from 'node:fs/promises';

test('route card mode changes replan automatically, cancel stale work, and swap the actual endpoints', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  await mkdir('.openai/navigation-card-actions', { recursive: true });
  const requests = [];
  await build({
    entryPoints: ['modules/navigation/useNavigation.ts'],
    outfile: '.openai/navigation-card-actions/useNavigation.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [{
      name: 'navigation-planner-fixture',
      setup(builder) {
        builder.onResolve({ filter: /(^|\/)provider$/ }, () => ({ path: 'planner', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const planRoute=(start,end,mode,signal,via=[])=>new Promise((resolve,reject)=>globalThis.cardPlanRequests.push({start,end,mode,signal,via,resolve,reject}));`,
        }));
      },
    }],
  });
  globalThis.cardPlanRequests = requests;
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { useNavigation } = await import('../.openai/navigation-card-actions/useNavigation.mjs');
  let state;
  function Probe() { state = useNavigation(); return null; }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    await act(async () => root.unmount());
    delete globalThis.cardPlanRequests;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  const start = { name: '起点', coordinates: [104, 30] };
  const end = { name: '终点', coordinates: [104.02, 30] };
  const routeFor = (mode, a = start, b = end) => ({
    mode,
    coordinates: [a.coordinates, [104.01, 30.001], b.coordinates],
    distance: 2000,
    duration: 900,
    steps: [],
    snapped: [a.coordinates, b.coordinates],
    createdAt: Date.now(),
  });

  await act(async () => state.place('start', start));
  await act(async () => state.place('end', end));
  await act(async () => { void state.calculate(); });
  assert.equal(requests.length, 1);
  await act(async () => requests[0].resolve(routeFor('auto')));
  assert.equal(state.route.mode, 'auto');

  const applied = [];
  await act(async () => state.setMode('bicycle', route => applied.push(route)));
  assert.equal(requests[1].mode, 'bicycle', 'changing the card selector immediately requests the selected travel mode');
  await act(async () => state.setMode('pedestrian', route => applied.push(route)));
  assert.equal(requests[1].signal.aborted, true, 'a newer selection cancels the earlier plan');
  assert.equal(requests[2].mode, 'pedestrian');
  await act(async () => requests[1].resolve(routeFor('bicycle')));
  assert.equal(state.route.mode, 'auto', 'a cancelled response cannot replace the current route');
  await act(async () => requests[2].resolve(routeFor('pedestrian')));
  assert.equal(state.route.mode, 'pedestrian');
  assert.equal(applied.at(-1).mode, 'pedestrian');

  await act(async () => state.swap(route => applied.push(route)));
  assert.equal(requests[3].start.name, '终点');
  assert.equal(requests[3].end.name, '起点');
  await act(async () => requests[3].resolve(routeFor('pedestrian', end, start)));
  assert.equal(state.start.name, '终点');
  assert.equal(state.end.name, '起点');
  assert.equal(state.route.coordinates[0], end.coordinates);
  assert.equal(applied.at(-1).coordinates[0], end.coordinates);

  const adoptedTrack = { ...routeFor('bicycle', end, start), geometryKind: 'track' };
  await act(async () => {
    state.setMode('auto');
    state.adoptRoute(adoptedTrack);
  });
  assert.equal(requests[4].signal.aborted, true, 'adopting a connected track cancels any older road plan');
  await act(async () => requests[4].resolve(routeFor('auto', end, start)));
  assert.equal(state.route, adoptedTrack, 'an older response cannot overwrite the adopted route');
});
