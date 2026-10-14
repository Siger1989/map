import test from 'node:test';
import assert from 'node:assert/strict';
import { NearbyMarker } from '../modules/map/NearbyMarker.ts';
import { getNearbyMarkerRange, isCoordinateWithinNearbyRange } from '../modules/map/nearbyMarkerRange.ts';

function fakeMap(center = [0, 0], zoom = 20) {
  const listeners = new Map();
  let appendCount = 0, projectCount = 0;
  const canvasContainer = { appendChild(element) { appendCount++; element.parentNode = this; }, };
  return {
    listeners,
    center: [...center],
    zoom,
    get appendCount() { return appendCount; },
    get projectCount() { return projectCount; },
    resetProjectCount() { projectCount = 0; },
    on(name, fn) { const entries = listeners.get(name) ?? []; entries.push(fn); listeners.set(name, entries); return this; },
    off(name, fn) { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== fn)); return this; },
    fire(name, event = {}) {
      const snapshot = [...(listeners.get(name) ?? [])];
      for (const fn of snapshot) fn({ type: name, ...event });
    },
    getCenter() { return { lng: this.center[0], lat: this.center[1] }; },
    getZoom() { return this.zoom; },
    getCanvas() { return { clientWidth: 100, clientHeight: 100 }; },
    getCanvasContainer() { return canvasContainer; },
    project() { projectCount++; return { x: 1, y: 2, _add() { return this; }, round() { return this; } }; },
  };
}

function markerElement(log = []) {
  const classes = new Set();
  return {
    parentNode: null,
    classList: {
      add: (value) => classes.add(value), remove: (value) => classes.delete(value),
      toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value),
      contains: (value) => classes.has(value),
    },
    style: { opacity: '' },
    addEventListener() {}, removeEventListener() {},
    hasAttribute() { return false; }, getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
    remove() { log.push('element-remove'); this.parentNode = null; },
  };
}

function instrument(marker, log = []) {
  marker._update = () => {
    if (!marker._map) { log.push('update-detached'); return; }
    log.push('update-attached');
    marker._map.project(marker._lngLat);
  };
  return marker;
}

test('range uses ground meters per pixel and the canvas diagonal without map projection helpers', () => {
  const map = fakeMap([0, 0], 20);
  map.project = () => { throw new Error('range must not project'); };
  map.unproject = () => { throw new Error('range must not unproject'); };
  map.getBounds = () => { throw new Error('range must not query bounds'); };
  const range = getNearbyMarkerRange(map);
  assert.ok(range);
  assert.equal(range.exitRadiusMeters, 150, 'the configured radius has a 150m floor');
  assert.equal(range.enterRadiusMeters, 135);
  assert.equal(getNearbyMarkerRange(fakeMap([0, 0], 2)).exitRadiusMeters, 30000,
    'the configured radius has a 30km ceiling');
});

test('range distance wraps across the antimeridian and fails open for invalid or polar inputs', () => {
  const range = getNearbyMarkerRange(fakeMap([179.999, 10], 8));
  assert.ok(range);
  assert.equal(isCoordinateWithinNearbyRange(range, [-179.999, 10]), true);
  assert.equal(isCoordinateWithinNearbyRange(range, [0, 85]), true);
  assert.equal(isCoordinateWithinNearbyRange(range, [NaN, 0]), true);
  assert.equal(getNearbyMarkerRange(fakeMap([0, 85], 8)), null);
  assert.equal(getNearbyMarkerRange({ getCenter() { throw new Error('map unavailable'); } }), null);
});

test('far markers never call native addTo or project, then reuse the same element when near', () => {
  const map = fakeMap();
  const element = markerElement();
  const marker = instrument(new NearbyMarker({ element }));
  marker.setLngLat([1, 1]).addTo(map);
  assert.equal(map.appendCount, 0);
  assert.equal(map.projectCount, 0);
  assert.equal(marker.getElement(), element);

  map.center = [1, 1];
  map.fire('move');
  assert.equal(map.appendCount, 1);
  assert.equal(map.projectCount, 1);
  assert.equal(marker.getElement(), element);
  assert.equal(marker.getLngLat().lng, 1);
});

test('detaches before applying a far setLngLat and ignores native callbacks retained in a move snapshot', () => {
  const map = fakeMap();
  const log = [];
  const element = markerElement(log);
  const marker = instrument(new NearbyMarker({ element }), log).setLngLat([0, 0]).addTo(map);
  assert.equal(map.projectCount, 1);
  log.length = 0;
  map.resetProjectCount();
  marker.setLngLat([2, 2]);
  assert.ok(log.indexOf('element-remove') >= 0);
  assert.ok(log.indexOf('update-detached') > log.indexOf('element-remove'),
    'native setLngLat update happens after native remove detached the marker');
  assert.equal(map.projectCount, 0);

  map.center = [0, 0];
  // The map dispatches a listener snapshot that still contains the removed native _update callback.
  map.fire('move');
  assert.equal(map.projectCount, 0, 'a stale callback returns before map.project after _map is cleared');

  marker.setLngLat([0, 0]);
  map.resetProjectCount();
  log.length = 0;
  map.center = [2, 2];
  map.fire('move');
  assert.ok(log.includes('element-remove'), 'the manager detaches during this move event');
  assert.ok(log.includes('update-detached'), 'the same event still invokes the native listener snapshot');
  assert.equal(map.projectCount, 0, 'the snapshot cannot project the marker after the manager detaches it');
});

test('attached markers use the outer radius while detached markers require the inner radius', () => {
  const map = fakeMap();
  const marker = instrument(new NearbyMarker({ element: markerElement() })).setLngLat([0, 0]).addTo(map);
  const metersToLatitude = (meters) => meters / 111195;
  map.center = [0, metersToLatitude(140)];
  map.fire('move');
  assert.equal(map.appendCount, 1, 'an attached marker stays through the 135–150m hysteresis band');
  map.center = [0, metersToLatitude(160)];
  map.fire('move');
  assert.equal(marker._map, undefined, 'the attached marker exits beyond the outer radius');
  map.center = [0, metersToLatitude(140)];
  map.fire('move');
  assert.equal(map.appendCount, 1, 'a detached marker does not re-enter in the hysteresis band');
  map.center = [0, metersToLatitude(130)];
  map.fire('move');
  assert.equal(map.appendCount, 2, 'the marker re-enters inside the inner radius');
});

test('two-finger zoom across the nearby boundary retains mounted markers until gesture end', () => {
  const map = fakeMap([0, 0], 10);
  const log = [];
  const marker = instrument(new NearbyMarker({ element: markerElement(log) }), log)
    .setLngLat([0, 5600 / 111195])
    .addTo(map);
  assert.equal(map.appendCount, 1);
  log.length = 0;
  map.fire('movestart', { originalEvent: { touches: [{}, {}] } });
  map.fire('zoomstart');

  for (const zoom of [10.25, 9.8, 10.25, 9.8]) {
    map.zoom = zoom;
    map.fire('move');
  }

  assert.equal(map.appendCount, 1, 'a mounted marker is not repeatedly appended during pinch zoom');
  assert.equal(log.filter((entry) => entry === 'element-remove').length, 0);

  map.zoom = 10.25;
  map.fire('move');
  map.fire('zoomend');
  assert.ok(marker._map, 'moveend still owns the active two-finger gesture');
  map.fire('moveend');
  assert.equal(marker._map, undefined, 'the normal nearby range is applied when the gesture ends');
  assert.equal(log.filter((entry) => entry === 'element-remove').length, 1);
});

test('same-coordinate setLngLat keeps an attached boundary marker during zoom, then gesture end prunes it', () => {
  const map = fakeMap([0, 0], 10);
  const log = [];
  const marker = instrument(new NearbyMarker({ element: markerElement(log) }), log)
    .setLngLat([0, 5600 / 111195])
    .addTo(map);
  assert.equal(map.appendCount, 1);
  log.length = 0;

  map.fire('zoomstart');
  map.zoom = 12.5;
  map.fire('move');
  assert.ok(marker._map, 'the active zoom retains this marker beyond the normal nearby radius');

  marker.setLngLat(marker.getLngLat());
  assert.ok(marker._map, 'a same-coordinate terrain-driven update uses the active gesture retention range');
  assert.equal(map.appendCount, 1, 'the update does not detach and re-append the marker');
  assert.equal(log.filter((entry) => entry === 'element-remove').length, 0);

  map.fire('zoomend');
  assert.equal(marker._map, undefined, 'zoom end reapplies the normal nearby range');
  assert.equal(log.filter((entry) => entry === 'element-remove').length, 1);
});

test('gesture retention still enforces the 30km cap and attaches new nearby markers', () => {
  const map = fakeMap([0, 0], 10);
  const marker = instrument(new NearbyMarker({ element: markerElement() }))
    .setLngLat([0, 5000 / 111195])
    .addTo(map);
  assert.ok(marker._map);
  map.fire('movestart', { originalEvent: { touches: [{}, {}] } });

  map.center = [0, -25_001 / 111195];
  map.fire('move');
  assert.equal(marker._map, undefined, 'gesture retention never keeps a marker beyond 30km');

  const nearby = instrument(new NearbyMarker({ element: markerElement() }))
    .setLngLat([0, map.center[1]])
    .addTo(map);
  assert.ok(nearby._map, 'newly nearby markers still attach during a held gesture');
  map.fire('moveend');
});

test('rotateend applies the normal range even without a paired moveend', () => {
  const map = fakeMap([0, 0], 10);
  const log = [];
  const marker = instrument(new NearbyMarker({ element: markerElement(log) }), log)
    .setLngLat([0, 5600 / 111195])
    .addTo(map);
  assert.ok(marker._map);
  log.length = 0;
  map.fire('rotatestart');
  map.zoom = 10.25;
  map.fire('move');
  assert.ok(marker._map, 'the marker remains mounted while rotation/zoom is active');

  map.fire('rotateend');
  assert.equal(marker._map, undefined);
  assert.equal(log.filter((entry) => entry === 'element-remove').length, 1);
});

test('manual removal and map removal clean manager listeners and isolate different maps', () => {
  const firstMap = fakeMap(), secondMap = fakeMap([10, 10]);
  const first = instrument(new NearbyMarker({ element: markerElement() })).setLngLat([0, 0]).addTo(firstMap);
  const second = instrument(new NearbyMarker({ element: markerElement() })).setLngLat([10, 10]).addTo(secondMap);
  assert.equal(firstMap.listeners.get('move').length, 2, 'manager listener precedes the native marker listener');
  assert.equal(secondMap.listeners.get('move').length, 2);

  firstMap.center = [20, 20]; firstMap.fire('move');
  assert.equal(first._map, undefined);
  assert.ok(second._map, 'movement on one map cannot detach markers on another');
  firstMap.fire('remove');
  for (const listeners of firstMap.listeners.values()) assert.equal(listeners.length, 0);
  assert.ok(second._map, 'removing one map leaves the other manager intact');

  second.remove();
  for (const listeners of secondMap.listeners.values()) assert.equal(listeners.length, 0);
  assert.equal(secondMap.appendCount, 1);
});
