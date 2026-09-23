import test from 'node:test';
import assert from 'node:assert/strict';
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
  };
  const map = {
    on(name, callback) {
      listeners.set(name, callback);
    },
    off(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
    getCanvas: () => ({ width: 780, height: 1688 }),
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
