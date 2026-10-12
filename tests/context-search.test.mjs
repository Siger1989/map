import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSearcher } from '../modules/navigation/placeSearch.ts';
import {
  boundedMapSearch, exactContextAnchors, isContextAnchorCompletion,
  contextAnchorPrefixSuggestions, contextPlaceMatchesCity, parseContextAnchorPrefix, parseContextSearchQuery, withinContextRadius,
} from '../modules/navigation/contextSearch.ts';

const signal = () => new AbortController().signal;
test('city shorthand matches the actual administrative field rather than arbitrary address text', () => {
  assert.equal(contextPlaceMatchesCity({ detail: '四川省 · 成都市 · 双流区' }, '成都'), true);
  assert.equal(contextPlaceMatchesCity({ detail: '四川省 · 成都市 · 双流区' }, '成都市'), true);
  assert.equal(contextPlaceMatchesCity({ detail: '湖南省 · 衡阳市 · 成都路' }, '成都'), false);
});
const poi = (name, lonlat, city = '成都市') => ({ name, lonlat, city });
const tdt = (pois, count = pois.length) => ({
  json: async () => ({ status: { infocode: 1000 }, resultType: 1, count, pois }),
});
function service(fetch, extra = {}) {
  return createPlaceSearcher({
    fetch,
    getConfig: () => ({ domestic: true, token: 'test-key' }),
    minIntervalMs: 0,
    ...extra,
  });
}

test('recognizes only bounded two-token Chinese nearby forms and completion without an anchor request', async () => {
  assert.deepEqual(parseContextSearchQuery('财富中心 怡心湖'), { target: '财富中心', anchor: '怡心湖' });
  assert.equal(parseContextSearchQuery('New York Station'), null);
  assert.equal(parseContextSearchQuery('东原 晴天见'), null, 'ordinary split names stay intact unless the second token is an anchor suffix');
  assert.equal(parseContextSearchQuery('成都市 怡心湖'), null, 'a city-led address is not split into nearby intent');
  assert.equal(isContextAnchorCompletion('财富中心 怡'), true);
  assert.deepEqual(parseContextAnchorPrefix('财富中心 怡心'), { target: '财富中心', anchor: '怡心' });
  assert.equal(parseContextAnchorPrefix('成都市 怡心'), null, 'city-led address queries remain on the normal search path');

  let requests = 0;
  const result = await service(async () => { requests++; return tdt([]); })
    .searchPlacesDetailed('财富中心 怡', [104, 30], signal(), 'tianditu');
  assert.equal(requests, 0);
  assert.deepEqual(result.places, []);
  assert.match(result.warnings[0], /继续输入完整的参照地点/);
});

test('context search resolves a real anchor, uses a narrow target bound, and filters by anchor distance', async () => {
  const requests = [];
  const search = service(async (url) => {
    const post = JSON.parse(new URL(url).searchParams.get('postStr'));
    requests.push(post);
    if (post.keyWord === '怡心湖') return tdt([poi('怡心湖', '104,30')]);
    return tdt([
      poi('财富中心近点', '104.01,30'),
      poi('财富中心远点', '104.08,30'),
    ]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', [103.9, 30], signal(), 'tianditu');
  assert.deepEqual(requests.map((post) => post.keyWord), ['怡心湖', '财富中心']);
  assert.equal(requests[0].queryType, 2);
  assert.equal(requests[1].queryType, 2);
  const bound = requests[1].mapBound.split(',').map(Number);
  assert.ok(bound[0] > 103.9 && bound[2] < 104.1, 'target request is bounded around the returned anchor, not the map center/nationwide');
  assert.deepEqual(result.places.map((place) => place.name), ['财富中心近点']);
  assert.match(result.warnings[0], /按检索到的怡心湖参考点附近搜索财富中心/);
  assert.match(result.warnings[0], /不代表GPS/);
});

test('ambiguous anchors offer only real candidates and never query the target', async () => {
  let targetCalls = 0;
  const search = service(async (url) => {
    const keyword = JSON.parse(new URL(url).searchParams.get('postStr')).keyWord;
    if (keyword !== '怡心湖') { targetCalls++; return tdt([]); }
    return tdt([
      poi('怡心湖', '104,30', '成都市'),
      poi('怡心湖', '110,30', '武汉市'),
    ]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu');
  assert.equal(targetCalls, 0);
  assert.equal(result.places.length, 0);
  assert.equal(result.suggestions.length, 2);
  assert.deepEqual(result.suggestions.map((item) => item.city).sort(), ['成都市', '武汉市']);
  assert.ok(result.suggestions.every((item) => item.query === '财富中心 怡心湖'));
});

test('explicit city is applied to returned anchor details before matching, despite cross-city provider results', async () => {
  const requests = [];
  const search = service(async (url) => {
    const post = JSON.parse(new URL(url).searchParams.get('postStr'));
    requests.push(post);
    if (post.keyWord === '怡心湖') return tdt([
      poi('怡心湖', '104,30', '成都市'),
      poi('怡心湖', '112,29', '衡阳市'),
      poi('怡心湖', '114,23', '深圳市'),
    ]);
    return tdt([poi('财富中心', '104.01,30', '成都市')]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu', { city: '成都市' });
  assert.equal(requests[0].queryType, 1, 'city-qualified anchor lookups use the city-aware query type');
  assert.equal(requests[0].specify, '成都市');
  assert.equal(requests[1].keyWord, '财富中心');
  assert.equal(result.places[0].coordinates[0], 104.01);
  assert.equal(contextPlaceMatchesCity({ name: '怡心湖', coordinates: [112, 29], detail: '衡阳市' }, '成都市'), false);
});

test('same-city exact anchors do not offer a city-only suggestion loop', async () => {
  let targetCalls = 0;
  const search = service(async (url) => {
    const keyword = JSON.parse(new URL(url).searchParams.get('postStr')).keyWord;
    if (keyword !== '怡心湖') { targetCalls++; return tdt([]); }
    return tdt([poi('怡心湖', '104,30', '成都市'), poi('怡心湖', '104.02,30', '成都市')]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu');
  assert.equal(targetCalls, 0);
  assert.deepEqual(result.suggestions, []);
  assert.match(result.warnings[0], /补充更具体的地标或入口名称/);
});

test('non-exact anchor candidates suggest the real candidate name in the compound query', async () => {
  const search = service(async () => tdt([poi('怡心湖公园', '104,30')]));
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu');
  assert.equal(result.suggestions[0].query, '财富中心 怡心湖公园');
});

test('a unique exact anchor remains usable even when nearby POIs have more pages', async () => {
  const requests = [];
  const search = service(async (url) => {
    const post = JSON.parse(new URL(url).searchParams.get('postStr'));
    requests.push(post);
    if (post.keyWord === '怡心湖') return tdt([poi('怡心湖', '104,30')], 35);
    return tdt([poi('财富中心', '104.01,30')]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu');
  assert.equal(requests.length, 2, 'fetch only one anchor page and one target page');
  assert.equal(requests[1].keyWord, '财富中心');
  assert.equal(result.places[0].name, '财富中心');
  assert.match(result.warnings.join(' '), /参考点/);
  assert.match(result.warnings.join(' '), /入口请在地图核对/);
});

test('two-character anchor prefixes return only matching real anchor suggestions in one request', async () => {
  let requests = 0;
  const search = service(async (url) => {
    requests++;
    const keyword = JSON.parse(new URL(url).searchParams.get('postStr')).keyWord;
    assert.equal(keyword, '怡心');
    return tdt([
      poi('怡心湖', '104,30'),
      poi('怡心公园', '104.01,30'),
      poi('其他湖', '104.02,30'),
    ]);
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心', null, signal(), 'tianditu');
  assert.equal(requests, 1);
  assert.deepEqual(result.places, []);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.query), ['财富中心 怡心湖', '财富中心 怡心公园']);
  assert.deepEqual(contextAnchorPrefixSuggestions([
    { name: '怡心湖', coordinates: [104, 30], detail: '四川省 · 成都市' },
    { name: '怡心湖', coordinates: [104.01, 30], detail: '四川省 · 成都市' },
  ], '财富中心', '怡心'), [{ label: '怡心湖附近', query: '财富中心 怡心湖', city: '成都市' }]);
});

test('offline anchor prefix suggestions use real matching cache entries', async () => {
  let networkCalls = 0;
  let cachedQuery;
  const search = service(async () => { networkCalls++; return tdt([]); }, {
    isOnline: () => false,
    readCache: (query) => {
      cachedQuery = query;
      return [{ name: '怡心湖', coordinates: [104, 30], detail: '四川省 · 成都市', source: 'offline', precision: 'poi' }];
    },
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心', null, signal(), 'auto');
  assert.equal(networkCalls, 0);
  assert.equal(cachedQuery, '怡心');
  assert.deepEqual(result.suggestions, [{ label: '怡心湖附近', query: '财富中心 怡心湖', city: '成都市' }]);
  assert.match(result.warnings[0], /离线缓存/);
});

test('context pagination retains the original query, target keyword, and bounded search area', async () => {
  const requests = [];
  const search = service(async (url) => {
    const post = JSON.parse(new URL(url).searchParams.get('postStr'));
    requests.push(post);
    if (post.keyWord === '怡心湖') return tdt([poi('怡心湖', '104,30')]);
    return tdt(Array.from({ length: 20 }, (_, i) => poi(`财富中心${post.start + i}`, `104.${String(i + 1).padStart(2, '0')},30`)), 60);
  });
  const first = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu');
  assert.equal(first.next.query, '财富中心 怡心湖');
  assert.equal(first.next.searchQuery, '财富中心');
  const second = await search.searchPlacesDetailed('财富中心 怡心湖', null, signal(), 'tianditu', { page: first.next });
  assert.equal(requests[2].keyWord, '财富中心');
  assert.equal(requests[2].start, 20);
  assert.equal(requests[2].mapBound, requests[1].mapBound);
  assert.equal(second.next.searchQuery, '财富中心');
  assert.deepEqual(boundedMapSearch([104, 30]), requests[1].mapBound);
});

test('offline and failed-network cache results retain POI precision and respect explicit source', async () => {
  const cached = [{ name: '财富中心', coordinates: [104, 30], source: 'offline', precision: 'poi', detail: '本机缓存' }];
  let requestedSource;
  const offline = service(async () => { throw new Error('must not call network'); }, {
    isOnline: () => false,
    readCache: (_query, source) => { requestedSource = source; return cached; },
    offlineSearch: async () => { throw new Error('cache should win'); },
  });
  const offlineResult = await offline.searchPlacesDetailed('财富中心', null, signal(), 'tianditu');
  assert.equal(requestedSource, 'tianditu');
  assert.equal(offlineResult.places[0].precision, 'poi');
  assert.match(offlineResult.warnings[0], /离线缓存，可能已过期/);

  const failed = service(async () => { throw new TypeError('offline network'); }, {
    isOnline: () => true,
    readCache: (_query, source) => { assert.equal(source, 'photon'); return cached; },
  });
  const fallback = await failed.searchPlacesDetailed('财富中心', null, signal(), 'photon');
  assert.equal(fallback.places[0].precision, 'poi');
  assert.match(fallback.warnings[0], /离线缓存，可能已过期/);
});

test('offline contextual search without a compound cache does not claim route-network results are nearby', async () => {
  let networkCalls = 0;
  let roadSearchCalls = 0;
  const search = service(async () => { networkCalls++; return tdt([]); }, {
    isOnline: () => false,
    readCache: () => [],
    offlineSearch: async () => { roadSearchCalls++; return [{ name: '财富中心路', coordinates: [104, 30] }]; },
  });
  const result = await search.searchPlacesDetailed('财富中心 怡心湖', [104, 30], signal(), 'tianditu');
  assert.equal(networkCalls, 0);
  assert.equal(roadSearchCalls, 0);
  assert.deepEqual(result.places, []);
  assert.match(result.warnings[0], /离线且未缓存/);
});

test('radius filtering uses anchor coordinates and exact anchor matching does not fabricate places', () => {
  const places = [
    { name: '财富中心', coordinates: [104.01, 30] },
    { name: '财富中心', coordinates: [104.1, 30] },
  ];
  assert.equal(withinContextRadius(places, [104, 30]).length, 1);
  assert.equal(exactContextAnchors(places, '怡心湖').length, 0);
});
