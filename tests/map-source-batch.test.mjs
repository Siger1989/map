import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSourceBatchItems } from '../modules/mapSources/batch.ts';

const online = (id, name = id) => ({
  id, name, kind: 'online', format: 'XYZ', tiles: ['https://tiles.example/{z}/{x}/{y}.png'],
  minzoom: 0, maxzoom: 18, tileSize: 256, bytes: 0, attribution: 'test',
});

test('batch includes current source and unique online saved sources in stable order', () => {
  const current = online('current');
  const rows = mapSourceBatchItems([current, online('saved'), { ...online('offline'), kind: 'mbtiles' }], current);
  assert.deepEqual(rows.map((row) => row.id), ['current:current', 'saved:saved', 'saved:offline']);
  assert.equal(rows[0].label, 'current');
  assert.equal(rows[2].skipped, '离线图源没有在线瓦片模板');
});

test('batch marks missing templates and unavailable current built-ins as skipped', () => {
  const rows = mapSourceBatchItems([{ ...online('empty'), tiles: [] }], null, false);
  assert.equal(rows[0].skipped, '当前内置图源没有可测试的在线瓦片模板');
  assert.equal(rows[1].skipped, '缺少可测试的瓦片模板');
});

test('batch labels do not expose endpoint URLs or key values', () => {
  const rows = mapSourceBatchItems([online('secret', 'https://provider.example/map?key=SECRET')], null);
  assert.doesNotMatch(rows[1].label, /SECRET|provider\.example/);
  assert.match(rows[1].label, /地址已隐藏/);
});
