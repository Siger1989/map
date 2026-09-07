import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlaceName,
  placeCenter,
} from '../modules/navigation/placeName.ts';
const at = [103.62, 31];
const response = (properties, coordinates = at) => ({
  features: [{ geometry: { coordinates }, properties }],
});

test('current area uses administrative context, deduplicates and ignores a nearby shop name', () => {
  const place = normalizePlaceName(
    response({
      name: '便利店',
      osm_key: 'shop',
      city: '成都市',
      district: '灌口街道',
      state: '四川省',
      country: '中国',
    }),
    at,
  );
  assert.equal(place.local, '成都市 · 灌口街道');
  assert.equal(place.region, '中国 · 四川省');
  assert.ok(!place.full.includes('便利店'));
  assert.equal(
    normalizePlaceName(response({ city: '成都', district: '成都' }), at).local,
    '成都',
  );
});
test('global place names retain local writing and fall back to available administrative levels', () => {
  assert.equal(
    normalizePlaceName(response({ city: '東京都', country: '日本' }), at).local,
    '東京都',
  );
  assert.equal(
    normalizePlaceName(
      response({
        name: 'Village',
        osm_key: 'place',
        osm_value: 'village',
        country: 'UK',
      }),
      at,
    ).local,
    'Village',
  );
  assert.equal(
    normalizePlaceName(response({ state: 'Alaska', country: 'USA' }), at).local,
    'Alaska',
  );
  assert.equal(
    normalizePlaceName(
      response({
        name: 'WC2R 0BP',
        osm_key: 'boundary',
        osm_value: 'postal_code',
        country: 'UK',
      }),
      at,
    ).local,
    'UK',
  );
});
test('empty, distant and malformed place results never invent a current area', () => {
  assert.equal(normalizePlaceName({ features: [] }, at), null);
  assert.equal(
    normalizePlaceName(response({ city: 'London' }, [-0.12, 51.51]), at),
    null,
  );
  assert.equal(
    normalizePlaceName(
      { features: [null, {}, { properties: { name: 'x' } }] },
      at,
    ),
    null,
  );
  assert.throws(() => normalizePlaceName(null, at));
});
test('center query grid rounds coordinates and wraps repeated worlds', () => {
  assert.deepEqual(placeCenter([463.6242, 31.003]), [103.62, 31]);
  assert.deepEqual(placeCenter([-540, -30.234]), [-180, -30.23]);
  assert.equal(placeCenter([Infinity, 0]), null);
  assert.equal(placeCenter([0, 91]), null);
});
