import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMapConfig } from '../modules/mapSources/online.ts';
import { parseOviQr } from '../modules/mapSources/oviQr.ts';

const encoder = new TextEncoder();
const base64 = (value) => Buffer.from(encoder.encode(value)).toString('base64');

function qr(overrides = {}) {
  const fields = {
    t: '37',
    id: '123',
    na: '8J+SqQ==', // UTF-8 emoji whose standard Base64 includes a literal plus.
    gp: base64('谷歌'),
    po: '1',
    ml: '20',
    pn: '1',
    mt: '1',
    mf: '3',
    pt: '443',
    hn: base64('tiles.example.invalid'),
    ul: base64('/{$z}/{$x}/{$y}.png?token=a+b'),
    ...overrides,
  };
  return `ovobj?${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('&')}`;
}

test('parses a sampled OVI t37 raster profile through the regular config path', () => {
  const draft = parseMapConfig(qr())[0];
  assert.equal(draft.name, '💩');
  assert.equal(draft.format, 'OVMAP');
  assert.equal(draft.maxzoom, 20);
  assert.equal(draft.minzoom, 0);
  assert.equal(draft.tileSize, 256);
  assert.equal(draft.datum, 'gcj02');
  assert.equal(draft.ovmap.coordType, 1);
  assert.equal(draft.ovmap.layers.length, 1);
  assert.match(draft.tiles[0], /token=a\+b$/);
  assert.match(draft.detail, /谷歌/);
});

test('preserves the declared WGS84 profile and accepts standard Base64 plus signs', () => {
  const draft = parseOviQr(qr({ id: '124', pn: '0', pt: '80' }));
  assert.equal(draft.datum, 'wgs84');
  assert.equal(draft.ovmap.coordType, 0);
  assert.equal(new URL(draft.tiles[0]).protocol, 'http:');
  assert.match(draft.tiles[0], /token=a\+b$/);
});

test('imports bounded JSON arrays of OVI payload strings atomically', () => {
  const drafts = parseMapConfig(JSON.stringify([qr(), qr({ id: '125', pn: '0' })]));
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts.map((draft) => draft.ovmap.sourceId), [123, 125]);
  assert.throws(
    () => parseMapConfig(JSON.stringify([qr(), qr({ id: '126', po: '3' })])),
    /第 2 个二维码无法导入：.*历史专有/,
  );
});

test('rejects historical proprietary and unverified profile variants explicitly', () => {
  assert.throws(() => parseOviQr(qr({ po: '3' })), /历史专有/);
  assert.throws(() => parseOviQr(qr({ mf: '4' })), /栅格格式/);
  assert.throws(() => parseOviQr(qr({ mt: '2' })), /地图类型/);
  assert.throws(() => parseOviQr(qr({ pn: '2' })), /pn/);
  assert.throws(() => parseOviQr(qr({ at: '2', ad: 'private-payload', al: '49' })), /历史地图数据/);
  assert.throws(() => parseOviQr(qr({ future: 'unrecognized' })), /未支持字段/);
});

test('accepts declared zoom levels within the raster renderer range', () => {
  assert.equal(parseOviQr(qr({ ml: '12' })).maxzoom, 12);
  assert.equal(parseOviQr(qr({ ml: '24' })).maxzoom, 24);
  assert.throws(() => parseOviQr(qr({ ml: '25' })), /ml/);
});

test('rejects unsafe endpoints and unsupported tile templates without echoing their contents', () => {
  assert.throws(() => parseOviQr(qr({ hn: base64('user:pass@tiles.example.invalid') })), /主机名/);
  assert.throws(() => parseOviQr(qr({ pt: '8880' })), /端口/);
  assert.throws(() => parseOviQr(qr({ ul: base64('/static/tiles.png') })), /XYZ/);
  assert.throws(() => parseOviQr(qr({ ul: base64('/{$z}/{$x}/{$y}/{$Unknown}.png') })), /未支持的变量/);
  assert.throws(() => parseOviQr(qr({ ul: base64('/{$z}/{$x}/{$y}.png#fragment') })), /相对路径/);
});
