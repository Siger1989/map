import test from 'node:test';
import assert from 'node:assert/strict';

test('motion frame timings exclude idle gaps and stay bounded across gestures', () => {
  const s = scene();
  let time = 0;
  const observer = observeMapRendering(s.map, () => time);
  s.state.moving = true;
  s.emit('movestart');
  s.emit('render');
  for (let i = 0; i < 130; i++) { time += 16; s.emit('render'); }
  assert.deepEqual(observer.snapshot().movingFrameIntervals,
    { samples: 120, averageMs: 16, p95Ms: 16, over50Ms: 0 });
  s.state.moving = false;
  s.emit('moveend');
  time += 10000;
  s.emit('render');
  s.state.moving = true;
  s.emit('movestart');
  s.emit('render');
  time += 80;
  s.emit('render');
  assert.equal(observer.snapshot().movingFrameIntervals.over50Ms, 1);
  assert.ok(observer.snapshot().movingFrameIntervals.averageMs < 17);
  s.emit('webglcontextlost');
  time += 10000;
  s.emit('webglcontextrestored');
  s.emit('render');
  assert.equal(observer.snapshot().movingFrameIntervals.over50Ms, 1);
  observer.dispose();
});
import { observeMapRendering } from '../modules/map/renderDiagnostics.ts';

function scene() {
  const listeners = new Map();
  const state = {
    source: false,
    loaded: false,
    terrain: false,
    zoom: 11,
    hidden: false,
    moving: false,
    canvas: { width: 780, height: 1688, clientWidth: 390, clientHeight: 844,
      ownerDocument: { defaultView: { devicePixelRatio: 3 } } },
  };
  const map = {
    on(name, callback) {
      listeners.set(name, callback);
    },
    off(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    getCanvas: () => state.canvas,
    getSource: () => (state.source ? {} : undefined),
    isSourceLoaded: () => state.loaded,
    getTerrain: () => (state.terrain ? { source: 'elevation' } : null),
    getZoom: () => state.zoom,
    isMoving: () => state.moving,
    areTilesLoaded: () => state.loaded,
    getLayer: (id) =>
      state.source ? { minzoom: id === 'local-roads' ? 12 : 6 } : undefined,
    getLayoutProperty: () => (state.hidden ? 'none' : undefined),
  };
  return {
    map,
    state,
    listeners,
    emit: (name, sourceId) => listeners.get(name)?.({ type: name, sourceId }),
  };
}

test('road diagnostics distinguish loading, hidden roads and zoom thresholds without changing the map', () => {
  const s = scene(),
    observer = observeMapRendering(s.map);
  assert.equal(observer.snapshot().roads.sourcePresent, false);
  assert.equal(
    observer.snapshot().roads.layers.some((l) => l.eligibleAtZoom),
    false,
  );
  Object.assign(s.state, { source: true, terrain: true });
  s.emit('sourcedataloading', 'openmaptiles');
  s.emit('error', 'elevation');
  s.emit('error', 'openmaptiles');
  let roads = observer.snapshot().roads;
  assert.equal(roads.requests, 1);
  assert.equal(roads.errors, 1);
  assert.equal(roads.sourceLoaded, false);
  assert.equal(roads.terrainEnabled, true);
  assert.equal(
    roads.layers.find((l) => l.id === 'main-roads').eligibleAtZoom,
    true,
  );
  assert.equal(
    roads.layers.find((l) => l.id === 'local-roads').eligibleAtZoom,
    false,
  );
  Object.assign(s.state, { loaded: true, zoom: 12, hidden: true });
  assert.equal(
    observer.snapshot().roads.layers.some((l) => l.eligibleAtZoom),
    false,
  );
  s.state.hidden = false;
  assert.equal(
    observer.snapshot().roads.layers.every((l) => l.eligibleAtZoom),
    true,
  );
  observer.dispose();
  assert.equal(s.listeners.size, 0);
});

test('canvas diagnostics distinguish screen density from actual backing pixels and follow resize', () => {
  const s = scene(), observer = observeMapRendering(s.map);
  let canvas = observer.snapshot().canvas;
  assert.equal(canvas.devicePixelRatio, 3);
  assert.equal(canvas.effectivePixelRatioX, 2);
  assert.equal(canvas.effectivePixelRatioY, 2);
  Object.assign(s.state.canvas, { width: 1170, height: 2532 });
  canvas = observer.snapshot().canvas;
  assert.equal(canvas.effectivePixelRatioX, 3);
  assert.equal(canvas.effectivePixelRatioY, 3);
  Object.assign(s.state.canvas, { clientWidth: 0, clientHeight: 0 });
  canvas = observer.snapshot().canvas;
  assert.equal(canvas.effectivePixelRatioX, null);
  assert.equal(canvas.effectivePixelRatioY, null);
  observer.dispose();
});

test('diagnostic history stays bounded and snapshot mutation cannot alter counters', () => {
  const s = scene(),
    observer = observeMapRendering(s.map);
  for (let i = 0; i < 40; i++) s.emit('sourcedataloading', 'openmaptiles');
  const first = observer.snapshot();
  assert.equal(first.recent.length, 16);
  first.counts.sourcedataloading = 0;
  first.roads.requests = 0;
  assert.equal(observer.snapshot().counts.sourcedataloading, 40);
  assert.equal(observer.snapshot().roads.requests, 40);
  observer.dispose();
});

test('render diagnostics report context recovery, DEM failure and camera motion independently', () => {
  const s=scene(), observer=observeMapRendering(s.map);
  Object.assign(s.state,{source:true,moving:true});
  s.emit('webglcontextlost'); s.emit('error','elevation');
  let snapshot=observer.snapshot();
  assert.equal(snapshot.rendering.contextLost,true);
  assert.equal(snapshot.rendering.moving,true);
  assert.equal(snapshot.terrainSources.find(t=>t.id==='elevation').errors,1);
  s.emit('webglcontextrestored'); s.emit('render'); s.state.moving=false;
  snapshot=observer.snapshot();
  assert.equal(snapshot.rendering.contextLost,false);
  assert.equal(snapshot.rendering.moving,false);
  assert.equal(snapshot.counts.render,1);
  observer.dispose();
});


test('operation timings preserve results and errors without mutable snapshots', () => {
  const s = scene(); let time = 0;
  const observer = observeMapRendering(s.map, () => time);
  assert.equal(observer.measure('tracks', () => { time += 8; return 42; }), 42);
  assert.throws(() => observer.measure('tracks', () => { time += 3; throw new Error('test'); }), /test/);
  const snapshot = observer.snapshot();
  assert.deepEqual(snapshot.operations.tracks, { count: 2, totalMs: 11, maxMs: 8, lastMs: 3 });
  snapshot.operations.tracks.count = 0;
  assert.equal(observer.snapshot().operations.tracks.count, 2);
  observer.dispose();
});
