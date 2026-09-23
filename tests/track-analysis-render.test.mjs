import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { metricLineParts } from '../modules/routeAnalysis/metrics.ts';
import { terrainProfileTrack } from '../modules/routeAnalysis/terrainProfileTrack.ts';
import { trackHeights } from '../modules/routeAnalysis/trackElevation.ts';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style.ts';

// Bundle the actual layer for Node (its MapLibre constructor uses TS parameter properties).
const result = await build({
  entryPoints: ['modules/tracks/TrackLayer.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { TrackLayer } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(result.outputFiles[0].text).toString('base64')
);

test('DEM colours reach the real map source in edit mode; hit targets remain original vertices', () => {
  const sources = new Map(),
    layers = new Map();
  const map = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    addSource(id, spec) {
      sources.set(id, {
        ...spec,
        setData(data) {
          this.data = data;
        },
      });
    },
    addLayer(spec) {
      layers.set(spec.id, spec);
    },
    getStyle: () => ({ layers: [...layers.values()] }),
    moveLayer() {},
    project: ([x, y]) => ({ x: x * 100000, y: y * 100000 }),
    queryRenderedFeatures: (_, { layers }) =>
      layers.includes('manual-track-line')
        ? [{ properties: { trackId: 'a' } }]
        : [],
  };
  const track = {
    id: 'a',
    name: 'a',
    createdAt: 0,
    segments: [
      [
        [0, 0],
        [0.004, 0],
      ],
    ],
    style: { ...DEFAULT_TRACK_STYLE, colorMode: 'slope' },
  };
  const before = structuredClone(track),
    distance = trackHeights(track)[1].distance;
  const profile = terrainProfileTrack(
    track,
    [500, 501, 520, 560, 500].map((elevation, i) => ({
      coordinates: [0.001 * i, 0],
      distance: (distance * i) / 4,
      part: 0,
      elevation,
    })),
  );
  const state = {
    saved: [track],
    draft: [],
    visible: true,
    style: DEFAULT_TRACK_STYLE,
    nodes: [],
    selectedId: 'a',
    nodeSelection: { trackId: 'a', points: track.segments[0] },
    editing: true,
    analysisParts: { trackId: 'a', parts: metricLineParts(profile, 'slope') },
  };
  const layer = new TrackLayer(map);
  layer.sync(state);
  const data = sources.get('manual-tracks').data;
  const selectedEdges = sources.get('manual-track-selection-edge').data;
  assert.equal(layers.get('manual-track-selection-edge').type, 'line', 'selection uses terrain-draped map lines');
  assert.deepEqual(selectedEdges.features[0].geometry.coordinates, track.segments, 'selection retains geographic geometry, not projected endpoint chords');
  assert.equal(
    new Set(
      data.features
        .filter((f) => f.geometry.type === 'MultiLineString')
        .map((f) => f.properties.color),
    ).size,
    3,
  );
  const nodes = data.features.filter((f) => f.geometry.type === 'Point');
  assert.deepEqual(
    nodes.map((f) => f.geometry.coordinates),
    track.segments[0],
  );
  assert.ok(
    Math.abs(layer.pickLine({ x: 200, y: 0 }).distance - distance / 2) < 0.01,
  );
  assert.deepEqual(track, before);
  const destination = [0.005, 0.001];
  layer.sync({
    ...state,
    preview: {
      node: { trackId: 'a', coordinate: [0.004, 0] },
      coordinate: destination,
    },
  });
  const preview = sources
    .get('manual-tracks')
    .data.features.filter((f) => f.geometry.type === 'MultiLineString');
  assert.ok(
    preview.some((f) =>
      f.geometry.coordinates.some((line) =>
        line.some((c) => c[0] === destination[0] && c[1] === destination[1]),
      ),
    ),
  );
  assert.deepEqual(track, before);
  assert.deepEqual(sources.get('manual-track-selection-edge').data.features[0].geometry.coordinates, [[[0,0],destination]]);
  layer.sync({ ...state, nodeSelection: { trackId: 'a', points: [track.segments[0][0]] } });
  assert.equal(sources.get('manual-track-selection-edge').data.features.length, 0, 'one selected endpoint never highlights an unselected edge');
  layer.sync({ ...state, editing: false });
  assert.equal(sources.get('manual-track-selection-edge').data.features.length, 0, 'leaving edit mode clears highlighting');
});
