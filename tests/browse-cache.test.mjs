import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowseCacheEngine } from '../modules/outdoor/browseCache.ts';

function memoryStorage({ failWrites = false } = {}) {
  const rows = new Map();
  return {
    rows,
    async get(key) { const row = rows.get(key); return row && { ...row, body: row.body.slice(0) }; },
    async write(row) {
      if (failWrites) throw new Error('quota exceeded');
      rows.set(row.key, { ...row, body: row.body.slice(0) });
    },
    async list() { return [...rows.values()].map(({ body, ...meta }) => ({ ...meta, bytes: body.byteLength })); },
    async touch(key, lastAccess) { const row = rows.get(key); if (row) row.lastAccess = lastAccess; },
    async remove(keys) { for (const key of keys) rows.delete(key); },
    async clear() { rows.clear(); },
  };
}
const tile = (x) => ({ z: 12, x, y: 20 });
const image = (body = 'tile', headers = {}) => new Response(new Uint8Array([137,80,78,71,13,10,26,10,...new TextEncoder().encode(body)]), {
  status: 200, headers: { 'Content-Type': 'image/png', ...headers },
});
const imageText = async (response) => new TextDecoder().decode((await response.arrayBuffer()).slice(8));
const call = (engine, url, fetcher, opts = {}, signal = new AbortController().signal) =>
  engine.browseCachedFetch(url, signal, fetcher, { tile: tile(1), ...opts });

test('serves fresh cache hits without calling the network and tracks route metadata', async () => {
  const storage = memoryStorage();
  const engine = createBrowseCacheEngine({ storage, now: () => 10_000 });
  let count = 0;
  await call(engine, '/tile/1.png', async () => { count++; return image('first'); });
  await engine.flush();
  await call(engine, '/tile/1.png', async () => { count++; return image('second'); });
  engine.setBrowseCachePriority(t => t.x === 1);
  assert.equal(count, 1);
  assert.equal(await imageText(await call(engine, '/tile/1.png', async () => image())), 'first');
  assert.deepEqual(await engine.browseCacheStats(), { count: 1, bytes: 13, limitBytes: 256 * 1024 * 1024, routeCount: 1 });
});

test('cacheable false still serves a prior entry but never writes a miss', async () => {
  const engine = createBrowseCacheEngine({ storage: memoryStorage() });
  await call(engine, '/read-only', async () => image('saved'));
  await engine.flush();
  let requests = 0;
  assert.equal(await imageText(await call(engine, '/read-only', async () => { requests++; return image(); }, { cacheable: false })), 'saved');
  assert.equal(requests, 0);
  await call(engine, '/no-write', async () => { requests++; return image(); }, { cacheable: false });
  assert.equal((await engine.browseCacheStats()).count, 1);
});

test('skips errors, opaque responses, non-tile payloads, no-store, and corrupt cache records', async () => {
  const storage = memoryStorage();
  const engine = createBrowseCacheEngine({ storage });
  await call(engine, '/error', async () => new Response('denied', { status: 403 }));
  await call(engine, '/opaque', async () => ({ ok: true, status: 200, type: 'opaque' }));
  await call(engine, '/html', async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
  await call(engine, '/json', async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
  await call(engine, '/nostore', async () => image('private', { 'Cache-Control': 'no-store' }));
  assert.equal(storage.rows.size, 0);
  storage.rows.set('/corrupt', { key: '/corrupt', body: new ArrayBuffer(0), status: 200, contentType: 'image/png', expiresAt: Date.now() + 10000, lastAccess: 1, tile: tile(1) });
  let fetched = 0;
  assert.equal(await imageText(await call(engine, '/corrupt', async () => { fetched++; return image('ok'); })), 'ok');
  assert.equal(fetched, 1);
});

test('caps server freshness at seven days, expires entries, and accepts protobuf tiles', async () => {
  let now = 100_000;
  const engine = createBrowseCacheEngine({ storage: memoryStorage(), now: () => now });
  const protobuf = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/x-protobuf', 'Cache-Control': 'max-age=9999999' } });
  await call(engine, '/vector', protobuf);
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 1);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  assert.equal((await engine.browseCacheStats()).count, 1);
  await call(engine, '/expired', async () => image('old', { 'Cache-Control': 'max-age=0' }));
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 1);
  assert.equal((await engine.browseCacheStats()).bytes, 3);
});

test('evicts least-recent non-route tiles before route tiles and applies current route callback', async () => {
  const engine = createBrowseCacheEngine({ storage: memoryStorage(), limitBytes: 26, entryBytesLimit: 16 });
  await call(engine, '/route', async () => image('rrrr'), { tile: tile(1) });
  await call(engine, '/other', async () => image('oooo'), { tile: tile(2) });
  await engine.flush();
  engine.setBrowseCachePriority(t => t.x === 1);
  await call(engine, '/new', async () => image('nnnn'), { tile: tile(3) });
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 2);
  assert.equal((await engine.browseCacheStats()).routeCount, 1);
});

test('evicts a newly requested far tile when every stored tile is route-priority', async () => {
  const engine = createBrowseCacheEngine({ storage: memoryStorage(), limitBytes: 26, entryBytesLimit: 16 });
  await call(engine, '/route-a', async () => image('aaaa'), { tile: tile(1) });
  await engine.flush();
  await call(engine, '/route-b', async () => image('bbbb'), { tile: tile(2) });
  await engine.flush();
  engine.setBrowseCachePriority(t => t.x === 1 || t.x === 2);
  await call(engine, '/far', async () => image('ffff'), { tile: tile(3) });
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 2);
  assert.equal((await engine.browseCacheStats()).routeCount, 2);
});

test('offline can read stale tiles; stats do not prune them and TileJSON requires a valid tile list', async () => {
  let now = 1000;
  const engine = createBrowseCacheEngine({ storage: memoryStorage(), now: () => now });
  await call(engine, '/stale', async () => image('old', { 'Cache-Control': 'max-age=1' }));
  await engine.flush();
  now += 2000;
  assert.equal((await engine.browseCacheStats()).count, 1);
  let fetched = 0;
  assert.equal(await imageText(await call(engine, '/stale', async () => { fetched++; return image('new'); }, { allowStale: true })), 'old');
  assert.equal(fetched, 0);
  const metadataUrl = 'https://tiles.openfreemap.org/planet';
  const metadataBody = JSON.stringify({ tiles: ['https://tiles.openfreemap.org/{z}/{x}/{y}.pbf'] });
  const metadataResponse = await call(engine, metadataUrl, async () => new Response(metadataBody, { headers: { 'Content-Type': 'application/json' } }), { allowTileJson: true });
  assert.equal(await metadataResponse.text(), metadataBody);
  await engine.flush();
  let metadataRequests = 0;
  const cachedMetadata = await call(engine, metadataUrl, async () => { metadataRequests++; return new Response('missing'); }, { allowTileJson: true });
  assert.equal(await cachedMetadata.text(), metadataBody);
  assert.equal(metadataRequests, 0);
  await call(engine, '/bad-json', async () => new Response('{"error":"bad"}', { headers: { 'Content-Type': 'application/json' } }), { allowTileJson: true });
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 1);
});

test('clear during a slow cache lookup suppresses the stale hit', async () => {
  const backing = memoryStorage();
  const engine = createBrowseCacheEngine({ storage: backing });
  await call(engine, '/slow-hit', async () => image('stored'));
  await engine.flush();
  const get = backing.get.bind(backing);
  let release;
  backing.get = async key => { const value = await get(key); await new Promise(r => { release = r; }); return value; };
  let fetched = 0;
  const pending = call(engine, '/slow-hit', async () => { fetched++; return image('fresh'); });
  while (!release) await Promise.resolve();
  await engine.clearBrowseCache();
  release();
  assert.equal(await imageText(await pending), 'fresh');
  await engine.flush();
  assert.equal(fetched, 1);
  assert.equal((await engine.browseCacheStats()).count, 0);
});

test('abort while cloning a body prevents the queued cache write', async () => {
  const storage = memoryStorage();
  const engine = createBrowseCacheEngine({ storage });
  const controller = new AbortController();
  let release;
  const response = image('clone');
  response.clone = () => ({ arrayBuffer: () => new Promise(r => { release = r; }) });
  await call(engine, '/clone-abort', async () => response, {}, controller.signal);
  while (!release) await Promise.resolve();
  controller.abort();
  release(new Uint8Array([137,80,78,71,13,10,26,10,99]).buffer);
  await engine.flush();
  assert.equal(storage.rows.size, 0);
});

test('clear invalidates a response still in flight so it cannot refill the cache', async () => {
  const engine = createBrowseCacheEngine({ storage: memoryStorage() });
  let resolve;
  const pending = call(engine, '/late', () => new Promise(r => { resolve = r; }));
  await Promise.resolve();
  await engine.clearBrowseCache();
  resolve(image('late'));
  await pending;
  await engine.flush();
  assert.equal((await engine.browseCacheStats()).count, 0);
});

test('aborted requests are not delivered or cached, and quota failures preserve network responses', async () => {
  const storage = memoryStorage({ failWrites: true });
  const engine = createBrowseCacheEngine({ storage });
  const controller = new AbortController();
  let resolve;
  const aborted = call(engine, '/abort', () => new Promise(r => { resolve = r; }), {}, controller.signal);
  await Promise.resolve();
  controller.abort();
  resolve(image('late'));
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.equal(await imageText(await call(engine, '/quota', async () => image('online'))), 'online');
  await engine.flush();
  assert.equal(storage.rows.size, 0);
});
