import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDefaultSeedBundle, parseDefaultSeeds } from '../modules/mapSources/defaultSeeds.ts';
import { sameOnlineMap } from '../modules/mapSources/importReview.ts';

const makeDraft = (index) => ({
  name: `Seed ${index}`,
  kind: 'online',
  format: 'XYZ',
  attribution: 'Test provider',
  minzoom: 0,
  maxzoom: 18,
  tileSize: 256,
  scheme: 'xyz',
  tiles: [`https://tiles${index}.example.test/{z}/{x}/{y}.png`],
});

const makeBundle = (legacyCount, appendCount = 1) => ({
  legacyMapCount: legacyCount,
  drafts: Array.from({ length: legacyCount + appendCount }, (_, index) => makeDraft(index)),
});

function createIndexedDb({ maps = [], marker = undefined, failAdd = false } = {}) {
  const meta = new Map();
  if (marker !== undefined) meta.set(marker.key, structuredClone(marker));
  meta.set('unrelated-user-setting', { key: 'unrelated-user-setting', value: 'keep' });
  const state = {
    maps: structuredClone(maps), meta, failAdd, version: 0,
    get marker() { return this.meta.get('default-map-sources-initialized'); },
  };
  const names = new Set();
  const db = {
    get objectStoreNames() { return { contains: (name) => names.has(name) }; },
    createObjectStore(name) { names.add(name); return {}; },
    transaction(_storeNames, mode) {
      assert.equal(mode, 'readwrite');
      const staged = { maps: structuredClone(state.maps), meta: new Map([...state.meta].map(([key, value]) => [key, structuredClone(value)])) };
      const tx = {
        aborted: false,
        abort() {
          if (this.aborted) return;
          this.aborted = true;
          queueMicrotask(() => this.onabort?.());
        },
        objectStore(name) {
          if (name === 'maps') return {
            openCursor() {
              const request = { result: null };
              let index = 0;
              const advance = () => {
                request.result = index < staged.maps.length ? {
                  value: structuredClone(staged.maps[index]),
                  continue() { index += 1; queueMicrotask(advance); },
                } : null;
                request.onsuccess?.();
              };
              queueMicrotask(advance);
              return request;
            },
            add(value) {
              if (state.failAdd) { tx.abort(); return; }
              staged.maps.push(structuredClone(value));
            },
          };
          return {
            get(key) {
              const request = { result: undefined };
              queueMicrotask(() => {
                request.result = staged.meta.has(key) ? structuredClone(staged.meta.get(key)) : undefined;
                request.onsuccess?.();
              });
              return request;
            },
            put(value) { staged.meta.set(value.key, structuredClone(value)); },
          };
        },
      };
      setTimeout(() => {
        if (!tx.aborted) {
          state.maps = staged.maps;
          state.meta = staged.meta;
          tx.oncomplete?.();
        }
      }, 0);
      return tx;
    },
    close() {},
  };
  return {
    state,
    indexedDB: {
      open(name, version) {
        assert.equal(name, 'shantu-map-sources');
        const request = { result: db };
        queueMicrotask(() => {
          if (state.version && version < state.version) {
            request.error = new DOMException('VersionError', 'VersionError');
            request.onerror?.();
            return;
          }
          if (version > state.version) {
            state.version = version;
            request.onupgradeneeded?.();
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
  };
}

async function storageWith(t, fixture, tag) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = fixture.indexedDB;
  t.after(() => {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  });
  return import(`../modules/mapSources/storage.ts?seed-migration=${tag}`);
}

test('legacyMapCount defaults to the full old manifest while the array parser stays compatible', () => {
  const oldManifest = { version: 1, maps: [makeDraft(0), makeDraft(1)] };
  assert.equal(parseDefaultSeeds(oldManifest).length, 2);
  assert.deepEqual(parseDefaultSeedBundle(oldManifest), { drafts: parseDefaultSeeds(oldManifest), legacyMapCount: 2 });
  assert.throws(() => parseDefaultSeedBundle({ ...oldManifest, legacyMapCount: 3 }), /旧版数量/);
  assert.throws(() => parseDefaultSeedBundle({ ...oldManifest, legacyMapCount: -1 }), /旧版数量/);
});

test('old marker migration adds only the appended seed and never revives removed legacy or appended maps', async (t) => {
  const oldDrafts = [makeDraft(0), makeDraft(1), makeDraft(2)];
  const retained = { ...oldDrafts[0], id: 'old-retained', bytes: 111, detail: 'user detail' };
  const userMap = { ...makeDraft(90), id: 'user-map', bytes: 222, custom: true };
  const fixture = createIndexedDb({ maps: [retained, userMap], marker: { key: 'default-map-sources-initialized', value: true } });
  const storage = await storageWith(t, fixture, 'legacy-migration');
  const bundle = makeBundle(3, 1);

  assert.equal(await storage.ensureDefaultMaps(bundle), true);
  assert.equal(fixture.state.maps.length, 3);
  assert.deepEqual(fixture.state.maps.slice(0, 2), [retained, userMap]);
  assert.equal(fixture.state.maps.some((map) => sameOnlineMap(map, oldDrafts[1]) || sameOnlineMap(map, oldDrafts[2])), false);
  assert.equal(fixture.state.maps.some((map) => sameOnlineMap(map, bundle.drafts[3])), true);
  assert.equal(fixture.state.marker.value, true);
  assert.equal(fixture.state.marker.seedStateVersion, 1);
  assert.equal(fixture.state.marker.processedSeedFingerprintsV1.length, 4);
  assert.deepEqual(fixture.state.meta.get('unrelated-user-setting'), { key: 'unrelated-user-setting', value: 'keep' });

  assert.equal(await storage.ensureDefaultMaps(bundle), false);
  assert.equal(fixture.state.maps.length, 3);
  fixture.state.maps = fixture.state.maps.filter((map) => !sameOnlineMap(map, bundle.drafts[3]));
  assert.equal(await storage.ensureDefaultMaps(bundle), false);
  assert.equal(fixture.state.maps.length, 2);

  const laterAppend = { ...bundle, drafts: [...bundle.drafts, makeDraft(4)] };
  assert.equal(await storage.ensureDefaultMaps(laterAppend), true);
  assert.equal(fixture.state.maps.length, 3);
  assert.equal(await storage.ensureDefaultMaps(laterAppend), false);
  fixture.state.maps = fixture.state.maps.filter((map) => !sameOnlineMap(map, laterAppend.drafts[4]));
  assert.equal(await storage.ensureDefaultMaps(laterAppend), false);
  assert.deepEqual(fixture.state.maps, [retained, userMap]);
});

test('fresh installs seed the entire bundle and pre-imported append entries are retained without duplication', async (t) => {
  const fresh = createIndexedDb();
  const freshStorage = await storageWith(t, fresh, 'fresh-bundle');
  const bundle = makeBundle(2, 1);
  assert.equal(await freshStorage.ensureDefaultMaps(bundle), true);
  assert.equal(fresh.state.maps.length, 3);
  assert.equal(fresh.state.marker.processedSeedFingerprintsV1.length, 3);

  const legacyMarker = { key: 'default-map-sources-initialized', value: true };
  const manuallyImported = { ...bundle.drafts[2], id: 'manually-imported', bytes: 456, custom: 'kept' };
  const migrated = createIndexedDb({ maps: [manuallyImported], marker: legacyMarker });
  const migratedStorage = await storageWith(t, migrated, 'pre-imported-append');
  assert.equal(await migratedStorage.ensureDefaultMaps(bundle), false);
  assert.deepEqual(migrated.state.maps, [manuallyImported]);
  assert.equal(migrated.state.marker.processedSeedFingerprintsV1.length, 3);
});

test('capacity and add failures preserve the prior marker and commit no partial map rows', async (t) => {
  const bundle = makeBundle(1, 1);
  const full = Array.from({ length: 100 }, (_, index) => ({ ...makeDraft(index + 10), id: `saved-${index}`, bytes: 1 }));
  const capacity = createIndexedDb({ maps: full, marker: { key: 'default-map-sources-initialized', value: true } });
  const capacityStorage = await storageWith(t, capacity, 'capacity');
  await assert.rejects(capacityStorage.ensureDefaultMaps(bundle), /容量上限/);
  assert.equal(capacity.state.maps.length, 100);
  assert.deepEqual(capacity.state.marker, { key: 'default-map-sources-initialized', value: true });

  const failing = createIndexedDb({ failAdd: true, marker: { key: 'default-map-sources-initialized', value: true } });
  const failingStorage = await storageWith(t, failing, 'add-failure');
  await assert.rejects(failingStorage.ensureDefaultMaps(bundle), /保存失败/);
  assert.equal(failing.state.maps.length, 0);
  assert.deepEqual(failing.state.marker, { key: 'default-map-sources-initialized', value: true });
});
