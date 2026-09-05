import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { sectionFill, sectionOutline } from '../modules/section/appearance.ts';
import {
  clippedTerrain,
  decodeTerrain,
  terrainEdges,
  tileCoordinate,
} from '../modules/section/terrainMath.ts';

test('3D cut removes only material above the plane and keeps true negative elevations', () => {
  const original = new Float32Array([-300, -0.5, 0, 100.25, 1000, 6000]);
  for (const altitude of [-500, 0, 1234.1, 9000]) {
    const clipped = decodeTerrain(clippedTerrain(original, altitude));
    original.forEach((height, i) =>
      assert.ok(Math.abs(clipped[i] - Math.min(height, altitude)) <= 1 / 256),
    );
  }
  assert.equal(original[5], 6000, 'source DEM is never mutated');
  assert.throws(() => clippedTerrain(new Float32Array([NaN]), 0), /缺测/);
  assert.ok(Number.isNaN(decodeTerrain(new Uint8ClampedArray(4))[0]));
});
test('cut edges intersect a known slope at the selected altitude, without tile-frame outlines', () => {
  const heights = Float32Array.from({ length: 65536 }, (_, i) => i % 256);
  const tile = { z: 12, x: 3220, y: 1680 };
  const lines = terrainEdges(heights, tile, 100);
  assert.ok(lines.length > 0);
  assert.equal(
    lines.length,
    1,
    'one continuous outline, not hundreds of triangle segments',
  );
  assert.equal(
    lines[0].length,
    2,
    'collinear vertices are removed before GeoJSON upload',
  );
  const longitude = tileCoordinate(tile, 100.5, 0)[0];
  for (const line of lines)
    for (const p of line) assert.ok(Math.abs(p[0] - longitude) < 1e-10);
  assert.equal(terrainEdges(heights, tile, -1).length, 0);
  assert.equal(terrainEdges(heights, tile, 300).length, 0);
  assert.equal(
    terrainEdges(new Float32Array(65536).fill(NaN), tile, 0).length,
    0,
  );
});

let SectionLayer, SectionTerrainStore;
async function classes() {
  if (!SectionLayer) {
    const compiled = await build({
      stdin: {
        contents:
          "export { SectionLayer } from './modules/section/SectionLayer.ts'; export { SectionTerrainStore } from './modules/section/elevation.ts';",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
    });
    ({ SectionLayer, SectionTerrainStore } = await import(
      `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
    ));
  }
}
function fixture(t, store, pitch = 65) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sources = new Map(),
    layers = new Map(),
    listeners = new Map(),
    protocols = new Map();
  let terrain = { source: 'elevation', exaggeration: 2 },
    cameraPitch = pitch;
  const heights = new Float32Array(65536).fill(2000),
    requests = [],
    applied = [],
    statuses = [];
  const map = {
    getTerrain: () => terrain,
    setTerrain: (next) => {
      terrain = next;
    },
    getPitch: () => cameraPitch,
    jumpTo: (next) => {
      cameraPitch = next.pitch;
    },
    getBounds: () => ({ contains: () => true }),
    isMoving: () => false,
    setSourceTileLodParams() {},
    on: (event, fn) => listeners.set(event, fn),
    off: (event) => listeners.delete(event),
    addSource: (id, spec) =>
      sources.set(id, {
        spec,
        changes: 0,
        setTiles(tiles) {
          this.spec.tiles = tiles;
          this.changes++;
        },
        setData(data) {
          this.spec.data = data;
        },
      }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (layer) => layers.set(layer.id, layer),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    setPaintProperty: (id, key, value) => {
      layers.get(id).paint[key] = value;
    },
  };
  const layer = new SectionLayer(
    map,
    (s) => statuses.push(s),
    {
      addProtocol: (name, fn) => protocols.set(name, fn),
      removeProtocol: (name) => protocols.delete(name),
    },
    (h) => applied.push(h),
    store ?? {
      async read(tile) {
        requests.push(tile);
        return heights;
      },
      async image(data, altitude) {
        return {
          data: decodeTerrain(clippedTerrain(data, altitude)),
          close() {},
        };
      },
      clear() {},
    },
  );
  t.after(() => layer.dispose());
  const open = (altitude = 1500) =>
    layer.configure({ enabled: true, altitude }, []);
  const request = (z = 12, x = 3220, y = 1680) => {
    const url = sources
      .get('section-elevation')
      .spec.tiles[0].replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
    return [...protocols.values()][0]({ url }, new AbortController());
  };
  return {
    layer,
    map,
    sources,
    layers,
    listeners,
    protocols,
    statuses,
    applied,
    requests,
    open,
    request,
  };
}
test('section retains the 3D camera, uses native terrain and a white cut face with one outline', async (t) => {
  await classes();
  const f = fixture(t);
  f.open();
  assert.equal(f.map.getPitch(), 65);
  assert.deepEqual(f.map.getTerrain(), {
    source: 'section-elevation',
    exaggeration: 1,
  });
  const style = {
    version: 8,
    sources: {
      elevation: {
        type: 'raster-dem',
        tiles: ['https://example.com/{z}/{x}/{y}.png'],
      },
      shading: {
        type: 'raster-dem',
        tiles: ['https://example.com/{z}/{x}/{y}.png'],
      },
      ...Object.fromEntries(
        [...f.sources].map(([id, source]) => [id, source.spec]),
      ),
    },
    layers: [...f.layers.values()],
  };
  assert.deepEqual(
    validateStyleMin(style).map((e) => e.message),
    [],
  );
  assert.equal(f.layers.has('section-cut-edges-halo'), false);
  assert.equal(f.layers.get('section-cut-edges-rim').paint['line-width'], 1.8);
  assert.equal(
    f.layers.get('section-cut-fill').paint['color-relief-color'].at(-1),
    '#ffffff',
  );
  f.map.jumpTo({ pitch: 42 });
  f.layer.configure({ enabled: false, altitude: 1500 }, []);
  assert.equal(f.map.getPitch(), 42, 'user camera adjustments survive exit');
  assert.deepEqual(f.map.getTerrain(), {
    source: 'elevation',
    exaggeration: 2,
  });
  assert.equal(f.sources.size, 0);
  assert.equal(f.layers.size, 0);
  assert.equal(f.applied.at(-1), null);
});
test('entering from 2D supplies a 3D angle and restores that original flat view on exit', async (t) => {
  await classes();
  const f = fixture(t, undefined, 0);
  f.map.setTerrain(null);
  f.open();
  assert.equal(f.map.getPitch(), 55);
  f.layer.configure({ enabled: false, altitude: 1500 }, []);
  assert.equal(f.map.getPitch(), 0);
  assert.equal(f.map.getTerrain(), null);
});
test('only renderer-requested tiles are sampled; rapid slider edits coalesce and pan refreshes the new viewport', async (t) => {
  await classes();
  const f = fixture(t);
  f.open();
  assert.equal(f.requests.length, 0, 'no whole-region prefetch');
  const image = await f.request();
  assert.equal(image.data.data[0], 1500);
  t.mock.timers.tick(250);
  assert.equal(f.statuses.at(-1).phase, 'ready');
  for (let i = 0; i < 100; i++) f.open(1000 + i);
  assert.equal(f.sources.get('section-elevation').changes, 0);
  t.mock.timers.tick(350);
  assert.equal(f.sources.get('section-elevation').changes, 1);
  assert.equal(f.applied.at(-1), 1099);
  assert.equal(f.requests.length, 1);
  const changed = await f.request();
  assert.equal(changed.data.data[0], 1099);
  f.listeners.get('moveend')();
  t.mock.timers.tick(350);
  assert.equal(
    f.sources.get('section-elevation').changes,
    1,
    'panning reuses native tiles without reloading',
  );
  assert.equal(f.map.getPitch(), 65);
});
test('changing the solid fill color updates only paint and uses an interpolated GPU ramp', async (t) => {
  await classes();
  const f = fixture(t);
  f.open();
  for (const color of ['#ffffff', '#002244', '#ff5500']) {
    f.layer.configure({ enabled: true, altitude: 1500, color }, []);
    const fill = f.layers.get('section-cut-fill').paint['color-relief-color'];
    assert.equal(fill[0], 'interpolate');
    assert.equal(fill.at(-1), color);
    assert.deepEqual(fill, sectionFill(1500, color));
    assert.equal(
      f.layers.get('section-cut-edges-rim').paint['line-color'],
      sectionOutline(color),
    );
  }
  t.mock.timers.tick(1000);
  assert.equal(f.sources.get('section-elevation').changes, 0);
  assert.equal(f.requests.length, 0);
});
test('camera movement defers heavy altitude rebuilds and repeated move events never reload DEM', async (t) => {
  await classes();
  const f = fixture(t);
  f.open();
  f.map.isMoving = () => true;
  f.open(900);
  t.mock.timers.tick(350);
  assert.equal(f.sources.get('section-elevation').changes, 0);
  f.map.isMoving = () => false;
  t.mock.timers.tick(350);
  assert.equal(f.sources.get('section-elevation').changes, 1);
  for (let i = 0; i < 100; i++) f.listeners.get('moveend')();
  t.mock.timers.tick(1000);
  assert.equal(f.sources.get('section-elevation').changes, 1);
});
test('late work after exit is cancelled without resurrecting cut geometry', async (t) => {
  await classes();
  let resolve, signal;
  const f = fixture(t, {
    read(_, s) {
      signal = s;
      return new Promise((done) => {
        resolve = done;
      });
    },
    image() {
      throw new Error('must not run');
    },
    clear() {},
  });
  f.open();
  const pending = f.request();
  f.layer.configure({ enabled: false, altitude: 1500 }, []);
  assert.equal(signal.aborted, true);
  resolve(new Float32Array(65536));
  await assert.rejects(pending, { name: 'AbortError' });
  t.mock.timers.tick(1000);
  assert.equal(f.statuses.at(-1).phase, 'idle');
  assert.equal(f.layers.size, 0);
});
test('DEM failure is exposed as an error instead of a fabricated flat sea-level section', async (t) => {
  await classes();
  const f = fixture(t, {
    async read() {
      throw new Error('missing');
    },
    clear() {},
  });
  f.open();
  await assert.rejects(f.request(), /missing/);
  t.mock.timers.tick(250);
  assert.equal(f.statuses.at(-1).phase, 'error');
  assert.equal(f.statuses.at(-1).valid, 0);
});
test('terrain decoding reuses original tiles across altitudes and enforces three concurrent fetches', async (t) => {
  await classes();
  const oldDocument = globalThis.document,
    oldBitmap = globalThis.createImageBitmap,
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.createImageBitmap = oldBitmap;
    globalThis.fetch = oldFetch;
  });
  const rgba = clippedTerrain(new Float32Array(65536).fill(2000), 9999);
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        drawImage() {},
        getImageData: () => ({ data: rgba }),
      }),
    }),
  };
  globalThis.createImageBitmap = async () => ({ close() {} });
  let calls = 0,
    active = 0,
    peak = 0;
  const releases = [];
  globalThis.fetch = async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active--;
    return { ok: true, blob: async () => ({}) };
  };
  const store = new SectionTerrainStore(),
    signal = new AbortController().signal;
  const reads = Array.from({ length: 7 }, (_, x) =>
    store.read({ z: 12, x, y: 1000 }, signal),
  );
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  await flush();
  assert.equal(calls, 3);
  while (calls < 7 || releases.length) {
    const batch = releases.splice(0);
    batch.forEach((release) => release());
    await flush();
  }
  await Promise.all(reads);
  assert.equal(peak, 3);
  const cached = await store.read({ z: 12, x: 0, y: 1000 }, signal);
  assert.equal(calls, 7);
  assert.equal(cached[0], 2000);
  assert.equal(decodeTerrain(clippedTerrain(cached, 800))[0], 800);
  assert.equal((await store.read({ z: 12, x: 0, y: 1000 }, signal))[0], 2000);
});
