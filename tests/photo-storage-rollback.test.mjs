import test from 'node:test';
import assert from 'node:assert/strict';

// Model the IndexedDB version contract and pre-existing stores. In particular,
// requesting v1 against a persisted v3 database must fail with VersionError.
for (const version of [0, 1, 3]) {
  test(`rollback reads the existing photo store at database version ${version}`, async (t) => {
    const photo = {
      id: 'rollback-photo', name: 'sample.jpg', trackId: 'trip', trackName: 'Trip',
      time: 123456, coordinates: [104, 30], kind: 'point',
      preview: new Blob(['synthetic'], { type: 'image/jpeg' }),
      title: 'Keep my title', note: 'Keep my note',
    };
    const stores = new Set(version ? ['photos'] : []);
    if (version === 3) {
      stores.add('photo-index');
      stores.add('photo-previews');
    }
    const created = [];
    const db = {
      version: version || 1,
      objectStoreNames: { contains: (name) => stores.has(name) },
      createObjectStore(name) { created.push(name); stores.add(name); },
      transaction(name, mode) {
        assert.equal(name, 'photos');
        assert.equal(mode, undefined, 'reading must not rewrite the existing data');
        assert.ok(stores.has(name));
        return { objectStore: () => ({ getAll() {
          const request = { result: version ? [photo] : [] };
          queueMicrotask(() => request.onsuccess());
          return request;
        } }) };
      },
      close() {},
    };
    const original = globalThis.indexedDB;
    globalThis.indexedDB = { open(name, requestedVersion) {
      assert.equal(name, 'guanyun-trip-photos');
      const request = { result: db };
      queueMicrotask(() => {
        if (requestedVersion !== undefined && requestedVersion < version) {
          request.error = new DOMException('Database is newer', 'VersionError');
          request.onerror();
          return;
        }
        if (!version) request.onupgradeneeded();
        request.onsuccess();
      });
      return request;
    } };
    t.after(() => {
      if (original === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = original;
    });
    const storage = await import(`../modules/photos/storage.ts?rollback=${version}`);
    assert.deepEqual(await storage.readPhotos(), version ? [photo] : []);
    assert.deepEqual(created, version ? [] : ['photos']);
    assert.equal(db.version, version || 1, 'existing database version is preserved');
    if (version === 3) assert.equal(stores.size, 3, 'newer auxiliary stores are preserved');
  });
}

test('track ID remap updates only photos attached to the finished recording', async (t) => {
  const photos = [
    { id: 'capture-a', trackId: 'record-live', kind: 'point' },
    { id: 'unrelated', trackId: 'other-track', kind: 'point' },
    { id: 'marker-photo', trackId: '', kind: 'annotation', annotationId: 'pin-a' },
  ];
  const puts = [], tx = {
    objectStore: () => ({
      getAll() { const request = { result: photos }; queueMicrotask(() => { request.onsuccess(); queueMicrotask(() => tx.oncomplete()); }); return request; },
      put(value) { puts.push(value); },
    }),
  };
  const db = { objectStoreNames: { contains: () => true }, transaction: (name, mode) => {
    assert.equal(name, 'photos'); assert.equal(mode, 'readwrite'); return tx;
  }, close() {} };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open: () => { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
  t.after(() => { if (previous === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previous; });
  const storage = await import('../modules/photos/storage.ts?track-remap');
  await storage.remapPhotoTrack('record-live', 'deduplicated-track');
  assert.deepEqual(puts, [{ ...photos[0], trackId: 'deduplicated-track' }]);
});
