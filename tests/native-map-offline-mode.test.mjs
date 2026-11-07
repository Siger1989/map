import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { readNativeOfflineDisplayPolicy, subscribeNativeOfflineDisplayPolicy } from '../modules/map/native/offlineMode.ts';

function installStorage(values) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map(Object.entries(values));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  } });
  return () => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  };
}

test('offline display policy derives version templates only from the selected OpenFreeMap package', () => {
  const restore = installStorage({
    'shantu.offline-map-only.v1': 'true',
    'shantu.offline-package.v1': 'ofm-trip',
    'guanyun.trips.v1': JSON.stringify([{ id: 'ofm-trip', provider: 'openfreemap', urls: [
      'https://tiles.openfreemap.org/planet/20261028_001001_pt/12/2048/1365.pbf',
      'https://tiles.openfreemap.org/planet/20261028_001001_pt/11/1024/682.pbf',
      'https://evil.invalid/planet/version/12/0/0.pbf',
    ] }]),
  });
  try {
    assert.deepEqual(readNativeOfflineDisplayPolicy(), {
      version: 1, enabled: true, packageId: 'ofm-trip', sourceId: null, provider: 'openfreemap',
      vectorTileTemplates: ['https://tiles.openfreemap.org/planet/20261028_001001_pt/{z}/{x}/{y}.pbf'],
    });
  } finally { restore(); }
});

test('old trip package metadata defaults to Tianditu and missing selected packages fail closed', () => {
  const restore = installStorage({
    'shantu.offline-map-only.v1': 'true',
    'shantu.offline-package.v1': 'old-trip',
    'guanyun.trips.v1': JSON.stringify([{ id: 'old-trip', urls: [] }]),
  });
  try {
    assert.deepEqual(readNativeOfflineDisplayPolicy(), {
      version: 1, enabled: true, packageId: 'old-trip', sourceId: null, provider: 'tianditu', vectorTileTemplates: [],
    });
    localStorage.setItem('shantu.offline-package.v1', 'missing-trip');
    assert.deepEqual(readNativeOfflineDisplayPolicy(), {
      version: 1, enabled: true, packageId: null, sourceId: null, provider: null, vectorTileTemplates: [],
    });
  } finally { restore(); }
});

test('native policy republishes on network recovery without changing explicit cache-only preference', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const { window } = parseHTML('<html><body></body></html>');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  const restore = installStorage({
    'shantu.offline-map-only.v1': 'true',
    'shantu.offline-package.v1': 'offline-route',
    'guanyun.trips.v1': JSON.stringify([{ id: 'offline-route', provider: 'imported', sourceId: 'source-1', urls: [] }]),
  });
  try {
    const published = [];
    const unsubscribe = subscribeNativeOfflineDisplayPolicy(policy => published.push(policy));
    const before = published.length;
    window.dispatchEvent(new window.Event('online'));
    assert.equal(published.length, before + 1);
    assert.equal(published.at(-1).enabled, true);
    assert.equal(published.at(-1).packageId, 'offline-route');
    assert.equal(localStorage.getItem('shantu.offline-map-only.v1'), 'true');
    unsubscribe();
    const afterUnsubscribe = published.length;
    window.dispatchEvent(new window.Event('online'));
    assert.equal(published.length, afterUnsubscribe, 'connectivity listener is removed with the subscription');
  } finally {
    restore();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
