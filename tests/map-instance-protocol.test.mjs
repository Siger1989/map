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
const result = await build({
  entryPoints: ['modules/mapSources/RasterCoordinates.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  outdir: '.openai/map-protocol-tests',
  plugins: [workerPlugin],
});
const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const { RasterCoordinates } = module;
const mapSourceResult = await build({
  entryPoints: ['modules/mapSources/MapSourceLayer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  outdir: '.openai/map-protocol-tests',
  plugins: [workerPlugin],
});
const mapSourceModule = await import(`data:text/javascript;base64,${Buffer.from(mapSourceResult.outputFiles[0].contents).toString('base64')}`);
const { MapSourceLayer } = mapSourceModule;
const ovmapTilesResult = await build({
  entryPoints: ['modules/mapSources/ovmapTiles.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const ovmapTilesModule = await import(`data:text/javascript;base64,${Buffer.from(ovmapTilesResult.outputFiles[0].contents).toString('base64')}`);
const { ovmapSourceIds, ovmapTileSize } = ovmapTilesModule;
const cameraSyncResult = await build({
  entryPoints: ['modules/map/cameraSync.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  outdir: '.openai/map-protocol-tests',
});
const cameraSyncModule = await import(`data:text/javascript;base64,${Buffer.from(cameraSyncResult.outputFiles[0].contents).toString('base64')}`);
const { CameraSync } = cameraSyncModule;

test('warped provider tile protocol forwards requests without passive cache metadata', async () => {
  let received;
  const coordinates=new RasterCoordinates({getSource:()=>undefined},async request=>{
    received=request;return {data:Uint8Array.of(1).buffer};
  },'shantu-map-cache');
  const url='shantu-map-cache://source/16/51202/26001';
  await coordinates.fetch(url,new AbortController().signal);
  assert.equal(received.url,url);
  assert.equal('cacheTile' in received,false);
  coordinates.dispose();
});

test('raster coordinate adapters route only their own map-source protocol scheme', async () => {
  const requests = [];
  const adapter = (scheme, value) => new RasterCoordinates(
    { getSource: () => undefined },
    async ({ url }) => {
      requests.push([scheme, url]);
      return { data: Uint8Array.of(value).buffer };
    },
    scheme,
  );
  const primary = adapter('shantu-map-1', 1);
  const secondary = adapter('shantu-map-2', 2);
  const signal = new AbortController().signal;

  const [primaryResponse, secondaryResponse] = await Promise.all([
    primary.fetch('shantu-map-1://source/0/0/0', signal),
    secondary.fetch('shantu-map-2://source/0/0/0', signal),
  ]);

  assert.deepEqual([...new Uint8Array(await primaryResponse.arrayBuffer())], [1]);
  assert.deepEqual([...new Uint8Array(await secondaryResponse.arrayBuffer())], [2]);
  assert.deepEqual(requests, [
    ['shantu-map-1', 'shantu-map-1://source/0/0/0'],
    ['shantu-map-2', 'shantu-map-2://source/0/0/0'],
  ]);
  primary.dispose();
  secondary.dispose();
});

test('map-source layers keep instance-specific tile URLs and reject another instance protocol', async () => {
  const makeMap = () => {
    const sources = new Map();
    const layers = new Map();
    return {
      sources,
      addSource(id, source) { sources.set(id, source); },
      getSource(id) { return sources.get(id); },
      removeSource(id) { sources.delete(id); },
      addLayer(layer) { layers.set(layer.id, layer); },
      getLayer(id) { return layers.get(id); },
      removeLayer(id) { layers.delete(id); },
    };
  };
  const firstMap = makeMap();
  const secondMap = makeMap();
  const first = new MapSourceLayer(firstMap, () => {}, 'shantu-map-11');
  const second = new MapSourceLayer(secondMap, () => {}, 'shantu-map-12');
  const source = {
    id: 'source-a', name: 'A', kind: 'online', format: 'OVMAP', attribution: '',
    minzoom: 0, maxzoom: 14, tileSize: 256, bytes: 1, tiles: ['https://example.test/{z}/{x}/{y}.png'],
    ovmap: { layers: [{ tiles: ['https://example.test/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 14 }] },
  };

  await Promise.all([first.select(source), second.select(source)]);

  assert.deepEqual(firstMap.getSource('shantu-user-map').tiles, ['shantu-map-11://source-a/{z}/{x}/{y}']);
  assert.deepEqual(secondMap.getSource('shantu-user-map').tiles, ['shantu-map-12://source-a/{z}/{x}/{y}']);
  await assert.rejects(
    first.protocol({ url: 'shantu-map-12://source-a/0/0/0' }, new AbortController()),
    { name: 'AbortError' },
  );
  first.clear();
  second.clear();
});

test('MBTiles protocol keeps z/x/y captures after adding the optional OVMAP layer index', async t => {
  const saved = { Worker: globalThis.Worker, window: globalThis.window, indexedDB: globalThis.indexedDB };
  t.after(() => {
    if (saved.Worker === undefined) delete globalThis.Worker; else globalThis.Worker = saved.Worker;
    if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
    if (saved.indexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = saved.indexedDB;
  });
  const requests = [];
  globalThis.window = { location: { href: 'https://app.example.invalid/map' } };
  globalThis.Worker = class FakeWorker {
    onmessage = null;
    onerror = null;
    postMessage(message) {
      requests.push(message);
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: message.op === 'tile' ? Uint8Array.of(19) : { opened: true } } }));
    }
    terminate() {}
  };
  const record = { id: 'mbtiles-a', blob: new Blob([Uint8Array.of(1)]), bytes: 1 };
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = { transaction: () => ({ objectStore: () => ({ get: id => {
          const read = {};
          queueMicrotask(() => { read.result = id === record.id ? record : undefined; read.onsuccess?.(); });
          return read;
        } }) }) };
        request.onsuccess?.();
      });
      return request;
    },
  };
  const sources = new Map(), layers = new Map();
  const map = {
    addSource(id, source) { sources.set(id, source); }, getSource(id) { return sources.get(id); },
    removeSource(id) { sources.delete(id); }, addLayer(layer) { layers.set(layer.id, layer); },
    getLayer(id) { return layers.get(id); }, removeLayer(id) { layers.delete(id); },
  };
  const manager = new MapSourceLayer(map, () => {}, 'shantu-map-14');
  await manager.select({
    id: record.id, name: 'offline', kind: 'mbtiles', format: 'MBTiles', attribution: '',
    minzoom: 0, maxzoom: 18, tileSize: 256, bytes: record.bytes,
  });
  const response = await manager.protocol({ url: 'shantu-map-14://mbtiles-a/5/6/10' }, new AbortController());
  const tileRequest = requests.find(request => request.op === 'tile');
  assert.deepEqual({ op: tileRequest.op, z: tileRequest.z, x: tileRequest.x, y: tileRequest.y }, { op: 'tile', z: 5, x: 6, y: 10 });
  assert.deepEqual([...new Uint8Array(response.data)], [19]);
  manager.clear();
});

test('OVMAP base and annotations load as independent sources while the base keeps its original protocol URL', async t => {
  const saved = { fetch: globalThis.fetch, location: globalThis.location };
  t.after(() => {
    globalThis.fetch = saved.fetch;
    if (saved.location === undefined) delete globalThis.location;
    else globalThis.location = saved.location;
  });
  globalThis.location = { origin: 'https://app.example.invalid' };
  let annotationStarted;
  const started = new Promise(resolve => { annotationStarted = resolve; });
  let finishAnnotation;
  let hangAnnotation = false, pendingAnnotationStarted;
  globalThis.fetch = async (input, options) => {
    if (options?.signal?.aborted) throw options.signal.reason;
    const url = new URL(String(input));
    if (url.searchParams.get('url')?.includes('base.example'))
      return new Response(Uint8Array.of(7), { headers: { 'Content-Type': 'image/png' } });
    if (hangAnnotation) {
      pendingAnnotationStarted();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    annotationStarted();
    return new Promise(resolve => { finishAnnotation = () => resolve(new Response('annotation unavailable', { status: 502 })); });
  };
  const sources = new Map(), layers = new Map(), statuses = [];
  const map = {
    addSource(id, source) { sources.set(id, source); },
    getSource(id) { return sources.get(id); },
    removeSource(id) { sources.delete(id); },
    addLayer(layer) { layers.set(layer.id, layer); },
    getLayer(id) { return layers.get(id); },
    removeLayer(id) { layers.delete(id); },
  };
  const manager = new MapSourceLayer(map, text => statuses.push(text), 'shantu-map-13');
  const source = {
    id: 'source-a', name: 'A', kind: 'online', format: 'OVMAP', attribution: '',
    minzoom: 0, maxzoom: 14, tileSize: 256, bytes: 1, tiles: ['https://base.example/{z}/{x}/{y}.png'],
    ovmap: { layers: [
      { tiles: ['https://base.example/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 14 },
      { tiles: ['https://labels.example/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 3, maxzoom: 14 },
    ] },
  };

  await manager.select(source);
  const ids = ovmapSourceIds(source);
  assert.deepEqual(ids, ['shantu-user-map', 'shantu-user-map-ovmap-1']);
  assert.deepEqual(ovmapSourceIds({ ...source, ovmap: undefined }), ['shantu-user-map'], 'non-OVMAP raster sources retain datum synchronization');
  assert.deepEqual(ovmapSourceIds({ ...source, kind: 'image', ovmap: undefined }), [], 'georeferenced images stay outside raster datum warping');
  assert.equal(ovmapTileSize(source.ovmap.layers[0]), 256);
  assert.equal(ovmapTileSize({ ...source.ovmap.layers[0], tileSize: 512, subdivide: true }), 256);
  assert.deepEqual([...sources.keys()], ids);
  assert.deepEqual([...layers.keys()], ids);
  assert.deepEqual(sources.get(ids[0]).tiles, ['shantu-map-13://source-a/{z}/{x}/{y}']);
  assert.deepEqual(sources.get(ids[1]).tiles, ['shantu-map-13://source-a/layer/1/{z}/{x}/{y}']);
  assert.equal(sources.get(ids[1]).minzoom, 3);

  const annotationRequest = manager.protocol({ url: 'shantu-map-13://source-a/layer/1/5/6/10' }, new AbortController());
  await started;
  const base = await manager.protocol({ url: 'shantu-map-13://source-a/5/6/10' }, new AbortController());
  assert.deepEqual([...new Uint8Array(base.data)], [7]);
  finishAnnotation();
  await assert.rejects(annotationRequest);
  assert.ok(statuses.includes('底图已加载，部分叠加注记暂未加载'));
  assert.equal(sources.size, 2, 'an annotation request failure leaves both independent map sources available');

  hangAnnotation = true;
  const pendingStarted = new Promise(resolve => { pendingAnnotationStarted = resolve; });
  const pendingAnnotation = manager.protocol({ url: 'shantu-map-13://source-a/layer/1/5/6/10' }, new AbortController());
  await pendingStarted;
  await manager.select({ ...source, id: 'source-b', ovmap: undefined });
  await assert.rejects(pendingAnnotation, { name: 'AbortError' });
  assert.deepEqual([...sources.keys()], ['shantu-user-map'], 'switching removes stale annotation sources');
  assert.deepEqual([...layers.keys()], ['shantu-user-map']);
  manager.clear();
  assert.equal(sources.size, 0);
  assert.equal(layers.size, 0);
});

test('programmatic camera sync stays suppressed through moveend and user moves resume two-way sync', () => {
  class MockMap {
    camera;
    listeners = new Map();
    constructor(camera) { this.camera = camera; }
    on(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
    emit(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
    jumpTo(camera, originalEvent = false) {
      this.emit('movestart', originalEvent ? { originalEvent: {} } : {});
      const oldZoom = this.camera.zoom;
      this.camera = { center: [...camera.center], zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing };
      if (oldZoom !== camera.zoom) this.emit('zoom');
      this.emit('move');
      this.emit('moveend');
    }
    userMove(camera) { this.jumpTo(camera, true); }
    getCenter() { return { lng: this.camera.center[0], lat: this.camera.center[1] }; }
    getZoom() { return this.camera.zoom; }
    getPitch() { return this.camera.pitch; }
    getBearing() { return this.camera.bearing; }
  }
  const frames = [];
  const snapshot = map => ({ ...map.camera, center: [...map.camera.center] });
  const primaryStart = { center: [181, 34], zoom: 8, pitch: 22, bearing: 40 };
  const primary = new MockMap(primaryStart);
  const secondary = new MockMap({ center: [0, 0], zoom: 2, pitch: 0, bearing: 0 });
  const primarySync = new CameraSync();
  const secondarySync = new CameraSync();
  let callbacks = 0;
  let userMoveStarts = 0;
  const attachCameraFeed = (map, sync, onChange) => map.on('move', () => {
    frames.push(() => {
      if (!sync.isProgrammatic(map)) onChange(sync.remember(map));
    });
  });
  primary.on('movestart', event => { if (event.originalEvent) userMoveStarts++; });
  secondary.on('movestart', event => { if (event.originalEvent) userMoveStarts++; });
  attachCameraFeed(primary, primarySync, camera => {
    callbacks++;
    secondarySync.apply(secondary, camera);
  });
  attachCameraFeed(secondary, secondarySync, camera => {
    callbacks++;
    primarySync.apply(primary, camera);
  });
  const flushFrames = () => {
    let processed = 0;
    while (frames.length) {
      assert.ok(processed++ < 10, 'camera synchronization must not loop');
      frames.shift()();
    }
  };

  // Secondary initialization copies the current primary and its queued moveend
  // frame must remain suppressed until the RAF-style callback runs.
  secondarySync.apply(secondary, primaryStart);
  flushFrames();
  assert.equal(callbacks, 0);
  assert.equal(userMoveStarts, 0);
  assert.deepEqual(snapshot(primary), primaryStart);
  assert.deepEqual(snapshot(secondary), primaryStart);

  primary.userMove({ center: [-122.4, 37.8], zoom: 10, pitch: 35, bearing: 75 });
  flushFrames();
  assert.equal(callbacks, 1);
  assert.equal(userMoveStarts, 1);
  assert.deepEqual(snapshot(secondary), snapshot(primary));
  assert.deepEqual(primarySync.pendingCamera(), { ...snapshot(primary), detailZoom: 10 });

  secondary.userMove({ center: [151.2, -33.8], zoom: 7, pitch: 12, bearing: 15 });
  flushFrames();
  assert.equal(callbacks, 2);
  assert.equal(userMoveStarts, 2);
  assert.deepEqual(snapshot(primary), snapshot(secondary));
  assert.deepEqual(secondarySync.pendingCamera(), { ...snapshot(secondary), detailZoom: 7 });

  const recoveredSecondary = new MockMap({ center: [0, 0], zoom: 1, pitch: 0, bearing: 0 });
  secondarySync.apply(recoveredSecondary, secondarySync.pendingCamera());
  assert.deepEqual(snapshot(recoveredSecondary), snapshot(primary));
});
