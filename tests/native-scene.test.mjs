import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['modules/map/native/scene.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { createNativeSceneGeometry } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function props(trackOverlay) {
  return { trackOverlay, guidanceOverlay: null, navigationCues: null };
}
const style = { color: '#00ff00', width: 2, opacity: 0.5, pointSize: 8 };
function state(saved = []) { return { saved, draft: [], visible: true, style, nodes: [], selectedId: 'one', editing: true }; }

test('native scene retains original edge colors, notes, selected nodes and immutable source geometry', () => {
  const track = { id: 'one', name: 'line', createdAt: 0, style,
    segments: [[[0, 0], [0.001, 0], [0.002, 0]]], nodes: [[0, 0], [0.001, 0], [0.002, 0]],
    edgeColors: [['#ff0000', '#0000ff']], edgeNotes: [['first', 'second']],
    pointDetails: { '0.001,0': { note: 'junction' } } };
  const overlay = state([track]);
  const before = JSON.stringify(overlay);
  const result = createNativeSceneGeometry(props(overlay)).tracks.features;
  assert.deepEqual(result.filter(f => f.properties.role === 'track').map(f => f.properties.color), ['#ff0000', '#0000ff']);
  assert.equal(result.filter(f => f.properties.role === 'trackNode').length, 3);
  assert.deepEqual(new Set(result.filter(f => f.properties.role === 'note').map(f => f.properties.label)), new Set(['first', 'second', 'junction']));
  assert.ok(result.find(f => f.properties.nativePick?.kind === 'trackNode' && f.properties.nativePick.trackId === 'one'));
  assert.equal(JSON.stringify(overlay), before);
});

test('hidden tracks stay hidden and drag preview updates only the displayed geometry', () => {
  const track = { id: 'one', name: 'line', createdAt: 0, style, segments: [[[0, 0], [0.001, 0]]], nodes: [[0, 0], [0.001, 0]] };
  const overlay = { ...state([track, { ...track, id: 'hidden', hidden: true }]), preview: { node: { trackId: 'one', coordinate: [0, 0] }, coordinate: [0.0001, 0.0002] } };
  const geometry = createNativeSceneGeometry(props(overlay));
  assert.ok(geometry.tracks.features.every(f => f.properties.nativePick?.trackId !== 'hidden'));
  assert.deepEqual(geometry.tracks.features.find(f => f.properties.role === 'track').geometry.coordinates[0][0], [0.0001, 0.0002]);
  assert.deepEqual(track.segments[0][0], [0, 0]);
  assert.equal(createNativeSceneGeometry(props({ ...overlay, visible: false })).tracks.features.length, 0);
});
