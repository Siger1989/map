import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEIJING54_CRS,
  CGCS2000_CRS,
  WGS84_CRS,
  XIAN80_CRS,
  createCgcs2000Gauss3ByCentralMeridian,
  createCgcs2000Gauss3ByZone,
  createCgcs2000Gauss6ByZone,
  createUtmCrs,
  detectCrs,
  exportCoordinateCsv,
  exportProjectCoordinatesJson,
  fromWgs84,
  readActiveProjectCrs,
  resolveCrs,
  toWgs84,
  toWgs84GeoJson,
  writeActiveProjectCrs,
} from '../modules/coordinates/index.ts';

const closePoint = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual[0] - expected[0]) <= tolerance, `${actual[0]} != ${expected[0]}`);
  assert.ok(Math.abs(actual[1] - expected[1]) <= tolerance, `${actual[1]} != ${expected[1]}`);
};

test('CGCS2000 geographic, Gauss-Kruger 3/6-degree, and UTM projections round-trip', () => {
  const wgs = [104.066, 30.659];
  closePoint(toWgs84(fromWgs84(wgs, CGCS2000_CRS), CGCS2000_CRS), wgs);
  for (const crs of [
    createCgcs2000Gauss3ByCentralMeridian(105),
    createCgcs2000Gauss3ByZone(35),
    createCgcs2000Gauss6ByZone(18),
    createUtmCrs(48, 'N'),
    createUtmCrs(56, 'S'),
  ]) {
    closePoint(toWgs84(fromWgs84(wgs, crs), crs), wgs);
  }
});

test('resolve and detection use explicit CRS metadata only', () => {
  assert.equal(resolveCrs('4326').id, 'EPSG:4326');
  assert.equal(resolveCrs('CGCS2000').id, 'EPSG:4490');
  assert.equal(detectCrs('EPSG:3857').id, 'EPSG:3857');
  assert.equal(detectCrs({ srsName: 'EPSG:4490' }).id, 'EPSG:4490');
  assert.equal(detectCrs([104, 30]), null);
  assert.equal(detectCrs({ x: 104, y: 30 }), null);
  const custom = resolveCrs('+proj=longlat +datum=WGS84 +no_defs');
  assert.equal(custom.id, 'CUSTOM');
  closePoint(toWgs84([104, 30], custom), [104, 30]);
  assert.equal(detectCrs('+proj=not-a-projection'), null);
});

test('Beijing 54 and Xi’an 80 refuse cross-datum conversion without explicit parameters', () => {
  for (const crs of [BEIJING54_CRS, XIAN80_CRS]) {
    assert.throws(() => toWgs84([104, 30], crs), /需要经核实的 3\/7 参数/);
    assert.throws(() => fromWgs84([104, 30], crs), /需要经核实的 3\/7 参数/);
  }
});

test('projection factories and datum parameters enforce bounds', () => {
  assert.equal(createCgcs2000Gauss3ByCentralMeridian(75).id, 'CGCS2000:GAUSS3:CM:75');
  assert.equal(createCgcs2000Gauss3ByCentralMeridian(135).id, 'CGCS2000:GAUSS3:CM:135');
  assert.equal(createCgcs2000Gauss3ByZone(25).id, 'CGCS2000:GAUSS3:ZONE:25');
  assert.equal(createCgcs2000Gauss3ByZone(45).id, 'CGCS2000:GAUSS3:ZONE:45');
  assert.equal(createCgcs2000Gauss6ByZone(13).id, 'CGCS2000:GAUSS6:ZONE:13');
  assert.equal(createCgcs2000Gauss6ByZone(23).id, 'CGCS2000:GAUSS6:ZONE:23');
  assert.throws(() => createCgcs2000Gauss3ByCentralMeridian(74), /中央经线/);
  assert.throws(() => createCgcs2000Gauss3ByCentralMeridian(136), /中央经线/);
  assert.throws(() => createCgcs2000Gauss3ByZone(24), /带号/);
  assert.throws(() => createCgcs2000Gauss3ByZone(46), /带号/);
  assert.throws(() => createCgcs2000Gauss6ByZone(12), /带号/);
  assert.throws(() => createCgcs2000Gauss6ByZone(24), /带号/);
  assert.throws(() => createUtmCrs(0, 'N'), /UTM/);
  assert.throws(() => createUtmCrs(61, 'S'), /UTM/);
  assert.throws(() => createUtmCrs(31, 'X'), /UTM/);
  assert.throws(() => resolveCrs({ ...BEIJING54_CRS, datumParameters: [1_000_001, 0, 0] }), /允许范围/);
  assert.throws(() => resolveCrs({ ...XIAN80_CRS, datumParameters: [0, 0] }), /3 或 7 个/);
  assert.doesNotThrow(() => resolveCrs({ ...BEIJING54_CRS, datumParameters: [1_000_000, 0, 0] }));
});

test('invalid points and invalid custom definitions fail with bounded errors', () => {
  assert.throws(() => toWgs84([Number.NaN, 30], WGS84_CRS), /有限/);
  assert.throws(() => toWgs84([50_000_001, 0], CGCS2000_CRS), /有效范围/);
  assert.throws(() => fromWgs84([104, 91], CGCS2000_CRS), /经纬度范围/);
  assert.throws(() => resolveCrs({ id: 'CUSTOM', name: '太长', definition: '+proj=longlat '.repeat(1000) }), /过长/);
  assert.throws(() => resolveCrs({ id: 'CUSTOM', name: '错误', definition: '+proj=invalid +datum=WGS84' }), /无效或不受支持/);
});

test('active CRS storage uses only its versioned key and safely falls back', () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  assert.equal(readActiveProjectCrs(storage).id, 'EPSG:4326');
  writeActiveProjectCrs(createUtmCrs(48, 'N'), storage);
  assert.equal([...data.keys()].join(','), 'shantu.project-crs.v1');
  assert.equal(readActiveProjectCrs(storage).id, 'EPSG:32648');
  data.set('shantu.project-crs.v1', '{bad json');
  assert.equal(readActiveProjectCrs(storage).id, 'EPSG:4326');
});

test('coordinate exports carry explicit CRS metadata and GeoJSON remains WGS84', () => {
  const points = [{ name: '成都,测试', coordinates: [104.066, 30.659] }];
  const projected = createCgcs2000Gauss3ByZone(35);
  const csv = exportCoordinateCsv(points, projected);
  assert.match(csv, /^# CRS="CGCS2000:GAUSS3:ZONE:35"; name=/);
  assert.match(csv, /"成都,测试",/);
  const projectJson = JSON.parse(exportProjectCoordinatesJson(points, projected));
  assert.equal(projectJson.schema, 'shantu.project-coordinates');
  assert.equal(projectJson.crs.id, projected.id);
  assert.deepEqual(projectJson.axisOrder, ['x', 'y']);
  assert.ok(projectJson.coordinates[0].coordinates[0] > 1_000_000);
  const geoJson = JSON.parse(toWgs84GeoJson(points));
  assert.equal(geoJson.coordinateReferenceSystem.id, 'EPSG:4326');
  assert.deepEqual(geoJson.features[0].geometry.coordinates, points[0].coordinates);
});
