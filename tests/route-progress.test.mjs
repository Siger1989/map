import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationProgressParts } from '../modules/navigation/routeProgress.ts';
import { metresBetween } from '../modules/navigation/types.ts';
import { RouteLayer } from '../modules/navigation/RouteLayer.ts';

const makeRoute = (segments) => ({
  mode: 'auto',
  coordinates: segments.flatMap(({ coordinates }) => coordinates),
  segments,
  distance: 0,
  duration: 0,
  steps: [],
  snapped: [],
  createdAt: 0,
});

test('progress 0 and route end split without zero-length strokes', () => {
  const route = makeRoute([{ kind: 'road', coordinates: [[0, 0], [0.002, 0]] }]);
  const length = metresBetween([0, 0], [0.002, 0]);
  const atStart = createNavigationProgressParts(route, 0);
  assert.equal(atStart.length, 1);
  assert.equal(atStart[0].navigationState, 'future');
  assert.deepEqual(atStart[0].coordinates[0], [0, 0]);

  const atEnd = createNavigationProgressParts(route, length);
  assert.equal(atEnd.length, 1);
  assert.equal(atEnd[0].navigationState, 'traveled');
  assert.deepEqual(atEnd[0].coordinates.at(-1), [0.002, 0]);
  assert.ok(atStart.concat(atEnd).every(({ coordinates }) => coordinates.length >= 2));
});

test('partial road/access segments split at geographic progress and retain access semantics', () => {
  const route = makeRoute([
    { kind: 'road', coordinates: [[0, 0], [0.001, 0]] },
    { kind: 'access', coordinates: [[0.003, 0], [0.004, 0]] },
    { kind: 'road', coordinates: [[0.004, 0], [0.006, 0]] },
  ]);
  const roadLength = metresBetween([0, 0], [0.001, 0]);
  const gapLength = metresBetween([0.001, 0], [0.003, 0]);
  const accessLength = metresBetween([0.003, 0], [0.004, 0]);
  const progress = roadLength + gapLength + accessLength / 2;
  const parts = createNavigationProgressParts(route, progress);
  assert.deepEqual(parts.map(({ kind, navigationState }) => [kind, navigationState]), [
    ['road', 'traveled'], ['access', 'traveled'], ['access', 'future'], ['road', 'future'],
  ]);
  assert.deepEqual(parts[1].coordinates.at(-1), parts[2].coordinates[0], 'the access split shares its exact boundary point');
  assert.ok(parts.every(({ coordinates }) => coordinates.length >= 2));
  assert.equal(parts[0].coordinates.at(-1)[0], 0.001, 'the gap between segments is counted but never drawn');
  assert.equal(parts[3].coordinates[0][0], 0.004);
});

test('traveled paths are emitted before future paths at an outbound/return overlap', () => {
  const outbound = [[0, 0], [0.002, 0]];
  const returning = [[0.002, 0], [0, 0]];
  const route = makeRoute([
    { kind: 'road', coordinates: outbound },
    { kind: 'road', coordinates: returning },
  ]);
  const progress = metresBetween(outbound[0], outbound[1]) + 20;
  const parts = createNavigationProgressParts(route, progress);
  const states = parts.map(({ navigationState }) => navigationState);
  assert.deepEqual(states, ['traveled', 'traveled', 'future']);
  assert.deepEqual(parts[0].coordinates, outbound, 'the complete outward leg remains available as the gray first pass');
  assert.ok(parts[2].coordinates[0][0] < returning[0][0], 'the remaining inward leg begins at the interpolated progress point');
});

test('closed loops survive start, completion, and a mid-return split', () => {
  const loop = [[0, 0], [0.001, 0], [0, 0]];
  const route = makeRoute([{ kind: 'road', coordinates: loop }]);
  const length = 2 * metresBetween(loop[0], loop[1]);
  const atStart = createNavigationProgressParts(route, 0);
  assert.equal(atStart.length, 1);
  assert.strictEqual(atStart[0].coordinates, loop, 'whole future loop reuses the static route coordinate reference');

  const atEnd = createNavigationProgressParts(route, length);
  assert.equal(atEnd.length, 1);
  assert.strictEqual(atEnd[0].coordinates, loop, 'whole traveled loop is retained even though its endpoints coincide');

  const midReturn = createNavigationProgressParts(route, length * 0.65);
  assert.deepEqual(midReturn.map(({ navigationState }) => navigationState), ['traveled', 'future']);
  assert.deepEqual(midReturn[0].coordinates.at(-1), midReturn[1].coordinates[0], 'the return split shares one boundary point');
  assert.ok(midReturn[1].coordinates[0][0] < loop[1][0], 'the midpoint has entered the actual return leg');
});

test('repeated coordinates and antimeridian cuts produce finite, nonzero geometry', () => {
  const repeated = makeRoute([{ kind: 'road', coordinates: [[0, 0], [0.001, 0], [0.001, 0], [0.002, 0]] }]);
  const split = createNavigationProgressParts(repeated, metresBetween([0, 0], [0.0015, 0]));
  assert.equal(split.length, 2);
  assert.ok(split.every(({ coordinates }) => coordinates.length >= 2 && coordinates.every(([lon, lat]) => Number.isFinite(lon + lat))));
  assert.ok(split.every(({ coordinates }) => coordinates.every(([lon, lat], i) => i === 0 || lon !== coordinates[i - 1][0] || lat !== coordinates[i - 1][1])));

  const dateline = makeRoute([{ kind: 'road', coordinates: [[179.999, 0], [-179.999, 0]] }]);
  const datelineParts = createNavigationProgressParts(dateline, metresBetween([179.999, 0], [-180, 0]));
  const boundary = datelineParts[0].coordinates.at(-1);
  assert.ok(Math.abs(Math.abs(boundary[0]) - 180) < 0.00001, 'cut follows the short crossing at the antimeridian');
});

test('distance cache is reused while the same route and segments references are updated', () => {
  const backing = Array.from({ length: 10_000 }, (_, index) => [index * 0.00001, 0]);
  let reads = 0;
  const coordinates = new Proxy(backing, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads++;
      return Reflect.get(target, property, receiver);
    },
  });
  const segments = [{ kind: 'road', coordinates }];
  const route = makeRoute(segments);
  createNavigationProgressParts(route, 50_000);
  assert.ok(reads > 10_000, 'initial call builds the cumulative distance cache');
  reads = 0;
  createNavigationProgressParts(route, 50_100);
  assert.ok(reads < 100, `subsequent progress update read ${reads} route coordinates instead of rescanning the route`);
});

test('RouteLayer restores displayParts when navigationProgress ends', () => {
  const sources = new Map();
  const layers = new Map();
  const container = {
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    ownerDocument: { fonts: { addEventListener() {}, removeEventListener() {} } },
  };
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id, spec) { sources.set(id, { data: spec.data, setData(value) { this.data = value; } }); },
    getLayer: (id) => layers.get(id),
    addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }),
    getContainer: () => container,
    moveLayer() {},
    on() {},
    off() {},
  };
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const route = makeRoute([
      { kind: 'road', coordinates: [[0, 0], [0.002, 0]] },
      { kind: 'access', coordinates: [[0.002, 0], [0.003, 0]] },
    ]);
    const overlay = {
      route,
      start: null,
      end: null,
      displayParts: [{ coordinates: [[0, 0], [0.002, 0]], color: '#123456' }],
      navigationProgress: 100,
      navigationClose: true,
    };
    const layer = new RouteLayer(map);
    layer.sync(overlay);
    const activeLines = sources.get('planned-route').data.features.filter(({ geometry }) => geometry.type === 'LineString');
    assert.ok(activeLines.some(({ properties }) => properties.navigationState === 'traveled' && properties.navigationClose === true));
    assert.ok(activeLines.some(({ properties }) => properties.navigationState === 'future' && properties.kind === 'access'));

    const { navigationProgress: _ended, navigationClose: _close, ...ended } = overlay;
    layer.sync(ended);
    const restored = sources.get('planned-route').data.features.filter(({ geometry }) => geometry.type === 'LineString');
    assert.ok(restored.some(({ properties }) => properties.color === '#123456'), 'the original displayParts color returns');
    assert.ok(restored.every(({ properties }) => properties.navigationState === undefined));
  } finally {
    if (previousRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});
