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

test('programmatic camera sync stays suppressed through moveend and user moves resume two-way sync', () => {
  class MockMap {
    camera;
    listeners = new Map();
    constructor(camera) { this.camera = camera; }
    on(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
    emit(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
    jumpTo(camera, originalEvent = false) {
      this.emit('movestart', originalEvent ? { originalEvent: {} } : {});
      this.camera = { ...camera, center: [...camera.center] };
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
  assert.deepEqual(primarySync.pendingCamera(), snapshot(primary));

  secondary.userMove({ center: [151.2, -33.8], zoom: 7, pitch: 12, bearing: 15 });
  flushFrames();
  assert.equal(callbacks, 2);
  assert.equal(userMoveStarts, 2);
  assert.deepEqual(snapshot(primary), snapshot(secondary));
  assert.deepEqual(secondarySync.pendingCamera(), snapshot(secondary));

  const recoveredSecondary = new MockMap({ center: [0, 0], zoom: 1, pitch: 0, bearing: 0 });
  secondarySync.apply(recoveredSecondary, secondarySync.pendingCamera());
  assert.deepEqual(snapshot(recoveredSecondary), snapshot(primary));
});
