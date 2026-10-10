import test from 'node:test';
import assert from 'node:assert/strict';
import { syncRouteIconPriority } from '../modules/map/routeIconPriority.ts';

function marker(rect, childRects = [], initialMask = '', initialStyles = {}) {
  const makeStyle = (styles = {}, mask = '') => {
    const values = new Map([...Object.entries(styles), ...(mask ? [['mask-image', mask]] : [])]);
    const priorities = new Map();
    return {
      getPropertyValue: (name) => values.get(name) ?? '',
      getPropertyPriority: (name) => priorities.get(name) ?? '',
      setProperty: (name, value, priority = '') => { values.set(name, value); priorities.set(name, priority); },
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
    fire: (name) => { for (const fn of handlers.get(name) ?? []) fn(); },
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
