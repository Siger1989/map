import test from 'node:test';
import assert from 'node:assert/strict';
import { cadReferenceFeatureCollections } from '../modules/cad/CadLayer.ts';
import { syncPlaceLabelLayerOrder } from '../modules/map/overlayData.ts';

const document = (id, visible = true) => ({
  id,
  name: `CAD ${id}`,
  format: 'dxf',
  sourceBase64: '',
  sourceCrs: { id: 'EPSG:4326', name: 'WGS 84' },
  features: [],
  mapFeatures: [
    { id: 'p1', layer: 'points', entityType: 'POINT', geometry: { type: 'Point', coordinates: [104, 30] }, color: '#ff0000', text: '控制点' },
    { id: 'l1', layer: 'lines', entityType: 'LINE', geometry: { type: 'LineString', coordinates: [[104, 30], [104.1, 30.1]] }, color: '#00ff00' },
    { id: 'a1', layer: 'areas', entityType: 'POLYGON', geometry: { type: 'Polygon', coordinates: [[[104, 30], [104.1, 30], [104.1, 30.1], [104, 30]]] }, color: '#0000ff', text: '范围' },
  ],
  layers: [], warnings: [], visible, createdAt: 1, axisOrder: 'xy', unitScale: 1,
});

test('visible CAD map features and labels use stable document-feature IDs and source colors', () => {
  const input = [document('doc-a'), document('doc-b', false)];
  const first = cadReferenceFeatureCollections(input);
  const second = cadReferenceFeatureCollections(input);
  assert.deepEqual(first.features.features.map((feature) => feature.id), ['doc-a:p1', 'doc-a:l1', 'doc-a:a1']);
  assert.deepEqual(second.features.features.map((feature) => feature.id), first.features.features.map((feature) => feature.id));
  assert.equal(first.features.features[1].properties.cadColor, '#00ff00');
  assert.deepEqual(first.labels.features.map((feature) => feature.id), ['doc-a:p1:label', 'doc-a:a1:label']);
  assert.deepEqual(first.labels.features[0].geometry.coordinates, [104, 30]);
  assert.equal(first.labels.features[1].properties.cadText, '范围');
});

test('CAD points and lines stay below basemap place labels while CAD text stays visible above', () => {
  const layers = ['basemap', 'city-names', 'cad-fill', 'cad-outline', 'cad-line', 'cad-point', 'cad-labels'].map((id) => ({ id, layout: {} }));
  const map = {
    getStyle: () => ({ layers }),
    moveLayer: (id, beforeId) => {
      const item = layers.splice(layers.findIndex((layer) => layer.id === id), 1)[0];
      const position = beforeId ? layers.findIndex((layer) => layer.id === beforeId) : layers.length;
      layers.splice(position, 0, item);
    },
  };
  syncPlaceLabelLayerOrder(map);
  const ids = layers.map((layer) => layer.id);
  assert.ok(ids.indexOf('cad-point') < ids.indexOf('city-names'));
  assert.ok(ids.indexOf('cad-line') < ids.indexOf('city-names'));
  assert.ok(ids.indexOf('cad-labels') > ids.indexOf('city-names'));
});
