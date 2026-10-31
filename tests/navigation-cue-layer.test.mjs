import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationCueData, createNavigationCueFeatures, navigationReferenceJoinProgress } from '../modules/guidance/navigationCueGeometry.ts';
import { GuidanceLayer } from '../modules/guidance/GuidanceLayer.ts';
import { pathOf } from '../modules/guidance/geometry.ts';
import { metresBetween } from '../modules/navigation/types.ts';
import {
  NavigationCueLayer,
  NAVIGATION_CUE_LAYER_ID,
  NAVIGATION_CUE_MIN_ZOOM,
  NAVIGATION_CUE_OUTLINE_LAYER_ID,
  NAVIGATION_CUE_ICON_ID,
  NAVIGATION_CUE_LEAD_ICON_ID,
  NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID,
  NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID,
  NAVIGATION_CUE_REJOIN_ICON_ID,
  NAVIGATION_CUE_RIBBON_LAYER_ID,
  NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID,
  NAVIGATION_CUE_SOURCE_ID,
} from '../modules/guidance/NavigationCueLayer.ts';

const arrows = (collection) => collection.features.filter(({ properties }) => properties.role === 'chevron');
const leads = (collection) => collection.features.filter(({ properties }) => properties.role === 'lead');
const point = (feature) => feature.geometry.coordinates;
const fakeMap = (zoom = 16, height = 857) => {
  const sources = new Map();
  const layers = new Map();
  const images = new Map();
  return {
    sources,
    layers,
    images,
    zoom,
    height,
    resizeListeners: [],
    getZoom() { return this.zoom; },
    getCanvas() { return { clientHeight: this.height }; },
    getContainer() { return { clientHeight: this.height }; },
    isStyleLoaded() { return true; },
    on(event, listener) { if (event === 'resize') this.resizeListeners.push(listener); },
    resize(nextHeight) {
      this.height = nextHeight;
      for (const listener of this.resizeListeners) listener();
    },
    getSource(id) { return sources.get(id); },
    addSource(id, spec) {
      sources.set(id, { data: spec.data, setData(value) { this.data = value; } });
    },
    getLayer(id) { return layers.get(id); },
    addLayer(spec) { layers.set(spec.id, spec); },
    hasImage(id) { return images.has(id); },
    addImage(id, image, options) { images.set(id, { image, options }); },
    setLayoutProperty(id, name, value) {
      const layer = layers.get(id);
      layer.layout[name] = value;
      this.layoutChanges.push([id, name, value]);
    },
    layoutChanges: [],
    getStyle() { return { layers: [...layers.values()] }; },
    moveLayer() {},
  };
};

test('cue chevrons point forward and follow the route tangent around a bend', () => {
  const east = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.004, 0]], position: [0.0001, 0], progress: 10, kind: 'route',
  });
  const eastArrows = arrows(east);
  assert.ok(eastArrows.length > 10 && eastArrows.length < 24, 'small route chevrons form a continuous but bounded chain');
  assert.equal(leads(east).length, 1);
  assert.ok(eastArrows.every(({ properties }) => Math.abs(properties.bearing - 90) < 0.1));
  assert.ok(eastArrows.every(({ geometry }) => geometry.type === 'Point'));

  const bend = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.001, 0], [0.001, 0.003]],
    position: [0.001, 0.001], progress: 220, kind: 'route',
  });
  const bendArrow = arrows(bend)[0];
  assert.ok(bendArrow);
  assert.ok(Math.abs(bendArrow.properties.bearing) < 0.1, 'after the corner, the arrow points north along the new segment');
});

test('progress disambiguates closely spaced outbound and return legs', () => {
  const coordinates = [[0, 0], [0.002, 0], [0.002, 0.00005], [0, 0.00005]];
  const position = [0.001, 0.000025];
  const outbound = createNavigationCueFeatures({ coordinates, position, kind: 'route' }, 40);
  const returning = createNavigationCueFeatures({ coordinates, position, kind: 'route' }, 250);
  assert.ok(arrows(outbound).length > 0 && arrows(returning).length > 0);
  assert.ok(point(arrows(outbound)[0])[1] < 0.00002);
  assert.ok(point(arrows(returning)[0])[1] > 0.00003);
});

test('projected progress is returned and cached when sync input omits progress', () => {
  const coordinates = [[0, 0], [0.002, 0], [0.002, 0.00005], [0, 0.00005]];
  const returningPosition = [0.001, 0.00005];
  const first = createNavigationCueData({ coordinates, position: returningPosition, kind: 'route' });
  assert.ok(first.progress > 300, 'first match resolves onto the return leg');
  const crossing = createNavigationCueFeatures({
    coordinates, position: [0.001, 0.000025], kind: 'route',
  }, first.progress);
  assert.ok(point(arrows(crossing)[0])[1] > 0.00003, 'the cached chainage keeps the next match on the return leg');

  const map = fakeMap(16);
  const layer = new NavigationCueLayer(map);
  layer.sync({ coordinates, position: returningPosition, kind: 'route' });
  const afterFirst = map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features;
  layer.sync({ coordinates, position: [0.001, 0.000025], kind: 'route' });
  const afterSecond = map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features;
  assert.ok(afterFirst.length > 1 && point(arrows({ features: afterSecond })[0])[1] > 0.00003);
});

test('cue generation stays bounded, handles invalid/short input and returns empty on null', () => {
  const result = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.02, 0]], position: [0.0005, 0], progress: 0, kind: 'rejoin',
  });
  assert.equal(result.features.length, 5, 'rejoin creates arrows only, with no ribbon feature');
  assert.ok(result.features.every((feature, index) => feature.geometry.type === 'Point' && feature.properties.ordinal === index && feature.properties.kind === 'rejoin'));
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

test('binary chainage sampling preserves chevron bearing across the antimeridian', () => {
  const features = createNavigationCueFeatures({
    coordinates: [[179.999, 0], [-179.999, 0]], position: [179.999, 0], progress: 0, kind: 'route',
  });
  assert.ok(arrows(features).length > 0);
  assert.ok(arrows(features).every(({ properties }) => properties.bearing > 89 && properties.bearing < 91));
  for (const feature of features.features.filter(({ properties }) => properties.role === 'ribbon')) {
    assert.ok(feature.geometry.coordinates.every(([longitude]) => longitude >= -180 && longitude <= 180));
  }
});

test('route ribbon is bounded to 500 metres ahead and starts at progress across route segments', () => {
  const result = createNavigationCueData({
    coordinates: [[0, 0], [0.02, 0]], position: [0.005, 0], progress: 556, kind: 'route',
  });
  const ribbon = result.data.features.find(({ properties }) => properties.role === 'ribbon');
  assert.ok(ribbon);
  assert.ok(ribbon.geometry.coordinates.length <= 128);
  assert.ok(Math.abs(ribbon.geometry.coordinates[0][0] - 0.005) < 0.00002, 'ribbon begins at the current route progress');
  assert.ok(Math.abs(ribbon.geometry.coordinates.at(-1)[0] - 0.00948) < 0.00002, 'ribbon ends 500m ahead');
  const rejoin = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.02, 0]], position: [0.005, 0], progress: 556, kind: 'rejoin',
  });
  assert.ok(rejoin.features.every(({ properties }) => properties.role === 'rejoin'));

  const splitRoute = [[0, 0], [0.001, 0], [0.001, 0.01]];
  const splitPath = pathOf(splitRoute);
  const splitProgress = 50;
  const split = createNavigationCueData({
    coordinates: splitRoute,
    position: [splitProgress / 111_320, 0],
    progress: splitProgress,
    kind: 'route',
  }).data.features.find(({ properties }) => properties.role === 'ribbon');
  assert.ok(split);
  const expectedStartLongitude = splitRoute[1][0] * (splitProgress / splitPath.cumulative[1]);
  assert.ok(Math.abs(split.geometry.coordinates[0][0] - expectedStartLongitude) < 1e-10,
    'split ribbon begins at the interpolated progress point');
  assert.deepEqual(split.geometry.coordinates[1], splitRoute[1], 'the ribbon retains the real route segment boundary');
  assert.ok(split.geometry.coordinates.length >= 3 && splitPath.length > splitProgress);

  const routeEnd = splitRoute.at(-1);
  const routeLength = splitPath.length;
  const atEnd = createNavigationCueData({
    coordinates: splitRoute, position: routeEnd, progress: routeLength, kind: 'route',
  });
  assert.equal(atEnd.data.features.filter(({ properties }) => properties.role === 'ribbon').length, 0,
    'no zero-length ribbon is generated at the route endpoint');
});

test('lead arrow follows route bearing at up to 50m ahead and scales toward the endpoint', () => {
  const longRoute = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.003, 0]], position: [0.000224, 0], progress: 25, kind: 'route',
  });
  const [lead] = leads(longRoute);
  assert.ok(lead);
  assert.ok(Math.abs(lead.properties.bearing - 90) < 0.1);
  assert.ok(Math.abs((lead.geometry.coordinates[0] - 0.000224) * 111_320 - 50) < 2);

  const bend = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.001, 0], [0.001, 0.003]],
    position: [0.001, 0.000258], progress: 140, kind: 'route',
  });
  assert.ok(Math.abs(leads(bend)[0].properties.bearing) < 0.1, 'lead arrow uses the real northbound tangent after the bend');

  const nearEnd = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.0006, 0]], position: [0, 0], progress: 0, kind: 'route',
  });
  const [nearEndLead] = leads(nearEnd);
  assert.ok(nearEndLead);
  assert.ok(Math.abs(nearEndLead.geometry.coordinates[0] * 111_320 - (0.0006 * 111_320 * 0.65)) < 1);
  assert.ok(!arrows(nearEnd).some((arrow) => Math.abs((arrow.geometry.coordinates[0] - nearEndLead.geometry.coordinates[0]) * 111_320) <= 10),
    'small chevrons within 10m of the lead arrow are omitted');

  const tooShort = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.00053, 0]], position: [0, 0], progress: 0, kind: 'route',
  });
  assert.equal(leads(tooShort).length, 0, 'no lead arrow when less than 60m remains');
  const rejoin = createNavigationCueFeatures({
    coordinates: [[0, 0], [0.003, 0]], position: [0, 0], progress: 0, kind: 'rejoin',
  });
  assert.equal(leads(rejoin).length, 0, 'rejoin never gets the lead arrow');
  assert.equal(leads(createNavigationCueFeatures(null)).length, 0);
});

test('lead target accepts only the 20-50m range and defaults to 50m', () => {
  const input = { coordinates: [[0, 0], [0.003, 0]], position: [0, 0], progress: 0, kind: 'route' };
  const distance = (target) => metresBetween(input.position,
    createNavigationCueData(input, undefined, undefined, target).data.features.find(({ properties }) => properties.role === 'lead').geometry.coordinates);
  assert.ok(Math.abs(distance(20) - 20) < 1);
  assert.ok(Math.abs(distance(19) - 20) < 1, 'targets below the supported range clamp to 20m');
  assert.ok(Math.abs(distance(50) - 50) < 1);
  assert.ok(Math.abs(distance(60) - 50) < 1, 'targets above the supported range clamp to 50m');
  assert.ok(Math.abs(distance(Number.NaN) - 50) < 1, 'invalid targets use the normal-height default');
});

test('off-route accuracy reference is bounded and only appears beyond reported uncertainty', () => {
  const base = { coordinates: [[0, 0], [0.003, 0]], progress: 0, kind: 'route' };
  const offsetPosition = [0, 20 / 111_320];
  const offset = createNavigationCueData({ ...base, position: offsetPosition });
  const reference = offset.data.features.find(({ properties }) => properties.role === 'offset-reference');
  const projection = offset.data.features.find(({ properties }) => properties.role === 'route-projection');
  assert.ok(reference);
  assert.equal(reference.geometry.type, 'LineString');
  assert.equal(reference.geometry.coordinates.length, 32);
  assert.deepEqual(reference.geometry.coordinates[0], offsetPosition, 'reference begins at the real GPS fix');
  assert.ok(reference.geometry.coordinates.at(-1)[0] > 0, 'reference ends slightly forward on the planned route');
  const startDelta = [
    (reference.geometry.coordinates[1][0] - reference.geometry.coordinates[0][0]) * 111_320,
    (reference.geometry.coordinates[1][1] - reference.geometry.coordinates[0][1]) * 111_320,
  ];
  const endDelta = [
    (reference.geometry.coordinates.at(-1)[0] - reference.geometry.coordinates.at(-2)[0]) * 111_320,
    (reference.geometry.coordinates.at(-1)[1] - reference.geometry.coordinates.at(-2)[1]) * 111_320,
  ];
  assert.ok(startDelta[0] > 0 && Math.abs(startDelta[1] / startDelta[0]) < 0.02,
    'reference starts forward along the route tangent');
  assert.ok(endDelta[0] > 0 && Math.abs(endDelta[1] / endDelta[0]) < 0.02,
    'reference meets the route with a matching forward tangent');
  assert.ok(projection);
  assert.deepEqual(projection.geometry.coordinates, [0, 0], 'projection remains an independent route reference point');
  assert.equal(offset.progress, 0, 'the real navigation progress remains at the route anchor');
  assert.equal(offset.referenceJoinProgress, 12, 'the display-only join advances 12m on route');
  const ribbon = offset.data.features.find(({ properties }) => properties.role === 'ribbon');
  assert.ok(ribbon);
  assert.deepEqual(ribbon.geometry.coordinates[0], reference.geometry.coordinates.at(-1),
    'the green ribbon starts exactly where the yellow reference rejoins the route');
  assert.ok(arrows(offset.data).every(({ geometry }) => metresBetween([0, 0], geometry.coordinates) > offset.referenceJoinProgress),
    'small arrows do not imply forward travel along the green segment behind the join');

  const withinAccuracy = createNavigationCueData({ ...base, position: offsetPosition, accuracy: 30 });
  assert.equal(withinAccuracy.data.features.some(({ properties }) => properties.role === 'offset-reference'), false,
    '20m offset is not drawn when reported accuracy creates a 35m threshold');
  assert.equal(withinAccuracy.data.features.some(({ properties }) => properties.role === 'route-projection'), false);
  const resolvedPath = pathOf(base.coordinates);
  assert.equal(navigationReferenceJoinProgress({ ...base, position: offsetPosition }, resolvedPath), 12);
  assert.equal(navigationReferenceJoinProgress({ ...base, position: offsetPosition, accuracy: 30 }, resolvedPath), undefined);
  assert.equal(navigationReferenceJoinProgress({ ...base, position: [0, 0] }, resolvedPath), undefined);
  assert.equal(navigationReferenceJoinProgress({ ...base, position: offsetPosition, kind: 'rejoin' }, resolvedPath), undefined);
  assert.equal(navigationReferenceJoinProgress(null, resolvedPath), undefined);
  const accuracyBoundary = createNavigationCueData({ ...base, position: offsetPosition, accuracy: 15 });
  assert.equal(accuracyBoundary.data.features.some(({ properties }) => properties.role === 'offset-reference'), false,
    'a 20m offset at the exact max(12m, accuracy+5m) threshold does not draw a reference');
  const onRoute = createNavigationCueData({ ...base, position: [0, 0] });
  assert.equal(onRoute.data.features.some(({ properties }) => properties.role === 'offset-reference'), false);
  assert.equal(onRoute.data.features.some(({ properties }) => properties.role === 'route-projection'), false);
  const rejoin = createNavigationCueData({ ...base, position: offsetPosition, kind: 'rejoin' });
  assert.equal(rejoin.data.features.some(({ properties }) => properties.role === 'offset-reference' || properties.role === 'route-projection'), false);
  assert.equal(createNavigationCueData(null).data.features.length, 0);

  const nearEndCoordinates = [[0, 0], [0.003, 0]];
  const nearEndLength = pathOf(nearEndCoordinates).length;
  const nearEnd = createNavigationCueData({
    coordinates: nearEndCoordinates,
    position: [0.003, 20 / 111_320], progress: nearEndLength, kind: 'route',
  }).data.features.find(({ properties }) => properties.role === 'offset-reference');
  assert.ok(nearEnd);
  assert.equal(nearEnd.geometry.coordinates.length, 2, 'under 1m forward room degrades to a finite direct connector');
  assert.equal(navigationReferenceJoinProgress({
    coordinates: nearEndCoordinates,
    position: [0.003, 20 / 111_320], progress: nearEndLength - 0.5, kind: 'route',
  }, pathOf(nearEndCoordinates)), nearEndLength, 'display join clamps to the short route tail');

  const antimeridian = createNavigationCueData({
    coordinates: [[179.999, 0], [-179.999, 0]],
    position: [179.999, 20 / 111_320], progress: 0, kind: 'route',
  }).data.features.find(({ properties }) => properties.role === 'offset-reference');
  assert.ok(antimeridian);
  assert.equal(antimeridian.geometry.coordinates.length, 32);
  assert.ok(antimeridian.geometry.coordinates.every(([longitude, latitude]) =>
    Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180),
  'reference coordinates stay finite and normalized across the date line');
});

test('top and forward modes preserve cue geometry without changing cue stroke widths', () => {
  const input = {
    coordinates: [[0, 0], [0.003, 0]], position: [0, 20 / 111_320], progress: 0, kind: 'route',
  };
  const topData = createNavigationCueData({ ...input, cameraMode: 'top' });
  assert.deepEqual(topData.data.features.map(({ properties }) => properties.role), ['offset-reference', 'route-projection']);
  assert.ok(topData.data.features.every(({ properties }) => properties.closeView === false));
  assert.equal(topData.progress, 0);
  assert.equal(topData.referenceJoinProgress, 12);
  const topOnRoute = createNavigationCueData({ ...input, position: [0, 0], cameraMode: 'top' });
  assert.equal(topOnRoute.data.features.length, 0, 'top view at zero offset draws no close-view cues or ribbon');
  const forwardData = createNavigationCueData(input);
  assert.ok(forwardData.data.features.some(({ properties }) => properties.role === 'ribbon'));
  assert.ok(forwardData.data.features.some(({ properties }) => properties.role === 'chevron'));
  assert.ok(forwardData.data.features.some(({ properties }) => properties.role === 'lead'));
  assert.ok(forwardData.data.features.filter(({ properties }) => properties.role === 'offset-reference' || properties.role === 'route-projection')
    .every(({ properties }) => properties.closeView === true));

  const map = fakeMap();
  const layer = new NavigationCueLayer(map);
  layer.sync(input);
  const roleNames = () => map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.map(({ properties }) => properties.role);
  assert.ok(roleNames().includes('ribbon'));
  assert.equal(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.find(({ properties }) => properties.role === 'ribbon').properties.closeView, true,
    'forward cue metadata remains intact; it no longer changes stroke width');
  layer.sync({ ...input, cameraMode: 'top' });
  assert.deepEqual(roleNames(), ['offset-reference', 'route-projection']);
  assert.equal(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features[0].properties.closeView, false);
  assert.equal(map.layers.get(NAVIGATION_CUE_OUTLINE_LAYER_ID).layout.visibility, 'none');
  assert.equal(map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).layout.visibility, 'none');
  assert.equal(map.layoutChanges.length, 2);
  layer.sync({ ...input, cameraMode: 'top' });
  assert.equal(map.layoutChanges.length, 2, 'identical top inputs do not repeat visibility updates');
  layer.sync(input);
  assert.ok(roleNames().includes('ribbon'));
  assert.equal(map.layers.get(NAVIGATION_CUE_OUTLINE_LAYER_ID).layout.visibility, 'visible');
  assert.equal(map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).layout.visibility, 'visible');
  assert.equal(map.layoutChanges.length, 4);
});

test('resize repositions only the lead arrow for short and normal screens without reviving cleared cues', () => {
  const map = fakeMap(16, 480);
  const layer = new NavigationCueLayer(map);
  const input = { coordinates: [[0, 0], [0.003, 0]], position: [0, 0], progress: 0, kind: 'route' };
  const leadDistance = () => metresBetween(input.position,
    map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.find(({ properties }) => properties.role === 'lead').geometry.coordinates);

  layer.sync(input);
  assert.ok(Math.abs(leadDistance() - 20) < 1, 'short viewport places the lead near the visible gap');
  map.resize(857);
  assert.ok(Math.abs(leadDistance() - 50) < 1, 'normal viewport restores the usual lead distance');

  layer.sync(null);
  assert.deepEqual(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features, []);
  map.resize(480);
  assert.deepEqual(map.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features, [], 'resize after stop cannot restore a stale route cue');

  const noHeightMap = fakeMap();
  noHeightMap.getCanvas = () => null;
  noHeightMap.getContainer = () => null;
  new NavigationCueLayer(noHeightMap).sync(input);
  const noHeightLead = noHeightMap.sources.get(NAVIGATION_CUE_SOURCE_ID).data.features.find(({ properties }) => properties.role === 'lead');
  assert.ok(Math.abs(metresBetween(input.position, noHeightLead.geometry.coordinates) - 50) < 1,
    'missing viewport dimensions use the normal-height target');
});

test('route and rejoin chevrons use separate ordinary RGBA Heroicons images', () => {
  const previousDocument = globalThis.document;
  const previousPath2D = globalThis.Path2D;
  globalThis.document = {
    createElement: () => {
      const strokes = [];
      const pathDraws = [];
      return {
        width: 0,
        height: 0,
        getContext: () => ({
        scale() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        translate() {},
        stroke(path) {
          if (path) pathDraws.push(['stroke', path.d, this.strokeStyle, this.lineWidth]);
          else strokes.push([this.strokeStyle, this.lineWidth]);
        },
        fill(path) { pathDraws.push(['fill', path.d, this.fillStyle]); },
        getImageData(x, y, width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4), strokes: [...strokes], pathDraws: [...pathDraws] }; },
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 0,
        lineCap: '',
        lineJoin: '',
        }),
      };
    },
  };
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  try {
    const map = fakeMap(16);
    new NavigationCueLayer(map).sync({
      coordinates: [[0, 0], [0.01, 0]], position: [0.0005, 0], progress: 0, kind: 'route',
    });
    assert.equal(map.images.size, 3);
    assert.equal(map.images.get(NAVIGATION_CUE_ICON_ID).options.sdf, false);
    assert.equal(map.images.get(NAVIGATION_CUE_REJOIN_ICON_ID).options.sdf, false);
    assert.equal(map.images.get(NAVIGATION_CUE_LEAD_ICON_ID).options.sdf, false);
    assert.equal(map.images.get(NAVIGATION_CUE_ICON_ID).image.width, 48);
    assert.equal(map.images.get(NAVIGATION_CUE_LEAD_ICON_ID).image.width, 52);
    assert.equal(map.images.get(NAVIGATION_CUE_LEAD_ICON_ID).image.height, 72);
    assert.deepEqual(map.images.get(NAVIGATION_CUE_LEAD_ICON_ID).image.pathDraws.map((draw) => [draw[0], draw[2]]), [['fill', '#ffffff'], ['stroke', '#46b9ff']]);
    assert.deepEqual(map.images.get(NAVIGATION_CUE_ICON_ID).image.strokes, [['#17452f', 5], ['#ffffff', 2.5]]);
    assert.deepEqual(map.images.get(NAVIGATION_CUE_REJOIN_ICON_ID).image.strokes, [['#563719', 5], ['#ffd08a', 2.5]]);
    const iconImage = map.layers.get(NAVIGATION_CUE_LAYER_ID).layout['icon-image'];
    assert.deepEqual(iconImage, ['match', ['get', 'role'], 'lead', NAVIGATION_CUE_LEAD_ICON_ID, ['match', ['get', 'kind'], 'rejoin', NAVIGATION_CUE_REJOIN_ICON_ID, NAVIGATION_CUE_ICON_ID]]);
    assert.deepEqual(map.layers.get(NAVIGATION_CUE_LAYER_ID).layout['icon-size'], ['match', ['get', 'role'], 'lead', 1.8, 'rejoin', 0.55, 0.85]);
    assert.ok((15 + 5) * 0.85 > 14, 'route chevrons remain legible on the pitched map');
    assert.equal('icon-color' in map.layers.get(NAVIGATION_CUE_LAYER_ID).paint, false);
    assert.equal('icon-halo-width' in map.layers.get(NAVIGATION_CUE_LAYER_ID).paint, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousPath2D === undefined) delete globalThis.Path2D;
    else globalThis.Path2D = previousPath2D;
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
  assert.ok(map.layers.has(NAVIGATION_CUE_RIBBON_LAYER_ID));
  assert.ok(map.layers.has(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID));
  assert.ok(map.layers.has(NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID));
  assert.ok(map.layers.has(NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID));
  assert.equal(map.layers.get(NAVIGATION_CUE_LAYER_ID).type, 'symbol');
  assert.equal(map.layers.get(NAVIGATION_CUE_OUTLINE_LAYER_ID).paint['line-width'], 8);
  assert.equal(map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).paint['line-width'], 4);
  assert.equal(map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID).paint['line-width'], 4);
  assert.equal(map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID).paint['line-width'], 8);
  assert.equal(map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID).paint['line-color'], '#ffd34f');
  assert.equal(map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_OUTLINE_LAYER_ID).paint['line-color'], '#65562f');
  assert.equal('line-dasharray' in map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID).paint, false);
  assert.deepEqual(
    ['line-cap', 'line-join'].map((key) => map.layers.get(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID).layout[key]),
    ['line-cap', 'line-join'].map((key) => map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).layout[key]),
    'reference shares the round cap and join with the green ribbon');
  assert.ok([...map.layers.keys()].indexOf(NAVIGATION_CUE_OFFSET_REFERENCE_LAYER_ID) > [...map.layers.keys()].indexOf(NAVIGATION_CUE_RIBBON_LAYER_ID),
    'yellow reference overlays the green ribbon');
  assert.equal(map.layers.get(NAVIGATION_CUE_ROUTE_PROJECTION_LAYER_ID).type, 'circle');
  assert.equal(map.layers.get(NAVIGATION_CUE_OUTLINE_LAYER_ID).layout.visibility, 'visible');
  assert.equal(map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).layout.visibility, 'visible');
  assert.deepEqual(map.layers.get(NAVIGATION_CUE_OUTLINE_LAYER_ID).filter, map.layers.get(NAVIGATION_CUE_RIBBON_LAYER_ID).filter);
  assert.equal(map.layers.get(NAVIGATION_CUE_LAYER_ID).layout['icon-rotation-alignment'], 'map');
    assert.equal(map.layers.get(NAVIGATION_CUE_LAYER_ID).layout['icon-pitch-alignment'], 'map', 'small arrows follow the tilted route plane');
  assert.ok(map.layers.get(NAVIGATION_CUE_LAYER_ID).filter.some((part) => Array.isArray(part) && part.includes('rejoin')));
  assert.ok(map.layers.get(NAVIGATION_CUE_LAYER_ID).filter.some((part) => Array.isArray(part) && part.includes('lead')), 'the lead feature must pass the symbol filter');
  layer.sync({ ...input, kind: 'rejoin' });
  assert.equal(map.layoutChanges.length, 2, 'one visibility update is sent to each line layer on route exit');
  assert.ok(map.layoutChanges.every(([, name, value]) => name === 'visibility' && value === 'none'));
  layer.sync(null);
  assert.equal(map.layoutChanges.length, 2, 'null after rejoin does not repeat unchanged visibility updates');
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
