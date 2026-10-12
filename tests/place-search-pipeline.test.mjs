import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceSearcher, PlaceSearchError } from '../modules/navigation/placeSearch.ts';
import { normalizeTiandituGeocode } from '../modules/navigation/tiandituGeocoder.ts';
import { normalizeTiandituSuggestions } from '../modules/navigation/tiandituSearch.ts';

const point = (name, coordinates, properties = {}) => ({
  geometry: { coordinates },
  properties: { name, ...properties },
});
const photon = (features) => ({ json: async () => ({ features }) });
const tdt = (body) => ({ json: async () => body });
const responseFor = (url, data) =>
  url.includes('tianditu.gov.cn') ? tdt(data.tdt) : photon(data.photon);
const signal = () => new AbortController().signal;

test('address encoding does not duplicate a city already present in the full address', async () => {
  const requests = [];
  const service = createPlaceSearcher({
    getConfig: () => ({ domestic: true, token: 'test-key' }),
    minIntervalMs: 0,
    fetch: async (url) => {
      requests.push(JSON.parse(new URL(url).searchParams.get('ds')).keyWord);
      return tdt({status:'0',location:{lon:104,lat:30,level:'门址'}});
    },
  });
  await service.searchPlacesDetailed('四川省成都市公开路12号', null, signal(), 'tianditu', {city:'成都市'});
  await service.searchPlacesDetailed('公开路12号', null, signal(), 'tianditu', {city:'成都市'});
  assert.deepEqual(requests, ['四川省成都市公开路12号', '成都市 公开路12号']);
});

function searcher(fetch, { domestic = false, offlineSearch = async () => [] } = {}) {
  return createPlaceSearcher({
    fetch,
    getConfig: () => ({ domestic, token: domestic ? 'test-key' : '' }),
    offlineSearch,
    minIntervalMs: 0,
    now: () => 1_000,
  });
}

test('returns same-name matches from every city and sorts by distance without losing locality', async () => {
  const service = searcher(async () => photon([
    point('Central Park', [110, 35], { city: 'Northport', state: 'North State', type: 'park' }),
    point('Central Park', [104.001, 30.001], { city: 'Southport', state: 'South State', type: 'park' }),
    point('Central Park', [103, 29], { city: 'Westport', state: 'West State', type: 'park' }),
  ]));

  const { places } = await service.searchPlacesDetailed(
    'Central Park', [104, 30], signal(), 'photon',
  );
  assert.deepEqual(places.map((place) => place.detail), [
    'South State · Southport',
    'West State · Westport',
    'North State · Northport',
  ]);
  assert.deepEqual(places[0].coordinates, [104.001, 30.001]);
  assert.equal(places.length, 3);
});

test('keeps a street and house number when a Photon result has no name', async () => {
  const service = searcher(async () => photon([
    point(undefined, [104.05, 30.67], {
      street: 'Maple Avenue', housenumber: '42', city: 'Southport', type: 'house',
    }),
  ]));
  const { places } = await service.searchPlacesDetailed('42 Maple Avenue', null, signal(), 'photon');
  assert.equal(places[0].name, 'Maple Avenue 42');
  assert.equal(places[0].precision, 'address');
  assert.match(places[0].detail, /Maple Avenue 42/);
});

test('TianDiTu geocoder preserves the address query and marks only the documented door level as an address', () => {
  const query = '12 Maple Street';
  const door = normalizeTiandituGeocode({
    status: '0', location: { lon: 104.16575, lat: 30.61404, level: '\u95e8\u5740' },
  }, query)[0];
  assert.equal(door.name, query);
  assert.equal(door.precision, 'address');
  assert.equal(door.coordinateSystem, undefined);

  const coarse = normalizeTiandituGeocode({
    status: '0', location: { lon: 104.16575, lat: 30.61404, level: 'unrecognized-level' },
  }, query)[0];
  assert.equal(coarse.name, query);
  assert.equal(coarse.precision, 'unknown');
  assert.equal(coarse.coordinateSystem, undefined);
});

test('TianDiTu geocoder treats status 101 as no result and 404 as a service error', () => {
  assert.throws(() => normalizeTiandituGeocode({ status: '101' }, '12 Maple Street'), (error) =>
    error instanceof PlaceSearchError && error.category === 'noresult');
  assert.throws(() => normalizeTiandituGeocode({ status: '404' }, '12 Maple Street'), (error) =>
    error instanceof PlaceSearchError && error.category === 'service');
});

test('address search keeps the typed street and number without claiming undocumented coordinate precision', async () => {
  const urls = [];
  const service = searcher(async (url) => {
    urls.push(new URL(url));
    return { json: async () => ({
      status: '0', location: { lon: 104.16575, lat: 30.61404, level: 'unknown' },
    }) };
  }, { domestic: true });
  const query = '\u6d2a\u6cb3\u4e2d\u8def600';
  const result = await service.searchPlacesDetailed(query, null, signal(), 'tianditu');
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, '/geocoder');
  assert.equal(JSON.parse(urls[0].searchParams.get('ds')).keyWord, query);
  assert.equal(result.places[0].name, query);
  assert.equal(result.places[0].precision, 'unknown');
  assert.equal(result.places[0].coordinateSystem, undefined);
});

test('the public community name variants remain independent raw queries against one public POI fixture', async () => {
  const queries = ['\u4e1c\u539f\u6674\u5929\u5251', '\u4e1c\u539f\u6674\u5929\u89c1'];
  const publicPoi = {
    name: '\u4e1c\u539f\u6674\u5929\u89c1',
    lonlat: '104.16575,30.61404',
    province: '\u56db\u5ddd\u7701',
    city: '\u6210\u90fd\u5e02',
    county: '\u9f99\u6cc9\u9a7f\u533a',
    address: '\u6d2a\u6cb3\u4e2d\u8def600',
  };
  const seen = [];
  const service = searcher(async (url) => {
    const post = JSON.parse(new URL(url).searchParams.get('postStr'));
    seen.push(post.keyWord);
    return tdt({ status: { infocode: 1000 }, resultType: 1, pois: [publicPoi] });
  }, { domestic: true });
  const results = [];
  for (const query of queries)
    results.push(await service.searchPlacesDetailed(query, null, signal(), 'tianditu'));
  assert.deepEqual(seen, queries);
  assert.deepEqual(results.map((result) => result.places[0].detail), [
    '\u56db\u5ddd\u7701 · \u6210\u90fd\u5e02 · \u9f99\u6cc9\u9a7f\u533a · \u6d2a\u6cb3\u4e2d\u8def600',
    '\u56db\u5ddd\u7701 · \u6210\u90fd\u5e02 · \u9f99\u6cc9\u9a7f\u533a · \u6d2a\u6cb3\u4e2d\u8def600',
  ]);
});

test('TianDiTu result types 2, 3, and 4 become actionable text suggestions without map-center pins', () => {
  const cases = [
    [{ resultType: 2, statistics: { priorityCitys: [{ name: 'Southport' }], allAdmins: [{ name: 'Northport', adminName: 'Northport', keyword: 'Library' }] } }, ['Southport', 'Northport']],
    [{ resultType: 3, area: { name: 'Eastport' } }, ['Eastport']],
    [{ resultType: 4, prompt: { type: 4, admins: [{ name: 'Westport', adminName: 'Westport', keyword: 'Library' }] } }, ['Library']],
  ];
  for (const [payload, labels] of cases) {
    const result = normalizeTiandituSuggestions(payload, 'Library');
    assert.deepEqual(result.map((item) => item.label), labels);
    assert.ok(result.every((item) => typeof item.query === 'string' && item.query.length));
    assert.ok(result.every((item) => !('coordinates' in item)));
    if (payload.resultType === 2)
      assert.equal(result[1].query, 'Northport Library');
    if (payload.resultType === 3)
      assert.equal(result[0].query, 'Eastport Library');
    if (payload.resultType === 4) {
      assert.equal(result[0].query, 'Library');
      assert.equal(result[0].city, undefined);
    }
  }
});

test('city preference uses Photon structured address fields and nationwide is a broad query', async () => {
  const urls = [];
  const service = searcher(async (url) => {
    urls.push(new URL(url));
    return photon([point('Library', [104, 30], { city: 'Southport', type: 'library' })]);
  });
  await service.searchPlacesDetailed('12 Oak Street', null, signal(), 'photon', { city: 'Southport' });
  await service.searchPlacesDetailed('12 Oak Street', [104, 30], signal(), 'photon', { nationwide: true });
  assert.equal(urls[0].pathname, '/structured');
  assert.equal(urls[0].searchParams.get('city'), 'Southport');
  assert.equal(urls[0].searchParams.get('street'), 'Oak Street');
  assert.equal(urls[0].searchParams.get('housenumber'), '12');
  assert.equal(urls[1].pathname, '/api/');
  assert.equal(urls[1].searchParams.get('q'), '12 Oak Street');
  assert.equal(urls[1].searchParams.has('lat'), false, 'nationwide mode drops the map-center bias');
});

test('TianDiTu city preference is request-scoped and nationwide expansion removes that preference', async () => {
  const urls = [];
  const service = searcher(async (url) => {
    urls.push(new URL(url));
    return tdt({
      status: { infocode: 1000 },
      resultType: 1,
      pois: [{ name: 'Public Library', lonlat: '104,30', city: 'Southport' }],
    });
  }, { domestic: true });
  await service.searchPlacesDetailed('Public Library', null, signal(), 'tianditu', { city: 'Southport' });
  await service.searchPlacesDetailed('Public Library', null, signal(), 'tianditu', { city: 'Southport', nationwide: true });
  const first = JSON.parse(urls[0].searchParams.get('postStr'));
  const expanded = JSON.parse(urls[1].searchParams.get('postStr'));
  assert.equal(first.specify, 'Southport');
  assert.equal(Object.hasOwn(expanded, 'specify'), false);
  assert.equal(expanded.mapBound, '73,3,136,54');
});

test('automatic empty search crosses providers, explicit provider empty search does not', async () => {
  const calls = [];
  const service = searcher(async (url) => {
    calls.push(url);
    if (url.includes('tianditu.gov.cn'))
      return tdt({ status: { infocode: 3001 }, pois: [] });
    return photon([point('Maple Library', [104.06, 30.66], { city: 'Southport' })]);
  }, { domestic: true });

  const automatic = await service.searchPlacesDetailed('Maple Library', null, signal(), 'auto');
  assert.equal(automatic.places[0].name, 'Maple Library');
  assert.equal(automatic.places[0].source, 'photon');
  assert.equal(calls.length, 3, 'automatic TDT search performs local, nationwide expansion, then Photon fallback');
  assert.equal(JSON.parse(new URL(calls[0]).searchParams.get('postStr')).queryType, 1);
  assert.equal(JSON.parse(new URL(calls[1]).searchParams.get('postStr')).queryType, 7);

  const explicit = await service.searchPlacesDetailed('No Such Place', null, signal(), 'tianditu');
  assert.deepEqual(explicit.places, []);
  assert.equal(calls.length, 5);
});

test('authorization and malformed response errors are surfaced without trying another provider', async () => {
  for (const [response, category] of [
    [{ ok: false, status: 403 }, 'auth'],
    [{ ok: false, status: 429 }, 'rate'],
    [{ ok: false, status: 400 }, 'parameter'],
    [{ ok: true, text: async () => '{ invalid json' }, 'format'],
  ]) {
    let calls = 0;
    const service = searcher(async () => { calls++; return response; }, { domestic: true });
    await assert.rejects(
      service.searchPlacesDetailed('Sample Place', null, signal(), 'tianditu'),
      (error) => error instanceof PlaceSearchError && error.category === category,
    );
    assert.equal(calls, 1, `${category} errors must not trigger cross-provider fallback`);
  }
});

test('automatic authorization failure can recover through Photon while explicit TianDiTu reports auth', async () => {
  let photonCalls = 0;
  const service = searcher(async (url) => {
    if (url.includes('tianditu.gov.cn')) return { ok: false, status: 403 };
    photonCalls++;
    return photon([point('Civic Library', [104, 30])]);
  }, { domestic: true });
  const recovered = await service.searchPlacesDetailed('Civic Library', null, signal(), 'auto');
  assert.equal(recovered.places[0].name, 'Civic Library');
  assert.equal(photonCalls, 1);
  await assert.rejects(
    service.searchPlacesDetailed('Explicit Query', null, signal(), 'tianditu'),
    (error) => error instanceof PlaceSearchError && error.category === 'auth',
  );
  assert.equal(photonCalls, 1);
});

test('TianDiTu infocodes separate no-result, parameter, and service failures', async () => {
  for (const [infocode, category] of [[3001, 'noresult'], [2001, 'parameter'], [3000, 'service']]) {
    const service = searcher(async () => tdt({ status: { infocode }, resultType: 1, pois: [] }), { domestic: true });
    if (category === 'noresult') {
      const result = await service.searchPlacesDetailed('Known Empty', null, signal(), 'tianditu');
      assert.deepEqual(result.places, []);
    } else {
      await assert.rejects(
        service.searchPlacesDetailed('Service Error', null, signal(), 'tianditu'),
        (error) => error instanceof PlaceSearchError && error.category === category,
      );
    }
  }
});

test('automatic network failure can use Photon, while two network failures return a warning and offline fallback', async () => {
  let calls = 0;
  const service = searcher(async (url) => {
    calls++;
    if (url.includes('tianditu.gov.cn')) throw new TypeError('offline');
    return photon([point('Civic Center', [104, 30], { city: 'Southport' })]);
  }, { domestic: true });
  const result = await service.searchPlacesDetailed('Civic Center', null, signal(), 'auto');
  assert.equal(result.places[0].name, 'Civic Center');
  assert.equal(result.places[0].source, 'photon');
  assert.equal(calls, 2);

  const fallback = searcher(async () => { throw new TypeError('offline'); }, {
    domestic: true,
    offlineSearch: async () => [{ name: 'Oak Street', coordinates: [104, 30] }],
  });
  const offlineResult = await fallback.searchPlacesDetailed('Oak Street', null, signal(), 'auto');
  assert.equal(offlineResult.places[0].source, 'offline');
  assert.equal(offlineResult.places[0].precision, 'street');
  assert.ok(offlineResult.warnings.length);
});

test('administrative center results stay suggestions instead of becoming selectable pins', async () => {
  const service = searcher(async () => tdt({
    status: { infocode: 1000 },
    resultType: 3,
    area: { name: 'Southport', lonlat: '104.06,30.66' },
  }), { domestic: true });
  const result = await service.searchPlacesDetailed('Southport', null, signal(), 'tianditu');
  assert.deepEqual(result.places, []);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].city, 'Southport');
  assert.equal(result.suggestions[0].query, 'Southport');
});

test('cancellation during the primary request prevents fallback and a failed request is not cached', async () => {
  const controller = new AbortController();
  const calls = [];
  const service = searcher(async (url, init) => {
    calls.push(url);
    if (url.includes('tianditu.gov.cn')) return {
      json: () => {
        init.signal.throwIfAborted();
        return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      },
    };
    return photon([point('Should Not Run', [104, 30])]);
  }, { domestic: true });
  const pending = service.searchPlacesDetailed('Abort Sample', null, controller.signal, 'auto');
  controller.abort(new DOMException('superseded', 'AbortError'));
  await assert.rejects(pending, /superseded/);
  assert.equal(calls.length, 1);

  let attempts = 0;
  const retryable = searcher(async () => {
    attempts++;
    if (attempts === 1) throw new TypeError('temporary network failure');
    return photon([point('Retry Place', [104, 30])]);
  });
  await assert.rejects(retryable.searchPlacesDetailed('Retry Place', null, signal(), 'photon'));
  const recovered = await retryable.searchPlacesDetailed('Retry Place', null, signal(), 'photon');
  assert.equal(recovered.places[0].name, 'Retry Place');
  assert.equal(attempts, 2);
});

test('invalid JSON is not cached and each provider stays within the injected request interval', async () => {
  let attempts = 0;
  const retryable = searcher(async () => {
    attempts++;
    return attempts === 1
      ? { ok: true, text: async () => '{invalid' }
      : photon([point('Valid Retry', [104, 30])]);
  });
  await assert.rejects(
    retryable.searchPlacesDetailed('Valid Retry', null, signal(), 'photon'),
    (error) => error instanceof PlaceSearchError && error.category === 'format',
  );
  const valid = await retryable.searchPlacesDetailed('Valid Retry', null, signal(), 'photon');
  assert.equal(valid.places[0].name, 'Valid Retry');
  assert.equal(attempts, 2);

  const starts = [];
  const budgeted = createPlaceSearcher({
    fetch: async () => {
      starts.push(Date.now());
      return photon([point('Budget Result', [104, 30])]);
    },
    getConfig: () => ({ domestic: false, token: '' }),
    offlineSearch: async () => [],
    minIntervalMs: 25,
  });
  await Promise.all([
    budgeted.searchPlacesDetailed('Budget Alpha', null, signal(), 'photon'),
    budgeted.searchPlacesDetailed('Budget Beta', null, signal(), 'photon'),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(Math.abs(starts[1] - starts[0]) >= 20, `observed request spacing: ${starts[1] - starts[0]}ms`);
});

test('abort during response-body parsing prevents fallback and suppresses a pending offline result', async () => {
  const bodyAbort = new AbortController();
  const bodyRequests = [];
  const bodyService = searcher(async (url, init) => {
    bodyRequests.push(url);
    return {
      text: () => new Promise((resolve, reject) => {
        const onAbort = () => reject(init.signal.reason);
        init.signal.addEventListener('abort', onAbort, { once: true });
      }),
    };
  }, { domestic: true });
  const bodyPending = bodyService.searchPlacesDetailed('Body Abort', null, bodyAbort.signal, 'auto');
  await new Promise((resolve) => setTimeout(resolve, 0));
  bodyAbort.abort(new DOMException('body aborted', 'AbortError'));
  await assert.rejects(bodyPending, /body aborted/);
  assert.equal(bodyRequests.length, 1);

  const offlineAbort = new AbortController();
  let releaseOffline;
  const offlineService = createPlaceSearcher({
    fetch: async () => { throw new TypeError('offline'); },
    getConfig: () => ({ domestic: false, token: '' }),
    offlineSearch: () => new Promise((resolve) => { releaseOffline = resolve; }),
    minIntervalMs: 0,
  });
  const offlinePending = offlineService.searchPlacesDetailed('Offline Abort', null, offlineAbort.signal, 'auto');
  while (!releaseOffline) await new Promise((resolve) => setTimeout(resolve, 0));
  offlineAbort.abort(new DOMException('offline result is stale', 'AbortError'));
  releaseOffline([{ name: 'Stale Offline Place', coordinates: [104, 30] }]);
  await assert.rejects(offlinePending, /offline result is stale/);
});

test('TianDiTu pagination requests one bounded page at a time and clamps tokens to rank 300', async () => {
  const urls = [];
  const service = searcher(async (url) => {
    urls.push(new URL(url));
    return tdt({
      status: { infocode: 1000 },
      resultType: 1,
      count: 1000,
      pois: Array.from({ length: 20 }, (_, index) => ({
        name: `Public Park ${index}`,
        lonlat: `${104 + index / 1000},30`,
      })),
    });
  }, { domestic: true });
  const first = await service.searchPlacesDetailed('Public Park', null, signal(), 'tianditu');
  assert.equal(first.places.length, 20);
  assert.equal(first.next.start, 20);
  assert.equal(urls.length, 1, 'the service returns a token instead of fetching later pages eagerly');
  const post = (url) => JSON.parse(url.searchParams.get('postStr'));
  assert.equal(post(urls[0]).count, 20);
  assert.equal(post(urls[0]).start, 0);

  const nearLast = await service.searchPlacesDetailed('Public Park', null, signal(), 'tianditu', {
    page: { provider: 'tianditu', query: 'Public Park', start: 280, queryType: 7 },
  });
  assert.equal(post(urls[1]).start, 280);
  assert.equal(post(urls[1]).count, 20);
  assert.equal(nearLast.next.start, 300);
  const last = await service.searchPlacesDetailed('Public Park', null, signal(), 'tianditu', {
    page: nearLast.next,
  });
  assert.equal(post(urls[2]).start, 300);
  assert.equal(post(urls[2]).count, 20);
  assert.equal(last.next, undefined);
  assert.ok(urls.every((url) => post(url).start <= 300));
});


test('canceled provider waiters do not add throttle debt and concurrent requests launch at provider intervals', async () => {
  const interval = 140;
  const starts = [];
  const throttled = createPlaceSearcher({
    fetch: async (url) => {
      starts.push({ query: new URL(url).searchParams.get('q'), at: Date.now() });
      return photon([point('Throttled result', [104, 30])]);
    },
    getConfig: () => ({ domestic: false, token: '' }),
    offlineSearch: async () => [],
    minIntervalMs: interval,
  });
  await throttled.searchPlacesDetailed('First request', null, signal(), 'photon');
  const firstStarted = starts[0].at;

  const canceled = new AbortController();
  const waiting = throttled.searchPlacesDetailed('Canceled waiter', null, canceled.signal, 'photon');
  await new Promise((resolve) => setTimeout(resolve, 25));
  canceled.abort(new DOMException('cancel queued search', 'AbortError'));
  await assert.rejects(waiting, /cancel queued search/);

  await throttled.searchPlacesDetailed('Request after cancel', null, signal(), 'photon');
  const afterCancelDelta = starts[1].at - firstStarted;
  assert.ok(afterCancelDelta >= interval - 15, `request interval should still be honored (${afterCancelDelta}ms)`);
  assert.ok(afterCancelDelta < interval + 90,
    `canceling a queued waiter must not reserve another interval (${afterCancelDelta}ms)`);

  const parallelStarts = [];
  const parallel = createPlaceSearcher({
    fetch: async (url) => {
      parallelStarts.push({ query: new URL(url).searchParams.get('q'), at: Date.now() });
      return photon([point('Parallel result', [104, 30])]);
    },
    getConfig: () => ({ domestic: false, token: '' }),
    offlineSearch: async () => [],
    minIntervalMs: interval,
  });
  await Promise.all([
    parallel.searchPlacesDetailed('Parallel one', null, signal(), 'photon'),
    parallel.searchPlacesDetailed('Parallel two', null, signal(), 'photon'),
  ]);
  assert.equal(parallelStarts.length, 2);
  assert.ok(parallelStarts[1].at - parallelStarts[0].at >= interval - 15,
    `concurrent provider requests must be spaced at launch (${parallelStarts[1].at - parallelStarts[0].at}ms)`);
});

test('TianDiTu prompt suggestions preserve actionable words and only scoped prompts set a city', async () => {
  const payload = {
    status: { infocode: 1000 },
    resultType: 4,
    prompt: [
      { type: 1, keyword: 'museum', admins: [{ adminName: 'Southport', adminCode: '123456789' }] },
      { type: 2, keyword: 'library', admins: [{ adminName: 'Northport', adminCode: '987654321', keyword: 'library' }] },
      { type: 3, keyword: 'parks', admins: [{ adminName: 'Westport', adminCode: '112233445' }] },
      { type: 4, keyword: 'global parks', admins: [{ adminName: 'Global', keyword: 'global parks' }] },
    ],
  };
  const suggestions = normalizeTiandituSuggestions(payload, 'original typo');
  const byQuery = new Map(suggestions.map((item) => [item.query, item]));
  assert.equal(byQuery.get('Southport museum')?.city, 'Southport');
  assert.equal(byQuery.get('Northport library')?.city, 'Northport');
  assert.equal(byQuery.get('Westport parks')?.city, 'Westport');
  assert.equal(byQuery.get('global parks')?.city, undefined,
    'the global/type-4 prompt is a keyword suggestion, not a city constraint');
  assert.ok(!byQuery.has('original typo'), 'prompt keyword buttons must submit their actionable term');
  assert.deepEqual(normalizeTiandituSuggestions({
    resultType: 1,
    prompt: { type: 4, admins: [{ adminName: 'Global', adminCode: 0 }] },
  }, 'original typo'), [], 'a global admin prompt without a keyword is not an actionable suggestion');

  const requests = [];
  const service = searcher(async (url) => {
    const parsed = new URL(url);
    requests.push(JSON.parse(parsed.searchParams.get('postStr')));
    return tdt({ status: { infocode: 1000 }, resultType: 1, pois: [
      { name: 'Global result', lonlat: '104,30' },
    ] });
  }, { domestic: true });
  await service.searchPlacesDetailed(byQuery.get('global parks').query, null, signal(), 'tianditu', {
    city: byQuery.get('global parks').city,
  });
  assert.equal(requests[0].keyWord, 'global parks');
  assert.equal(Object.hasOwn(requests[0], 'specify'), false,
    'a global word suggestion must not become TianDiTu specify');
});

test('TianDiTu infers specify only from explicit administrative prefixes, not POI suffix words', async () => {
  const queries = [
    '\u9752\u57ce\u5c71\u666f\u533a',
    '\u4e1c\u539f\u6674\u5929\u89c1\u5c0f\u533a',
    '\u67d0\u793e\u533a',
    '\u67d0\u6821\u533a',
    '\u67d0\u56ed\u533a',
    '\u5929\u8679\u8d85\u5e02',
    '\u6210\u90fd\u5e02\u5bbd\u7a84\u5df7\u5b50',
    '\u56db\u5ddd\u7701\u6210\u90fd\u5e02\u5bbd\u7a84\u5df7\u5b50',
    '\u6b66\u6c49\u5e02\u9ec4\u9e64\u697c',
  ];
  const posts = [];
  const service = searcher(async (url) => {
    posts.push(JSON.parse(new URL(url).searchParams.get('postStr')));
    return tdt({
      status: { infocode: 1000 }, resultType: 1,
      pois: [{ name: 'Fixture place', lonlat: '104,30' }],
    });
  }, { domestic: true });
  for (const query of queries)
    await service.searchPlacesDetailed(query, null, signal(), 'tianditu');

  assert.deepEqual(posts.map((post) => post.keyWord), queries, 'keep the complete typed query sent to TianDiTu');
  for (const post of posts.slice(0, 6))
    assert.equal(Object.hasOwn(post, 'specify'), false, `${post.keyWord} is a POI/locality suffix, not a city scope`);
  assert.equal(posts[6].specify, '\u6210\u90fd\u5e02');
  assert.equal(posts[7].specify, '\u6210\u90fd\u5e02', 'province+city text should constrain to its city while retaining the raw province prefix in keyWord');
  assert.equal(posts[8].specify, '\u6b66\u6c49\u5e02');
});
