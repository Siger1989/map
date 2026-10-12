import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLACE_CACHE_KEY,
  PLACE_CACHE_MAX_AGE_MS,
  PLACE_CACHE_MAX_CHARS,
  PLACE_CACHE_MAX_ENTRIES,
  createPlaceCache,
  parsePlaceCache,
} from '../modules/navigation/offlinePlaceCache.ts';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
}

function place(name, source = 'tianditu', overrides = {}) {
  return {
    name,
    detail: '四川省 · 成都市 · 双流区',
    coordinates: [103.9, 30.4],
    source,
    precision: 'poi',
    coordinateSystem: 'WGS84',
    ...overrides,
  };
}

test('cache stores only public POI fields, filters provider, AND-matches query words, and returns offline provenance', () => {
  let now = 1_800_000_000_000;
  const storage = memoryStorage({ 'user.saved-routes': 'keep-me' });
  const cache = createPlaceCache({ storage, now: () => now });
  const target = place('财富中心', 'tianditu', {
    detail: '成都 · 怡心湖附近',
    extra: 'must not persist',
    token: 'secret-token',
    url: 'https://example.invalid/?key=secret',
  });
  cache.cachePlaces('财富中心 怡心湖', [target, place('财富中心', 'photon')]);
  cache.cachePlaces('备用简称', [place('财富中心')]);

  const raw = storage.values.get(PLACE_CACHE_KEY);
  assert.ok(raw);
  assert.equal(raw.includes('secret-token'), false);
  assert.equal(raw.includes('example.invalid'), false);
  assert.equal(raw.includes('must not persist'), false);
  assert.equal(storage.values.get('user.saved-routes'), 'keep-me');

  const matches = cache.readCachedPlaces('怡心湖 财富中心');
  assert.equal(matches.length, 2, 'word order does not matter when all query words match');
  assert.ok(matches.every((item) => item.source === 'offline'));
  assert.equal(matches[0].name, '财富中心', 'exact name match sorts first');
  assert.match(matches[0].detail, /本机缓存 · 原来源天地图/);
  assert.equal(matches[0].precision, 'poi');
  assert.equal(matches[0].coordinateSystem, 'WGS84');
  assert.equal('token' in matches[0], false);
  assert.equal(cache.readCachedPlaces('备用简称').length, 1, 'duplicate POI retains a few real query terms');
  assert.equal(cache.readCachedPlaces('财富中心 不存在').length, 0, 'all normalized words are required');
  assert.equal(cache.readCachedPlaces('财富中心', 'tianditu').length, 1);
  assert.equal(cache.readCachedPlaces('财富中心', 'photon').length, 1);
  assert.equal(cache.readCachedPlaces('财富中心', 'auto').length, 2);
  now += 1;
});

test('cache validates coordinates and source, deduplicates, caps results, and expires after 30 days', () => {
  let now = 1_800_000_000_000;
  const storage = memoryStorage();
  const cache = createPlaceCache({ storage, now: () => now });
  cache.cachePlaces('公共地点', [
    place('有效 POI'),
    place('无效坐标', 'tianditu', { coordinates: [200, 20] }),
    place('非公开来源', 'offline'),
    place('无效纬度', 'photon', { coordinates: [100, 95] }),
    place('有效 POI'),
  ]);
  assert.equal(cache.readCachedPlaces('公共地点').length, 1);

  cache.cachePlaces('批量地点', Array.from({ length: PLACE_CACHE_MAX_ENTRIES + 15 }, (_, i) =>
    place(`地点${i}`, i % 2 ? 'photon' : 'tianditu', { coordinates: [100 + i / 10000, 30] })));
  const persisted = JSON.parse(storage.values.get(PLACE_CACHE_KEY));
  assert.equal(persisted.entries.length, PLACE_CACHE_MAX_ENTRIES);
  assert.ok(storage.values.get(PLACE_CACHE_KEY).length < PLACE_CACHE_MAX_CHARS);

  const expired = JSON.stringify({ version: 1, entries: [{
    place: { name: '过期地点', coordinates: [100, 30], source: 'tianditu' },
    queries: ['过期地点'], savedAt: now - PLACE_CACHE_MAX_AGE_MS - 1,
  }] });
  assert.deepEqual(parsePlaceCache(expired, now), []);
});

test('corrupt, unsupported, oversized, and unavailable storage safely degrade without touching other keys', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(parsePlaceCache('{broken', now), []);
  assert.deepEqual(parsePlaceCache(JSON.stringify({ version: 2, entries: [] }), now), []);
  assert.deepEqual(parsePlaceCache('x'.repeat(PLACE_CACHE_MAX_CHARS + 1), now), []);

  const storage = memoryStorage({ 'user.photos': 'preserve' });
  storage.getItem = () => { throw new Error('storage denied'); };
  storage.setItem = () => { throw new Error('storage denied'); };
  const cache = createPlaceCache({ storage, now: () => now });
  assert.deepEqual(cache.readCachedPlaces('anywhere'), []);
  cache.cachePlaces('anywhere', [place('Any POI')]);
  assert.equal(storage.values.get('user.photos'), 'preserve');
  assert.equal(storage.values.has(PLACE_CACHE_KEY), false, 'failed storage writes are ignored');

  const setterFailure = createPlaceCache({
    storage: { getItem: () => null, setItem() { throw new Error('quota exceeded'); } },
    now: () => now,
  });
  assert.doesNotThrow(() => setterFailure.cachePlaces('anywhere', [place('Any POI')]));
});
