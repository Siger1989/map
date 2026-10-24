import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const mocks = new Map([
  ['./nativeOffline.ts', `
    const s=()=>globalThis.__importedRouteCacheTest;
    export function nativeOffline(){s().nativeCalls++;return s().bridge;}
    export function nativeRouteOffline(){s().routeChecks++;return s().routeBridge??null;}
    export function canUseNativeRouteDownload(trip){return !!s().routeBridge&&(trip.native||trip.done===0);}
    export async function downloadNative(){s().nativeDownloadCalls++;}
    export function applyNativeProgress(value){return value;}
  `],
  ['./tripStorage.ts', `
    const key='guanyun.trips.v1';
    export function tripPackages(){try{return JSON.parse(localStorage.getItem(key)??'[]')}catch{return []}}
    export function putTrip(trip){const list=tripPackages(),i=list.findIndex(x=>x.id===trip.id);if(i<0)list.push(trip);else list[i]=trip;localStorage.setItem(key,JSON.stringify(list))}
    export async function persistTripManifest(trip){putTrip(trip)}
    export async function loadTripManifest(trip){return trip}
    export async function removeTripManifest(){if(globalThis.__importedRouteCacheTest.failManifestRemoval)throw new Error('manifest deletion failed')}
    export function removeTripIndex(id){localStorage.setItem(key,JSON.stringify(tripPackages().filter(t=>t.id!==id)))}
    export async function hydrateTripPackages(){return tripPackages()}
  `],
  ['./asyncImportedRoutePlan.ts', `export async function planImportedRouteDownloadAsync(){return {urls:[],bounds:[0,0,1,1],count:0,estimatedBytes:0}}`],
  ['../navigation/types.ts', `export const coordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);`],
  ['../terrain/tiles.ts', `export const TERRAIN_URL='/api/terrain/{z}/{x}/{y}.png';`],
  ['./tileCache.ts', `export const cachedMapFetch=async()=>{throw Error('unexpected map fetch')};export const offlineMapOnly=()=>false;`],
  ['./tiandituCache.ts', `
    export const tdtIdentity=()=>null;
    export const resourceCacheKey=url=>url;
    export const resourceFetchUrl=url=>url;
    export async function validateTileResponse(url,response){return (await response.clone().arrayBuffer()).byteLength;}
  `],
  ['./downloadPlan.ts', `
    export const MAX_DOWNLOAD_RESOURCES=20000;
    export const downloadBounds=area=>area.kind==='route'?[0,0,1,1]:area.bounds;
    export const downloadTiles=()=>[];
  `],
  ['./offlineDownloadPolicy.ts', `export const TIANDITU_OFFLINE_DISABLED='disabled';export const canDownloadTrip=()=>true;`],
  ['../mapSources/storage.ts', `export async function readMap(id){return globalThis.__importedRouteCacheTest.sources.get(id)??null;}`],
  ['./importedRouteDownload.ts', `
    export const MAX_IMPORTED_DOWNLOAD_BYTES=1024**3;
    export function assertImportedDownloadBudget(bytes){const limit=globalThis.__importedRouteCacheTest?.byteLimit??MAX_IMPORTED_DOWNLOAD_BYTES;if(!Number.isFinite(bytes)||bytes<0||bytes>limit)throw Error('离线包达到 1 GB 上限，已暂停；请降低清晰度');}
    export function planImportedRouteDownload(){return {urls:[],bounds:[0,0,1,1],count:0,estimatedBytes:0};}
    export function validateImportedDownloadSource(source){
      const templates=source.ovmap?source.ovmap.layers.flatMap(x=>x.tiles):source.tiles??[];
      for(const value of templates){const u=new URL(value.replace(/\\{[^{}]*\\}/g,'0'));const host=u.hostname.toLowerCase();if(host==='tile.openstreetmap.org'||host.endsWith('.tile.openstreetmap.org'))throw Error('该公共地图服务不支持批量下载');if(host==='tianditu.gov.cn'||host.endsWith('.tianditu.gov.cn')||host==='tianditu.com'||host.endsWith('.tianditu.com'))throw Error('天地图离线下载已暂停');}
    }
    export function validateImportedDownloadUrls(urls){for(const value of urls){const host=new URL(value).hostname.toLowerCase();if(host==='tile.openstreetmap.org'||host.endsWith('.tile.openstreetmap.org'))throw Error('该公共地图服务不支持批量下载');if(host==='tianditu.gov.cn'||host.endsWith('.tianditu.gov.cn')||host==='tianditu.com'||host.endsWith('.tianditu.com'))throw Error('天地图离线下载已暂停');}}
  `],
]);

const mockPlugin = { name: 'mock-imported-route-backend', setup(build) {
    build.onResolve({ filter: /.*/ }, args => mocks.has(args.path) ? { path: args.path, namespace: 'imported-route-mock' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'imported-route-mock' }, args => ({ contents: mocks.get(args.path), loader: 'js' }));
  } };
const concurrencyVariant = size => ({ name: `download-concurrency-${size}`, setup(build) {
  build.onLoad({ filter: /modules[\\/]outdoor[\\/]offline\.ts$/ }, async args => ({
    contents: (await readFile(args.path, 'utf8')).replace(
      "trip.provider === 'imported' ? 16 : 3", `trip.provider === 'imported' ? ${size} : 3`),
    loader: 'ts',
  }));
} });
const buildApi = async (size = 16) => {
  const bundled = await build({
    entryPoints: ['modules/outdoor/offline.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [concurrencyVariant(size), mockPlugin],
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
};
const api = await buildApi();
const api8 = await buildApi(8);

const tileBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const imageResponse = () => new Response(tileBytes, { status: 200, headers: { 'Content-Type': 'image/png' } });
const makeTrip = (urls, extra = {}) => ({
  id: 'imported-package', name: 'route · imported', bounds: [0, 0, 1, 1], urls,
  done: 0, bytes: 0, createdAt: 1, complete: false,
  provider: 'imported', sourceId: 'source-1', sourceName: 'Imported XYZ', ...extra,
});

async function environment(t) {
  const keys = ['caches', 'localStorage', '__importedRouteCacheTest'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const rows = new Map();
  const state = {
    nativeCalls: 0, routeChecks: 0, nativeDownloadCalls: 0, bridge: { offlineStart() { state.nativeDownloadCalls++; } },
    sources: new Map([['source-1', { id: 'source-1', name: 'Imported XYZ', kind: 'online' }]]),
    putCount: 0, indexWrites: 0, rows,
  };
  const cache = {
    async match(key) { return rows.get(key)?.clone(); },
    async put(key, response) {
      if (state.writeDelayMs) await new Promise(resolve => setTimeout(resolve, state.writeDelayMs));
      state.putCount++; rows.set(key, response.clone());
    },
    async delete(key) { return rows.delete(key); },
  };
  const local = new Map();
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => cache } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return local.get(key) ?? null; },
    setItem(key, value) { state.indexWrites++; local.set(key, String(value)); },
    removeItem(key) { local.delete(key); },
  } });
  Object.defineProperty(globalThis, '__importedRouteCacheTest', { configurable: true, value: state });
  t.after(() => {
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  return state;
}

test('imported route saves one valid image, reuses its cached body, verifies complete, and never calls native bridge', async t => {
  const state = await environment(t);
  let networkCalls = 0;
  const fetchImported = async () => { networkCalls++; return imageResponse(); };
  const trip = makeTrip(['https://tiles.example.test/12/1/2.png']);
  const signal = new AbortController().signal;
  await api.downloadTrip(trip, signal, () => {}, fetchImported);
  assert.equal(networkCalls, 1);
  assert.equal(state.putCount, 1);
  assert.equal(state.rows.size, 1);
  await api.downloadTrip(trip, signal, () => {}, fetchImported);
  assert.equal(networkCalls, 1);
  assert.equal(state.putCount, 1);
  const verified = await api.verifyTrip(trip);
  assert.equal(verified.done, 1);
  assert.equal(verified.bytes, tileBytes.byteLength);
  assert.equal(verified.complete, true);
  assert.equal(state.nativeCalls, 0);
  assert.equal(state.nativeDownloadCalls, 0);
});

test('only the explicit native route-download capability redirects imported packages', async t => {
  const state = await environment(t);
  state.routeBridge = {};
  const trip = makeTrip(['https://tiles.example.test/12/4/4.png']);
  await api.downloadTrip(trip, new AbortController().signal, () => {});
  assert.equal(state.nativeDownloadCalls, 1);
  assert.equal(state.rows.size, 0);
});

test('legacy browser partial packages stay on browser cache when native route support appears', async t => {
  const state = await environment(t);
  state.routeBridge = {};
  const trip = makeTrip(['https://tiles.example.test/12/4/5.png'], {done: 1, bytes: tileBytes.byteLength});
  let calls = 0;
  await api.downloadTrip(trip, new AbortController().signal, () => {}, async () => { calls++; return imageResponse(); });
  assert.equal(calls, 1);
  assert.equal(state.nativeDownloadCalls, 0);
  assert.equal(state.rows.size, 1);
});

test('an HTML 200 body is rejected and never stored as an imported map tile', async t => {
  const state = await environment(t);
  let networkCalls = 0;
  const url = 'https://tiles.example.test/12/3/4.png';
  const trip = makeTrip([url]);
  await assert.rejects(
    api.downloadTrip(trip, new AbortController().signal, () => {}, async () => {
      networkCalls++;
      return new Response('<html>quota page</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    }),
    /图源请求失败，下载已暂停/,
  );
  assert.equal(networkCalls, 1);
  assert.equal(state.putCount, 0);
  assert.equal(state.rows.size, 0);
});

test('a 429 is fatal for imported downloads and does not retry', async t => {
  const state = await environment(t);
  let networkCalls = 0;
  const trip = makeTrip(['https://tiles.example.test/12/5/6.png']);
  await assert.rejects(
    api.downloadTrip(trip, new AbortController().signal, () => {}, async () => {
      networkCalls++;
      return new Response('rate limited', { status: 429 });
    }),
    /授权或服务额度受限/,
  );
  assert.equal(networkCalls, 1);
  assert.equal(state.putCount, 0);
  assert.equal(state.rows.size, 0);
  assert.equal(state.nativeCalls, 0);
});

test('imported downloads use a bounded sixteen-request pool and resume by fetching only missing URLs', async t => {
  const state = await environment(t);
  const urls = Array.from({length: 24},(_,i)=>`https://tiles.example.test/12/${i+1}/${i+1}.png`);
  const trip = makeTrip(urls);
  const controller = new AbortController();
  const attempts = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const firstPass = api.downloadTrip(trip, controller.signal, () => {}, async (url) => {
      attempts.push(url);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (inFlight === 16) { controller.abort(); allStarted(); }
        await gate;
        return imageResponse();
      } finally {
        inFlight--;
      }
    });
  await started;
  release();
  await assert.rejects(firstPass, /下载已暂停/);
  assert.equal(maxInFlight, 16);
  assert.ok(state.rows.size >= 1 && state.rows.size <= 16, 'only already-started requests may complete after pause');

  await api.downloadTrip(trip, new AbortController().signal, () => {}, async (url) => {
    attempts.push(url);
    return imageResponse();
  });
  assert.equal(attempts.length, urls.length, 'resume requests only the URLs absent from cache');
  assert.equal(state.rows.size, urls.length);
});

test('first imported failure stops scheduling, settles active requests, and checkpoints successful writes', async t => {
  const state = await environment(t);
  const urls = Array.from({length: 17},(_,i)=>`https://tiles.example.test/12/${i+1}/1.png`);
  const trip = makeTrip(urls);
  let inFlight = 0, maxInFlight = 0, networkCalls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  let allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const pending = api.downloadTrip(trip, new AbortController().signal, () => {}, async (url) => {
    networkCalls++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    if (inFlight === 16) allStarted();
    try {
      await gate;
      if (url === urls[0]) return new Response('limited', {status: 429});
      return imageResponse();
    } finally { inFlight--; }
  });
  await started;
  release();
  await assert.rejects(pending, /授权或服务额度受限/);
  assert.equal(maxInFlight, 16);
  assert.equal(networkCalls, 16, 'the worker pool must not start queued URLs after the first failure');
  assert.equal(inFlight, 0, 'failure is reported only after active requests settle');
  assert.equal(state.rows.size, 15);
  assert.equal(state.putCount, 15);
  assert.equal(state.indexWrites, 2, 'failed transfer persists an initial and settled checkpoint');
  const saved = JSON.parse(globalThis.localStorage.getItem('guanyun.trips.v1'))[0];
  assert.equal(saved.done, 15);
  assert.equal(saved.bytes, tileBytes.byteLength * 15);
});

test('concurrent tile writes reserve bytes before each asynchronous cache put', async t => {
  const state = await environment(t);
  state.byteLimit = tileBytes.byteLength * 3;
  const urls = Array.from({length: 24},(_,i)=>`https://tiles.example.test/12/${i+1}/10.png`);
  const trip = makeTrip(urls);
  state.rows.set(urls[0], imageResponse());
  let inFlight = 0, maxInFlight = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  let allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const pending = api.downloadTrip(trip, new AbortController().signal, () => {}, async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    if (inFlight === 16) allStarted();
    try { await gate; return imageResponse(); } finally { inFlight--; }
  });
  await started;
  release();
  await assert.rejects(pending, /离线包达到/);
  assert.equal(maxInFlight, 16);
  const saved = JSON.parse(globalThis.localStorage.getItem('guanyun.trips.v1'))[0];
  assert.equal(saved.done, 3, 'cached tile plus only two writes that fit the shared budget');
  assert.equal(saved.bytes, tileBytes.byteLength * 3);
});

test('controlled delayed-tile simulation compares the real 8 and 16 worker download paths', async t => {
  const state = await environment(t);
  state.writeDelayMs = 3;
  const urls = Array.from({length: 32},(_,i)=>`https://tiles.example.test/12/${i+1}/20.png`);
  const trip = makeTrip(urls);
  const measure = async (runner, poolSize) => {
    state.rows.clear(); state.putCount = 0; state.indexWrites = 0;
    let active = 0, peak = 0;
    const started = performance.now();
    await runner.downloadTrip(trip, new AbortController().signal, () => {}, async () => {
      active++; peak = Math.max(peak, active);
      try { await new Promise(resolve => setTimeout(resolve, 20)); return imageResponse(); }
      finally { active--; }
    });
    return { poolSize, elapsedMs: performance.now() - started, peak, writes: state.putCount };
  };
  const eight = await measure(api8, 8);
  const sixteen = await measure(api, 16);
  assert.equal(eight.peak, 8);
  assert.equal(sixteen.peak, 16);
  assert.equal(eight.writes, urls.length);
  assert.equal(sixteen.writes, urls.length);
  // Record throughput without making shared-runner scheduling a correctness gate.
  console.log(`simulated 32 tiles, 20ms fetch + 3ms cache put: 8=${eight.elapsedMs.toFixed(1)}ms peak=${eight.peak} writes=${eight.writes}; 16=${sixteen.elapsedMs.toFixed(1)}ms peak=${sixteen.peak} writes=${sixteen.writes}`);
});

test('oversized single map image reports the per-image limit', async t => {
  const state = await environment(t);
  state.bridge = null;
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const large = new Uint8Array(8 * 1024 * 1024 + 1);
  large.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; return new Response(large); };
  const trip = makeTrip(['https://tiles.example.test/12/1/1.png'], {provider: 'openfreemap'});
  try {
    await assert.rejects(api.downloadTrip(trip, new AbortController().signal, () => {}), /单张地图图像超过 8MB 上限/);
    assert.equal(fetchCalls, 1);
  } finally {
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
  }
});

test('route progress throttles index writes and reuses only validated cached image bytes', async t => {
  const state = await environment(t);
  const urls = Array.from({length: 12},(_,i)=>`https://tiles.example.test/12/${i+1}/9.png`);
  const trip = makeTrip(urls);
  state.rows.set(urls[0], imageResponse());
  state.rows.set(urls[1], new Response('<html>bad</html>', {status: 200}));
  let networkCalls = 0, progressCalls = 0;
  await api.downloadTrip(trip, new AbortController().signal, () => { progressCalls++; }, async () => { networkCalls++; return imageResponse(); });
  assert.equal(networkCalls, urls.length - 1);
  assert.equal(state.rows.size, urls.length);
  assert.equal(state.putCount, urls.length - 1);
  assert.ok(state.indexWrites <= 3, 'metadata index is not rewritten for every tile');
  assert.ok(progressCalls <= 3, 'progress updates are throttled with forced start/final checkpoints');
  const saved = JSON.parse(globalThis.localStorage.getItem('guanyun.trips.v1'))[0];
  assert.equal(saved.done, urls.length);
  assert.equal(saved.bytes, tileBytes.byteLength * urls.length);
});

test('failed manifest deletion restores the compact package index for recovery', async t => {
  const state = await environment(t);
  state.bridge = null;
  state.failManifestRemoval = true;
  const trip = makeTrip(['https://tiles.example.test/12/2/9.png'], {manifest: true, urlCount: 1});
  api.putTrip(trip);
  await assert.rejects(api.removeTrip(trip), /manifest deletion failed/);
  const saved = api.tripPackages().find(item => item.id === trip.id);
  assert.ok(saved, 'package index survives so the user can retry or recover the manifest');
  assert.deepEqual(saved.urls, trip.urls);
});

test('resuming an imported package rechecks its current source and saved URLs before any fetch', async t => {
  const state = await environment(t);
  let networkCalls = 0;
  const trip = makeTrip(['https://a.tile.openstreetmap.org/12/5/6.png']);
  await assert.rejects(
    api.downloadTrip(trip, new AbortController().signal, () => {}, async () => {
      networkCalls++;
      return imageResponse();
    }),
    /不支持批量下载/,
  );
  assert.equal(networkCalls, 0);
  assert.equal(state.putCount, 0);

  state.sources.set('source-1', { id: 'source-1', name: 'Previously edited', kind: 'online', tiles: ['https://t0.tianditu.gov.cn/{z}/{x}/{y}.png'] });
  const ordinaryTrip = makeTrip(['https://tiles.example.test/12/5/6.png']);
  await assert.rejects(
    api.downloadTrip(ordinaryTrip, new AbortController().signal, () => {}, async () => {
      networkCalls++;
      return imageResponse();
    }),
    /天地图离线下载已暂停/,
  );
  assert.equal(networkCalls, 0);
});

test('verifyTrip does not mark a cached HTML 200 body as a complete package', async t => {
  const state = await environment(t);
  const url = 'https://tiles.example.test/12/7/8.png';
  state.rows.set(url, new Response('<html>error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  const trip = makeTrip([url]);
  const verified = await api.verifyTrip(trip);
  assert.equal(verified.done, 0);
  assert.equal(verified.bytes, 0);
  assert.equal(verified.complete, false);
});

test('imported route package persists complete deduplicated route names and keeps legacy fallback metadata', async t => {
  await environment(t);
  const source = {
    id: 'source-1', name: 'Imported XYZ', kind: 'online',
    tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'],
    scheme: 'xyz', tileSize: 256, minzoom: 0, maxzoom: 18,
  };
  globalThis.__importedRouteCacheTest.sources.set(source.id, source);
  const area = { kind: 'route', segments: [[[0, 0], [1, 1]]], bufferKm: 4 };
  const names = [' Route A ', 'Route B', 'Route A', '', 'X'.repeat(75)];
  const trip = await api.prepareImportedRoutePackage('Batch cache', area, source, 14, new AbortController().signal, names);
  assert.deepEqual(trip.routeNames, ['Route A', 'Route B', 'X'.repeat(60)]);
  assert.deepEqual(api.tripPackages().find(item => item.id === trip.id)?.routeNames, trip.routeNames, 'route names are persisted in the existing package index');

  const legacyStyle = await api.prepareImportedRoutePackage('Single route', area, source, 14, new AbortController().signal);
  assert.deepEqual(legacyStyle.routeNames, ['Single route']);
});
