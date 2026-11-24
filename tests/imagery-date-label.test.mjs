import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
import { imageryDateLabel } from '../modules/map/imageryDateLabel.ts';

test('built-in imagery labels retain the annual composite date for retired imagery preferences', () => {
  const eox = applyLayerPatch(DEFAULT_LAYERS, { satellite: true, imageryMode: 'detail' });
  const label = {
    text: '影像日期：2025年合成', kind: 'imagery',
  };
  assert.deepEqual(imageryDateLabel(eox, null, false), label);
  assert.deepEqual(imageryDateLabel({ ...eox, imageryMode: 'latest' }, null, false), label);
});

test('date labels do not infer dates when switching to a custom source', () => {
  const settings = { ...DEFAULT_LAYERS, satellite: true };
  const custom = {
    id: 'local-1', name: '卫星2024', kind: 'online', format: 'xyz',
    attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 0,
    tiles: ['https://example.invalid/2024/{z}/{x}/{y}.jpg'],
  };
  assert.equal(imageryDateLabel(settings, custom, false)?.text, '图源日期：未提供');
  assert.equal(imageryDateLabel(DEFAULT_LAYERS, null, false), null);
});

test('image-only custom sources use an image date label without guessing a date', () => {
  const image = {
    id: 'image-1', name: 'Raster', kind: 'image', format: 'png',
    attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 0,
  };
  assert.equal(imageryDateLabel(DEFAULT_LAYERS, image, false)?.text,
    '影像日期：未提供');
});
