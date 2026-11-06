import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { indexedDB } from 'fake-indexeddb';
import { createImportedPlanningTrip, importedTaskPhase } from '../modules/outdoor/offlineTaskState.ts';
import { persistTripPlanningTask, tripPackages } from '../modules/outdoor/tripStorage.ts';

test('route planning task is a durable same-ID package with an honest preparing phase', () => {
  const segments = [[[103, 31], [104, 32]]];
  const area = { kind: 'route', segments, bufferKm: 2 };
  const task = createImportedPlanningTrip('task-1', '山路', area,
    { id: 'source-1', name: 'XYZ', kind: 'online', tiles: [] }, 14, ['山路'], 123);
  assert.equal(task.id, 'task-1');
  assert.equal(task.phase, 'preparing');
  assert.deepEqual(task.bounds, [103, 31, 104, 32]);
  assert.deepEqual(task.routeSegments, segments);
  assert.equal(task.urls.length, 0);
  segments[0][0][0] = 0;
  assert.deepEqual(task.routeSegments, [[[103, 31], [104, 32]]]);
});

test('native offline states map to real resumable package states', () => {
  assert.equal(importedTaskPhase('running'), 'running');
  assert.equal(importedTaskPhase('waiting'), 'waiting');
  assert.equal(importedTaskPhase('complete'), 'complete');
  assert.equal(importedTaskPhase('paused'), 'paused');
  assert.equal(importedTaskPhase('cancelled'), 'paused');
  assert.equal(importedTaskPhase('error'), 'failed');
  assert.equal(importedTaskPhase('unknown'), undefined);
});

test('planning uses the same persisted task ID when the real manifest replaces the placeholder', async () => {
  const source = await readFile(new URL('../modules/outdoor/useOffline.ts', import.meta.url), 'utf8');
  assert.match(source, /persistTripPlanningTask\(placeholder\);setPackages\(tripPackages\(\)\);setCurrent\(placeholder\)/);
  assert.match(source, /prepareImportedRoutePackage\(name,area,source,zoom,signal,routeNames,id\)/);
  assert.match(source, /prepareImportedRoutePackage\(name, \{ kind: 'route', segments: trip\.routeSegments, bufferKm: trip\.bufferKm \?\? 4 \}, source, trip\.zoom \?\? 14, signal, trip\.routeNames, trip\.id\)/);
});

test('collection exposes planning state and keeps retry/resume controls on the saved package', async () => {
  const source = await readFile(new URL('../modules/collections/OfflineMapFolder.tsx', import.meta.url), 'utf8');
  assert.match(source, /p\.phase === 'preparing' \? '正在规划'/);
  assert.match(source, /disabled=\{!p\.urls\.length \|\| p\.phase === 'preparing'\}/);
  assert.match(source, /offline\.resume\(p\)/);
  const panel = await readFile(new URL('../modules/outdoor/RouteCachePanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /正在规划路线缓存/);
  assert.match(panel, /offline\.resume\(activeTrip\)/);
});

test('planning retry geometry stays in IndexedDB, not the frequently rewritten package index', async () => {
  const previousIndex = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  } });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: indexedDB });
  try {
    const task = createImportedPlanningTrip('persist-task-test', '路径',
      { kind: 'route', segments: [[[103, 31], [103.1, 31.1]]], bufferKm: 2 },
      { id: 'source-1', name: 'XYZ', kind: 'online', tiles: [] }, 14, ['路径'], 99);
    await persistTripPlanningTask(task);
    const compact = JSON.parse(values.get('guanyun.trips.v1'));
    assert.equal(Object.hasOwn(compact[0], 'routeSegments'), false);
    assert.deepEqual(tripPackages().find((item) => item.id === task.id).routeSegments, task.routeSegments);
    const restored = await import(`../modules/outdoor/tripStorage.ts?fresh=${Date.now()}`);
    const hydrated = await restored.hydrateTripPackages();
    assert.deepEqual(hydrated.find((item) => item.id === task.id).routeSegments, task.routeSegments);
  } finally {
    if (previousIndex) Object.defineProperty(globalThis, 'localStorage', previousIndex); else delete globalThis.localStorage;
    if (previousIndexedDb) Object.defineProperty(globalThis, 'indexedDB', previousIndexedDb); else delete globalThis.indexedDB;
  }
});
