import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NativeMapBridgeClient } from '../modules/map/native/client.ts';
import { installNativeBrowserCacheBridge } from '../modules/map/native/browserCacheBridge.ts';

class FakeWindow extends EventTarget {
  location = { origin: 'https://appassets.androidplatform.net' };
  sent = [];
  ShantuNativeMap = { postMessage: (raw) => {
    const message = JSON.parse(raw); this.sent.push(message);
    if (message.command === 'hello') this.host({ version: 1, sessionId: 'trusted-session', requestId: message.requestId,
      mapId: message.mapId, type: 'result', payload: { sessionId: 'trusted-session', capabilities: {} } });
  } };
  host(message) { this.dispatchEvent(Object.assign(new Event('shantu:native-map'), { detail: message })); }
}

function installStorage(values) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  } });
  return () => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : delete globalThis.localStorage;
}

const sha = (value) => createHash('sha256').update(value).digest('hex');
const waitFor = async (predicate) => {
  for (let i = 0; i < 100; i++) { const result = predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('native cache bridge response timed out');
};

test('native cache request reads only selected package CacheStorage and echoes verified request identity', async () => {
  const url = 'https://tiles.openfreemap.org/planet/20261028_001001_pt/12/2048/1365.pbf';
  const packageId = 'trip-cache';
  const body = new Uint8Array([1, 2, 3, 4, 5]);
  const restoreStorage = installStorage({
    'shantu.offline-map-only.v1': 'true',
    'shantu.offline-package.v1': packageId,
    'guanyun.trips.v1': JSON.stringify([{ id: packageId, provider: 'openfreemap', urls: [url] }]),
  });
  const oldCaches = globalThis.caches;
  let fetchCalls = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('network must not be used'); };
  globalThis.caches = { open: async (name) => {
    assert.equal(name, 'guanyun-trips-v1');
    return { match: async (key) => key === url ? new Response(body, { status: 200 }) : undefined };
  } };
  try {
    const win = new FakeWindow();
    const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
    await client.connect('main');
    const stop = installNativeBrowserCacheBridge(client, 'main');
    const request = { requestId: 'native-read-1', packageId, url, urlHash: sha(url), maxBytes: 4 * 1024 * 1024 };
    win.host({ version: 1, sessionId: 'trusted-session', mapId: 'main', type: 'event', payload: { name: 'cachedTileRequest', value: request } });
    const response = await waitFor(() => win.sent.find((message) => message.command === 'cachedTileResponse'));
    assert.equal(response.payload.requestId, request.requestId);
    assert.equal(response.payload.packageId, packageId);
    assert.equal(response.payload.urlHash, request.urlHash);
    assert.equal(response.payload.found, true);
    assert.equal(response.payload.bodySha256, sha(body));
    assert.deepEqual([...Uint8Array.from(atob(response.payload.bytesBase64), (character) => character.charCodeAt(0))], [...body]);
    assert.equal(fetchCalls, 0);
    stop(); client.dispose();
  } finally {
    restoreStorage();
    if (oldCaches === undefined) delete globalThis.caches; else globalThis.caches = oldCaches;
    globalThis.fetch = oldFetch;
  }
});

test('package mismatch, untrusted session and cancellation never read CacheStorage', async () => {
  const restoreStorage = installStorage({
    'shantu.offline-map-only.v1': 'true',
    'shantu.offline-package.v1': 'selected',
    'guanyun.trips.v1': JSON.stringify([{ id: 'selected', provider: 'openfreemap', urls: [] }]),
  });
  const oldCaches = globalThis.caches;
  let reads = 0;
  globalThis.caches = { open: async () => ({ match: async () => { reads++; return null; } }) };
  try {
    const win = new FakeWindow();
    const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
    await client.connect('main');
    const stop = installNativeBrowserCacheBridge(client, 'main');
    const url = 'https://tiles.openfreemap.org/planet/latest/1/0/0.pbf';
    const request = { requestId: 'native-read-2', packageId: 'other-package', url, urlHash: sha(url), maxBytes: 100 };
    win.host({ version: 1, sessionId: 'wrong-session', mapId: 'main', type: 'event', payload: { name: 'cachedTileRequest', value: { ...request, packageId: 'selected' } } });
    win.host({ version: 1, sessionId: 'trusted-session', mapId: 'main', type: 'event', payload: { name: 'cachedTileRequest', value: request } });
    win.host({ version: 1, sessionId: 'trusted-session', mapId: 'main', type: 'event', payload: { name: 'cachedTileCancel', value: { requestId: request.requestId } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(reads, 0);
    assert.equal(win.sent.some((message) => message.command === 'cachedTileResponse' && message.payload.found === true), false);
    stop(); client.dispose();
  } finally {
    restoreStorage();
    if (oldCaches === undefined) delete globalThis.caches; else globalThis.caches = oldCaches;
  }
});
