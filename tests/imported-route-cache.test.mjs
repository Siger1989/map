import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const mocks = new Map([
  ['./nativeOffline.ts', `
    const s=()=>globalThis.__importedRouteCacheTest;
    export function nativeOffline(){s().nativeCalls++;return s().bridge;}
    export async function downloadNative(){s().nativeDownloadCalls++;}
    export function applyNativeProgress(value){return value;}
  `],
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
  ['./importedRouteDownload.ts', `export function planImportedRouteDownload(){return {urls:[],bounds:[0,0,1,1],count:0,estimatedBytes:0};}`],
]);

const bundled = await build({
  entryPoints: ['modules/outdoor/offline.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'mock-imported-route-backend', setup(build) {
    build.onResolve({ filter: /.*/ }, args => mocks.has(args.path) ? { path: args.path, namespace: 'imported-route-mock' } : undefined);
    build.onLoad({ filter: /.*/, namespace: 'imported-route-mock' }, args => ({ contents: mocks.get(args.path), loader: 'js' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);

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
    nativeCalls: 0, nativeDownloadCalls: 0, bridge: { offlineStart() { state.nativeDownloadCalls++; } },
    sources: new Map([['source-1', { id: 'source-1', name: 'Imported XYZ', kind: 'online' }]]),
    putCount: 0, rows,
  };
  const cache = {
    async match(key) { return rows.get(key)?.clone(); },
    async put(key, response) { state.putCount++; rows.set(key, response.clone()); },
    async delete(key) { return rows.delete(key); },
  };
  const local = new Map();
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => cache } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return local.get(key) ?? null; },
    setItem(key, value) { local.set(key, String(value)); },
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
