import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
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
      roads: false, labels: false,
      geology: true, geologySource: 'geocloud20w', geologyOpacity: 0.45,
      contours: true, contourInterval: 100, elevationColors: true,
      elevationColorsOpacity: 0.35, exaggeration: 1.6,
      offlineBasemap: true, offlineMaxZoom: 13, rasterLevel: 12,
      roadsOpacity: 0.6, rasterDatums: { 'custom:abc': 'gcj02' },
    };
    saveLayerPreferences(selected);
    const { rasterDatums: _datumPreferences, offlineMaxZoom: _retiredLimit, ...expected } = selected;
    assert.deepEqual(readLayerPreferences(), expected);
    const persisted = JSON.parse(values.get(LAYER_PREFERENCES_KEY));
    assert.equal(persisted.version, 1);
    assert.equal('rasterDatums' in persisted.layers, false, 'datum choices remain in their existing preference key');
    for (const key of ['clouds', 'cloudOpacity', 'cloudTime', 'rain', 'temperature', 'opacity']) assert.equal(key in persisted.layers, false, key + ' is retired');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('legacy weather preferences and patches are ignored without losing other settings', () => {
  const legacy = { ...DEFAULT_LAYERS, terrain: false, satellite: true, roadsOpacity: 0.4,
    clouds: true, cloudOpacity: 0.2, cloudTime: '202610030600', rain: true, temperature: true, opacity: 0.2 };
  const parsed = parseLayerPreferences(JSON.stringify({ version: 1, layers: legacy }), legacy);
  for (const key of ['clouds', 'cloudOpacity', 'cloudTime', 'rain', 'temperature', 'opacity']) {
    assert.equal(key in parsed, false, key + ' is omitted from parsed legacy preferences');
  }
  assert.equal(parsed.terrain, false);
  assert.equal(parsed.satellite, true);
  assert.equal(parsed.roadsOpacity, 0.4);

  const patched = applyLayerPatch(legacy, { clouds: true, cloudOpacity: 1, cloudTime: '20261003', rain: true, temperature: true, opacity: 1 });
  for (const key of ['clouds', 'cloudOpacity', 'cloudTime', 'rain', 'temperature', 'opacity']) {
    assert.equal(key in patched, false, key + ' cannot be restored by an external patch');
  }
  assert.equal(patched.roadsOpacity, 0.4);
  assert.equal(patched.satellite, true);
});

test('geology and elevation colours remain mutually exclusive', () => {
  assert.equal(applyLayerPatch(DEFAULT_LAYERS, { geology: true }).elevationColors, false);
  assert.equal(applyLayerPatch({ ...DEFAULT_LAYERS, geology: true }, { elevationColors: true }).geology, false);
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
  assert.equal(parsed?.clouds, undefined);
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


test('old offline package caps are ignored without changing source or user detail choice', () => {
  const parsed = parseLayerPreferences(JSON.stringify({ version: 1, layers: { offlineMaxZoom: 14, rasterLevel: 19, satellite: true, satelliteProvider: 'tianditu' } }));
  assert.equal(parsed.offlineMaxZoom, undefined);
  assert.equal(parsed.rasterLevel, 19);
  assert.equal(parsed.satelliteProvider, 'tianditu');
});
