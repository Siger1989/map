import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRasterDatum } from '../modules/mapSources/sourceDatum.ts';
const template = 'https://tiles.example.test/vt/lyrs=s&hl=zh-CN&x={$x}&y={$y}&z={$z}&s={$Galileo}&scale=1&gmapgz.jpg';
const source = {kind:'online', datum:'gcj02', ovmap:{coordType:1,layers:[{tiles:[template]}]}};

test('legacy satellite-only Ovi payload uses WGS84 without rewriting stored metadata', () => {
  assert.equal(defaultRasterDatum(source), 'wgs84');
  assert.equal(source.datum, 'gcj02');
  assert.equal(source.ovmap.coordType, 1);
});
test('hybrid, labels, unknown templates and composite stacks retain declared datum', () => {
  for (const tiles of [[template.replace('lyrs=s&','lyrs=y&')], [template.replace('lyrs=s&','lyrs=h&')], ['https://tiles.example.test/{z}/{x}/{y}.png'], [template,'https://tiles.example.test/{z}/{x}/{y}.png']])
    assert.equal(defaultRasterDatum({...source,ovmap:{layers:[{tiles}]}}), 'gcj02');
  assert.equal(defaultRasterDatum({...source,ovmap:{layers:[...source.ovmap.layers,...source.ovmap.layers]}}), 'gcj02');
  assert.equal(defaultRasterDatum({...source,kind:'image'}), 'gcj02');
  assert.equal(defaultRasterDatum({...source,datum:'bd09',ovmap:undefined}), 'bd09');
  assert.equal(defaultRasterDatum(null), 'wgs84');
});
