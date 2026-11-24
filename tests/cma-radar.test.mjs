import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadarRequestUrl, normalizeRadarDirectory, parseBeijingRadarTime } from '../modules/weather/cmaRadar.ts';
import { GET as radarRoute } from '../app/api/radar/route.ts';

function row(id, vshijian = '20261006000000', overrides = {}) {
  return {
    id, dataCode: 'RAD__B0_CR', vshijian,
    cfname: 'Z_RADA_C_BABJ_20261005160701_P_DOR_ACHN_CREF_20261005_160000.png',
    fileURL: 'http://image.data.cma.cn/vis/RAD__B0_CR/20261005/Z_RADA_C_BABJ_20261005160701_P_DOR_ACHN_CREF_20261005_160000.png',
    ...overrides,
  };
}

test('CMA Beijing time becomes UTC ISO without shifting the observation instant', () => {
  assert.equal(parseBeijingRadarTime('20261006000000'), '2026-10-05T16:00:00.000Z');
  assert.equal(parseBeijingRadarTime('20260230000000'), null);
});

test('normalizes official directory records and retains dBZ observation metadata', () => {
  // Mirrors the official getVasData response, including its string code and record keys.
  const result = normalizeRadarDirectory({ code: '200', data: { data: [row('abc_1'), row('abc_2', '20261006000600')] } }, '20261006', Date.parse('2026-10-06T00:20:00Z'));
  assert.equal(result.unit, 'dBZ');
  assert.equal(result.product, '全国雷达拼图 · 组合反射率');
  assert.equal(result.latestAt, '2026-10-05T16:06:00.000Z');
  assert.equal(result.frames[0].imagePath, '/api/radar?date=20261006&frame=abc_2');
});

test('rejects untrusted URLs, invalid ids, future frames and malformed responses', () => {
  const result = normalizeRadarDirectory({ code: 200, data: { data: [
    row('bad', '20261006000000', { fileURL: 'https://attacker.example/a.png' }),
    row('bad id'), row('future', '20261007000000'),
  ] } }, '20261006', Date.parse('2026-10-06T00:20:00Z'));
  assert.deepEqual(result.frames, []);
  assert.throws(() => normalizeRadarDirectory({ code: 403 }, '20261006'));
  assert.throws(() => buildRadarRequestUrl('20261006', '../image'));
  assert.throws(() => buildRadarRequestUrl('20260230'));
});

test('the retired radar endpoint responds locally for all old requests', () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('a retired endpoint must not contact providers');
  try {
    for (const query of ['', '?date=20261006', '?date=20261006&frame=abc_2']) {
      assert.equal(radarRoute(new Request('http://localhost/api/radar' + query)).status, 410);
    }
  } finally { globalThis.fetch = original; }
});
