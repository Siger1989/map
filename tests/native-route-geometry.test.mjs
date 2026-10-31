import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/native/routes.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { createNativeRouteGeometry } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const A = [0, 0], B = [0.001, 0], C = [0.002, 0], D = [0.003, 0];
const place = (name, coordinates) => ({ name, coordinates });
const planned = () => ({ mode: 'pedestrian', coordinates: [A, B, C, D], distance: 333, duration: 200,
  steps: [], snapped: [], createdAt: 0, style: { color: '#f06a33', width: 1.5 }, displayOpacity: 0.35,
  segments: [{ kind: 'access', coordinates: [A, B] }, { kind: 'road', coordinates: [B, C, D] }] });
const state = (extra = {}) => ({ route: planned(), start: place('起点', A), end: place('终点', D),
  via: [place('中转', C)], ...extra });

test('native route keeps saved style opacity access geometry and all endpoint names', () => {
  const overlay = state(), before = JSON.stringify(overlay);
  const features = createNativeRouteGeometry(overlay).features;
  const path = features.find(f => f.properties.role === 'routePath');
  assert.equal(path.properties.color, '#f06a33');
  assert.equal(path.properties.width, 1.5);
  assert.equal(path.properties.opacity, 0.35);
  assert.deepEqual(path.geometry.coordinates, [B, C, D]);
  const access = features.find(f => f.properties.role === 'routeAccess');
  assert.deepEqual(access.geometry.coordinates, [A, B]);
  assert.deepEqual(access.properties.dash, [2, 2]);
  assert.equal(access.properties.color, '#ffcb65');
  assert.equal(features.find(f => f.properties.role === 'routeOutline').properties.width, 5.5);
  assert.deepEqual(features.filter(f => f.properties.role === 'routePoint').map(f => f.properties.label),
    ['起 · 起点', '终 · 终点', '1 · 中转']);
  assert.ok(features.every(f => f.properties.nativePick.kind === 'route'));
  assert.equal(JSON.stringify(overlay), before);
});

test('display coloring replaces only road strokes and preserves access connectors', () => {
  const features = createNativeRouteGeometry(state({ displayParts: [{ coordinates: [B, C], color: '#112233' },
    { coordinates: [C, D], color: '#445566' }] })).features;
  assert.deepEqual(features.filter(f => f.properties.role === 'routePath').map(f => f.properties.color), ['#112233', '#445566']);
  assert.deepEqual(features.find(f => f.properties.role === 'routeAccess').geometry.coordinates, [A, B]);
  assert.equal(features.filter(f => f.properties.role === 'routeOutline').length, 2);
});

test('navigation progress splits at shared chainage while preserving ordinary route widths', () => {
  const overlay = state({ navigationProgress: 165, navigationClose: true,
    displayParts: [{ coordinates: [B, D], color: '#112233' }] });
  const features = createNativeRouteGeometry(overlay).features;
  const traveled = features.find(f => f.properties.role === 'routePath' && f.properties.navigationState === 'traveled');
  const future = features.find(f => f.properties.role === 'routePath' && f.properties.navigationState === 'future');
  assert.equal(traveled.properties.color, '#8e999b'); assert.equal(traveled.properties.width, 1.5);
  assert.equal(future.properties.color, '#39c878'); assert.equal(future.properties.width, 1.5);
  assert.deepEqual(traveled.geometry.coordinates.at(-1), future.geometry.coordinates[0]);
  assert.equal(features.find(f => f.properties.role === 'routeOutline' && f.properties.navigationState === 'traveled').properties.width, 5.5);
  assert.equal(features.find(f => f.properties.role === 'routeAccess').properties.width, 4);
  assert.ok(!features.some(f => f.properties.color === '#112233'));
});

test('navigationClose state never changes user route widths on travelled segments', () => {
  const route = planned();
  const close = createNativeRouteGeometry(state({ route, navigationProgress: 165, navigationClose: true })).features;
  const top = createNativeRouteGeometry(state({ route, navigationProgress: 165, navigationClose: false })).features;
  const closeTraveled = close.find(f => f.properties.role === 'routePath' && f.properties.navigationState === 'traveled');
  const topTraveled = top.find(f => f.properties.role === 'routePath' && f.properties.navigationState === 'traveled');
  const topOutline = top.find(f => f.properties.role === 'routeOutline' && f.properties.navigationState === 'traveled');
  assert.equal(closeTraveled.properties.width, 1.5);
  assert.equal(topTraveled.properties.width, 1.5);
  assert.equal(topOutline.properties.width, 5.5);
  assert.equal(close.find(f => f.properties.role === 'routeOutline' && f.properties.navigationState === 'traveled').properties.width, 5.5);
  assert.equal(close.find(f => f.properties.role === 'routeAccess').properties.width, 4);
  assert.equal(top.find(f => f.properties.role === 'routeAccess').properties.width, 4);
  assert.equal(topTraveled.properties.color, '#8e999b', 'traveled-state color retains its existing semantic override');
  assert.equal(topTraveled.properties.routeColor, '#f06a33', 'saved route color remains attached and unchanged');
  assert.equal(topTraveled.properties.routeWidth, 1.5);
});

test('start badge hides only near an actual navigation position and route-less picks still show', () => {
  const overlay = state();
  assert.equal(createNativeRouteGeometry(overlay, A).features.filter(f => f.properties.slot === 'start').length, 0);
  assert.equal(createNativeRouteGeometry(overlay, C).features.filter(f => f.properties.slot === 'start').length, 1);
  const unplanned = createNativeRouteGeometry(state({ route: null })).features;
  assert.equal(unplanned.length, 3); assert.ok(unplanned.every(f => f.geometry.type === 'Point'));
});

test('legacy route without style retains established default stroke and opaque display', () => {
  const route = planned(); delete route.style; delete route.displayOpacity; delete route.segments;
  const features = createNativeRouteGeometry(state({ route })).features;
  const path = features.find(f => f.properties.role === 'routePath');
  assert.equal(path.properties.color, '#59dcff'); assert.equal(path.properties.width, 4);
  // Missing opacity preserves the renderer's default of one, matching MapLibre coalesce.
  assert.equal(path.properties.opacity, 1);
  assert.deepEqual(path.geometry.coordinates, [A, B, C, D]);
});
