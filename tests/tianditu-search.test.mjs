import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTiandituSearchURL,
  normalizeTiandituPlaces,
} from '../modules/navigation/tiandituSearch.ts';

test('builds HTTPS v2 nationwide place-name search with detailed locality fields', () => {
  const url = new URL(buildTiandituSearchURL(' 四姑娘山 ', 'test-key'));
  assert.equal(url.origin, 'https://api.tianditu.gov.cn');
  assert.equal(url.pathname, '/v2/search');
  assert.equal(url.searchParams.get('type'), 'query');
  assert.equal(url.searchParams.get('tk'), 'test-key');
  assert.deepEqual(JSON.parse(url.searchParams.get('postStr')), {
    keyWord: '四姑娘山',
    level: 12,
    mapBound: '73,3,136,54',
    queryType: 7,
    start: 0,
    count: 300,
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
  assert.deepEqual(result, [
    { name: '四姑娘山', coordinates: [102.902002, 31.11225], detail: '四川省小金县' },
    { name: '无地址地名', coordinates: [104, 30] },
  ]);
});

test('filters invalid coordinates, deduplicates, and retains results through rank three hundred', () => {
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
  assert.equal(result.length, 300);
  assert.deepEqual(result[0], { name: '重复', coordinates: [104, 30] });
  assert.equal(result.at(-1).name, '地名298');
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
  assert.deepEqual(result[14], {
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

test('maps an explicitly returned administrative centre and ignores other non-point results', () => {
  assert.deepEqual(normalizeTiandituPlaces({ status: { infocode: 3001 } }), []);
  assert.deepEqual(normalizeTiandituPlaces({ status: { infocode: 1000 }, pois: [] }), []);
  assert.deepEqual(
    normalizeTiandituPlaces({
      status: { infocode: 1000 },
      resultType: 3,
      area: { name: '成都市', lonlat: '104.062269,30.661123' },
    }),
    [{ name: '成都市', coordinates: [104.062269, 30.661123], detail: '行政区中心' }],
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

test('searchPlaces honors explicit TianDiTu selection and handles abort/key errors without fallback', async () => {
  const { searchPlaces } = await import('../modules/navigation/provider.ts');
  const oldKey = process.env.NEXT_PUBLIC_TIANDITU_KEY;
  const oldFetch = globalThis.fetch;
  const key = 'integrationtestkey012345678901';
  const urls = [];
  process.env.NEXT_PUBLIC_TIANDITU_KEY = key;
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    assert.match(url, /^https:\/\/api\.tianditu\.gov\.cn\/v2\/search/);
    const params = new URL(url).searchParams;
    assert.deepEqual(JSON.parse(params.get('postStr')), {
      keyWord: '显式TDT集成唯一查询',
      level: 12,
      mapBound: '73,3,136,54',
      queryType: 7,
      start: 0,
      count: 300,
      show: 2,
    });
    return new Response(JSON.stringify({
      status: { infocode: 1000 },
      resultType: 1,
      pois: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const explicit = await searchPlaces(
      '显式TDT集成唯一查询', [104, 30], new AbortController().signal, 'tianditu',
    );
    assert.deepEqual(explicit, []);
    assert.equal(urls.length, 1);

    const aborted = new AbortController();
    aborted.abort(new DOMException('test abort', 'AbortError'));
    await assert.rejects(
      searchPlaces('取消查询唯一串', [104, 30], aborted.signal, 'tianditu'),
      /test abort/,
    );
    assert.equal(urls.length, 1);

    process.env.NEXT_PUBLIC_TIANDITU_KEY = '';
    await assert.rejects(
      searchPlaces('缺少密钥唯一查询', [104, 30], new AbortController().signal, 'tianditu'),
      /未配置天地图搜索密钥/,
    );
    assert.equal(urls.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_TIANDITU_KEY;
    else process.env.NEXT_PUBLIC_TIANDITU_KEY = oldKey;
  }
});

test('searchPlaces ranks the returned TianDiTu results by the supplied map center', async () => {
  const { searchPlaces } = await import('../modules/navigation/provider.ts');
  const oldKey = process.env.NEXT_PUBLIC_TIANDITU_KEY;
  const oldFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_TIANDITU_KEY = 'integrationtestkey012345678901';
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: { infocode: 1000 },
    resultType: 1,
    pois: [
      { name: '远处', lonlat: '110,35' },
      { name: '中心附近', lonlat: '104.001,30.001' },
      { name: '中间', lonlat: '105,31' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const results = await searchPlaces(
      '地图中心排序唯一查询', [104, 30], new AbortController().signal, 'tianditu',
    );
    assert.deepEqual(results.map((place) => place.name), ['中心附近', '中间', '远处']);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_TIANDITU_KEY;
    else process.env.NEXT_PUBLIC_TIANDITU_KEY = oldKey;
  }
});

test('default TianDiTu empty result falls back to Photon, while explicit TianDiTu does not', async () => {
  const { searchPlaces } = await import('../modules/navigation/provider.ts');
  const oldKey = process.env.NEXT_PUBLIC_TIANDITU_KEY;
  const oldFetch = globalThis.fetch;
  const key = 'integrationtestkey012345678901';
  const urls = [];
  process.env.NEXT_PUBLIC_TIANDITU_KEY = key;
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('api.tianditu.gov.cn')) {
      return new Response(JSON.stringify({ status: { infocode: 3001 }, pois: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    assert.match(url, /^https:\/\/photon\.komoot\.io\/api\//);
    return new Response(JSON.stringify({
      features: [{
        geometry: { coordinates: [104.066, 30.659] },
        properties: { name: 'Photon回退结果', city: '成都' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const results = await searchPlaces(
      '默认回退唯一查询', [104, 30], new AbortController().signal,
    );
    assert.deepEqual(results.map((place) => place.name), ['Photon回退结果']);
    assert.equal(urls.length, 2);
    assert.match(urls[0], /^https:\/\/api\.tianditu\.gov\.cn\/v2\/search/);
    assert.match(urls[1], /^https:\/\/photon\.komoot\.io\/api\//);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.NEXT_PUBLIC_TIANDITU_KEY;
    else process.env.NEXT_PUBLIC_TIANDITU_KEY = oldKey;
  }
});
