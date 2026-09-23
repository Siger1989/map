import test from 'node:test';
import assert from 'node:assert/strict';
import { newAnnotation } from '../modules/annotations/data.ts';
import { annotationSheet } from '../modules/annotations/spreadsheet.ts';
import { spreadsheetRegions } from '../modules/annotations/spreadsheetRegions.ts';

const marker = (id, coordinates) => ({ ...newAnnotation('pin', coordinates, null, id), name: id });

test('marker Excel carries saved regions and resolves missing regions only', async () => {
  const items = [marker('saved', [103, 30]), marker('missing', [104, 31])];
  const saved = { 'annotation:saved': {
    coordinateKey: '103.000000,30.000000', country: '中国', province: '四川省', city: '成都市',
    source: 'manual', checkedAt: 1,
  } };
  let calls = 0;
  const result = await spreadsheetRegions(items, saved, new AbortController().signal, async () => {
    calls++;
    return { country: '中国', province: '四川省', city: '绵阳市' };
  });
  assert.equal(calls, 1);
  assert.equal(result.unresolved, 0);
  const { rows } = annotationSheet(items, result.regions);
  const province = rows[0].indexOf('省/州');
  assert.equal(rows[1][province], '四川省');
  assert.equal(rows[2][rows[0].indexOf('城市')], '绵阳市');
  assert.deepEqual(saved, { 'annotation:saved': {
    coordinateKey: '103.000000,30.000000', country: '中国', province: '四川省', city: '成都市',
    source: 'manual', checkedAt: 1,
  } });
});

test('failed region lookup leaves coordinates and existing marker rows intact', async () => {
  const items = [marker('a', [105, 32])];
  const result = await spreadsheetRegions(items, {}, new AbortController().signal, async () => { throw Error('offline'); });
  assert.equal(result.unresolved, 1);
  const { rows } = annotationSheet(items, result.regions);
  assert.deepEqual(rows[1].slice(0, 3), [105, 32, 'a']);
  assert.equal(rows[1][rows[0].indexOf('城市')], '');
});
