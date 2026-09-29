import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDefaultSeeds, loadDefaultSeeds, seedThenList } from '../modules/mapSources/defaultSeeds.ts';

const makeDraft = (index) => ({
  name: `Seed ${index}`, kind: 'online', format: 'XYZ', attribution: 'Test provider',
  minzoom: 0, maxzoom: 18, tileSize: 256, scheme: 'xyz',
  tiles: [`https://tiles${index}.example.test/{z}/{x}/{y}.png`],
});
const seedAsset = (maps = Array.from({ length: 39 }, (_, i) => makeDraft(i))) => ({ version: 1, maps });

test('parses exactly 39 safe online seeds and rejects malformed, offline, oversized, or unsafe input', () => {
  assert.equal(parseDefaultSeeds(seedAsset()).length, 39);
  assert.throws(() => parseDefaultSeeds({ version: 2, maps: seedAsset().maps }), /版本或数量/);
  assert.throws(() => parseDefaultSeeds({ version: 1, maps: [] }), /版本或数量/);
  assert.equal(parseDefaultSeeds({ version: 1, maps: [makeDraft(1)] }).length, 1);
  const offline = seedAsset(); offline.maps[0] = { ...makeDraft(0), kind: 'image', blob: 'nope' };
  assert.throws(() => parseDefaultSeeds(offline), /在线栅格/);
  const unsafe = seedAsset(); unsafe.maps[0] = { ...makeDraft(0), tiles: ['javascript:alert(1)'] };
  assert.throws(() => parseDefaultSeeds(unsafe));
});

test('accepts safe HTTP OVMAP templates and keeps them online', () => {
  const maps = Array.from({ length: 39 }, (_, i) => makeDraft(i));
  maps[0] = {
    name: 'OVMAP test', kind: 'online', format: 'OVMAP', attribution: 'Test provider',
    minzoom: 0, maxzoom: 20, tileSize: 256, scheme: 'xyz',
    tiles: ['http://ovi.example.test/{$z}/{$x}/{$y}.png'], datum: 'wgs84',
    ovmap: { layers: [{ tiles: ['http://ovi.example.test/{$z}/{$x}/{$y}.png'], tileSize: 256, minzoom: 0, maxzoom: 20 }] },
  };
  assert.equal(parseDefaultSeeds({ version: 1, maps })[0].format, 'OVMAP');
  maps[0].ovmap.layers[0].tiles[0] = 'http://u:p@ovi.example.test/{$z}/{$x}/{$y}.png';
  assert.throws(() => parseDefaultSeeds({ version: 1, maps }), /模板无效/);
});

test('asset fetch is Android-appassets-only, bounded, and treats 404 as a no-op', async (t) => {
  const oldLocation = globalThis.location, oldFetch = globalThis.fetch;
  t.after(() => { if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation; globalThis.fetch = oldFetch; });
  globalThis.location = { origin: 'https://example.test' };
  globalThis.fetch = () => { throw new Error('must not fetch outside APK'); };
  assert.equal(await loadDefaultSeeds(), undefined);
  globalThis.location = { origin: 'https://appassets.androidplatform.net' };
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/native/default-map-sources.json');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 404 });
  };
  assert.equal(await loadDefaultSeeds(), undefined);
});

test('seed failure still loads saved maps and reports the initialization error', async () => {
  const saved = [{ id: 'existing', name: 'Saved map' }];
  let message = '';
  const result = await seedThenList(async () => { throw new Error('capacity'); }, async () => {}, async () => saved, (value) => { message = value; });
  assert.equal(result, saved);
  assert.equal(message, 'capacity');
});

function createIndexedDb({ maps = [], marker = undefined, failAdd = false } = {}) {
  const state = { maps: structuredClone(maps), marker: structuredClone(marker), failAdd, version: 0 };
  const names = new Set();
  const db = {
    get objectStoreNames() { return { contains: (name) => names.has(name) }; },
    createObjectStore(name) { names.add(name); return {}; },
    transaction(_storeNames, mode) {
      assert.equal(mode, 'readwrite');
      const staged = { maps: structuredClone(state.maps), marker: structuredClone(state.marker) };
      const tx = { aborted: false, abort() { if (this.aborted) return; this.aborted = true; queueMicrotask(() => this.onabort?.()); },
        objectStore(name) {
          if (name === 'maps') return {
            getAll() { const request = { result: undefined }; queueMicrotask(() => { request.result = structuredClone(staged.maps); request.onsuccess?.(); }); return request; },
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
            add(value) { if (state.failAdd) { tx.abort(); return; } staged.maps.push(structuredClone(value)); },
            delete(id) { staged.maps = staged.maps.filter((item) => item.id !== id); },
          };
          return {
            get(key) { const request = { result: undefined }; queueMicrotask(() => { request.result = staged.marker?.key === key ? structuredClone(staged.marker) : undefined; request.onsuccess?.(); }); return request; },
            put(value) { staged.marker = structuredClone(value); },
          };
        },
      };
      setTimeout(() => {
        if (!tx.aborted) { state.maps = staged.maps; state.marker = staged.marker; tx.oncomplete?.(); }
      }, 0);
      return tx;
    }, close() {},
  };
  return { state, db, indexedDB: { open(name, version) {
    assert.equal(name, 'shantu-map-sources');
    const request = { result: db };
    queueMicrotask(() => {
      if (state.version && version < state.version) { request.error = new DOMException('VersionError', 'VersionError'); request.onerror?.(); return; }
      if (version > state.version) { state.version = version; request.onupgradeneeded?.(); }
      request.onsuccess?.();
    });
    return request;
  } } };
}

async function storageWith(t, fixture, cacheTag) {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = fixture.indexedDB;
  t.after(() => { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; });
  return import(`../modules/mapSources/storage.ts?seed-test=${cacheTag}`);
}

test('initial install seeds once; restart and deletion never restore maps', async (t) => {
  const fixture = createIndexedDb();
  const storage = await storageWith(t, fixture, 'first');
  const seeds = parseDefaultSeeds(seedAsset());
  assert.equal(await storage.ensureDefaultMaps(seeds), true);
  assert.equal(fixture.state.maps.length, 39);
  assert.equal(fixture.state.marker.value, true);
  assert.equal(await storage.ensureDefaultMaps(seeds), false);
  fixture.state.maps = fixture.state.maps.slice(1); // user removes one seed
  const reopened = await storageWith(t, fixture, 'restart');
  assert.equal(await reopened.ensureDefaultMaps(seeds), false);
  assert.equal(fixture.state.maps.length, 38);
});

test('existing identical maps are retained and never duplicated', async (t) => {
  const drafts = parseDefaultSeeds(seedAsset());
  const existing = { ...drafts[0], id: 'user-map', bytes: 123, detail: 'user detail' };
  const fixture = createIndexedDb({ maps: [existing] });
  const storage = await storageWith(t, fixture, 'dedupe');
  await storage.ensureDefaultMaps(drafts);
  assert.equal(fixture.state.maps.length, 39);
  assert.equal(fixture.state.maps[0].id, 'user-map');
  assert.equal(fixture.state.maps[0].detail, 'user detail');
});

test('capacity and transaction failures leave no completion marker or partial rows', async (t) => {
  const drafts = parseDefaultSeeds(seedAsset());
  const full = Array.from({ length: 100 }, (_, i) => ({ ...makeDraft(i), tiles: [`https://saved${i}.example.test/{z}/{x}/{y}.png`], id: `saved-${i}`, bytes: 1 }));
  const capacity = createIndexedDb({ maps: full });
  const capStorage = await storageWith(t, capacity, 'capacity');
  await assert.rejects(capStorage.ensureDefaultMaps(drafts), /容量上限/);
  assert.equal(capacity.state.maps.length, 100);
  assert.equal(capacity.state.marker, undefined);
  const byteHeavy = Array.from({ length: 90 }, (_, i) => ({ ...makeDraft(i), tiles: [`https://saved${i}.example.test/{z}/{x}/{y}.png`], id: `heavy-${i}`, bytes: 3 * 1024 * 1024 }));
  const byteCapacity = createIndexedDb({ maps: byteHeavy });
  const byteStorage = await storageWith(t, byteCapacity, 'byte-capacity');
  await assert.rejects(byteStorage.ensureDefaultMaps(drafts), /容量上限/);
  assert.equal(byteCapacity.state.maps.length, 90);
  assert.equal(byteCapacity.state.marker, undefined);
  const failing = createIndexedDb({ failAdd: true });
  const failStorage = await storageWith(t, failing, 'failure');
  await assert.rejects(failStorage.ensureDefaultMaps(drafts), /保存失败/);
  assert.equal(failing.state.maps.length, 0);
  assert.equal(failing.state.marker, undefined);
});
