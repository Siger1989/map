import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEIJING54_CRS,
  XIAN80_CRS,
  createCgcs2000Gauss3ByCentralMeridian,
  createCgcs2000Gauss3ByZone,
  detectCrs,
  exportCoordinateCsv,
  exportProjectCoordinatesJson,
  fromWgs84,
  resolveCrs,
  toWgs84,
  toWgs84GeoJson,
} from '../modules/coordinates/index.ts';
import {
  createCoordinateExchange,
  exportCoordinateExchangeCsv,
  exportCoordinateExchangeJson,
  importCoordinateExchange,
} from '../modules/coordinates/exchange.ts';

const close = (actual, expected, tolerance = 1e-7) => {
  assert.ok(Math.abs(actual[0] - expected[0]) < tolerance);
  assert.ok(Math.abs(actual[1] - expected[1]) < tolerance);
};

test('explicit CRS detection never infers a coordinate system from coordinate values', () => {
  assert.equal(detectCrs({ srsName: 'EPSG:4490' }).id, 'EPSG:4490');
  assert.equal(detectCrs({ crs: { id: 'EPSG:4326', name: 'WGS84' } }).id, 'EPSG:4326');
  assert.equal(detectCrs([104.06, 30.65]), null);
  assert.equal(detectCrs({ x: 104.06, y: 30.65 }), null);
});

test('Gauss projection round-trips and custom definitions are bounded', () => {
  const crs = createCgcs2000Gauss3ByZone(35);
  const point = [104.066, 30.659, 512.25];
  const projected = fromWgs84(point, crs);
  assert.equal(projected[2], point[2]);
  close(toWgs84(projected, crs), point);
  assert.throws(() => resolveCrs('+proj=invalid +datum=WGS84'));
  assert.throws(() => resolveCrs({ id: 'CUSTOM', name: 'too long', definition: '+proj=longlat '.repeat(1000) }));
});

test('registered CGCS2000 Gauss and UTM codes use their documented false eastings', () => {
  const cm = createCgcs2000Gauss3ByCentralMeridian(105);
  const zone = createCgcs2000Gauss3ByZone(35);
  assert.match(cm.definition, /\+x_0=500000\b/);
  assert.match(zone.definition, /\+x_0=35500000\b/);
  assert.equal(resolveCrs('EPSG:4513').definition.match(/\+x_0=(\d+)/)[1], '25500000');
  assert.equal(resolveCrs('EPSG:4534').definition.match(/\+x_0=(\d+)/)[1], '500000');
  assert.equal(resolveCrs('EPSG:4491').definition.match(/\+x_0=(\d+)/)[1], '13500000');
  assert.equal(resolveCrs('EPSG:4502').definition.match(/\+x_0=(\d+)/)[1], '500000');
  assert.equal(resolveCrs('EPSG:32648').id, 'EPSG:32648');
  assert.equal(resolveCrs('EPSG:32756').id, 'EPSG:32756');
});

test('arbitrary CRS IDs cannot bypass explicit datum requirements; 3D output stays 3D', () => {
  const unknown = { id: 'LOCAL:ENGINEERING', name: 'Local grid', definition: '+proj=tmerc +lat_0=0 +lon_0=105 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs' };
  assert.throws(() => toWgs84([500000, 0], unknown), /datum/);
  const threeDim = toWgs84([104, 30, 500], '+proj=longlat +datum=WGS84 +no_defs');
  assert.equal(threeDim.length, 3);
  assert.ok(Math.abs(threeDim[0] - 104) < 1e-10);
  assert.ok(Math.abs(threeDim[1] - 30) < 1e-10);
  assert.equal(threeDim[2], 500);
});

test('Beijing 54 and Xi’an 80 require explicit bounded datum parameters', () => {
  for (const base of [BEIJING54_CRS, XIAN80_CRS]) {
    assert.throws(() => toWgs84([104, 30], base), /需要经核实的 3\/7 参数/);
    const configured = { ...base, datumParameters: [0, 0, 0] };
    const point = [104, 30];
    close(toWgs84(fromWgs84(point, configured), configured), point);
    assert.throws(() => resolveCrs({ ...base, datumParameters: [1_000_001, 0, 0] }), /允许范围/);
  }
});

test('project exports include IDs, altitude and complete CRS metadata; GeoJSON stays WGS84', () => {
  const points = [{ id: 'p-1', name: '成都', coordinates: [104.066, 30.659, 512.25] }];
  const crs = createCgcs2000Gauss3ByZone(35);
  const csv = exportCoordinateCsv(points, crs);
  assert.match(csv, /"p-1","成都",[^,]+,[^,]+,512\.25/);

  const json = JSON.parse(exportProjectCoordinatesJson(points, crs));
  assert.deepEqual(json.crs, crs);
  assert.equal(json.coordinates[0].id, 'p-1');
  assert.equal(json.coordinates[0].coordinates[2], 512.25);

  const geojson = JSON.parse(toWgs84GeoJson(points));
  assert.deepEqual(geojson.features[0].geometry.coordinates, points[0].coordinates);
});

test('coordinate exchange preserves pin and track altitude, favorite route geometry, areas, and unique IDs', () => {
  const data = {
    format: 'guanyun-backup', version: 1,
    annotations: [
      { id: 'same-id', kind: 'pin', name: '高程点', note: 'ground value', coordinates: [104.066, 30.659], groundElevation: 512.25 },
      { id: 'same-id', kind: 'pin', name: '重复编号点', note: '', coordinates: [104.067, 30.66], groundElevation: null },
    ],
    tracks: [{
      id: 'same-id', name: '分段轨迹', createdAt: 1,
      segments: [[[104.066, 30.659], [104.07, 30.66]], [[104.08, 30.67], [104.09, 30.68]]],
      samples: [
        [{ time: null, altitude: 500 }, { time: null, altitude: null }],
        [{ time: null, altitude: 600 }, { time: null, altitude: 610 }],
      ],
    }],
    favorites: [{
      id: 'same-id', name: '收藏路线', savedAt: 1,
      start: { name: '起点', coordinates: [104.066, 30.659] },
      end: { name: '终点', coordinates: [104.09, 30.68] },
      route: {
        mode: 'pedestrian', coordinates: [[104.066, 30.659], [104.09, 30.68]],
        distance: 100, duration: 100, steps: [], snapped: [[104.066, 30.659], [104.09, 30.68]], createdAt: 1,
      },
    }],
    areas: [{
      id: 'same-id', name: '收藏区域', note: '', color: '#3388ff', visible: true,
      boundary: [[104.06, 30.65], [104.08, 30.65], [104.07, 30.67], [104.06, 30.65]], createdAt: 1,
    }],
  };
  const crs = createCgcs2000Gauss3ByCentralMeridian(105);
  const exchange = createCoordinateExchange(data, crs);
  assert.deepEqual(exchange.features.map((feature) => feature.featureID), [
    'pin:same-id', 'pin:same-id#2', 'track:same-id', 'area:same-id', 'favorite-route:same-id',
  ]);
  assert.equal(new Set(exchange.features.map((feature) => feature.featureID)).size, exchange.features.length);
  const pin = exchange.features[0];
  assert.equal(pin.type, 'Point');
  assert.equal(pin.geometry.coordinates[2], 512.25);
  const favorite = exchange.features.find((feature) => feature.featureID === 'favorite-route:same-id');
  assert.equal(favorite.type, 'LineString');
  assert.equal(favorite.geometry.coordinates.length, 2);

  for (const text of [exportCoordinateExchangeJson(data, crs), exportCoordinateExchangeCsv(data, crs)]) {
    const imported = importCoordinateExchange(text).data;
    const restoredPin = imported.annotations.find((annotation) => annotation.name === '高程点');
    assert.equal(restoredPin.groundElevation, 512.25);
    const restoredTrack = imported.tracks.find((track) => track.name === '分段轨迹');
    assert.equal(restoredTrack.segments.length, 2);
    assert.equal(restoredTrack.samples[0][0].altitude, 500);
    assert.equal(restoredTrack.samples[1][1].altitude, 610);
    assert.ok(imported.tracks.some((track) => track.name === '收藏路线'));
    assert.ok(imported.areas.some((area) => area.name === '收藏区域'));
  }
});
