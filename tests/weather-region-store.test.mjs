import assert from 'node:assert/strict';
import test from 'node:test';
import { WeatherRegionStore } from '../modules/weather/weatherRegionStore.ts';

const region = (id, bounds) => ({ id, bounds, center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] });
const weather = { rainMm: 0.2, snowCm: 0, cloudCover: 80, time: 1780000000, interval: 900 };
const settle = () => new Promise(resolve => setImmediate(resolve));
const area = b => (b[2] - b[0]) * (b[3] - b[1]);

test('camera changes reuse in-flight work, publish batches progressively and bound concurrency', async () => {
  const requests = [];
  const store = new WeatherRegionStore((samples, signal) => new Promise(resolve => requests.push({ samples, signal, resolve })));
  const samples = Array.from({ length: 32 }, (_, i) => region(String(i), [i, 0, i + 1, 1]));
  const owner = Symbol();
  store.demand(owner, samples);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(r => r.samples.length), [4, 16]);
  store.demand(owner, samples.slice(2));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve(new Map(requests[0].samples.map(r => [r.id, weather])));
  await settle();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].samples.length, 12);
  assert.equal(store.snapshot(samples).cells.length, 4);
  store.demand(owner, []);
  for (const request of requests.slice(1)) request.resolve(new Map());
  await settle();
});

test('a failed batch pauses the remaining queue and recovery probes one small batch first', async () => {
  let now = 1_000;
  const requests = [];
  const store = new WeatherRegionStore(samples => new Promise((resolve, reject) => {
    requests.push({ samples, resolve, reject });
  }), () => now);
  const owner = Symbol();
  const samples = Array.from({ length: 32 }, (_, i) => region(String(i), [i, 0, i + 1, 1]));
  store.demand(owner, samples);
  for (const request of requests) request.reject(new Error('connection failed'));
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(store.snapshot(samples).status, 'unavailable');
  now += 5_001;
  store.demand(owner, samples);
  assert.deepEqual(requests.map(r => r.samples.length), [4, 16, 4]);
  requests[2].resolve(new Map(requests[2].samples.map(r => [r.id, weather])));
  await settle();
  assert.deepEqual(requests.map(r => r.samples.length), [4, 16, 4, 16, 12]);
  store.demand(owner, []);
  for (const request of requests.slice(3)) request.resolve(new Map());
  await settle();
});

test('rate limiting pauses new viewports for the provider retry interval', async () => {
  let now = 1_000;
  const requests = [];
  const store = new WeatherRegionStore(async samples => {
    requests.push(samples);
    if (requests.length === 1) throw Object.assign(new Error('rate limited'), { status: 429, retryAfterMs: 90_000 });
    return new Map(samples.map(r => [r.id, weather]));
  }, () => now);
  const owner = Symbol();
  store.demand(owner, [region('a', [0, 0, 1, 1])]);
  await settle();
  const newView = [region('b', [1, 0, 2, 1])];
  now += 60_001;
  store.demand(owner, newView);
  assert.equal(requests.length, 1);
  now += 30_000;
  store.demand(owner, newView);
  await settle();
  store.demand(owner, []);
  assert.equal(requests.length, 2);
  assert.equal(store.snapshot(newView).cells.length, 1);
});

test('zoom replacement keeps exact old geographic coverage without doubling or extending rain', async () => {
  let now = 1000;
  const store = new WeatherRegionStore(async samples => new Map(samples.map(r => [r.id, weather])), () => now);
  const owner = Symbol();
  const old = [region('a', [0, 0, 1, 1]), region('b', [1, 0, 2, 1])];
  store.demand(owner, old);
  await settle();
  store.demand(owner, []);
  const broad = [region('coarse', [-1, -1, 3, 2])];
  const snapshot = store.snapshot(broad);
  assert.equal(snapshot.cells.reduce((sum, r) => sum + area(r.bounds), 0), 2);
  assert.equal(snapshot.refreshing, true);
  assert.ok(snapshot.cells.every(r => r.bounds[0] >= 0 && r.bounds[2] <= 2 && r.bounds[1] === 0 && r.bounds[3] === 1));
  const wrapped = store.snapshot([region('world-copy', [360, 0, 362, 1])]);
  assert.equal(wrapped.cells.reduce((sum, r) => sum + area(r.bounds), 0), 2);
  now += 31 * 60_000;
  assert.equal(store.snapshot(broad).cells.length, 0);
});

test('a failed refresh retains prior weather with stale status and retries after five seconds', async () => {
  let now = 1000, fails = false, calls = 0;
  const store = new WeatherRegionStore(async samples => {
    calls++;
    if (fails) throw new Error('temporary timeout');
    return new Map(samples.map(r => [r.id, weather]));
  }, () => now);
  const owner = Symbol(), samples = [region('a', [0, 0, 1, 1])];
  store.demand(owner, samples);
  await settle();
  store.demand(owner, []);
  now += 13 * 60_000;
  fails = true;
  store.demand(owner, samples);
  await settle();
  store.demand(owner, []);
  assert.equal(store.snapshot(samples).cells.length, 1);
  // A transport retry deadline does not make the old observation fresh again.
  assert.equal(store.snapshot(samples).stale, true);
  now += 5_001;
  store.demand(owner, samples);
  await settle();
  store.demand(owner, []);
  assert.equal(calls, 3);
});
