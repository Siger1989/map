import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeOfflineDisplayPolicy } from '../modules/map/native/offlineMode.ts';

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
