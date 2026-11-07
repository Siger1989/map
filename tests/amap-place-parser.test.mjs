import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIncomingPlace } from '../modules/incomingPlace/parser.ts';

function link(payload = 'BSYNTHETIC01,39.915,116.404,合成测试入口,合成地址', extra = '') {
  return `https://m.amap.com/poi/detail?__p=${encodeURIComponent(payload)}${extra}`;
}

test('AMap mobile POI share directly names one point and converts GCJ02 lat-lon to WGS84', () => {
  const result = parseIncomingPlace(`合成地点\n${link(undefined, '&poiid=BSYNTHETIC01&src=app_share&userRelationToken=SYNTHETIC_TRACKING')}`);
  assert.equal(result.kind, 'place');
  if (result.kind !== 'place') return;
  assert.equal(result.format, 'amap-poi');
  assert.equal(result.inputDatum, 'GCJ-02');
  assert.equal(result.place.name, '合成测试入口');
  assert.equal(result.place.detail, '合成地址');
  assert.equal(result.place.coordinateSystem, 'WGS84');
  assert.ok(Math.abs(result.place.coordinates[0] - 116.39775550083061) < 1e-9);
  assert.ok(Math.abs(result.place.coordinates[1] - 39.91359571849836) < 1e-9);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_TRACKING'), false);
});

test('AMap accepts the known exact origin only and never guesses from IDs or view centers', () => {
  for (const input of [
    link().replace('https:', 'http:'), link().replace('m.amap.com', 'm.amap.com.evil.test'),
    link().replace('m.amap.com', 'user@m.amap.com'), link().replace('m.amap.com', 'm.amap.com:444'),
    link().replace('/poi/detail', '/poi/detail/extra'), `${link()}#fragment`,
    'https://m.amap.com/poi/detail?poiid=BSYNTHETIC01&center=116.404,39.915',
  ]) assert.equal(parseIncomingPlace(input).kind, 'unsupported', input);
});

test('AMap rejects duplicate, incomplete, invalid and competing coordinates and IDs', () => {
  for (const input of [
    link('BSYNTHETIC01,39.915,116.404,Only a name'),
    link('BSYNTHETIC01,91,116.404,Name,Address'),
    link('BSYNTHETIC01,116.404,39.915,Name,Address'),
    link('BSYNTHETIC01,39.915,181,Name,Address'),
    link('BSYNTHETIC01,39.915,116.404,,Address'),
    link(undefined, '&__p=BSYNTHETIC02,40,117,Other,Address'),
    link(undefined, '&poiid=BSYNTHETIC02'),
    link(undefined, '&poiid=BSYNTHETIC01&poiid=BSYNTHETIC01'),
    link(undefined, '&position=117,40'),
    link(undefined, '&coordinate=wgs84'),
    `${link()} https://www.google.com/maps?q=1,2`, `${link()} geo:10,20`, `${link()} http://example.test/other`,
  ]) assert.equal(parseIncomingPlace(input).kind, 'unsupported', input);
});
