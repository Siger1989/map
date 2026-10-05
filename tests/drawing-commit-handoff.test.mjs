import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { waitForTrackRender } from '../modules/tracks/trackRenderHandoff.ts';

const bundlePath = '.openai/drawing-commit-handoff/TrackDrawing.js';
let TrackDrawing;

async function loadTrackDrawing() {
  await build({
    stdin: {
      contents: "export { TrackDrawing } from './modules/tracks/TrackDrawing';",
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    plugins: [{
      name: 'point-magnifier-test-stub',
      setup(api) {
        api.onResolve({ filter: /PointMagnifier$/ }, () => ({ path: 'point-magnifier', namespace: 'point-magnifier' }));
        api.onLoad({ filter: /.*/, namespace: 'point-magnifier' }, () => ({
          contents: 'export function PointMagnifier(){ return null; }',
          loader: 'tsx',
        }));
      },
    }],
  });
  ({ TrackDrawing } = await import(`../${bundlePath}?v=${Date.now()}`));
}

function setupDom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.defineProperties(window.Element.prototype, {
    clientWidth: { configurable: true, get: () => 320 },
    clientHeight: { configurable: true, get: () => 500 },
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return window;
}

class FakeMap {
  listeners = new Map();
  source = {};
  loaded = false;

  on(type, listener) {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(listener);
    this.listeners.set(type, handlers);
    return this;
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
    return this;
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  getSource(id) {
    return id === 'manual-tracks' ? this.source : undefined;
  }

  isSourceLoaded() {
    return this.loaded;
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const style = { color: '#f80', width: 4, opacity: 1 };
const initialSegments = [[[0, 0]]];

async function mount(t, { enabled = true } = {}) {
  setupDom();
  const React = await import('react');
  const { act, createElement, createRef } = React;
  const { createRoot } = await import('react-dom/client');
  await loadTrackDrawing();
  const host = document.getElementById('root');
  const root = createRoot(host);
  const refs = [createRef(), createRef()];
  const maps = [new FakeMap(), new FakeMap()];
  const accepted = [initialSegments, initialSegments];
  const overlays = accepted.map((segments) => ({
    saved: [{ id: 'track-a', segments }], draft: [], visible: true, style, nodes: [],
  }));
  const waitCallbacks = [[], []];
  let currentEnabled = enabled;
  let commitSerial = 0;
  let mounted = true;

  const waitForCommit = (index) => (receipt, done) => {
    const dispose = waitForTrackRender(maps[index], () => overlays[index], receipt, done);
    waitCallbacks[index].push(done);
    return dispose;
  };
  const renderTree = () => root.render(createElement(React.Fragment, null,
    ...refs.map((ref, index) => createElement(TrackDrawing, {
      key: index,
      ref,
      enabled: currentEnabled,
      committedSegments: accepted[index],
      waitForCommit: waitForCommit(index),
      distanceSegments: accepted[index],
      length: 20,
      style,
      mode: 'points',
      anchor: [0, 0],
      candidates: [],
      snapping: false,
      roadSnapping: false,
      snapRoad: () => ({ status: 'loading', match: null }),
      lastVertex: [0, 0],
      toCoordinate: (point) => [point.x, point.y],
      toScreen: (point) => ({ x: point[0] * 10, y: point[1] * 10 }),
      magnify: () => () => {},
      onAnchor() {},
      onVertex(point) {
        const oldLine = accepted[index][0];
        const line = [...oldLine, point];
        const segments = [line];
        const receipt = { trackId: 'track-a', segments };
        commitSerial += 1;
        for (let pane = 0; pane < refs.length; pane += 1) {
          accepted[pane] = segments;
          overlays[pane] = { ...overlays[pane], saved: [{ id: 'track-a', segments }] };
          refs[pane].current.retainCommit(receipt, [oldLine.at(-1), point]);
        }
        renderTree();
      },
      onStroke() {},
    })),
  ));
  const render = async () => act(async () => renderTree());

  await render();
  const unmount = async () => {
    if (!mounted) return;
    mounted = false;
    await act(async () => root.unmount());
  };
  t.after(unmount);
  return {
    React, act, host, refs, maps, accepted, overlays, waitCallbacks,
    get commitSerial() { return commitSerial; },
    async render() { await render(); },
    unmount,
    async drawCommit() {
      await act(async () => {
        refs[0].current.input({ type: 'start', point: { x: 15, y: 25 } });
        refs[0].current.input({ type: 'end', reason: 'release' });
      });
    },
    async setEnabled(value) { currentEnabled = value; await render(); },
    async undoOrExit() {
      for (let index = 0; index < accepted.length; index += 1) {
        accepted[index] = initialSegments;
        overlays[index] = { ...overlays[index], saved: [{ id: 'track-a', segments: initialSegments }] };
      }
      await render();
    },
  };
}

function pendingPaths(host, index) {
  return host.querySelectorAll('.track-drawing')[index]?.querySelectorAll('[data-drawing-commit="pending"] path').length ?? 0;
}

function assertNoHandoffListeners(map) {
  for (const event of ['render', 'movestart', 'resize', 'remove']) assert.equal(map.count(event), 0, `${event} listener should be removed`);
}

test('both overlays show accepted geometry in the same commit and each worker render clears only its own ink', async (t) => {
  const f = await mount(t);
  await f.drawCommit();

  assert.equal(f.commitSerial, 1, 'a valid gesture commits once');
  assert.equal(pendingPaths(f.host, 0), 2, 'primary overlay exposes the two-stroke temporary line immediately');
  assert.equal(pendingPaths(f.host, 1), 2, 'secondary overlay exposes the same temporary line immediately');
  assert.equal(f.maps[0].count('render'), 1);
  assert.equal(f.maps[1].count('render'), 1);

  f.maps[0].loaded = true;
  await f.act(async () => f.maps[0].emit('render'));
  assert.equal(pendingPaths(f.host, 0), 0, 'primary clears after its worker has rendered the accepted geometry');
  assert.equal(pendingPaths(f.host, 1), 2, 'secondary stays visible until its own source worker completes');
  assertNoHandoffListeners(f.maps[0]);

  f.maps[1].loaded = true;
  await f.act(async () => f.maps[1].emit('render'));
  assert.equal(pendingPaths(f.host, 1), 0);
  assertNoHandoffListeners(f.maps[1]);
});

test('a second accepted line survives a stale completion callback from the first', async (t) => {
  const f = await mount(t);
  await f.drawCommit();
  const firstCompletion = f.waitCallbacks.map((callbacks) => callbacks[0]);
  await f.drawCommit();

  assert.equal(f.commitSerial, 2);
  assert.equal(pendingPaths(f.host, 0), 4, 'both accepted lines remain visible while the newest receipt is pending');
  await f.act(async () => firstCompletion[0]());
  assert.equal(pendingPaths(f.host, 0), 4, 'an old callback cannot clear the newer pending commit');
  await f.act(async () => firstCompletion[1]());
  assert.equal(pendingPaths(f.host, 1), 4);

  for (const map of f.maps) {
    map.loaded = true;
    await f.act(async () => map.emit('render'));
  }
  assert.equal(pendingPaths(f.host, 0), 0);
  assert.equal(pendingPaths(f.host, 1), 0);
});

test('the accepted-segments prop update does not clear a matching receipt; undo or exit clears it', async (t) => {
  const f = await mount(t);
  await f.drawCommit();
  await f.render();
  assert.equal(pendingPaths(f.host, 0), 2, 'rerendering the accepted segments reference keeps the temporary line');

  await f.undoOrExit();
  assert.equal(pendingPaths(f.host, 0), 0);
  assert.equal(pendingPaths(f.host, 1), 0);
  f.maps.forEach(assertNoHandoffListeners);
});

test('unmount removes render listeners without waiting for a map render', async (t) => {
  const f = await mount(t);
  await f.drawCommit();
  assert.equal(f.maps[0].count('render'), 1);
  await f.unmount();
  f.maps.forEach(assertNoHandoffListeners);
});

test('accepted ink remains visible while drawing is disabled until the worker finishes', async (t) => {
  const f = await mount(t);
  await f.drawCommit();
  await f.setEnabled(false);
  assert.equal(pendingPaths(f.host, 0), 2);
  assert.equal(pendingPaths(f.host, 1), 2);

  for (const map of f.maps) {
    map.loaded = true;
    await f.act(async () => map.emit('render'));
  }
  assert.equal(pendingPaths(f.host, 0), 0);
  assert.equal(pendingPaths(f.host, 1), 0);
});
