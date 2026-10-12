import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSearchResults } from '../modules/navigation/searchResultOrder.ts';

test('exact place name precedes nearer businesses while retaining locality and stable input', () => {
  const original = [
    { name: '菜鸟驿站成都东原晴天见店', coordinates: [104.166, 30.615] },
    { name: '东原晴天见', detail: '四川省 · 成都市 · 龙泉驿区', coordinates: [104.167, 30.615] },
    { name: '东原晴天见', detail: '重庆市', coordinates: [106.5, 29.5] },
  ];
  const before = structuredClone(original);
  const result = orderSearchResults(original, ' 东原晴天见 ', [104.166, 30.615]);
  assert.deepEqual(result.map(p => p.detail ?? 'shop'), ['四川省 · 成都市 · 龙泉驿区', '重庆市', 'shop']);
  assert.deepEqual(original, before);
});

test('map center reorders equal name matches and missing center preserves source order', () => {
  const places = [{ name: '医院', coordinates: [104, 30] }, { name: '医院', coordinates: [106, 30] }];
  assert.deepEqual(orderSearchResults(places, '医院', [106, 30]), [places[1], places[0]]);
  assert.deepEqual(orderSearchResults(places, '医院', null), places);
});
