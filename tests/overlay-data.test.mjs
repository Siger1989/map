import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOverlayData } from '../modules/map/overlayData.ts';

const lineLayerIds = new Set([
  'route-outline', 'route-path', 'route-access', 'manual-track-outline',
  'manual-track-selection-edge', 'manual-track-line', 'guidance-outline',
  'guidance-path', 'guidance-access', 'route-gap-line', 'main-roads',
  'late-roads',
]);
const layer = id => ({ id, type: lineLayerIds.has(id) ? 'line' : 'symbol' });
const layerMap = ids => ({
  getStyle: () => ({ layers: ids.map(layer) }),
  on() {},
  off() {},
  getLayer: id => ids.includes(id) ? layer(id) : undefined,
  getContainer: () => ({
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  }),
  getCanvas: () => ({
    clientWidth: 100,
    clientHeight: 100,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
  }),
  isStyleLoaded: () => true,
  getPitch: () => 0,
  getTerrain: () => null,
  getProjection: () => ({ type: 'mercator' }),
  queryRenderedFeatures: () => [],
  getLayoutProperty: () => 'visible',
  getPaintProperty: () => null,
});

test('independent OVMAP labels stay above roads, route strokes keep their upper tier, and position stays on top', () => {
  const ids = ['shantu-user-map','shantu-user-map-ovmap-1','position-dot','route-path','main-roads'];
  const map = {
    ...layerMap(ids),
    getSource: () => ({ setData() {} }),
    moveLayer(id, before) {
      ids.splice(ids.indexOf(id), 1);
      if (before) ids.splice(ids.indexOf(before), 0, id); else ids.push(id);
    },
  };
  syncOverlayData(map, 'route', { type:'FeatureCollection', features:[] });
  assert.deepEqual(ids, ['shantu-user-map','main-roads','shantu-user-map-ovmap-1','route-path','position-dot']);
});

test('access segments and slope warnings retain order after late base layers load', () => {
  const ids = ['route-access', 'guidance-access', 'route-grade-warning-label',
    'route-path', 'guidance-path', 'route-points', 'route-grade-warning-dot', 'late-roads'];
  let moves = 0;
  const map = {
    ...layerMap(ids),
    getSource: () => ({ setData() {} }),
    moveLayer(id) { moves++; ids.splice(ids.indexOf(id), 1); ids.push(id); },
  };
  const data = { type: 'FeatureCollection', features: [] };
  syncOverlayData(map, 'route', data);
  assert.deepEqual(ids, ['late-roads', 'route-points', 'route-grade-warning-dot',
    'route-grade-warning-label', 'route-path', 'route-access', 'guidance-path', 'guidance-access']);
  const count = moves;
  for (let i = 0; i < 100; i++) syncOverlayData(map, 'route', data);
  assert.equal(moves, count);
});

test('identical overlay polls neither resend geometry nor reshuffle terrain layers', () => {
  let writes = 0,
    moves = 0;
  let source = { setData: () => writes++ };
  const ids = ['main-roads', 'route-path', 'manual-track-line', 'position-dot'];
  const map = {
    ...layerMap(ids),
    getSource: () => source,
    moveLayer: () => moves++,
  };
  const data = { type: 'FeatureCollection', features: [] };
  for (let i = 0; i < 100; i++)
    syncOverlayData(map, 'route', structuredClone(data));
  assert.equal(writes, 1);
  assert.equal(moves, 0);
  data.features.push({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [103, 30] },
  });
  syncOverlayData(map, 'route', data);
  assert.equal(writes, 2);
  source = { setData: () => writes++ };
  syncOverlayData(map, 'route', data);
  assert.equal(
    writes,
    3,
    'a recreated source must receive even identical data',
  );
});

test('route stroke tier stays above line selection across later overlay updates', () => {
  const ids = ['track-line-selection-halo', 'track-line-selection', 'manual-track-selected-node', 'route-path', 'manual-track-line', 'guidance-path'];
  const source = { setData() {} };
  let moves = 0;
  const map = {
    ...layerMap(ids),
    getSource: () => source,
    moveLayer(id) { moves++; ids.splice(ids.indexOf(id), 1); ids.push(id); },
  };
  const data = { type: 'FeatureCollection', features: [] };
  syncOverlayData(map, 'manual-tracks', data);
  assert.deepEqual(ids.slice(-3), ['route-path', 'manual-track-line', 'guidance-path']);
  const count = moves;
  syncOverlayData(map, 'manual-tracks', data);
  assert.equal(moves, count);
});

test('selected edge bright border is between the route outline and original line color', () => {
  const ids = ['manual-track-line','manual-track-outline','manual-track-selection-edge'];
  const source = { setData() {} };
  const map = {
    ...layerMap(ids),
    getSource: () => source,
    moveLayer(id) { ids.splice(ids.indexOf(id), 1); ids.push(id); },
  };
  syncOverlayData(map, 'manual-track-selection-edge', { type: 'FeatureCollection', features: [] });
  assert.deepEqual(ids, ['manual-track-outline','manual-track-selection-edge','manual-track-line']);
});

test('late route creation restores consistent overlay ordering once', () => {
  const ids = ['main-roads', 'position-dot', 'manual-track-line', 'route-path'];
  let moves = 0;
  const source = { setData() {} };
  const map = {
    ...layerMap(ids),
    getSource: () => source,
    moveLayer(id, before) {
      moves++;
      ids.splice(ids.indexOf(id), 1);
      if (before) ids.splice(ids.indexOf(before), 0, id);
      else ids.push(id);
    },
  };
  const data = { type: 'FeatureCollection', features: [] };
  syncOverlayData(map, 'route', data);
  assert.deepEqual(ids, [
    'main-roads',
    'route-path',
    'manual-track-line',
    'position-dot',
  ]);
  const count = moves;
  syncOverlayData(map, 'route', structuredClone(data));
  assert.equal(moves, count);
  ids.push('late-base-roads');
  syncOverlayData(map, 'route', data);
  assert.deepEqual(ids.slice(-3), [
    'route-path',
    'manual-track-line',
    'position-dot',
  ]);
  const finalMoves = moves;
  syncOverlayData(map, 'route', data);
  assert.equal(moves, finalMoves);
});
