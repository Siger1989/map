import test from 'node:test';
import assert from 'node:assert/strict';
import { clipProjectedPathForMarker, syncRouteIconPriority } from '../modules/map/routeIconPriority.ts';
import { saveRouteMask, setRouteMask } from '../modules/map/routeIconPriorityGeometry.ts';

test('flat Mercator masks refresh after visual changes and route tiles, not unrelated repaints', () => {
  const map = fakeMap([marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 })]);
  let pitch = 0;
  let terrain = null;
  map.getPitch = () => pitch;
  map.getTerrain = () => terrain;
  map.getProjection = () => ({ type: 'mercator' });
  const data = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'route-1',
    properties: {}, geometry: { type: 'LineString', coordinates: [[15, 50], [85, 50]] } }] };
  syncRouteIconPriority(map, 'planned-route', data);
  map.fire('render');
  const settled = map.queryCount;
  for (let i = 0; i < 10; i++) map.fire('render');
  assert.equal(map.queryCount, settled);
  map.getProjection = () => undefined;
  map.fire('render');
  assert.equal(map.queryCount, settled, 'an absent style projection is MapLibre default Mercator');
  map.fire('move');
  assert.equal(map.queryCount, settled, 'flat changes wait for the updated rendered tile set');
  map.fire('render');
  assert.equal(map.queryCount, settled + 1);
  map.fire('sourcedata', { sourceId: 'base-labels' });
  map.fire('render');
  assert.equal(map.queryCount, settled + 1);
  map.fire('sourcedata', { sourceId: 'planned-route' });
  map.fire('render');
  assert.equal(map.queryCount, settled + 2, 'late route tile loading refreshes the mask');
  map.fire('resize'); map.fire('render');
  map.fire('styledata'); map.fire('render');
  assert.equal(map.queryCount, settled + 4);
  pitch = 55;
  map.fire('render'); map.fire('render');
  assert.equal(map.queryCount, settled + 6, 'pitched views preserve per-render refresh');
  pitch = 0; terrain = { source: 'dem' };
  map.fire('render'); map.fire('render');
  assert.equal(map.queryCount, settled + 8, 'terrain views preserve per-render refresh');
  map.fire('remove');
  const removed = map.queryCount;
  map.fire('sourcedata', { sourceId: 'planned-route' }); map.fire('render');
  assert.equal(map.queryCount, removed);
});

function marker(rect, childRects = [], initialMask = '', initialStyles = {}) {
  const makeStyle = (styles = {}, mask = '') => {
    const values = new Map([...Object.entries(styles), ...(mask ? [['mask-image', mask]] : [])]);
    const priorities = new Map();
    const writes = [];
    return {
      getPropertyValue: (name) => values.get(name) ?? '',
      getPropertyPriority: (name) => priorities.get(name) ?? '',
      writes,
      setProperty: (name, value, priority = '') => { writes.push([name, value, priority]); values.set(name, value); priorities.set(name, priority); },
      removeProperty: (name) => { values.delete(name); priorities.delete(name); },
      text: () => [...values].map(([key, value]) => `${key}: ${value}`).join('; '),
    };
  };
  const style = makeStyle(initialStyles, initialMask);
  const children = childRects.map((item) => {
    const childRect = item.rect ?? item;
    const childStyle = makeStyle(item.styles ?? {}, item.mask ?? '');
    return {
      style: childStyle,
      offsetWidth: childRect.width,
      offsetHeight: childRect.height,
      classList: { contains: () => false },
      ownerDocument: item.pseudo ? { defaultView: { getComputedStyle: (_child, pseudo) => item.pseudo[pseudo] ?? { display: 'none', visibility: 'visible', content: 'none' } } } : undefined,
      getClientRects: () => [childRect], getBoundingClientRect: () => childRect,
      closest: (selector) => selector === '.maplibregl-marker' ? element : null,
      getAttribute: (name) => name === 'style' && childStyle.text() ? childStyle.text() : null,
    };
  });
  const element = {
    style,
    offsetWidth: rect.width,
    offsetHeight: rect.height,
    dataset: {},
    classList: { contains: (name) => name === 'maplibregl-marker' },
    getBoundingClientRect: () => rect,
    getClientRects: () => [rect],
    children,
    querySelectorAll: () => children,
    closest: (selector) => selector === '.maplibregl-marker' ? element : null,
    getAttribute: (name) => name === 'style' && style.text() ? style.text() : null,
  };
  return element;
}

function fakeMap(markers, { hit = true, visible = true, opacity = 1, routeLayer = 'route-path', routeSource = 'planned-route', geometry, properties = {}, paint = {} } = {}) {
  const handlers = new Map();
  const layoutQueries = [];
  let queryCount = 0;
  const line = {
    type: 'Feature', id: 'route-1', properties,
    geometry: geometry ?? { type: 'LineString', coordinates: [[15, 50], [85, 50]] },
    layer: { id: routeLayer }, source: routeSource,
  };
  return {
    handlers,
    layoutQueries,
    get queryCount() { return queryCount; },
    on: (name, fn) => { const set = handlers.get(name) ?? new Set(); set.add(fn); handlers.set(name, set); },
    off: (name, fn) => handlers.get(name)?.delete(fn),
    fire: (name, event = {}) => { for (const fn of handlers.get(name) ?? []) fn(event); },
    getContainer: () => ({ querySelectorAll: () => markers }),
    getCanvas: () => ({ clientWidth: 200, clientHeight: 120,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 }) }),
    getLayer: (id) => id === routeLayer && visible ? { id, layout: { visibility: 'visible' } } : undefined,
    getPaintProperty: (_id, property) => paint[property] ?? (property === 'line-width' ? 4 : property === 'line-opacity' ? opacity : undefined),
    getLayoutProperty: (id) => { layoutQueries.push(id); return 'round'; },
    getSource: (id) => id === routeSource ? {} : undefined,
    isStyleLoaded: () => true,
    project: ([x, y]) => ({ x, y }),
    queryRenderedFeatures: (_box, options) => {
      queryCount++;
      return hit && options.layers.includes(routeLayer) ? [line] : [];
    },
  };
}

const routeData = { type: 'FeatureCollection', features: [{
  type: 'Feature', id: 'route-1', properties: {},
  geometry: { type: 'LineString', coordinates: [[15, 50], [85, 50]] },
}] };

test('masks only route pixels inside a marker, including visible overflow children', () => {
  const element = marker({ left: 20, top: 30, right: 40, bottom: 70, width: 20, height: 40 }, [
    { left: 40, top: 32, right: 64, bottom: 50, width: 24, height: 18 },
  ]);
  const map = fakeMap([element]);
  syncRouteIconPriority(map, 'planned-route', routeData);
  const css = element.style.getPropertyValue('mask-image');
  assert.match(css, /data:image\/svg\+xml/);
  const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
  assert.match(svg, /mask-type="luminance"/);
  assert.match(svg, /stroke-width="4\.0"/);
  assert.match(svg, /<rect width="100%" height="100%" fill="white" mask="url\(#m\)"\/>/);
  assert.equal(map.handlers.get('move')?.size, 1);
  assert.ok(map.layoutQueries.length > 0 && map.layoutQueries.every((id) => id === 'route-path'),
    'layout is only queried for route layers that exist');
});

test('reads every live marker bound before the first mask style write', () => {
  const elements = [
    marker({ left: 20, top: 30, right: 40, bottom: 70, width: 20, height: 40 }),
    marker({ left: 60, top: 30, right: 80, bottom: 70, width: 20, height: 40 }),
  ];
  const events = [];
  for (const [index, element] of elements.entries()) {
    const getRect = element.getBoundingClientRect;
    element.getBoundingClientRect = () => {
      events.push(`read:rect:${index}`);
      return getRect();
    };
    for (const dimension of ['offsetWidth', 'offsetHeight']) {
      const value = element[dimension];
      Object.defineProperty(element, dimension, { get: () => { events.push(`read:${dimension}:${index}`); return value; } });
    }
    const setProperty = element.style.setProperty;
    element.style.setProperty = (...args) => {
      events.push(`write:${index}`);
      setProperty(...args);
    };
  }

  syncRouteIconPriority(fakeMap(elements), 'planned-route', routeData);
  const firstWrite = events.findIndex((event) => event.startsWith('write:'));
  const lastLayoutRead = events.reduce((last, event, index) => event.startsWith('read:') ? index : last, -1);
  assert.ok(firstWrite > lastLayoutRead, 'all marker and mask-target layout reads finish before styles are written');
  for (let index = 0; index < elements.length; index++) {
    assert.ok(events.includes(`read:offsetWidth:${index}`), 'target offset width is pre-read');
    assert.ok(events.includes(`read:offsetHeight:${index}`), 'target offset height is pre-read');
  }
});

test('writes only changed mask declarations and clears stale important priority', () => {
  const bounds = { left: 20, top: 30, right: 50, bottom: 70 };
  const element = marker(bounds);
  const saved = saveRouteMask(element);
  const paths = [{ points: [[5, 10], [25, 10]], width: 4, dash: [], cap: 'round' }];
  setRouteMask(element, saved, bounds, paths);
  assert.equal(element.style.writes.length, 14, 'the first mask writes all required CSS declarations');

  element.style.writes.length = 0;
  setRouteMask(element, saved, bounds, paths);
  assert.equal(element.style.writes.length, 0, 'an unchanged mask causes no CSS writes');

  element.style.writes.length = 0;
  setRouteMask(element, saved, bounds, [{ ...paths[0], points: [[5, 10], [26, 11]] }]);
  assert.deepEqual(element.style.writes.map(([name]) => name), ['mask-image', '-webkit-mask-image'],
    'changed route geometry updates only the two image declarations');

  element.style.writes.length = 0;
  element.style.setProperty('mask-repeat', 'repeat');
  element.style.writes.length = 0;
  setRouteMask(element, saved, bounds, [{ ...paths[0], points: [[5, 10], [26, 11]] }]);
  assert.deepEqual(element.style.writes.map(([name]) => name), ['mask-repeat'],
    'an external mask-property change is repaired on the next update');
  assert.equal(element.style.getPropertyValue('mask-repeat'), 'no-repeat');

  element.style.writes.length = 0;
  element.style.setProperty('mask-origin', 'border-box', 'important');
  element.style.writes.length = 0;
  setRouteMask(element, saved, bounds, [{ ...paths[0], points: [[5, 10], [26, 11]] }]);
  assert.deepEqual(element.style.writes.map(([name]) => name), ['mask-origin'],
    'the required value is rewritten to remove an external important priority');
  assert.equal(element.style.getPropertyPriority('mask-origin'), '');
});

test('pre-read target metrics preserve mask geometry with non-unit transforms', () => {
  const rect = { left: 10, top: 20, right: 70, bottom: 60, width: 60, height: 40 };
  const bounds = { left: 20, top: 30, right: 50, bottom: 50 };
  const paths = [{ points: [[10, 10], [30, 20]], width: 6, dash: [2, 1], cap: 'round' }];
  const legacy = marker(rect);
  const batched = marker(rect);
  legacy.offsetWidth = batched.offsetWidth = 30;
  legacy.offsetHeight = batched.offsetHeight = 20;
  const legacySaved = saveRouteMask(legacy);
  const batchedSaved = saveRouteMask(batched);
  setRouteMask(legacy, legacySaved, bounds, paths);
  setRouteMask(batched, batchedSaved, bounds, paths, {
    left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    offsetWidth: 30, offsetHeight: 20,
  });
  assert.equal(batched.style.getPropertyValue('mask-image'), legacy.style.getPropertyValue('mask-image'));
  assert.equal(batched.style.getPropertyValue('mask-size'), legacy.style.getPropertyValue('mask-size'));
  assert.equal(batched.style.getPropertyValue('mask-position'), legacy.style.getPropertyValue('mask-position'));
});

test('reuses marker-local transform and clipping by projected path reference', () => {
  let mapAccesses = 0;
  const screenPath = new Proxy([[15, 50], [90, 50]], {
    get(target, property, receiver) {
      if (property === 'map') mapAccesses++;
      return Reflect.get(target, property, receiver);
    },
  });
  const projected = [screenPath];
  const bounds = { left: 20, top: 30, right: 50, bottom: 70 };
  const clipBounds = { left: 0, top: 0, right: 30, bottom: 40 };
  const firstMarkerCache = new WeakMap();
  const first = clipProjectedPathForMarker(projected, 0, screenPath, bounds, clipBounds, firstMarkerCache);
  const repeated = clipProjectedPathForMarker(projected, 0, screenPath, bounds, clipBounds, firstMarkerCache);
  assert.strictEqual(repeated, first, 'the same projected path returns the cached clipped runs');
  assert.deepEqual(first, [[[0, 20], [30, 20]]], 'the cached run keeps the exact marker-local clip');
  assert.equal(mapAccesses, 1, 'local coordinate transformation is performed once within a marker');

  const secondMarkerCache = new WeakMap();
  const second = clipProjectedPathForMarker(projected, 0, screenPath,
    { left: 40, top: 30, right: 70, bottom: 70 }, clipBounds, secondMarkerCache);
  assert.equal(second.length, 1, 'the second marker keeps one clipped run');
  assert.deepEqual(second[0][0], [0, 20]);
  assert.ok(Math.abs(second[0][1][0] - 30) < 1e-9 && second[0][1][1] === 20,
    'a different marker computes against its own local origin');
  assert.equal(mapAccesses, 2, 'a second marker does not reuse marker-specific clipped coordinates');
});

test('duplicate route layers reuse clipped geometry but keep per-layer mask style and hit order', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const map = fakeMap([element]);
  const originalGetLayer = map.getLayer;
  map.getLayer = (id) => ['route-outline', 'route-path'].includes(id) ? { id } : originalGetLayer(id);
  map.getPaintProperty = (id, property) => {
    if (property === 'line-width') return id === 'route-outline' ? 8 : 4;
    if (property === 'line-opacity') return id === 'route-outline' ? 0.5 : 1;
    if (property === 'line-dasharray') return id === 'route-outline' ? [2, 1] : undefined;
    return undefined;
  };
  map.getLayoutProperty = (id, property) => property === 'visibility' ? 'visible' :
    (id === 'route-path' ? 'square' : 'round');
  map.queryRenderedFeatures = (_box, options) => options.layers.includes('route-outline')
    ? options.layers.filter((id) => id === 'route-outline' || id === 'route-path').map((id) => ({
      type: 'Feature', id: 'route-1', properties: {},
      geometry: { type: 'LineString', coordinates: [[15, 50], [85, 50]] },
      layer: { id }, source: 'planned-route',
    }))
    : [];

  syncRouteIconPriority(map, 'planned-route', routeData);
  const css = element.style.getPropertyValue('mask-image');
  const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
  assert.equal((svg.match(/<path /g) ?? []).length, 2, 'each hit still contributes its own mask path');
  assert.ok(svg.indexOf('stroke-width="8.0"') < svg.indexOf('stroke-width="4.0"'),
    'paths retain rendered hit order');
  assert.match(svg, /stroke-width="8\.0"[^>]*stroke-linecap="round"[^>]*stroke-dasharray=/,
    'the outline keeps its width, cap, and dash');
  assert.match(svg, /stroke-width="4\.0"[^>]*stroke-linecap="square"/,
    'the path keeps its independent width and cap');
});

test('targets visible direct children of a 1px overflow marker and restores each original mask', () => {
  const first = { rect: { left: 30, top: 30, right: 55, bottom: 55, width: 25, height: 25 }, mask: 'url("first.svg")', styles: { 'mask-origin': 'content-box' } };
  const second = { rect: { left: 20, top: 20, right: 70, bottom: 70, width: 50, height: 50 } };
  const root = marker({ left: 45, top: 45, right: 46, bottom: 46, width: 1, height: 1 }, [first, second]);
  const map = fakeMap([root]);
  syncRouteIconPriority(map, 'planned-route', routeData);

  assert.equal(root.style.getPropertyValue('mask-image'), '', 'the 1px marker positioning root stays unmasked');
  assert.match(root.children[0].style.getPropertyValue('mask-image'), /data:image\/svg\+xml/);
  assert.match(root.children[1].style.getPropertyValue('mask-image'), /data:image\/svg\+xml/);
  assert.equal(root.children[0].style.getPropertyValue('mask-position'), '-10px -10px',
    'the shared screen-bounds image is offset relative to the child rectangle');
  assert.equal(root.children[1].style.getPropertyValue('mask-position'), '0px 0px');

  syncRouteIconPriority(map, 'planned-route', { type: 'FeatureCollection', features: [] });
  assert.equal(root.children[0].style.getPropertyValue('mask-image'), 'url("first.svg")');
  assert.equal(root.children[0].style.getPropertyValue('mask-origin'), 'content-box');
  assert.equal(root.children[1].style.getPropertyValue('mask-image'), '');
  assert.equal(map.handlers.get('move')?.size, 0);
});

test('masks selected-route outline from the MultiLineString source, without extending a disconnected run', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const geometry = { type: 'MultiLineString', coordinates: [[[15, 50], [45, 50]], [[65, 50], [85, 50]]] };
  const map = fakeMap([element], {
    routeLayer: 'manual-track-selection-edge',
    routeSource: 'manual-track-selection-edge',
    geometry,
    properties: { width: 9 },
    paint: { 'line-width': ['get', 'width'] },
  });
  const data = { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'route-1', properties: { width: 9 }, geometry,
  }] };
  syncRouteIconPriority(map, 'manual-track-selection-edge', data);
  const css = element.style.getPropertyValue('mask-image');
  const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
  assert.equal((svg.match(/<path /g) ?? []).length, 1);
  assert.match(svg, /stroke-width="9\.0"/);
});

test('matches rendered MultiLineString by id and samples past dense off-icon route geometry', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const coordinates = Array.from({ length: 1202 }, () => [150, 20]);
  coordinates.push([20, 50], [50, 50]);
  const geometry = { type: 'LineString', coordinates };
  const map = fakeMap([element], {
    routeLayer: 'manual-track-line', routeSource: 'manual-tracks',
    properties: { width: 6, opacity: 0.4, selected: true },
    paint: {
      'line-width': ['+', ['get', 'width'], ['case', ['get', 'selected'], 2, 1]],
      'line-opacity': ['*', 0.65, ['get', 'opacity']],
    },
  });
  const data = { type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'route-1', properties: { width: 6, opacity: 0.4, selected: true }, geometry,
  }] };
  syncRouteIconPriority(map, 'manual-tracks', data);
  const css = element.style.getPropertyValue('mask-image');
  assert.match(css, /data:image\/svg\+xml/);
  const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
  assert.match(svg, /stroke-width="8\.0"/);
});

test('caches projected geometry by canonical feature reference per render update', () => {
  let coordinateReads = 0;
  let coordinates = [[15, 50], [85, 50]];
  const geometry = {
    type: 'LineString',
    get coordinates() { coordinateReads++; return coordinates; },
  };
  const canonical = { type: 'Feature', id: 'route-1', properties: {}, geometry };
  const markers = Array.from({ length: 10 }, () =>
    marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 }));
  const map = fakeMap(markers);
  let projectCalls = 0;
  const project = map.project;
  map.project = (coordinate) => { projectCalls++; return project(coordinate); };

  syncRouteIconPriority(map, 'planned-route', { type: 'FeatureCollection', features: [canonical] });
  assert.equal(map.queryCount, 10, 'each marker still queries visible route hits');
  assert.equal(coordinateReads, 1, 'the shared feature geometry is read only for its one projection');
  const firstFrameProjectCalls = projectCalls;
  assert.ok(firstFrameProjectCalls > 0);

  coordinateReads = 0;
  projectCalls = 0;
  map.fire('render');
  assert.equal(coordinateReads, 1, 'the next render recomputes from the current camera');
  assert.equal(projectCalls, firstFrameProjectCalls);

  coordinates = [[15, 50], [85, 50], [86, 51]];
  coordinateReads = 0;
  projectCalls = 0;
  map.fire('render');
  assert.equal(coordinateReads, 1, 'updated geometry is read on the next update');
  assert.ok(projectCalls > firstFrameProjectCalls, 'the longer geometry is reprojected');
});

test('fallback geometry signature shares projection across tile clones but evaluates each hit style', () => {
  let sourceCoordinateReads = 0, renderedCoordinateReads = 0;
  const coordinates = [[15, 50], [85, 50]];
  const sourceGeometry = { type: 'MultiLineString', get coordinates() { sourceCoordinateReads++; return [coordinates]; } };
  const tileGeometry = { type: 'LineString', get coordinates() { renderedCoordinateReads++; return coordinates; } };
  const canonical = { type: 'Feature', id: 'manual-track:synthetic:line:0', properties: { trackId: 'synthetic' }, geometry: sourceGeometry };
  const data = { type: 'FeatureCollection', features: [canonical] };
  const markers = Array.from({ length: 10 }, () => marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 }));
  const map = fakeMap(markers, {
    routeLayer: 'manual-track-line', routeSource: 'manual-tracks', geometry: tileGeometry,
    paint: { 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] },
  });
  const query = map.queryRenderedFeatures;
  map.queryRenderedFeatures = (...args) => query(...args).map((feature) => ({
    ...feature,
    id: Number.NaN,
    geometry: tileGeometry,
    properties: { width: map.queryCount + 1, opacity: map.queryCount === 3 ? 0 : 1 },
  }));
  let projectCalls = 0;
  const project = map.project;
  map.project = (coordinate) => { projectCalls++; return project(coordinate); };

  syncRouteIconPriority(map, 'manual-tracks', data);
  assert.equal(map.queryCount, markers.length, 'the exact local rendered-feature query remains per marker');
  assert.equal(sourceCoordinateReads, 1, 'canonical geometry signatures are built once per source sync');
  assert.equal(projectCalls, 11, 'identical fallback tile geometries are projected once per update');
  assert.equal(markers[2].style.getPropertyValue('mask-image'), '', 'each rendered hit still applies its own zero opacity');
  for (const [index, element] of markers.entries()) {
    if (index === 2) continue;
    const css = element.style.getPropertyValue('mask-image');
    const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
    assert.match(svg, new RegExp(`stroke-width="${(index + 2).toFixed(1)}"`), 'each hit keeps its own width');
  }
  assert.equal(renderedCoordinateReads, markers.length + 1,
    'each returned tile geometry is signed once and the shared geometry is projected once');
});

test('source sync invalidates lazy geometry signatures and duplicate geometries keep the first candidate', () => {
  const markers = [marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 })];
  const oldGeometry = { type: 'LineString', coordinates: [[15, 50], [85, 50]] };
  const first = { type: 'Feature', id: 'canonical-first', properties: { width: 6 }, geometry: oldGeometry };
  const duplicate = { type: 'Feature', id: 'canonical-second', properties: { width: 8 }, geometry: oldGeometry };
  const data = { type: 'FeatureCollection', features: [first, duplicate] };
  const map = fakeMap(markers, {
    geometry: oldGeometry,
    paint: { 'line-width': ['get', 'width'] },
  });
  const query = map.queryRenderedFeatures;
  let tileGeometry = oldGeometry;
  map.queryRenderedFeatures = (...args) => query(...args).map(feature => ({
    ...feature, id: 'worker-id-without-canonical-match', geometry: tileGeometry, properties: { width: 99 },
  }));
  const widthFromMask = () => {
    const svg = decodeURIComponent(markers[0].style.getPropertyValue('mask-image').match(/data:image\/svg\+xml,([^\"]+)/)[1]);
    return Number(svg.match(/stroke-width="([0-9.]+)"/)[1]);
  };

  syncRouteIconPriority(map, 'planned-route', data);
  assert.equal(widthFromMask(), 6, 'exact geometry fallback preserves first-candidate semantics');

  const newGeometry = { type: 'LineString', coordinates: [[15, 50], [45, 55], [85, 50]] };
  first.geometry = newGeometry;
  tileGeometry = newGeometry;
  map.queryRenderedFeatures = (...args) => query(...args).map(feature => ({
    ...feature, id: 'worker-id-without-canonical-match', geometry: tileGeometry, properties: { width: 99 },
  }));
  syncRouteIconPriority(map, 'planned-route', data);
  assert.equal(widthFromMask(), 6, 're-syncing the same FeatureCollection reference rebuilds its geometry index');
});

test('includes the annotation marker triangle and its shadow pseudo-element in the mask extent', () => {
  const pseudo = {
    display: 'block', visibility: 'visible', content: '""',
    borderTopWidth: '14px', borderLeftWidth: '7px', borderRightWidth: '7px', borderBottomWidth: '0px',
    filter: 'drop-shadow(0 1px 1px #102129)',
  };
  const element = marker({ left: 20, top: 30, right: 40, bottom: 70, width: 20, height: 40 }, [
    { rect: { left: 20, top: 35, right: 50, bottom: 65, width: 30, height: 30 }, pseudo: { '::after': pseudo } },
  ]);
  const map = fakeMap([element]);
  syncRouteIconPriority(map, 'planned-route', routeData);
  const css = element.style.getPropertyValue('mask-image');
  const svg = decodeURIComponent(css.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
  assert.match(svg, /width="64\.0"/);
  assert.match(svg, /height="64\.0"/);
});

test('includes pseudo-element overflow painted on the marker root itself', () => {
  const element = marker({ left: 20, top: 30, right: 40, bottom: 50, width: 20, height: 20 });
  const pseudo = {
    display: 'block', visibility: 'visible', content: '""',
    borderBottomWidth: '14px', borderTopWidth: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
  };
  element.ownerDocument = { defaultView: { getComputedStyle: (_element, selector) => selector === '::after'
    ? pseudo : { display: 'none', visibility: 'visible', content: 'none' } } };
  const map = fakeMap([element]);
  syncRouteIconPriority(map, 'planned-route', routeData);
  assert.equal(element.style.getPropertyValue('mask-size'), '54px 54px',
    'the root pseudo-element receives the same conservative extent as descendant pseudo-elements');
  assert.equal(element.style.getPropertyValue('mask-position'), '-17px -17px');
});

test('does not leave a mask when no visible rendered route overlaps the marker', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const map = fakeMap([element], { hit: false });
  syncRouteIconPriority(map, 'planned-route', routeData);
  assert.equal(element.style.getPropertyValue('mask-image'), '');
});

test('does not mask for a route style with zero rendered opacity', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const map = fakeMap([element], { opacity: 0 });
  syncRouteIconPriority(map, 'planned-route', routeData);
  assert.equal(element.style.getPropertyValue('mask-image'), '');
});

test('restores an existing mask and removes listeners when route data clears', () => {
  const original = {
    '-webkit-mask-image': 'url("old-webkit-mask.svg")',
    'mask-mode': 'luminance', '-webkit-mask-mode': 'alpha',
    'mask-origin': 'padding-box', '-webkit-mask-origin': 'content-box',
    'mask-clip': 'padding-box', '-webkit-mask-clip': 'border-box',
  };
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 }, [], 'url("old-mask.svg")', original);
  const map = fakeMap([element]);
  syncRouteIconPriority(map, 'planned-route', routeData);
  assert.notEqual(element.style.getPropertyValue('mask-image'), 'url("old-mask.svg")');
  syncRouteIconPriority(map, 'planned-route', { type: 'FeatureCollection', features: [] });
  assert.equal(element.style.getPropertyValue('mask-image'), 'url("old-mask.svg")');
  for (const [name, value] of Object.entries(original)) assert.equal(element.style.getPropertyValue(name), value);
  assert.equal(map.handlers.get('move')?.size, 0);
  assert.equal(map.handlers.get('remove')?.size, 0);
});

test('restores marker styles when the marker is removed or the map is removed', () => {
  const first = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 }, [], 'url("first.svg")');
  const second = marker({ left: 65, top: 30, right: 95, bottom: 70, width: 30, height: 40 }, [], 'url("second.svg")');
  const markers = [first, second];
  const map = fakeMap(markers);
  syncRouteIconPriority(map, 'planned-route', routeData);
  markers.splice(0, 1);
  map.fire('move');
  assert.equal(first.style.getPropertyValue('mask-image'), 'url("first.svg")');
  map.fire('remove');
  assert.equal(second.style.getPropertyValue('mask-image'), 'url("second.svg")');
  assert.equal(map.handlers.get('render')?.size, 0);
});

test('disconnects marker-observation cleanup on map removal', () => {
  const previous = globalThis.MutationObserver;
  let disconnected = false;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() { disconnected = true; }
  };
  try {
    const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
    const map = fakeMap([element]);
    syncRouteIconPriority(map, 'planned-route', routeData);
    map.fire('remove');
    assert.equal(disconnected, true);
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test('marker transform changes resync the mask while mask-only style writes do not loop', () => {
  const previous = globalThis.MutationObserver;
  let observerCallback;
  globalThis.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const rect = { left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 };
    const element = marker(rect, [], '', { transform: 'translate3d(20px, 50px, 0)' });
    const map = fakeMap([element]);
    syncRouteIconPriority(map, 'planned-route', routeData);
    assert.equal(map.queryCount, 1);

    const beforeMaskWrite = 'transform: translate3d(20px, 50px, 0)';
    observerCallback([{ type: 'attributes', attributeName: 'style', target: element, oldValue: beforeMaskWrite }]);
    assert.equal(map.queryCount, 1, 'our mask-only style write is ignored');

    const beforeMove = element.getAttribute('style');
    element.style.setProperty('transform', 'translate3d(80px, 50px, 0)');
    rect.left = 80; rect.right = 110;
    observerCallback([{ type: 'attributes', attributeName: 'style', target: element, oldValue: beforeMove }]);
    assert.equal(map.queryCount, 2, 'an external marker transform change recomputes the mask');
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test('child-target mask writes are ignored by the observer but child transforms resync', () => {
  const previous = globalThis.MutationObserver;
  let observerCallback;
  globalThis.MutationObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const childRect = { left: 30, top: 30, right: 60, bottom: 70, width: 30, height: 40 };
    const root = marker({ left: 45, top: 50, right: 46, bottom: 51, width: 1, height: 1 }, [
      { rect: childRect, styles: { transform: 'translate(0px, 0px)' } },
    ]);
    const child = root.children[0];
    const map = fakeMap([root]);
    syncRouteIconPriority(map, 'planned-route', routeData);
    assert.equal(map.queryCount, 1);

    observerCallback([{ type: 'attributes', attributeName: 'style', target: child, oldValue: 'transform: translate(0px, 0px)' }]);
    assert.equal(map.queryCount, 1, 'child mask-only style writes are ignored');

    const beforeMove = child.getAttribute('style');
    child.style.setProperty('transform', 'translate(8px, 0px)');
    childRect.left = 38; childRect.right = 68;
    observerCallback([{ type: 'attributes', attributeName: 'style', target: child, oldValue: beforeMove }]);
    assert.equal(map.queryCount, 2, 'an external direct-child transform change recomputes the mask');
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test('non-route sources and invisible route layers do not mask markers', () => {
  const element = marker({ left: 20, top: 30, right: 50, bottom: 70, width: 30, height: 40 });
  const map = fakeMap([element], { visible: false });
  syncRouteIconPriority(map, 'manual-track-notes', routeData);
  syncRouteIconPriority(map, 'planned-route', routeData);
  assert.equal(element.style.getPropertyValue('mask-image'), '');
  assert.deepEqual(map.layoutQueries, [], 'missing layers are filtered before querying layout');
});
