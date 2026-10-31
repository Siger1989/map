import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteLayer } from '../modules/navigation/RouteLayer.ts';
import { validFavorite, parseFavorites, updateFavoriteRouteStyle } from '../modules/navigation/favorites.ts';
import { DEFAULT_ROUTE_STYLE, resolveRouteStyle, routeColorOptions, routeWidthOptions } from '../modules/navigation/routeStyleControls.ts';
import { routeLineWidthExpression } from '../modules/map/zoomLineWidth.ts';

const place = { name: 'A', coordinates: [103, 30] };
const route = {
  name: '路线', mode: 'auto', coordinates: [[103, 30], [103.01, 30]], distance: 1000,
  duration: 100, steps: [], snapped: [place.coordinates, [103.01, 30]], createdAt: 10,
};
const favorite = (routeValue) => ({ id: 'fav', name: '路线', savedAt: 11, start: place,
  end: { name: 'B', coordinates: [103.01, 30] }, route: routeValue });

test('route style reaches planned route features and MapLibre paint expressions', () => {
  const sources = new Map(), layers = new Map();
  const container = { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [],
    ownerDocument: { fonts: { addEventListener() {}, removeEventListener() {} } } };
  const map = {
    getSource: (id) => sources.get(id),
    addSource(id, spec) { sources.set(id, { data: spec.data, setData(value) { this.data = value; } }); },
    getLayer: (id) => layers.get(id), addLayer(spec) { layers.set(spec.id, spec); },
    getStyle: () => ({ layers: [...layers.values()] }), getContainer: () => container,
    moveLayer() {}, on() {}, off() {},
  };
  const oldRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
  new RouteLayer(map).sync({ route: { ...route, style: { color: '#ff7f00', width: 3.5 } }, start: null, end: null });
  const feature = sources.get('planned-route').data.features.find((item) => item.geometry.type === 'LineString');
  assert.equal(feature.properties.routeColor, '#ff7f00');
  assert.equal(feature.properties.routeWidth, 3.5);
  const paint = layers.get('route-path').paint;
  assert.deepEqual(paint['line-width'], routeLineWidthExpression(['coalesce', ['get', 'routeWidth'], 4]), 'navigation state never replaces the user-selected route width');
  assert.deepEqual(layers.get('route-outline').paint['line-width'], routeLineWidthExpression(['+', ['coalesce', ['get', 'routeWidth'], 4], 4]));
  assert.deepEqual(layers.get('route-access').paint['line-width'], routeLineWidthExpression(4));
  assert.deepEqual(paint['line-color'].at(-1), ['coalesce', ['get', 'color'], ['get', 'routeColor'], '#59dcff']);
  } finally {
    if (oldRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = oldRequestAnimationFrame;
  }
});

test('favorites preserve new route style and remain compatible with routes saved before styling existed', () => {
  const styled = favorite({ ...route, style: { color: '#377eb8', width: 2.5 } });
  const legacy = favorite({ ...route, createdAt: 12 });
  assert.equal(validFavorite(styled), true);
  assert.equal(validFavorite(legacy), true);
  assert.deepEqual(parseFavorites(JSON.stringify([styled, legacy])).map((item) => item.route.style), [
    { color: '#377eb8', width: 2.5 }, undefined,
  ]);
  assert.equal(validFavorite(favorite({ ...route, style: { color: 'red', width: 2 } })), false);
  const updated = updateFavoriteRouteStyle([styled, legacy], { ...route, ...styled.route }, { color: '#12ab34', width: 2.25 });
  assert.deepEqual(updated[0].route.style, { color: '#12ab34', width: 2.25 });
  assert.equal(updated[1], legacy, 'an unrelated favorite remains unchanged');
  assert.equal(updated.length, 2, 'style updates never create a favorite');
});

test('quick controls use the actual route fallback and expose legacy custom values', () => {
  assert.deepEqual(resolveRouteStyle(), DEFAULT_ROUTE_STYLE);
  assert.deepEqual(DEFAULT_ROUTE_STYLE, { color: '#59dcff', width: 4 });
  assert.deepEqual(resolveRouteStyle({ color: '#abcdef', width: 2.25 }), { color: '#abcdef', width: 2.25 });
  assert.ok(routeColorOptions('#abcdef').includes('#abcdef'));
  assert.ok(routeWidthOptions(2.25).includes(2.25));
});
