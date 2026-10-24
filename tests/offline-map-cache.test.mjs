import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMapFetch, offlineMapOnly, offlineMapProtocol, offlineMapTransform } from '../modules/outdoor/tileCache.ts';

test('cache-only mode reads a selected package and rejects a miss without network access', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const calls = [];
  const stored = new Response('saved package tile');
  const cache = { match: async key => key === 'https://tiles.example.test/8/32/32.png' ? stored.clone() : undefined };
  globalThis.fetch = async (...args) => { calls.push(args); return new Response('network tile'); };
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async name => { assert.equal(name, 'guanyun-trips-v1'); return cache; } } });
  const local = new Map([
    ['shantu.offline-map-only.v1', 'false'],
    ['shantu.offline-package.v1', 'route-1'],
    ['guanyun.trips.v1', JSON.stringify([{ id: 'route-1', urls: ['https://tiles.example.test/8/32/32.png'] }])],
  ]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => local.get(key) ?? null } });
  try {
    assert.equal(offlineMapOnly(), false);
    const signal = new AbortController().signal;
    assert.equal(await (await cachedMapFetch('https://tiles.example.test/8/32/32.png', signal)).text(), 'saved package tile', 'normal mode may reuse a selected explicit package');
    assert.equal(await (await cachedMapFetch('https://tiles.example.test/8/32/34.png', signal)).text(), 'network tile', 'package misses preserve online behavior');
    assert.equal(calls.length, 1);
    local.set('shantu.offline-map-only.v1', 'true');
    assert.equal(offlineMapOnly(), true);
    assert.equal(offlineMapTransform('https://tiles.example.test/8/32/32.png', 'Tile').url.startsWith('tripcache://'), true);
    assert.equal(offlineMapTransform('shantu-map://source/8/32/32', 'Tile').url, 'shantu-map://source/8/32/32', 'custom source protocol stays on its provider-aware transport');
    assert.equal(await (await cachedMapFetch('https://tiles.example.test/8/32/32.png', signal)).text(), 'saved package tile');
    const protocolResult = await offlineMapProtocol({ url: `tripcache://${encodeURIComponent('https://tiles.example.test/8/32/32.png')}`, type: 'Tile' }, new AbortController());
    assert.equal(new TextDecoder().decode(protocolResult.data), 'saved package tile');
    await assert.rejects(cachedMapFetch('https://tiles.example.test/8/32/33.png', signal), /没有这张地图瓦片/);
    assert.equal(calls.length, 1, 'cache-only misses never reach the network');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches);
    else delete globalThis.caches;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});
