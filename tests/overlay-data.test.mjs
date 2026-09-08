import test from 'node:test';
import assert from 'node:assert/strict';
import { syncOverlayData } from '../modules/map/overlayData.ts';

test('identical overlay polls neither resend geometry nor reshuffle terrain layers', () => {
  let writes = 0,
    moves = 0;
  let source = { setData: () => writes++ };
  const ids = ['main-roads', 'route-path', 'manual-track-line', 'position-dot'];
  const map = {
    getSource: () => source,
    getStyle: () => ({ layers: ids.map((id) => ({ id })) }),
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

test('late route creation restores consistent overlay ordering once', () => {
  const ids = ['main-roads', 'position-dot', 'manual-track-line', 'route-path'];
  let moves = 0;
  const source = { setData() {} };
  const map = {
    getSource: () => source,
    getStyle: () => ({ layers: ids.map((id) => ({ id })) }),
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
