import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteBuilder } from '../modules/dataTransfer/routeBuilder.ts';
import { createCgcs2000Gauss3ByZone } from '../modules/coordinates/index.ts';
import {
  createCoordinateExchange,
  exportCoordinateExchangeCsv,
  exportCoordinateExchangeJson,
  importCoordinateExchange,
} from '../modules/coordinates/exchange.ts';

function fixture() {
  const builder = new RouteBuilder('測線.csv');
  builder.pin('控制点,东', { coordinates: [104.066, 30.659], altitude: 512.5, time: null });
  builder.track('分段路线', [
    [{ coordinates: [104.066, 30.659], altitude: 512.5, time: null }, { coordinates: [104.07, 30.66], altitude: 514, time: null }],
    [{ coordinates: [104.08, 30.67], altitude: null, time: null }, { coordinates: [104.09, 30.68], altitude: 520, time: null }],
  ]);
  builder.area('施工区', [
    { coordinates: [104.06, 30.65], altitude: null, time: null },
    { coordinates: [104.08, 30.65], altitude: null, time: null },
    { coordinates: [104.07, 30.67], altitude: null, time: null },
  ]);
  return builder.finish();
}

test('projected JSON exchange includes CRS metadata and preserves point, multipart line, and polygon', () => {
  const data = fixture();
  const crs = createCgcs2000Gauss3ByZone(35);
  const exchange = createCoordinateExchange(data, crs);
  assert.equal(exchange.schema, 'shantu-coordinate-exchange');
  assert.equal(exchange.crs.id, crs.id);
  assert.deepEqual(exchange.axisOrder, ['x', 'y']);
  const point = exchange.features.find((feature) => feature.type === 'Point');
  assert.ok(point.geometry.coordinates[0] > 1_000_000);
  const line = exchange.features.find((feature) => feature.type === 'MultiLineString');
  assert.equal(line.geometry.coordinates.length, 2);
  const polygon = exchange.features.find((feature) => feature.type === 'Polygon');
  assert.equal(polygon.geometry.coordinates.length, 1);

  const imported = importCoordinateExchange(exportCoordinateExchangeJson(data, crs));
  assert.equal(imported.crs.id, crs.id);
  assert.equal(imported.featureCount, 3);
  assert.equal(imported.data.tracks[0].segments.length, 2);
  assert.equal(imported.data.tracks[0].samples[0][0].altitude, 512.5);
  assert.equal(imported.data.areas.length, 1);
  assert.equal(imported.data.annotations[0].name, '控制点,东');
  assert.ok(Math.abs(imported.data.tracks[0].segments[0][0][0] - 104.066) < 1e-8);
});

test('exchange CSV is explicitly labeled and reconstructs feature parts and quoted fields', () => {
  const data = fixture();
  const csv = exportCoordinateExchangeCsv(data, createCgcs2000Gauss3ByZone(35));
  assert.match(csv, /^# 山兔工程坐标交换 CSV v1\r\n# CRS_JSON=/);
  assert.match(csv, /featureID,name,type,part,vertex,x,y,z,propertiesJSON/);
  assert.match(csv, /"控制点,东"/);
  const imported = importCoordinateExchange(csv);
  assert.equal(imported.featureCount, 3);
  assert.equal(imported.data.tracks[0].segments.length, 2);
  assert.equal(imported.data.areas.length, 1);
});

test('imports require explicit CRS metadata and reject unsupported extra polygon rings', () => {
  assert.throws(() => importCoordinateExchange(JSON.stringify({ schema: 'shantu-coordinate-exchange', version: 1, features: [] })), /CRS/);
  const data = fixture();
  const exchange = createCoordinateExchange(data, 'EPSG:4326');
  const area = exchange.features.find((feature) => feature.type === 'Polygon');
  area.geometry.coordinates.push(area.geometry.coordinates[0]);
  assert.throws(() => importCoordinateExchange(JSON.stringify(exchange)), /多环对象不会被静默裁掉/);
});
