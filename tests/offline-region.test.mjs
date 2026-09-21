import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegion, regionEstimate, prepareRegion, downloadTrip, tripPackages, TILEJSON } from '../modules/outdoor/offline.ts';

test('region download rejects invalid or oversized selections before fetching', async () => {
  for (const bounds of [[1, 2, 1, 3], [170, 0, -170, 1], [0, 84, 1, 86], [0, 0, 3, 1], [0, NaN, 1, 2], [0, 1]]) {
    assert.throws(() => validateRegion(bounds));
    await assert.rejects(prepareRegion('invalid', bounds, new AbortController().signal));
  }
  assert.throws(() => regionEstimate([103, 30, 103.01, 30.01], 17));
  assert.throws(() => regionEstimate([103, 30, 105, 32], 14), /700/);
});

test('selected bounds stay exact; interrupted downloads resume from cache and finish without losing the package', async () => {
  const saved = Object.fromEntries(['window', 'caches', 'localStorage', 'fetch'].map(k => [k, globalThis[k]]));
  const entries = new Map(), storage = new Map(), requests = new Map();
  const cache = { match: async url => entries.get(url)?.clone(), put: async (url, response) => entries.set(url, response.clone()) };
  globalThis.window = { location: { origin: 'https://appassets.androidplatform.net' } };
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  globalThis.caches = { open: async () => cache };
  let interrupted = false;
  const controller = new AbortController();
  globalThis.fetch = async url => {
    requests.set(url, (requests.get(url) ?? 0) + 1);
    if (url === TILEJSON) return Response.json({ tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'] });
    if (!interrupted) { interrupted = true; controller.abort(); }
    return new Response('tile');
  };
  try {
    const bounds = [103.51, 30.79, 103.52, 30.80];
    const trip = await prepareRegion('区域', bounds, controller.signal);
    assert.deepEqual(trip.bounds, bounds);
    assert.equal(trip.urls.length, regionEstimate(bounds, 14));
    assert.ok(trip.urls.every(url => !url.includes('tianditu')));
    await assert.rejects(downloadTrip(trip, controller.signal, () => {}));
    assert.equal(tripPackages().length, 1);
    assert.equal(tripPackages()[0].complete, false);
    const cachedBefore = [...entries.keys()];
    const countsBefore = new Map(requests);
    await downloadTrip(tripPackages()[0], new AbortController().signal, () => {});
    const complete = tripPackages()[0];
    assert.equal(complete.id, trip.id);
    assert.equal(complete.complete, true);
    assert.equal(complete.done, complete.urls.length);
    for (const url of cachedBefore) assert.equal(requests.get(url), countsBefore.get(url));
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    await downloadTrip(complete, new AbortController().signal, () => {});
    assert.equal(tripPackages()[0].complete, true);
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
