import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const workerPlugin = {
  name: 'worker-url',
  setup(build) {
    build.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'worker-url', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export default "worker.js"' }));
  },
};
const bundled = await build({
  entryPoints: ['modules/mapSources/RasterCoordinates.ts', 'modules/mapSources/sharedTileFetch.ts', 'modules/mapSources/coordinates.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, outdir: '.openai/raster-scheduler-tests', plugins: [workerPlugin],
});
const modules = await Promise.all(bundled.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)));
const { RasterCoordinates } = modules.find(module => module.RasterCoordinates);
test('WGS84 rasters use source-local parent fallback and preserve 512px output without a warp worker', async () => {
  const originalBitmap = globalThis.createImageBitmap, originalCanvas = globalThis.OffscreenCanvas;
  const draws = [], requested = [];
  const png = Uint8Array.of(137,80,78,71,13,10,26,10).buffer;
  globalThis.createImageBitmap = async () => ({width:512,height:512,close(){}});
  globalThis.OffscreenCanvas = class {
    constructor(width,height) { this.width=width;this.height=height; }
    getContext() { return {drawImage: (...args) => draws.push(args.slice(1))}; }
    async convertToBlob() { return new Blob([png]); }
  };
  const source={id:'source',type:'raster',tileSize:512,minzoom:9,maxzoom:18,scheme:'xyz',tiles:['https://tiles.example.test/{z}/{x}/{y}.png'],setTiles(tiles){this.tiles=tiles;}};
  const coordinates=new RasterCoordinates({getSource:()=>source},async()=>({data:png}));
  coordinates.fetch=async url=>{
    requested.push(url);
    const zoom=Number(new URL(url).pathname.split('/')[1]);
    return zoom>10 ? new Response(null,{status:404}) : new Response(png);
  };
  try {
    coordinates.sync(['source'],'wgs84');
    assert.match(source.tiles[0],/^shantu-crs-/);
    const url=source.tiles[0].replace('{z}','12').replace('{x}','4001').replace('{y}','2003');
    const result=await coordinates.protocol({url},new AbortController());
    assert.equal(result.data.byteLength,png.byteLength);
    assert.deepEqual(requested.map(url=>new URL(url).pathname),['/12/4001/2003.png','/11/2000/1001.png','/10/1000/500.png']);
    assert.deepEqual(draws,[[128,384,128,128,0,0,512,512]]);
  } finally {coordinates.dispose();globalThis.createImageBitmap=originalBitmap;globalThis.OffscreenCanvas=originalCanvas;}
});

test('WGS84 authentication errors retain their failure and never request lower levels', async () => {
  const source={id:'source',type:'raster',minzoom:0,scheme:'xyz',tiles:['https://denied.example.test/{z}/{x}/{y}.png'],setTiles(tiles){this.tiles=tiles;}};
  const coordinates=new RasterCoordinates({getSource:()=>source},async()=>({data:new ArrayBuffer(1)}));
  let calls=0;
  coordinates.fetch=async()=>{calls++;return new Response(null,{status:403});};
  try {
    coordinates.sync(['source'],'wgs84');
    await assert.rejects(coordinates.protocol({url:source.tiles[0].replace('{z}','12').replace('{x}','1').replace('{y}','1')},new AbortController()),/403/);
    assert.equal(calls,1);
  } finally {coordinates.dispose();}
});

test('initial source metadata cannot restore raw URLs over the coverage fallback protocol', () => {
  const original=['https://late-metadata.example.test/{z}/{x}/{y}.png'];
  const source={id:'source',type:'raster',minzoom:0,scheme:'xyz',tiles:[...original],setTiles(tiles){this.tiles=tiles;}};
  let listener;
  const coordinates=new RasterCoordinates({getSource:()=>source,on:(_event,callback)=>{listener=callback;},off:()=>{}},async()=>({data:new ArrayBuffer(1)}));
  try {
    coordinates.sync(['source'],'wgs84');
    const wrapped=source.tiles[0];
    source.tiles=[...original];
    listener();
    assert.equal(source.tiles[0],wrapped);
    listener();
    assert.equal(source.tiles[0],wrapped);
  } finally {coordinates.dispose();}
});
const { SharedTileFetch } = modules.find(module => module.SharedTileFetch);
const { warpPlan } = modules.find(module => module.warpPlan);

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('source scheduler caps active fetches at four and drains in waves', async () => {
  const scheduler = new SharedTileFetch(4, 96), gates = [], starts = [];
  const requests = Array.from({ length: 10 }, (_, i) => {
    const gate = deferred(); gates.push(gate);
    return scheduler.request(`tile-${i}`, new AbortController().signal, async () => {
      starts.push(i);
      return gate.promise;
    });
  });
  await tick();
  assert.equal(starts.length, 4);
  for (let offset = 0; offset < 10; offset += 4) {
    for (const gate of gates.slice(offset, offset + 4)) gate.resolve(new ArrayBuffer(1));
    await tick();
    assert.equal(starts.length, Math.min(offset + 8, 10));
  }
  await Promise.all(requests);
  assert.equal(starts.length, 10);
});

test('same binding key shares one raw request and gives each caller its own buffer', async () => {
  const scheduler = new SharedTileFetch(4, 96), gate = deferred(), controllerA = new AbortController(), controllerB = new AbortController();
  let calls = 0;
  const fetchTile = async () => { calls++; return gate.promise; };
  const a = scheduler.request('binding-7\0https://tiles.test/1/0/0', controllerA.signal, fetchTile);
  const b = scheduler.request('binding-7\0https://tiles.test/1/0/0', controllerB.signal, fetchTile);
  await tick();
  assert.equal(calls, 1);
  const original = Uint8Array.of(4, 5, 6).buffer;
  gate.resolve(original);
  const [copyA, copyB] = await Promise.all([a, b]);
  assert.notEqual(copyA, copyB);
  assert.notEqual(copyA, original);
  assert.deepEqual([...new Uint8Array(copyA)], [4, 5, 6]);
  assert.deepEqual([...new Uint8Array(copyB)], [4, 5, 6]);
});

test('adjacent corrected outputs reuse completed raw inputs within a byte-bounded LRU', async () => {
  const urls = ['https://tiles.test/{z}/{x}/{y}.png'];
  const inputs = [];
  for (const x of [32760, 32761, 32762]) {
    const plan = warpPlan(16, x, 32600, 256, 'gcj02');
    const keys = [];
    for (let row = 0; row < plan.height; row++) for (let col = 0; col < plan.width; col++) {
      const tx = ((plan.left + col) % 2 ** 16 + 2 ** 16) % 2 ** 16;
      const ty = plan.top + row;
      keys.push(`binding-1\0${urls[0].replace('{z}', '16').replace('{x}', String(tx)).replace('{y}', String(ty))}`);
    }
    inputs.push(keys);
  }
  const measure = async maxCacheBytes => {
    const scheduler = new SharedTileFetch(4, 96, maxCacheBytes);
    let calls = 0;
    for (const output of inputs) for (const key of output)
      await scheduler.request(key, new AbortController().signal, async () => { calls++; return new ArrayBuffer(64); });
    return calls;
  };
  const before = await measure(0), after = await measure(1024 * 1024);
  assert.ok(after < before, `completed-input cache must reduce requests (${before} -> ${after})`);
  console.log(`controlled adjacent-output requests: before=${before}, after=${after}`);
});

test('completed raw cache returns isolated buffers, enforces byte LRU, and clear drops binding data', async () => {
  const scheduler = new SharedTileFetch(1, 4, 5);
  let calls = 0;
  const fetchTile = async () => { calls++; return Uint8Array.of(calls, 2, 3).buffer; };
  const first = await scheduler.request('binding-a/tile-1', new AbortController().signal, fetchTile);
  new Uint8Array(first)[0] = 99;
  const hit = await scheduler.request('binding-a/tile-1', new AbortController().signal, fetchTile);
  assert.deepEqual([...new Uint8Array(hit)], [1, 2, 3]);
  assert.notEqual(hit, first);
  assert.deepEqual(scheduler.snapshot(), {
    active: 0, pending: 0, cacheEntries: 1, cacheBytes: 3, cacheHits: 1, fetchStarts: 1, sharedJoins: 0,
  });
  await scheduler.request('binding-a/tile-2', new AbortController().signal, fetchTile);
  await scheduler.request('binding-a/tile-3', new AbortController().signal, fetchTile);
  await scheduler.request('binding-a/tile-1', new AbortController().signal, fetchTile);
  assert.equal(calls, 4, 'byte budget evicts the least recently used three-byte tile');
  await scheduler.request('binding-b/tile-1', new AbortController().signal, fetchTile);
  assert.equal(calls, 5, 'a different binding identity never hits the old key');
  scheduler.clear();
  assert.equal(scheduler.snapshot().cacheBytes, 0);
  await scheduler.request('binding-b/tile-1', new AbortController().signal, fetchTile);
  assert.equal(calls, 6, 'clear drops completed data');
});

test('forget evicts selected completed inputs while preserving unrelated hits and retryability', async () => {
  const scheduler = new SharedTileFetch(1, 4, 16), calls = new Map();
  const fetchTile = key => async () => {
    calls.set(key, (calls.get(key) ?? 0) + 1);
    if (key === 'bad-once' && calls.get(key) === 1) throw Error('decode source failed');
    return Uint8Array.of(calls.get(key)).buffer;
  };
  await assert.rejects(scheduler.request('bad-once', new AbortController().signal, fetchTile('bad-once')), /decode source failed/);
  const retried = await scheduler.request('bad-once', new AbortController().signal, fetchTile('bad-once'));
  assert.deepEqual([...new Uint8Array(retried)], [2]);
  await scheduler.request('keep', new AbortController().signal, fetchTile('keep'));
  const beforeBytes = scheduler.snapshot().cacheBytes;
  scheduler.forget(['bad-once']);
  assert.equal(scheduler.snapshot().cacheBytes, beforeBytes - 1);
  await scheduler.request('keep', new AbortController().signal, fetchTile('keep'));
  assert.equal(calls.get('keep'), 1, 'unrelated cache entry remains a hit');
  const badAgain = await scheduler.request('bad-once', new AbortController().signal, fetchTile('bad-once'));
  assert.deepEqual([...new Uint8Array(badAgain)], [3], 'forgotten key retries from the source');
  assert.equal(calls.get('bad-once'), 3);
});

test('a fetch cancelled by all subscribers never populates completed cache', async () => {
  const scheduler = new SharedTileFetch(1, 4), gate = deferred();
  const controller = new AbortController();
  let calls = 0;
  const pending = scheduler.request('cancelled-tile', controller.signal, async () => { calls++; return gate.promise; });
  await tick();
  controller.abort(new DOMException('caller left', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  gate.resolve(Uint8Array.of(7).buffer);
  await tick();
  const retry = await scheduler.request('cancelled-tile', new AbortController().signal, async () => { calls++; return Uint8Array.of(8).buffer; });
  assert.equal(calls, 2);
  assert.deepEqual([...new Uint8Array(retry)], [8]);
});

test('aborting one subscriber leaves shared fetch alive; aborting all releases its slot', async () => {
  const scheduler = new SharedTileFetch(1, 4), gate = deferred();
  const aController = new AbortController(), bController = new AbortController();
  let fetchSignal, calls = 0;
  const fetchTile = signal => {
    calls++; fetchSignal = signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      gate.promise.then(resolve, reject);
    });
  };
  const a = scheduler.request('shared', aController.signal, fetchTile);
  const b = scheduler.request('shared', bController.signal, fetchTile);
  await tick();
  aController.abort(new DOMException('caller left', 'AbortError'));
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(fetchSignal.aborted, false);
  bController.abort(new DOMException('last caller left', 'AbortError'));
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(fetchSignal.aborted, true);
  const next = scheduler.request('next', new AbortController().signal, async () => { calls++; return new ArrayBuffer(1); });
  await next;
  assert.equal(calls, 2);
  gate.resolve(new ArrayBuffer(2));
});

test('failed shared request preserves even an undefined rejection and permits a clean retry', async () => {
  const scheduler = new SharedTileFetch(1, 4), gate = deferred();
  let calls = 0;
  const fetchTile = () => { calls++; return gate.promise; };
  const first = scheduler.request('retry', new AbortController().signal, fetchTile);
  const second = scheduler.request('retry', new AbortController().signal, fetchTile);
  await tick();
  const firstResult = first.then(() => ({ ok: true }), error => ({ ok: false, error }));
  const secondResult = second.then(() => ({ ok: true }), error => ({ ok: false, error }));
  gate.reject(undefined);
  assert.deepEqual(await firstResult, { ok: false, error: undefined });
  assert.deepEqual(await secondResult, { ok: false, error: undefined });
  const retry = await scheduler.request('retry', new AbortController().signal, async () => { calls++; return new ArrayBuffer(2); });
  assert.equal(retry.byteLength, 2);
  assert.equal(calls, 2);
});

test('switching raster binding cancels its inputs and starts a separate request identity', async () => {
  const previousWorker = globalThis.Worker, previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const requests = [];
  class QuickWorker {
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { bytes: new ArrayBuffer(2) } })); }
    terminate() {}
  }
  globalThis.Worker = QuickWorker;
  globalThis.window = { location: { href: 'http://localhost/raster-fixture' } };
  globalThis.fetch = (url, { signal }) => {
    const gate = deferred(); requests.push({ url, signal, gate });
    if (requests.length > 1) return Promise.resolve(new Response(new ArrayBuffer(1)));
    return gate.promise;
  };
  const source = { id: 'source', type: 'raster', tileSize: 256, tiles: ['https://tiles.test/{z}/{x}/{y}.png'], scheme: 'xyz', setTiles(tiles) { this.tiles = tiles; } };
  const coordinates = new RasterCoordinates({ getSource: id => id === 'source' ? source : undefined }, async () => ({ data: new ArrayBuffer(1) }));
  try {
    coordinates.sync(['source'], 'gcj02');
    const oldUrl = `${coordinates.scheme}://${source.tiles[0].match(/\/(\d+)\/\{z\}/)[1]}/2/1/1`;
    const oldRequest = coordinates.protocol({ url: oldUrl }, new AbortController());
    for (let i = 0; i < 50 && requests.length === 0; i++) await tick();
    assert.ok(requests.length > 0);
    const oldRaw = requests[0];
    coordinates.sync(['source'], 'bd09');
    await assert.rejects(oldRequest, { name: 'AbortError' });
    assert.equal(oldRaw.signal.aborted, true);
    oldRaw.gate.resolve(new Response(new ArrayBuffer(1)));

    const newBindingId = source.tiles[0].match(/\/(\d+)\/\{z\}/)[1];
    assert.notEqual(newBindingId, oldUrl.match(/:\/\/(\d+)\//)[1]);
    const newRequest = coordinates.protocol({ url: `${coordinates.scheme}://${newBindingId}/2/1/1` }, new AbortController());
    for (let i = 0; i < 50 && requests.length <= 1; i++) await tick();
    assert.ok(requests.length > 1, 'new binding must issue its own raw input request');
    await newRequest;
    assert.equal(requests[0].signal.aborted, true);
  } finally {
    coordinates.dispose();
    globalThis.Worker = previousWorker;
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('four bounded pipelines can download ahead of two worker slots', async () => {
  const previousWorker = globalThis.Worker, previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch, previousSetTimeout = globalThis.setTimeout;
  const workers = [], timers = [];
  class HoldingWorker {
    postMessage(_message) {
      const worker = this;
      workers.push({ completed: false, complete() { worker.onmessage?.({ data: { bytes: new ArrayBuffer(3) } }); } });
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = HoldingWorker;
  globalThis.window = { location: { href: 'http://localhost/raster-fixture' } };
  globalThis.fetch = async () => new Response(new ArrayBuffer(1));
  globalThis.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
  const source = { id: 'source', type: 'raster', tileSize: 256, tiles: ['https://tiles.test/{z}/{x}/{y}.png'], scheme: 'xyz', setTiles(tiles) { this.tiles = tiles; } };
  const coordinates = new RasterCoordinates({ getSource: id => id === 'source' ? source : undefined }, async () => ({ data: new ArrayBuffer(1) }));
  try {
    coordinates.sync(['source'], 'gcj02');
    const [, bindingId] = source.tiles[0].match(/shantu-crs-[^:]+:\/\/(\d+)/);
    const urls = Array.from({length: 9}, (_, x) => `${coordinates.scheme}://${bindingId}/4/${x}/0`);
    const requests = urls.map(url => coordinates.protocol({ url }, new AbortController()));
    for (let i = 0; i < 50 && workers.length < 2; i++) await tick();
    assert.equal(workers.length, 2);
    assert.equal(timers.length, 4, 'only four requests may occupy the network/warp pipeline');
    assert.ok(timers.every(timer => timer.delay === 20000));
    workers[0].completed = true;
    workers[0].complete();
    await requests[0];
    for (let i = 0; i < 50 && workers.length < 3; i++) await tick();
    assert.equal(workers.length, 3);
    assert.equal(timers.length, 5, 'the fifth request enters only after a pipeline slot is released');
    let completedWorkers = 1;
    while (completedWorkers < urls.length) {
      for (let i = 0; i < 50 && !workers.some(candidate => !candidate.completed); i++) await tick();
      const worker = workers.find(candidate => !candidate.completed);
      assert.ok(worker, 'each admitted pipeline eventually reaches a warp worker');
      worker.completed = true;
      worker.complete();
      completedWorkers++;
      await tick();
    }
    await Promise.all(requests);
  } finally {
    coordinates.dispose();
    globalThis.Worker = previousWorker;
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
  }
});

test('zoom coalescing cancels before input admission and resumes after 90ms', async () => {
  const previousWorker = globalThis.Worker, previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch, previousSetTimeout = globalThis.setTimeout, previousClearTimeout = globalThis.clearTimeout;
  const timers = new Map(); let nextTimer = 0, fetchCalls = 0, zooming = true;
  class QuickWorker {
    postMessage() { queueMicrotask(() => this.onmessage?.({ data: { bytes: new ArrayBuffer(2) } })); }
    terminate() {}
  }
  globalThis.Worker = QuickWorker;
  globalThis.window = { location: { href: 'http://localhost/raster-fixture' } };
  globalThis.fetch = async () => { fetchCalls++; return new Response(new ArrayBuffer(1)); };
  globalThis.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const source = { id: 'source', type: 'raster', tileSize: 256, tiles: ['https://tiles.test/{z}/{x}/{y}.png'], scheme: 'xyz', setTiles(tiles) { this.tiles = tiles; } };
  const coordinates = new RasterCoordinates({
    getSource: id => id === 'source' ? source : undefined,
    isZooming: () => zooming,
  }, async () => ({ data: new ArrayBuffer(1) }));
  const runDelay = delay => {
    const [id, timer] = [...timers].find(([, value]) => value.delay === delay) ?? [];
    assert.ok(timer, `expected a ${delay}ms timer`);
    timers.delete(id); timer.callback();
  };
  try {
    coordinates.sync(['source'], 'gcj02');
    const bindingId = source.tiles[0].match(/\/(\d+)\/\{z\}/)[1];
    const cancelledController = new AbortController();
    const cancelled = coordinates.protocol({ url: `${coordinates.scheme}://${bindingId}/2/1/1` }, cancelledController);
    await tick();
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [90]);
    assert.equal(coordinates.snapshot().input.active, 0, 'zoom wait does not occupy an input request slot');
    cancelledController.abort(new DOMException('zoom superseded', 'AbortError'));
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(timers.size, 0, 'cancellation clears the coalescing timer');
    assert.equal(fetchCalls, 0, 'cancelled zoom never starts source fetches');
    assert.equal(coordinates.snapshot().input.active, 0);

    const valid = coordinates.protocol({ url: `${coordinates.scheme}://${bindingId}/2/2/1` }, new AbortController());
    await tick();
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [90]);
    assert.equal(coordinates.snapshot().input.active, 0, 'valid zoom wait also remains outside the input scheduler');
    assert.equal(fetchCalls, 0, 'valid zoom also waits for the full coalescing interval');
    runDelay(90);
    for (let i = 0; i < 100 && fetchCalls === 0; i++) await tick();
    assert.ok(fetchCalls > 0, 'the request starts after the 90ms gate opens');
    await valid;
    assert.ok(coordinates.snapshot().input.fetchStarts > 0);

    zooming = false;
    const beforeOrdinary = fetchCalls;
    const ordinary = coordinates.protocol({ url: `${coordinates.scheme}://${bindingId}/2/1/2` }, new AbortController());
    for (let i = 0; i < 100 && fetchCalls === beforeOrdinary; i++) await tick();
    assert.ok(fetchCalls > beforeOrdinary, 'non-zoom request starts without waiting');
    assert.ok(![...timers.values()].some(timer => timer.delay === 90));
    await ordinary;

    zooming = true;
    const beforeHit = coordinates.snapshot().outputHits;
    const hit = await coordinates.protocol({ url: `${coordinates.scheme}://${bindingId}/2/1/2` }, new AbortController());
    assert.ok(hit.data instanceof ArrayBuffer);
    assert.equal(coordinates.snapshot().outputHits, beforeHit + 1);
    assert.ok(![...timers.values()].some(timer => timer.delay === 90), 'output-cache hits bypass zoom coalescing');
  } finally {
    coordinates.dispose();
    globalThis.Worker = previousWorker;
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});
