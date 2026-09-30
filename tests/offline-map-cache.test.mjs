import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedMapFetch, offlineMapOnly } from '../modules/outdoor/tileCache.ts';

test('legacy map fetch helper always uses the network without reading app caches or offline settings', async () => {
  const previousFetch = globalThis.fetch;
  const previousCaches = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response('network tile');
  };
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw Error('CacheStorage accessed'); } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('offline preference accessed'); } });
  try {
    assert.equal(offlineMapOnly(), false);
    const signal = new AbortController().signal;
    assert.equal(await (await cachedMapFetch('/api/terrain/12/1/2.png', signal)).text(), 'network tile');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/terrain/12/1/2.png');
    assert.equal(calls[0][1].signal, signal);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches) Object.defineProperty(globalThis, 'caches', previousCaches);
    else delete globalThis.caches;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});
