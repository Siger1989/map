import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installSelectionMarkerVisibility,
  isSelectionMarkerWithinRadius,
  selectionMarkerNearRadiusMeters,
} from '../modules/map/selectionMarkerVisibility.ts';

function fakeMap({ center = { lng: 0, lat: 0 }, zoom = 12, width = 390, height = 750 } = {}) {
  const handlers = new Map();
  const map = {
    center, zoom, width, height, handlers,
    getCenter() { return this.center; },
    getZoom() { return this.zoom; },
    getCanvas() { return { clientWidth: this.width, clientHeight: this.height }; },
    on(name, callback) { const callbacks = handlers.get(name) ?? new Set(); callbacks.add(callback); handlers.set(name, callbacks); },
    off(name, callback) { handlers.get(name)?.delete(callback); },
    fire(name) { for (const callback of [...(handlers.get(name) ?? [])]) callback(); },
  };
  return map;
}

function fakeMarker() {
  const classes = new Set(['map-selection-marker']);
  return {
    classes,
    classList: {
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
}

test('selection marker is visible nearby and hidden beyond the viewport distance', () => {
  const map = fakeMap(), marker = fakeMarker();
  let selected = [0.001, 0];
  const visibility = installSelectionMarkerVisibility(map, marker, () => selected);
  assert.equal(marker.classList.contains('is-distance-hidden'), false);
  selected = [2, 0];
  visibility.refresh();
  assert.equal(marker.classList.contains('is-distance-hidden'), true);
  visibility.cleanup();
});

test('zooming out increases near radius and restores a previously hidden marker', () => {
  const map = fakeMap({ zoom: 15 }), marker = fakeMarker();
  const selected = [0.02, 0];
  const visibility = installSelectionMarkerVisibility(map, marker, () => selected);
  assert.equal(marker.classList.contains('is-distance-hidden'), true);
  map.zoom = 8;
  map.fire('move');
  assert.equal(marker.classList.contains('is-distance-hidden'), false);
  visibility.cleanup();
});

test('haversine distance treats coordinates across the antimeridian as adjacent', () => {
  assert.equal(isSelectionMarkerWithinRadius([179.999, 0], [-179.999, 0], 300), true);
});

test('invalid selected coordinates or map dimensions fail open', () => {
  assert.equal(isSelectionMarkerWithinRadius([0, 0], [Number.NaN, 2], 100), true);
  assert.equal(selectionMarkerNearRadiusMeters(0, 12, 0, 750), null);
  assert.equal(selectionMarkerNearRadiusMeters(Number.NaN, 12, 390, 750), null);
  const map = fakeMap({ width: 0 }), marker = fakeMarker();
  const visibility = installSelectionMarkerVisibility(map, marker, () => [100, 30]);
  assert.equal(marker.classList.contains('is-distance-hidden'), false);
  visibility.cleanup();
});

test('move, resize, and remove listeners are released and cleanup restores the marker', () => {
  const map = fakeMap(), marker = fakeMarker();
  const visibility = installSelectionMarkerVisibility(map, marker, () => [30, 40]);
  assert.equal(marker.classList.contains('is-distance-hidden'), true);
  assert.equal(map.handlers.get('move').size, 1);
  assert.equal(map.handlers.get('resize').size, 1);
  assert.equal(map.handlers.get('remove').size, 1);
  map.fire('remove');
  assert.equal(marker.classList.contains('is-distance-hidden'), false);
  for (const name of ['move', 'resize', 'remove']) assert.equal(map.handlers.get(name).size, 0);
  visibility.cleanup();
});
