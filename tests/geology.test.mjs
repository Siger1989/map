import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
import { geologyUnit, safeSourceUrl } from '../modules/geology/data.ts';

const compiled = await build({ entryPoints: ['modules/geology/GeologyLayer.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { GeologyLayer } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

test('theme switches preserve weather and keep one meaningful colour legend', () => {
  const geology = applyLayerPatch({ ...DEFAULT_LAYERS, elevationColors: true }, { geology: true });
  assert.equal(geology.elevationColors, false);
  assert.equal(geology.clouds, DEFAULT_LAYERS.clouds);
  const elevation = applyLayerPatch(geology, { elevationColors: true });
  assert.equal(elevation.geology, false);
  assert.equal(elevation.elevationColors, true);
});

test('missing map fields remain unknown and provider links cannot execute code', () => {
  const unit = geologyUnit({ name: 'Mesozoic intrusive rocks', color: '#812B92', ref_url: 'javascript:alert(1)' });
  assert.equal(unit.name, '中生代 侵入岩');
  assert.equal(unit.age, '年代未标注');
  assert.equal(unit.lithology, '岩性未标注');
  assert.equal(unit.sourceUrl, null);
  assert.equal(safeSourceUrl('https://doi.org/10.4095/223767'), 'https://doi.org/10.4095/223767');
});

test('geology style is valid; features drive legends and hidden layers cannot be picked', () => {
  globalThis.window = { location: { origin: 'http://localhost:3000' } };
  const sources = {};
  const layers = [{ id: 'hillshade', type: 'background' }];
  const handlers = new Map();
  let emitted;
  const feature = { properties: { color: '#812B92', age: 'Mesozoic', name: 'Mesozoic intrusive rocks', ref_name: 'World geology', ref_year: '2007' } };
  const map = {
    on: (name, fn) => handlers.set(name, fn), off: (name) => handlers.delete(name),
    getSource: (id) => sources[id], addSource: (id, value) => { sources[id] = value; },
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (layer, before) => layers.splice(layers.findIndex((l) => l.id === before), 0, layer),
    setLayoutProperty: (id, key, value) => { const l = map.getLayer(id); l.layout = { ...l.layout, [key]: value }; },
    setPaintProperty: (id, key, value) => { map.getLayer(id).paint[key] = value; },
    isSourceLoaded: () => true,
    queryRenderedFeatures: () => [feature, feature],
  };
  const controller = new GeologyLayer(map, (state) => { emitted = state; });
  controller.sync(DEFAULT_LAYERS);
  assert.equal(Object.keys(sources).length, 0, 'disabled overlay makes no source requests');
  controller.sync({ ...DEFAULT_LAYERS, geology: true });
  const errors = validateStyleMin({ version: 8, sources, layers });
  assert.deepEqual(errors.map((e) => e.message), []);
  assert.equal(layers.at(-1).id, 'hillshade', 'terrain shading remains above geological colours');
  assert.equal(sources['geology-source'].maxzoom, 5, 'do not request empty high-zoom world tiles');
  assert.equal(emitted.status, 'ready');
  assert.equal(emitted.legend.length, 1);
  assert.equal(emitted.legend[0].color, '#812B92');
  handlers.get('click')({ point: [1, 1] });
  assert.equal(emitted.selection.name, '中生代 侵入岩');
  controller.sync({ ...DEFAULT_LAYERS, geology: true, geologyOpacity: 0.5 });
  assert.equal(map.getLayer('geology-units').paint['fill-opacity'], 0.5);
  handlers.get('error')({ sourceId: 'geology-source' });
  assert.equal(emitted.status, 'error');
  controller.sync(DEFAULT_LAYERS);
  handlers.get('click')({ point: [1, 1] });
  assert.equal(emitted.selection, null);
  assert.equal(map.getLayer('geology-units').layout.visibility, 'none');
  controller.dispose();
  assert.equal(handlers.size, 0);
});

test('unauthorized detailed source never reuses world legend; stale replies cannot overwrite a source switch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.window = { location: { origin: 'http://localhost:3000' } };
  const layers = new Map(), sources = new Map();
  let emitted;
  const map = {
    on() {}, off() {}, getLayer: (id) => layers.get(id), getSource: (id) => sources.get(id),
    addSource: (id, value) => sources.set(id, value), addLayer: (layer) => layers.set(layer.id, layer),
    setLayoutProperty() {}, setPaintProperty() {}, isSourceLoaded: () => true,
    queryRenderedFeatures: () => [{ properties: { color: '#812B92', name: 'World map', ref_name: 'World' } }],
  };
  const controller = new GeologyLayer(map, (state) => { emitted = state; });
  try {
    globalThis.fetch = async () => Response.json({ message: '需要授权' }, { status: 503 });
    controller.sync({ ...DEFAULT_LAYERS, geology: true, geologySource: 'geocloud20w' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(emitted.source, 'geocloud20w');
    assert.equal(emitted.status, 'authorization');
    assert.deepEqual(emitted.legend, []);
    assert.equal(sources.size, 0);
    let reply;
    globalThis.fetch = () => new Promise((resolve) => { reply = resolve; });
    controller.retry();
    controller.sync({ ...DEFAULT_LAYERS, geology: true, geologySource: 'world' });
    reply(Response.json({ message: '旧请求失败' }, { status: 401 }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(emitted.source, 'world');
    assert.equal(emitted.status, 'ready');
    assert.equal(emitted.legend[0].name, 'World map');
  } finally { controller.dispose(); globalThis.fetch = originalFetch; }
});
