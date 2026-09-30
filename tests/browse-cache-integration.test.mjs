import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMapFetch } from '../modules/outdoor/tileCache.ts';
import { fetchMapTile, fetchOnlineMapTile } from '../modules/mapSources/tileTransport.ts';

test('render and explicit online tile requests bypass app cache stores and native offline hits', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const previousBridge = Object.getOwnPropertyDescriptor(globalThis, 'ShantuMap');
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('network tile');
  };
  const fail = name => ({ configurable: true, get() { throw Error(`${name} accessed`); } });
  Object.defineProperty(globalThis, 'caches', fail('CacheStorage'));
  Object.defineProperty(globalThis, 'localStorage', fail('offline preference'));
  Object.defineProperty(globalThis, 'indexedDB', fail('IndexedDB'));
  Object.defineProperty(globalThis, 'ShantuMap', { configurable: true, value: { offlineHas() { throw Error('native offline lookup'); } } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://app.example.test' } });
  try {
    const signal = new AbortController().signal;
    const provider = 'https://tiles.example.test/8/32/32.png';
    await cachedMapFetch('/api/terrain/8/32/32.png', signal, { z: 8, x: 32, y: 32 }, true);
    await fetchMapTile(provider, signal, { z: 8, x: 32, y: 32 });
    await fetchOnlineMapTile(provider, signal);
    assert.equal(calls.length, 3);
    assert.equal(calls[0][0], '/api/terrain/8/32/32.png');
    assert.equal(new URL(calls[1][0]).pathname, '/api/map-tile');
    assert.equal(new URL(calls[2][0]).pathname, '/api/map-tile');
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, descriptor] of [['caches', previousCaches], ['localStorage', previousStorage], ['indexedDB', previousIndexedDB], ['ShantuMap', previousBridge], ['location', previousLocation]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
