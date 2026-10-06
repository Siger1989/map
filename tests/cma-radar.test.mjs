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

function observedFixture() {
  const observed = new Date(Date.now() - 10 * 60_000);
  const beijing = new Date(observed.getTime() + 8 * 60 * 60_000);
  const part = (n) => String(n).padStart(2, '0');
  const date = `${beijing.getUTCFullYear()}${part(beijing.getUTCMonth() + 1)}${part(beijing.getUTCDate())}`;
  const time = `${date}${part(beijing.getUTCHours())}${part(beijing.getUTCMinutes())}${part(beijing.getUTCSeconds())}`;
  const utcDate = `${observed.getUTCFullYear()}${part(observed.getUTCMonth() + 1)}${part(observed.getUTCDate())}`;
  const name = `Z_RADA_C_BABJ_${utcDate}120000_P_DOR_ACHN_CREF_${utcDate}_000000.png`;
  return { date, time, name, imageUrl: `http://image.data.cma.cn/vis/RAD__B0_CR/${utcDate}/${name}` };
}

test('radar route rejects empty, repeated and unknown query parameters without upstream calls', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  try {
    for (const query of ['?date=', '?frame=', '?date=20261006&date=20261006', '?frame=a&frame=b', '?url=https://evil.test']) {
      const result = await radarRoute(new Request(`http://localhost/api/radar${query}`));
      assert.equal(result.status, 400, query);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test('radar image route binds IDs to the validated duplicate-safe HTTPS official record', async () => {
  const fixture = observedFixture();
  const valid = {
    id: 'same_id', dataCode: 'RAD__B0_CR', vshijian: fixture.time,
    cfname: fixture.name, fileURL: fixture.imageUrl,
  };
  const rows = [valid, { ...valid, fileURL: 'http://evil.example/replacement.png' }];
  const png = Uint8Array.from([137,80,78,71,13,10,26,10]);
  const oldFetch = globalThis.fetch;
  let directoryRequests = 0, imageRequests = 0, imageReferer = '', imageProtocol = '';
  globalThis.fetch = async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input));
    if (requestUrl.hostname === 'data.cma.cn') {
      directoryRequests++;
      return new Response(JSON.stringify({ code: '200', data: { data: rows } }), { headers: { 'Content-Type': 'application/json' } });
    }
    imageRequests++;
    imageReferer = new Headers(init?.headers).get('Referer') ?? '';
    imageProtocol = requestUrl.protocol;
    assert.equal(requestUrl.hostname, 'image.data.cma.cn');
    return new Response(png, { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try {
    const result = await radarRoute(new Request(`http://localhost/api/radar?date=${fixture.date}&frame=same_id`));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'image/png');
    assert.equal(directoryRequests, 1);
    assert.equal(imageRequests, 1);
    assert.equal(imageProtocol, 'https:');
    assert.equal(imageReferer, 'https://data.cma.cn/');
    assert.deepEqual([...new Uint8Array(await result.arrayBuffer())], [...png]);
  } finally { globalThis.fetch = oldFetch; }
});

test('server directory cache remains bounded to three distinct dates', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ code: '200', data: { data: [] } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const date of ['20260101', '20260102', '20260103', '20260104']) {
      const response = await radarRoute(new Request(`http://localhost/api/radar?date=${date}`));
      assert.equal(response.status, 200);
    }
    assert.equal(calls, 4);
    const evicted = await radarRoute(new Request('http://localhost/api/radar?date=20260101'));
    assert.equal(evicted.status, 200);
    assert.equal(calls, 5);
  } finally { globalThis.fetch = oldFetch; }
});
