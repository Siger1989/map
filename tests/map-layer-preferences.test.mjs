import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYERS } from '../modules/map/types.ts';
import { LAYER_PREFERENCES_KEY, parseLayerPreferences, readLayerPreferences, saveLayerPreferences } from '../modules/map/layerPreferences.ts';
import { resolveAvailableMapSelection } from '../modules/mapSources/selection.ts';

test('map layer preferences round-trip actual user selections', () => {
  const values = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  try {
    const selected = {
      ...DEFAULT_LAYERS,
      terrain: false, satellite: true, satelliteProvider: 'tianditu', tiandituBase: 'ter',
      tiandituLabels: 'cta', tiandituBoundaries: false, imageryMode: 'latest',
      clouds: true, rain: true, temperature: false, roads: false, labels: false,
      geology: true, geologySource: 'geocloud20w', geologyOpacity: 0.45,
      contours: true, contourInterval: 100, elevationColors: true,
      elevationColorsOpacity: 0.35, opacity: 0.72, exaggeration: 1.6,
      offlineBasemap: true, offlineMaxZoom: 13, rasterLevel: 12,
      roadsOpacity: 0.6, rasterDatums: { 'custom:abc': 'gcj02' },
    };
    saveLayerPreferences(selected);
    const { rasterDatums: _datumPreferences, ...expected } = selected;
    assert.deepEqual(readLayerPreferences(), expected);
    const persisted = JSON.parse(values.get(LAYER_PREFERENCES_KEY));
    assert.equal(persisted.version, 1);
    assert.equal('rasterDatums' in persisted.layers, false, 'datum choices remain in their existing preference key');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('malformed, missing and old preference formats retain current startup defaults', () => {
  const startup = { ...DEFAULT_LAYERS, satellite: true };
  for (const raw of [null, '{broken', JSON.stringify({ ...DEFAULT_LAYERS }), JSON.stringify({ version: 0, layers: DEFAULT_LAYERS })])
    assert.equal(parseLayerPreferences(raw, startup), null);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '{broken' } });
  try { assert.deepEqual(readLayerPreferences(startup), startup); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('future preference versions are preserved while corrupt values can be replaced', () => {
  const values = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  try {
    const future = JSON.stringify({ version: 2, layers: { satellite: false, futureField: 'keep me' } });
    values.set(LAYER_PREFERENCES_KEY, future);
    saveLayerPreferences({ ...DEFAULT_LAYERS, satellite: true });
    assert.equal(values.get(LAYER_PREFERENCES_KEY), future, 'startup saves must not downgrade a newer format');

    values.set(LAYER_PREFERENCES_KEY, '{corrupt');
    saveLayerPreferences({ ...DEFAULT_LAYERS, satellite: true });
    assert.equal(JSON.parse(values.get(LAYER_PREFERENCES_KEY)).version, 1, 'corrupt current data can be replaced');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('invalid stored values fall back field by field and valid choices survive', () => {
  const fallback = { ...DEFAULT_LAYERS, satellite: true };
  const parsed = parseLayerPreferences(JSON.stringify({ version: 1, layers: {
    satellite: false, imageryMode: 'nonsense', terrain: 'false', roadsOpacity: 4,
    geologySource: 'unknown', clouds: true, rasterLevel: -1,
  } }), fallback);
  assert.equal(parsed?.satellite, false);
  assert.equal(parsed?.clouds, true);
  assert.equal(parsed?.terrain, fallback.terrain);
  assert.equal(parsed?.imageryMode, fallback.imageryMode);
  assert.equal(parsed?.roadsOpacity, fallback.roadsOpacity);
  assert.equal(parsed?.geologySource, fallback.geologySource);
  assert.equal(parsed?.rasterLevel, fallback.rasterLevel);
});

test('map source restoration accepts existing built-ins or stored maps and rejects removed IDs', () => {
  const maps = [{ id: 'custom-1' }];
  assert.equal(resolveAvailableMapSelection('custom-1', maps), 'custom-1');
  assert.equal(resolveAvailableMapSelection('builtin-osm', maps), 'builtin-osm');
  assert.equal(resolveAvailableMapSelection('deleted-custom-map', maps), '');
  assert.equal(resolveAvailableMapSelection(null, maps), '');
});
