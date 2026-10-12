import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTiandituSearchURL,
  normalizeTiandituPlaces,
} from '../modules/navigation/tiandituSearch.ts';

test('builds HTTPS v2 nationwide place-name search with bounded twenty-result pages', () => {
  const url = new URL(buildTiandituSearchURL(' 四姑娘山 ', 'test-key'));
  assert.equal(url.origin, 'https://api.tianditu.gov.cn');
  assert.equal(url.pathname, '/v2/search');
  assert.equal(url.searchParams.get('type'), 'query');
  assert.equal(url.searchParams.get('tk'), 'test-key');
  assert.deepEqual(JSON.parse(url.searchParams.get('postStr')), {
    keyWord: '四姑娘山',
    level: 12,
    mapBound: '73,3,136,54',
    queryType: 1,
    start: 0,
    count: 20,
    show: 2,
  });
  assert.throws(() => buildTiandituSearchURL('  ', 'test-key'), /搜索内容/);
  assert.throws(() => buildTiandituSearchURL('公园', ' '), /尚未配置授权/);
});

test('normalizes named POIs in longitude,latitude order and keeps address detail', () => {
  const result = normalizeTiandituPlaces({
    status: { infocode: 1000, cndesc: '服务正常' },
    resultType: 1,
    pois: [
      { name: ' 四姑娘山 ', lonlat: '102.902002,31.11225', address: '四川省小金县' },
      { name: '无地址地名', lonlat: '104,30', address: '' },
    ],
  });
  assert.deepEqual(result.map(({ source, precision, ...place }) => place), [
    { name: '四姑娘山', coordinates: [102.902002, 31.11225], detail: '四川省小金县' },
    { name: '无地址地名', coordinates: [104, 30] },
  ]);
});

test('filters invalid coordinates and deduplicates within a twenty-result page', () => {
  const pois = [
    { name: '重复', lonlat: '104,30' },
    { name: '重复', lonlat: '104,30' },
    { name: '空坐标', lonlat: '' },
    { name: '非数值', lonlat: 'abc,30' },
    { name: '越界', lonlat: '181,30' },
    { name: '空名称', lonlat: '104,30' },
    ...Array.from({ length: 350 }, (_, i) => ({ name: `地名${i}`, lonlat: `${100 + i / 100},30` })),
  ];
  pois[5].name = '   ';
  const result = normalizeTiandituPlaces({ status: { infocode: 1000 }, resultType: 1, pois });
  assert.equal(result.length, 20);
  assert.equal(result[0].coordinates[0], 104);
  assert.match(result.at(-1).name, /18$/);
});

test('keeps a relevant place-name candidate after the former ten-result cutoff and labels its locality', () => {
  const pois = Array.from({ length: 14 }, (_, i) => ({
    name: '牛背山',
    lonlat: `${100 + i / 100},30`,
    province: '四川省',
    city: '其他市',
    county: `其他县${i}`,
  }));
  pois.push({
    name: '牛背山',
    lonlat: '102.298825,29.209062',
    province: '四川省',
    city: '雅安市',
    county: '石棉县',
  });
  const result = normalizeTiandituPlaces({
    status: { infocode: 1000 },
    resultType: 1,
    pois,
  });
  assert.equal(result.length, 15);
  const { source, precision, ...target } = result[14];
  assert.deepEqual(target, {
    name: '牛背山',
    coordinates: [102.298825, 29.209062],
    detail: '四川省 · 雅安市 · 石棉县',
  });
});

test('combines locality and specific address while removing repeated locality text', () => {
  const result = normalizeTiandituPlaces({
    status: { infocode: 1000 },
    resultType: 1,
    pois: [
      {
        name: '牛背山',
        lonlat: '102.298825,29.209062',
        province: '四川省',
        city: '雅安市',
        county: '石棉县',
        address: '四川省雅安市石棉县新棉镇牛背山景区入口',
      },
      {
        name: '另一地名',
        lonlat: '102.3,29.2',
        province: '四川省',
        city: '雅安市',
        county: '雅安市',
        address: '雅安市 · 四川省 · 景区路 12 号',
      },
    ],
  });
  assert.equal(result[0].detail, '四川省 · 雅安市 · 石棉县 · 新棉镇牛背山景区入口');
  assert.equal(result[1].detail, '四川省 · 雅安市 · 景区路 12 号');
  assert.ok(result[0].detail.length <= 240);
});

test('caps combined locality and address detail at 240 characters', () => {
  const [place] = normalizeTiandituPlaces({
    status: { infocode: 1000 },
    resultType: 1,
    pois: [{
      name: '长地址',
      lonlat: '104,30',
      province: '四川省',
      city: '成都市',
      county: '武侯区',
      address: '具体位置'.repeat(100),
    }],
  });
  assert.equal(place.detail.length, 240);
});

test('filters administrative centres and other non-point results out of selectable POIs', () => {
  assert.deepEqual(normalizeTiandituPlaces({ status: { infocode: 3001 } }), []);
  assert.deepEqual(normalizeTiandituPlaces({ status: { infocode: 1000 }, pois: [] }), []);
  assert.deepEqual(
    normalizeTiandituPlaces({
      status: { infocode: 1000 },
      resultType: 3,
      area: { name: '成都市', lonlat: '104.062269,30.661123' },
    }),
    [],
  );
  assert.deepEqual(
    normalizeTiandituPlaces({ status: { infocode: 1000 }, resultType: 3, area: [{ name: '四川省', lonlat: '102,30' }] }),
    [],
  );
  assert.deepEqual(
    normalizeTiandituPlaces({ status: { infocode: 1000 }, resultType: 3, area: { name: '成都市' } }),
    [],
  );
  assert.deepEqual(
    normalizeTiandituPlaces({ status: { infocode: 1000 }, resultType: 2, statistics: { lonlat: '104,30' } }),
    [],
  );
  assert.deepEqual(
    normalizeTiandituPlaces({ status: { infocode: 1000 }, resultType: 4, prompt: { lonlat: '104,30' } }),
    [],
  );
});

test('throws a generic authorization/service error without echoing key or URL', () => {
  const secret = 'unique-test-secret';
  const url = buildTiandituSearchURL('成都', secret);
  assert.ok(url.includes(secret));
  assert.throws(
    () => normalizeTiandituPlaces({ status: { infocode: 1001, cndesc: `bad ${secret}` } }),
    (error) => {
      assert.match(error.message, /天地图搜索不可用/);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(url), false);
      return true;
    },
  );
  assert.throws(() => normalizeTiandituPlaces({ status: { infocode: 2001 } }), /天地图搜索不可用/);
  assert.throws(() => normalizeTiandituPlaces(null), /响应格式异常/);
});

test('injected search pipeline handles explicit selection, ranking, abort, and auto fallback without real network', async () => {
  const { createPlaceSearcher } = await import('../modules/navigation/placeSearch.ts');
  const key = 'integrationtestkey012345678901';
  const urls = [];
  let payload = { status: { infocode: 1000 }, resultType: 1, pois: [] };
  const searcher = createPlaceSearcher({
    getConfig: () => ({ domestic: true, token: key }),
    fetch: async (url, init) => {
      urls.push({ url: String(url), signal: init.signal });
      if (String(url).includes('photon.komoot.io')) {
        return new Response(JSON.stringify({ features: [{
          geometry: { coordinates: [104.066, 30.659] },
          properties: { name: 'Photon fallback', city: '成都' },
        }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    minIntervalMs: 0,
  });

  const empty = await searcher.searchPlacesDetailed('explicit query', [104, 30], new AbortController().signal, 'tianditu');
  assert.deepEqual(empty.places, []);
  assert.equal(urls.length, 2);
  assert.ok(urls.every(({ url }) => url.includes('api.tianditu.gov.cn')));
  assert.match(urls[0].url, /^https:\/\/api\.tianditu\.gov\.cn\/v2\/search/);

  payload = { status: { infocode: 1000 }, resultType: 1, pois: [
    { name: 'far', lonlat: '110,35' },
    { name: 'near', lonlat: '104.001,30.001' },
    { name: 'middle', lonlat: '105,31' },
  ] };
  const ranked = await searcher.searchPlacesDetailed('ranking query', [104, 30], new AbortController().signal, 'tianditu');
  assert.deepEqual(ranked.places.map((place) => place.name), ['near', 'middle', 'far']);

  const controller = new AbortController();
  controller.abort(new DOMException('test abort', 'AbortError'));
  const beforeAbort = urls.length;
  await assert.rejects(searcher.searchPlacesDetailed('abort query', [104, 30], controller.signal, 'tianditu'));
  assert.equal(urls.length, beforeAbort);

  payload = { status: { infocode: 3001 }, pois: [] };
  const fallback = await searcher.searchPlacesDetailed('fallback query', [104, 30], new AbortController().signal);
  assert.deepEqual(fallback.places.map((place) => place.name), ['Photon fallback']);
  assert.equal(urls.filter(({ url }) => url.includes('photon.komoot.io')).length, 1);
  assert.ok(urls.every(({ signal }) => signal instanceof AbortSignal));
});
