import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { alternativeLineParts } from '../modules/tracks/alternatives.ts';
import { coloredLineParts } from '../modules/tracks/edgeColors.ts';

const bundle = await build({ entryPoints: ['modules/tracks/trackFeatures.ts'], bundle: true,
  platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { savedTrackRenderItem, trackLineFeatures } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('single-segment route shortcut preserves route selection and every explicit edge color', () => {
  const coordinates = [[104, 30], [104.001, 30], [104.002, 30], [104.003, 30]];
  const track = { id: 'single', name: 'single', createdAt: 1, segments: [coordinates], nodes: [],
    style: { color: '#ffb477', width: 2, opacity: 0.75 },
    edgeColors: [['#ff0000', '#0000ff', '#0000ff']] };
  const state = { saved: [track], draft: [], visible: true, style: track.style, nodes: [],
    selectedId: 'single', alternativeId: 'missing-alternative', editing: false };
  const features = trackLineFeatures(savedTrackRenderItem(track), state);
  assert.equal(features.length, 2, 'adjacent equal-color edges stay grouped and color boundaries remain split');
  assert.deepEqual(features.map(feature => feature.properties.color), ['#ff0000', '#0000ff']);
  assert.deepEqual(features.map(feature => feature.geometry.coordinates[0]), [coordinates.slice(0, 2), coordinates.slice(1)]);
  assert.ok(features.every(feature => feature.properties.selected));
  assert.ok(features.every(feature => feature.properties.opacity === 0.75));

  const plain = { ...track, edgeColors: undefined };
  const plainFeatures = trackLineFeatures(savedTrackRenderItem(plain), { ...state, saved: [plain], style: plain.style });
  assert.equal(plainFeatures.length, 1, 'a single route without explicit edge colors remains one complete line');
  assert.deepEqual(plainFeatures[0].geometry.coordinates, [coordinates]);
  assert.equal(plainFeatures[0].properties.color, '#ffb477');
});

test('single-segment shortcut matches alternatives for closed and repeated edges with unknown selection', () => {
  const coordinates = [[104, 30], [104.001, 30], [104.001, 30], [104.002, 30], [104, 30]];
  const track = { id: 'closed', name: 'closed', createdAt: 1, segments: [coordinates], nodes: [],
    style: { color: '#aabbcc', width: 3, opacity: 0.4 } };
  const state = { saved: [track], draft: [], visible: true, style: track.style, nodes: [],
    selectedId: 'closed', alternativeId: 'missing', editing: false };
  const actual = trackLineFeatures(savedTrackRenderItem(track), state);
  const oldBehavior = alternativeLineParts(track.segments, 'missing', track.style.color)
    .flatMap(part => coloredLineParts(part.coordinates, new Map(), part.color ?? track.style.color)
      .map(piece => ({ ...part, ...piece })));
  assert.deepEqual(actual.map(feature => feature.geometry.coordinates[0]), oldBehavior.map(part => part.coordinates));
  assert.deepEqual(actual.map(feature => feature.properties.color), oldBehavior.map(part => part.color ?? track.style.color));
  assert.deepEqual(actual.map(feature => feature.properties.opacity), oldBehavior.map(part => track.style.opacity * (part.muted ? 0.3 : 1)));
  assert.ok(actual.every(feature => feature.properties.selected));
});
