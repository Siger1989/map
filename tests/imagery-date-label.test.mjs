import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
import {
  imageryDateLabel,
  imageryDateSourceKey,
} from '../modules/map/imageryDateLabel.ts';

test('built-in imagery labels distinguish an annual composite from an observation date', () => {
  const eox = applyLayerPatch(DEFAULT_LAYERS, { satellite: true, imageryMode: 'detail' });
  assert.deepEqual(imageryDateLabel(eox, null, false, null), {
    text: '影像日期：2025年合成', kind: 'imagery',
  });

  const latest = { ...eox, imageryMode: 'latest' };
  assert.deepEqual(imageryDateLabel(latest, null, false, {
    date: '2026-09-28', ready: true, status: '最新可用',
  }), { text: '影像日期：2026-09-28', kind: 'imagery' });
  assert.equal(imageryDateLabel(latest, null, false, {
    date: '2026-09-28', ready: false, status: '卫星影像暂不可用',
  })?.text, '影像日期：未提供');
});

test('date labels clear on source changes and do not infer custom source dates', () => {
  const latest = { ...DEFAULT_LAYERS, satellite: true, imageryMode: 'latest' };
  const oldSourceKey = imageryDateSourceKey(latest, null, false);
  const custom = {
    id: 'local-1', name: '卫星2024', kind: 'online', format: 'xyz',
    attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 0,
    tiles: ['https://example.invalid/2024/{z}/{x}/{y}.jpg'],
  };
  const newSourceKey = imageryDateSourceKey(latest, custom, false);
  assert.notEqual(newSourceKey, oldSourceKey);
  assert.equal(imageryDateLabel(latest, custom, false, {
    date: '2026-09-28', ready: true, status: 'latest',
  })?.text, '图源日期：未提供');
  assert.equal(imageryDateLabel(DEFAULT_LAYERS, null, false, null), null);
});

test('image-only custom sources use an image date label without guessing a date', () => {
  const image = {
    id: 'image-1', name: 'Raster', kind: 'image', format: 'png',
    attribution: '', minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 0,
  };
  assert.equal(imageryDateLabel(DEFAULT_LAYERS, image, false, null)?.text,
    '影像日期：未提供');
});
