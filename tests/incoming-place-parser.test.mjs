import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIncomingPlace } from '../modules/incomingPlace/parser.ts';

test('RFC 5870 geo URI defaults to WGS84 and keeps latitude-first order', () => {
  const result = parseIncomingPlace('geo:39.915,116.404;crs=wgs84;u=20');
  assert.equal(result.kind, 'place');
  if (result.kind !== 'place') return;
  assert.equal(result.inputDatum, 'WGS84');
  assert.deepEqual(result.place.coordinates, [116.404, 39.915]);
  assert.equal(result.place.coordinateSystem, 'WGS84');
});

test('Android geo query coordinates override the conventional 0,0 search origin', () => {
  const result = parseIncomingPlace('geo:0,0?q=30.67,104.06(成都某地)');
  assert.equal(result.kind, 'place');
  if (result.kind !== 'place') return;
  assert.deepEqual(result.place.coordinates, [104.06, 30.67]);
  assert.equal(result.place.name, '成都某地');
  assert.equal(result.inputDatum, 'WGS84');
});

test('geo name search at 0,0 is unsupported but bare geo:0,0 remains a real coordinate', () => {
  assert.equal(parseIncomingPlace('geo:0,0?q=某地').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:0,0?q=30.67,104.06').kind, 'place');
  const explicitZero = parseIncomingPlace('geo:0,0');
  assert.equal(explicitZero.kind, 'place');
  if (explicitZero.kind === 'place') assert.deepEqual(explicitZero.place.coordinates, [0, 0]);
});

test('geo query coordinate must be unique, valid, and unambiguous', () => {
  assert.equal(parseIncomingPlace('geo:0,0?q=30.67,104.06&q=31,105').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:0,0?q=91,104.06').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:0,0?q=30.67,104.06 extra').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:0,0?q=30.67,104.06&z=14').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:91,0?q=30,104').kind, 'unsupported');
});

test('a balanced Android coordinate label survives punctuation trimming', () => {
  const result = parseIncomingPlace('收到位置 geo:0,0?q=30.67,104.06(成都) 。');
  assert.equal(result.kind, 'place');
  if (result.kind === 'place') assert.equal(result.place.name, '成都');
});

test('Tencent official marker link defaults to GCJ-02 and converts to WGS84', () => {
  const result = parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?marker=coord:39.915,116.404;title:测试地点;addr:测试地址&referer=shantu');
  assert.equal(result.kind, 'place');
  if (result.kind !== 'place') return;
  assert.equal(result.inputDatum, 'GCJ-02');
  assert.equal(result.format, 'tencent-marker');
  assert.equal(result.place.name, '测试地点');
  assert.equal(result.place.detail, '测试地址');
  assert.ok(Math.abs(result.place.coordinates[0] - 116.39775550083061) < 1e-9);
  assert.ok(Math.abs(result.place.coordinates[1] - 39.91359571849836) < 1e-9);
  assert.equal(result.place.coordinateSystem, 'WGS84');
});

test('Tencent coord_type=1 is GPS/WGS84 and can arrive in a text share', () => {
  const result = parseIncomingPlace('地点：\nhttps://apis.map.qq.com/uri/v1/marker?coord_type=1&marker=coord:39.915,116.404;title:入口');
  assert.equal(result.kind, 'place');
  if (result.kind !== 'place') return;
  assert.equal(result.inputDatum, 'WGS84');
  assert.deepEqual(result.place.coordinates, [116.404, 39.915]);
});

test('rejects unsupported geo CRS and invalid/out-of-range coordinates', () => {
  assert.equal(parseIncomingPlace('geo:39,116;crs=bd09').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:91,116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:39,181').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:nan,116').kind, 'unsupported');
});

test('does not guess from names, unrelated URLs, Tencent short links, or multiple markers', () => {
  assert.equal(parseIncomingPlace('北京天安门').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://example.com/place?lat=39&lng=116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://map.qq.com/short/abc').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com.evil/uri/v1/marker?marker=coord:39,116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?marker=coord:39,116;title:AImarker=coord:40,117').kind, 'unsupported');
  assert.equal(parseIncomingPlace('geo:39,116?coord_type=2').kind, 'unsupported');
  assert.equal(parseIncomingPlace(`geo:39,116 ${'x'.repeat(8192)}`).kind, 'unsupported');
});

test('rejects conflicting place references and unknown Tencent coordinate types', () => {
  assert.equal(parseIncomingPlace('geo:39,116 https://apis.map.qq.com/uri/v1/marker?marker=coord:39,116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?coord_type=3&marker=coord:39,116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?coord_type=1&coord_type=2&marker=coord:39,116').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?marker=coord:39,116;coord:40,117').kind, 'unsupported');
  assert.equal(parseIncomingPlace('https://apis.map.qq.com/uri/v1/marker?marker=coord:39,116Icoord:40,117').kind, 'unsupported');
});
