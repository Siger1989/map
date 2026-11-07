import test from 'node:test';
import assert from 'node:assert/strict';
import { cachePackagePreview } from '../modules/outdoor/cachePackagePreview.ts';

const trip = overrides => ({
  id: 'preview', name: '沿线缓存', bounds: [103, 30, 104, 31], urls: ['tile-a', 'tile-b', 'tile-c'],
  done: 1, bytes: 12, createdAt: 1, complete: false, provider: 'imported', bufferKm: 4,
  routeSegments: [[[103.1, 30.1], [103.5, 30.6]], [[103.7, 30.7], [103.9, 30.8]]],
  ...overrides,
});

test('cache preview exposes the actual route and labels bounds as a planning range', () => {
  const preview = cachePackagePreview(trip({ manifest: true, urlCount: 25, urls: [] }));
  assert.equal(preview.routeGeometry, 'available');
  assert.equal(preview.rangeKind, 'planning-bounds');
  assert.deepEqual(preview.plannedBounds, [103, 30, 104, 31]);
  assert.equal(preview.bufferKm, 4);
  assert.deepEqual(preview.progress, { done: 1, total: 25, state: 'partial' });
  assert.deepEqual(preview.geojson.features[0], {
    type: 'Feature', properties: { role: 'route', segmentIndex: 0 },
    geometry: { type: 'LineString', coordinates: [[103.1, 30.1], [103.5, 30.6]] },
  });
  const range = preview.geojson.features.find(feature => feature.properties.role === 'planning-range');
  assert.equal(range.properties.label, '规划范围（不代表实际已缓存覆盖）');
  assert.equal(range.geometry.type, 'Polygon');
});

test('legacy package without route geometry is explicitly marked missing and gets no fabricated line', () => {
  const preview = cachePackagePreview(trip({ routeSegments: undefined, done: 0 }));
  assert.equal(preview.routeGeometry, 'missing');
  assert.equal(preview.geojson.features.some(feature => feature.properties.role === 'route'), false);
  assert.equal(preview.progress.state, 'not-started');
});

test('invalid geometry is excluded rather than partially rendered as a different route', () => {
  const preview = cachePackagePreview(trip({ routeSegments: [[[103, 30], [181, 31]]] }));
  assert.equal(preview.routeGeometry, 'invalid');
  assert.equal(preview.geojson.features.some(feature => feature.properties.role === 'route'), false);
});

test('package complete flag alone does not claim full cache when counts disagree', () => {
  const preview = cachePackagePreview(trip({ done: 2, complete: true }));
  assert.equal(preview.progress.state, 'partial');
});

test('polygon cache preview exposes the saved area boundary separately from its planning bounds', () => {
  const boundary = [[103.1, 30.1], [103.4, 30.1], [103.3, 30.4]];
  const preview = cachePackagePreview(trip({ routeSegments: undefined, areaBoundary: boundary }));
  assert.equal(preview.areaGeometry, 'available');
  assert.deepEqual(preview.areaBoundary, [...boundary, boundary[0]]);
  const area = preview.geojson.features.find(feature => feature.properties.role === 'area-range');
  assert.deepEqual(area.geometry.coordinates, [[...boundary, boundary[0]]]);
  assert.ok(preview.geojson.features.some(feature => feature.properties.role === 'planning-range'));
  assert.equal(preview.routeGeometry, 'missing');
});
