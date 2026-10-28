import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['modules/map/native/projectionSyncScheduler.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { NativeProjectionSyncScheduler, nativePhotoGroupKey, subscribeNativeProjectionEvents } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function clock() {
  let now = 0, nextId = 0;
  const jobs = new Map();
  return {
    timers: { set(callback, delay) { const id = ++nextId; jobs.set(id, { at: now + delay, callback }); return id; }, clear(id) { jobs.delete(id); } },
    advance(to) {
      while (true) {
        const next = [...jobs.entries()].filter(([, job]) => job.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].callback();
      }
      now = to;
    },
    get now() { return now; }, get pending() { return jobs.size; },
  };
}

test('continuous 80ms frames publish within 180ms using the newest state instead of starving', () => {
  const time = clock(), published = [];
  let latestFrame = -1;
  const scheduler = new NativeProjectionSyncScheduler(() => true, 180, time.timers);
  for (let frame = 0; frame < 10; frame++) {
    time.advance(frame * 80); latestFrame = frame;
    scheduler.schedule(() => published.push({ at: time.now, frame: latestFrame }));
  }
  time.advance(1000);
  assert.deepEqual(published[0], { at: 180, frame: 2 });
  assert.ok(published.length >= 3);
  assert.ok(published.every((p, i) => i === 0 || p.at - published[i - 1].at <= 250));
  assert.equal(published.at(-1).frame, 9);
});

test('a DEM-cache event reprojects a previously blocked photo even without another frame', () => {
  const time = clock(), photoGroups = [];
  let demReady = false;
  const scheduler = new NativeProjectionSyncScheduler(() => true, 180, time.timers);
  const syncAfterProjection = () => scheduler.schedule(() => photoGroups.push(demReady ? ['photo-one', 'photo-two'] : []));
  syncAfterProjection(); time.advance(180);
  assert.deepEqual(photoGroups, [[]]);
  time.advance(200); demReady = true;
  // The production demCache and renderFrame handlers share this same scheduled update.
  syncAfterProjection(); time.advance(380);
  assert.deepEqual(photoGroups, [[], ['photo-one', 'photo-two']]);
});

test('initial frames cannot abort initial ACK ownership, and cleanup cancels pending work', () => {
  const time = clock(); let created = false, published = 0;
  const scheduler = new NativeProjectionSyncScheduler(() => created, 180, time.timers);
  scheduler.schedule(() => published++); time.advance(1000);
  assert.equal(time.pending, 0); assert.equal(published, 0);
  created = true; scheduler.schedule(() => published++);
  assert.equal(time.pending, 1);
  scheduler.cancel(); time.advance(2000);
  assert.equal(time.pending, 0); assert.equal(published, 0);
  scheduler.schedule(() => published++); created = false; time.advance(2200);
  assert.equal(published, 0);
});

test('stable 80ms frames perform one initial full sync then skip expensive JSON and photo reads', () => {
  const time = clock(); let acknowledged = null, fullReads = 0;
  const groups = [{ id: 'first', groupIds: ['first', 'second'] }];
  const scheduler = new NativeProjectionSyncScheduler(() => true, 180, time.timers);
  const frame = () => scheduler.scheduleWhenChanged(() => nativePhotoGroupKey(groups), () => acknowledged, () => {
    fullReads++;
    acknowledged = nativePhotoGroupKey(groups); // Successful render-state ACK only.
  });
  for (let i = 0; i < 40; i++) { time.advance(i * 80); frame(); }
  time.advance(3400);
  assert.equal(fullReads, 1);
  assert.equal(nativePhotoGroupKey([]), '');
});

test('changed group visibility and DEM-ready membership resync while failed ACKs remain retryable', () => {
  const time = clock(); let acknowledged = '', groups = [], successful = false, reads = 0;
  const scheduler = new NativeProjectionSyncScheduler(() => true, 180, time.timers);
  const update = () => scheduler.scheduleWhenChanged(() => nativePhotoGroupKey(groups), () => acknowledged, () => {
    reads++;
    if (successful) acknowledged = nativePhotoGroupKey(groups);
  });
  update(); time.advance(180); assert.equal(reads, 0); // Initial projection blocked: ACK already has no photos.
  groups = [{ id: 'one', groupIds: ['one', 'two'] }];
  update(); time.advance(360); assert.equal(reads, 1);
  successful = true; update(); time.advance(540); assert.equal(reads, 2); // Failed ACK did not commit the key.
  update(); time.advance(720); assert.equal(reads, 2);
  groups = [{ id: 'one', groupIds: ['one'] }, { id: 'two', groupIds: ['two'] }];
  update(); time.advance(900); assert.equal(reads, 3);
  groups = []; update(); time.advance(1080); assert.equal(reads, 4); // Viewport visibility loss clears old map photos.
});

test('group key excludes Blob and business contents so projection gating does not serialize them', () => {
  const poison = { toJSON() { throw new Error('must not serialize photo detail or route terrain'); } };
  assert.equal(nativePhotoGroupKey([{ id: 'one', groupIds: ['one'], detail: poison, sectionTerrain: poison }]),
    nativePhotoGroupKey([{ id: 'one', groupIds: ['one'] }]));
});

test('production default timers keep the Window receiver required by Chromium WebView', () => {
  const time = clock(), oldSet = globalThis.setTimeout, oldClear = globalThis.clearTimeout;
  let calls = 0;
  globalThis.setTimeout = function(callback, delay) {
    assert.equal(this, globalThis, 'unbound Window timer calls throw Illegal invocation in WebView');
    return time.timers.set(callback, delay);
  };
  globalThis.clearTimeout = function(timer) {
    assert.equal(this, globalThis, 'clearTimeout must retain its Window receiver too');
    return time.timers.clear(timer);
  };
  try {
    const scheduler = new NativeProjectionSyncScheduler(() => true);
    scheduler.schedule(() => calls++);
    assert.equal(time.pending, 1);
    time.advance(180); assert.equal(calls, 1);
    scheduler.schedule(() => calls++); scheduler.cancel();
    time.advance(1000); assert.equal(calls, 1); assert.equal(time.pending, 0);
  } finally { globalThis.setTimeout = oldSet; globalThis.clearTimeout = oldClear; }
});

test('production projection subscriptions deliver DEM visibility changes without requiring a later native frame', () => {
  const time = clock(), listeners = new Map();
  let groups = [], acknowledged = '', publications = 0;
  const client = { subscribe(mapId, name, listener) {
    assert.equal(mapId, 'main'); listeners.set(name, listener);
    return () => listeners.delete(name);
  } };
  const scheduler = new NativeProjectionSyncScheduler(() => true, 180, time.timers);
  const unsubscribe = subscribeNativeProjectionEvents(client, 'main', () => {
    scheduler.scheduleWhenChanged(() => nativePhotoGroupKey(groups), () => acknowledged, () => {
      publications++; acknowledged = nativePhotoGroupKey(groups);
    });
  });
  listeners.get('renderFrame')({ sequence: 1 }); time.advance(180);
  assert.equal(publications, 0);
  groups = [{ id: 'photo-one', groupIds: ['photo-one', 'photo-two'] }];
  assert.equal(typeof listeners.get('demCache'), 'function');
  listeners.get('demCache')({ revision: 2 }); time.advance(360);
  assert.equal(publications, 1);
  assert.notEqual(acknowledged, '');
  unsubscribe.forEach(stop => stop()); assert.equal(listeners.size, 0);
});
