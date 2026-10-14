import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationCueData, createNavigationCueFeatures } from '../modules/guidance/navigationCueGeometry.ts';
import { GuidanceLayer } from '../modules/guidance/GuidanceLayer.ts';
import {
  NavigationCueLayer,
  NAVIGATION_CUE_LAYER_ID,
  NAVIGATION_CUE_MIN_ZOOM,
  NAVIGATION_CUE_OUTLINE_LAYER_ID,
  NAVIGATION_CUE_SOURCE_ID,
} from '../modules/guidance/NavigationCueLayer.ts';

const tip = (feature) => feature.geometry.coordinates[1];
const tailMidpoint = (feature) => {
  const [a, , b] = feature.geometry.coordinates;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
};
const fakeMap = (zoom = 16) => {
  const sources = new Map();
  const layers = new Map();
  return {
    sources,
    layers,
    zoom,
    getZoom() { return this.zoom; },
    getSource(id) { return sources.get(id); },
    addSource(id, spec) {
      sources.set(id, { data: spec.data, setData(value) { this.data = value; } });
    },
    getLayer(id) { return layers.get(id); },
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle() { return { layers: [...layers.values()] }; },
    moveLayer() {},
  };
};

test('cue chevrons point forward and follow the route tangent around a bend', () => {
  const east = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.004, 0]], position: [0.0001, 0], progress: 10, kind: 'route',
  });
  assert.ok(east.features.length > 0 && east.features.length <= 5);
  for (const feature of east.features) {
    const mid = tailMidpoint(feature);
    assert.ok(tip(feature)[0] > mid[0], 'eastbound arrow tip is ahead of its wings');
  }

  const bend = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.001, 0], [0.001, 0.003]],
    position: [0.001, 0.001], progress: 220, kind: 'route',
  });
  assert.ok(bend.features.length > 0);
  const first = bend.features[0];
  assert.ok(tip(first)[1] > tailMidpoint(first)[1], 'after the corner, the arrow points north along the new segment');
});

test('progress disambiguates closely spaced outbound and return legs', () => {
  const coordinates = [[0, 0], [0.002, 0], [0.002, 0.00005], [0, 0.00005]];
  const position = [0.001, 0.000025];
  const outbound = createNavigationCueFeatures({ coordinates, position, kind: 'route' }, 40);
  const returning = createNavigationCueFeatures({ coordinates, position, kind: 'route' }, 250);
  assert.ok(outbound.features.length > 0 && returning.features.length > 0);
  assert.ok(tailMidpoint(outbound.features[0])[1] < 0.00002);
  assert.ok(tailMidpoint(returning.features[0])[1] > 0.00003);
});

test('projected progress is returned and cached when sync input omits progress', () => {
  const coordinates = [[0, 0], [0.002, 0], [0.002, 0.00005], [0, 0.00005]];
  const returningPosition = [0.001, 0.00005];
  const first = createNavigationCueData({ coordinates, position: returningPosition, kind: 'route' });
  assert.ok(first.progress > 300, 'first match resolves onto the return leg');
  const crossing = createNavigationCueFeatures({
    coordinates, position: [0.001, 0.000025], kind: 'route',
  }, first.progress);
  assert.ok(tailMidpoint(crossing.features[0])[1] > 0.00003, 'the cached chainage keeps the next match on the return leg');

  const map = fakeMap(16);
  const layer = new NavigationCueLayer(map);
  layer.sync({ coordinates, position: returningPosition, kind: 'route' });
  const afterFirst = map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features;
  layer.sync({ coordinates, position: [0.001, 0.000025], kind: 'route' });
  const afterSecond = map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features;
  assert.ok(afterFirst.length > 0 && tailMidpoint(afterSecond[0])[1] > 0.00003);
});

test('cue generation stays bounded, handles invalid/short input and returns empty on null', () => {
  const result = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.02, 0]], position: [0.0005, 0], progress: 0, kind: 'rejoin',
  });
  assert.equal(result.features.length, 5);
  assert.ok(result.features.every((feature, index) => feature.properties.ordinal === index && feature.properties.kind === 'rejoin'));
  assert.deepEqual(createNavigationCueFeatures(null).features, []);
  assert.deepEqual(createNavigationCueFeatures({ coordinates: [[0, 0]], position: [0, 0], kind: 'route' }).features, []);
  assert.deepEqual(createNavigationCueFeatures({ coordinates: [[0, 0], [0.00005, 0]], position: [0, 0], progress: 0, kind: 'route' }).features, []);
});

test('a cached path samples only local points for repeated known-progress updates on a dense route', () => {
  const route = Array.from({ length: 100_000 }, (_, index) => [index * 0.00001, 0]);
  let coordinateReads = 0;
  const coordinates = new Proxy(route, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) coordinateReads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const map = fakeMap(16);
  const layer = new NavigationCueLayer(map);
  layer.sync({ coordinates, position: [0.449, 0], progress: 50_000, kind: 'route' });
  assert.ok(coordinateReads > 100_000, 'the initial route validation builds the cached cumulative path');
  coordinateReads = 0;
  layer.sync({ coordinates, position: [0.4491, 0], progress: 50_010, kind: 'route' });
  assert.ok(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.length > 0);
  assert.ok(coordinateReads < 1_000, `a GPS update sampled ${coordinateReads} local coordinates instead of rescanning 100,000 points`);
});

test('binary chainage sampling preserves forward chevrons across the antimeridian', () => {
  const features = createNavigationCueFeatures({
    coordinates: [[179.999, 0], [-179.999, 0]], position: [179.999, 0], progress: 0, kind: 'route',
  });
  assert.ok(features.features.length > 0);
  for (const feature of features.features) {
    const mid = tailMidpoint(feature);
    const longitudes = feature.geometry.coordinates.map(([longitude]) => longitude);
    assert.ok(longitudes.every((longitude) => longitude >= -180 && longitude <= 180));
    const signedDelta = ((tip(feature)[0] - mid[0] + 540) % 360) - 180;
    assert.ok(signedDelta > 0, 'eastbound chevrons keep pointing forward through the wrap');
  }
});

test('cue layer clears on null, gates wide zooms, and keeps stable source/layer ids', () => {
  const map = fakeMap(13);
  const layer = new NavigationCueLayer(map);
  const input = { coordinates: [[0, 0], [0.01, 0]], position: [0.0005, 0], progress: 0, kind: 'route' };
  layer.sync(input);
  assert.equal(NAVIGATION_CUE_MIN_ZOOM, 14);
  const countBelowMinZoom = map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.length;
  assert.ok(countBelowMinZoom > 0, 'keep source data populated so zooming in reveals cues without a GPS update');
  map.zoom = 16;
  assert.equal(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.length, countBelowMinZoom);
  assert.equal(map.layers.get(NAVIGATION_CUE_LAYER_ID).minzoom, NAVIGATION_CUE_MIN_ZOOM);
  assert.ok(map.layers.has(NAVIGATION_CUE_OUTLINE_LAYER_ID));
  layer.sync(null);
  assert.deepEqual(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features, []);
});

test('rejoin road and outline both use real gaps while access and target styling remain distinct', () => {
  const sources = new Map();
  const layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id, spec) { sources.set(id, { setData(value) { this.data = value; }, data: spec.data }); },
    getLayer: (id) => layers.get(id),
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    on() {},
    off() {},
    getContainer: () => ({ addEventListener() {}, removeEventListener() {} }),
  };
  const guidance = new GuidanceLayer(map);
  guidance.sync(null);
  const outline = layers.get('guidance-outline');
  const main = layers.get('guidance-path');
  const pixelPattern = (layer) => layer.paint['line-dasharray'].map((unit) => unit * layer.paint['line-width']);
  assert.deepEqual(pixelPattern(outline), [15, 10]);
  assert.deepEqual(pixelPattern(main), [15, 10], 'the foreground dash and outline gap share pixel boundaries');
  assert.equal(outline.layout['line-cap'], 'butt');
  assert.equal(main.layout['line-cap'], 'butt', 'square/round caps must not paint across the transparent gap');
  assert.ok(pixelPattern(main)[1] >= 8, 'transparent gaps remain visibly open');
  assert.deepEqual(layers.get('guidance-access').paint['line-dasharray'], [2, 2]);
  assert.deepEqual(layers.get('guidance-path').filter.at(-1), ['!=', 'kind', 'access']);
  assert.deepEqual(layers.get('guidance-access').filter, ['==', 'kind', 'access']);
  assert.equal(layers.get('guidance-target').type, 'circle');
});
