import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/native/overlayStyle.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { trackOutlineFeature } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const sceneBundle = await build({ entryPoints: ['modules/map/native/scene.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { createNativeSceneGeometry } = await import(`data:text/javascript;base64,${Buffer.from(sceneBundle.outputFiles[0].text).toString('base64')}`);

test('native track halo mirrors the React outline paint without changing line geometry', () => {
  const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
    properties: { width: 2.5, opacity: 0.4, selected: true, color: '#fa0', role: 'track' } };
  const halo = trackOutlineFeature(line);
  assert.equal(halo.properties.role, 'trackHalo');
  assert.equal(halo.properties.color, '#ffffff');
  assert.equal(halo.properties.width, 4.5);
  assert.equal(halo.properties.opacity, 0.26);
  assert.deepEqual(halo.geometry, line.geometry);
  assert.equal(line.properties.role, 'track');
});

test('unselected track halo uses original dark outline and width plus one', () => {
  const halo = trackOutlineFeature({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [] },
    properties: { width: 1.5, opacity: 1, selected: false } });
  assert.equal(halo.properties.color, '#10212b');
  assert.equal(halo.properties.width, 2.5);
  assert.equal(halo.properties.opacity, 0.65);
});

test('native scene emits halo and colored line with identical geometry for selected tracks', () => {
  const style = { color: '#39aadd', width: 2, opacity: 0.5 };
  const track = { id: 'selected', name: 'line', createdAt: 0, style,
    segments: [[[1, 2], [3, 4]]], nodes: [] };
  const scene = createNativeSceneGeometry({
    trackOverlay: { saved: [track], draft: [], visible: true, style, nodes: [], selectedId: 'selected', editing: false },
    guidanceOverlay: null, navigationCues: null, routeOverlay: null, position: null, positionNavigating: false,
  });
  const halo = scene.tracks.features.find(f => f.properties.role === 'trackHalo');
  const line = scene.tracks.features.find(f => f.properties.role === 'track');
  assert.equal(halo.properties.color, '#ffffff');
  assert.equal(halo.properties.width, 4);
  assert.equal(halo.properties.opacity, 0.325);
  assert.equal(line.properties.color, '#39aadd');
  assert.equal(line.properties.opacity, 0.5);
  assert.deepEqual(halo.geometry, line.geometry);
});
