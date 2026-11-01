import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCoordinateQuery, parseCoordinateQuery } from '../modules/coordinates/coordinateQuery.ts';

test('Google decimal latitude-longitude input maps to internal longitude-latitude without guessing order', () => {
  assert.deepEqual(parseCoordinateQuery('39.9042, 116.4074'), {
    status: 'valid', latitude: 39.9042, longitude: 116.4074, coordinate: [116.4074, 39.9042],
  });
  assert.deepEqual(parseCoordinateQuery('40, 30').coordinate, [30, 40],
    'when both values are in both legal ranges, input order remains latitude then longitude');
  assert.equal(parseCoordinateQuery('116.4074, 39.9042').status, 'invalid',
    'a plausible reversed pair is rejected by latitude range and never silently swapped');
});

test('decimal coordinates accept Chinese comma, whitespace and explicit latitude/longitude labels', () => {
  assert.deepEqual(parseCoordinateQuery(' -33.8688， 151.2093 ').coordinate, [151.2093, -33.8688]);
  assert.deepEqual(parseCoordinateQuery('0 0').coordinate, [0, 0]);
  assert.deepEqual(parseCoordinateQuery('纬度：90，经度：-180').coordinate, [-180, 90]);
  assert.deepEqual(parseCoordinateQuery('longitude=-180 latitude=90').coordinate, [-180, 90]);
  assert.deepEqual(parseCoordinateQuery('lat 0 lon 0').coordinate, [0, 0]);
});

test('coordinate bounds are explicit and malformed coordinate attempts return useful local errors', () => {
  assert.equal(parseCoordinateQuery('90.0001, 10').status, 'invalid');
  assert.equal(parseCoordinateQuery('10, -180.0001').status, 'invalid');
  assert.equal(parseCoordinateQuery('纬度 30').status, 'invalid');
  assert.equal(parseCoordinateQuery('30, 40, 50').status, 'invalid');
  assert.equal(parseCoordinateQuery('91, 181').status, 'invalid');
  assert.equal(parseCoordinateQuery('北京三里屯').status, 'not-coordinate');
  assert.equal(parseCoordinateQuery('成都, 四川').status, 'not-coordinate');
  for (const place of ['London', 'Portland', 'Galata', 'Latitude Coffee', '纬度咖啡']) {
    assert.equal(parseCoordinateQuery(place).status, 'not-coordinate', place);
  }
  assert.deepEqual(parseCoordinateQuery(''), { status: 'not-coordinate' });
});

test('format and parse round-trip internal WGS84 points exactly as latitude, longitude text', () => {
  const points = [
    [116.4074, 39.9042],
    [-73.985656, 40.748433],
    [-0, -0],
    [1e-7, -1e-8],
    [179.99999999999997, 89.99999999999999],
  ];
  for (const coordinate of points) {
    const text = formatCoordinateQuery(coordinate);
    assert.deepEqual(text.split(', ').map(Number), [coordinate[1], coordinate[0]].map((value) => Object.is(value, -0) ? 0 : value));
    assert.deepEqual(parseCoordinateQuery(text).coordinate, coordinate.map((value) => Object.is(value, -0) ? 0 : value));
  }
  assert.equal(formatCoordinateQuery([116.4074, 39.9042]), '39.9042, 116.4074');
  assert.throws(() => formatCoordinateQuery([181, 0]), RangeError);
});
