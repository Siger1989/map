import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { build } from 'esbuild';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  roadLines,
  nearestRoad,
  roadSection,
} from '../modules/tracks/roadSnapping.ts';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
import {
  newAnnotation,
  parseAnnotations,
  validAnnotation,
  volume,
  dimensions,
  altitudeRange,
  verticalHalfExtent,
} from '../modules/annotations/data.ts';
import {
  basemapConfiguration,
  tiandituTiles,
} from '../modules/cartography/basemaps.ts';
const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
const line = {
  id: 'trail',
  name: '山间小路',
  coordinates: [
    [1.08, 1],
    [1.08, 5],
  ],
};
const close = (a, b, epsilon = 0.01) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);

test('road candidates accept paths and service roads, reject rivers, rail and malformed geometry', () => {
  const features = ['path', 'service', 'rail', 'waterway'].map(
    (kind, index) => ({
      properties: { class: kind },
      geometry: {
        type: 'LineString',
        coordinates: [
          [index, 1],
          [index, 2],
        ],
      },
    }),
  );
  features.push(features[0], {
    properties: { class: 'path' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [1, NaN],
        [2, 3],
      ],
    },
  });
  assert.equal(roadLines(features).length, 2);
});
test('road snap attaches to segment interiors and releases after the tolerance', () => {
  const match = nearestRoad({ x: 100, y: 240 }, [line], project);
  assert.ok(match);
  close(match.coordinate[0], 1.08);
  close(match.screen.y, 240, 0.1);
  assert.equal(nearestRoad({ x: 80, y: 240 }, [line], project, match), null);
  assert.equal(nearestRoad({ x: 88, y: 240 }, [line], project), null);
  assert.ok(nearestRoad({ x: 88, y: 240 }, [line], project, match));
});
test('road bends are retained in both directions, without connecting different roads', () => {
  const curved = {
    id: 'bend',
    name: '',
    coordinates: [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
    ],
  };
  const a = nearestRoad({ x: 150, y: 100 }, [curved], project),
    b = nearestRoad({ x: 250, y: 200 }, [curved], project);
  assert.deepEqual(roadSection(a, b, project).slice(0, -1), [
    [2, 1],
    [2, 2],
  ]);
  assert.deepEqual(roadSection(b, a, project).slice(0, -1), [
    [2, 2],
    [2, 1],
  ]);
  assert.equal(roadSection(a, { ...b, line }, project), null);
});
test('hairpins do not cause a large automatic jump between nearby arms', () => {
  const hairpin = {
    id: 'hairpin',
    name: '',
    coordinates: [
      [1, 1],
      [1, 7],
      [1.1, 7],
      [1.1, 1],
    ],
  };
  const a = nearestRoad({ x: 100, y: 110 }, [hairpin], project),
    b = nearestRoad({ x: 110, y: 110 }, [hairpin], project);
  assert.equal(roadSection(a, b, project), null);
});
test('freehand commits road-snapped coordinates throughout the stroke and can leave the road', () => {
  const session = new DrawingSession();
  const options = {
    mode: 'freehand',
    anchor: [1.08, 2],
    length: 48,
    width: 800,
    height: 800,
    candidates: [],
    snapping: false,
    roadSnapping: true,
    project,
    unproject: ({ x, y }) => [x / 100, y / 100],
    snapRoad: (point, previous) => ({
      status: 'ready',
      match: nearestRoad(point, [line], project, previous),
    }),
  };
  session.input({ type: 'start', point: { x: 108, y: 248 } }, options);
  assert.equal(
    session.input({ type: 'move', point: { x: 115, y: 310 } }, options).preview
      .snapped,
    true,
  );
  session.input({ type: 'move', point: { x: 118, y: 350 } }, options);
  const stroke = session.input(
    { type: 'end', reason: 'navigation' },
    options,
  ).stroke;
  assert.ok(stroke.length >= 3);
  stroke.forEach((p) => close(p[0], 1.08));
  const next = { ...options, anchor: stroke.at(-1) },
    tip = project(next.anchor);
  session.input({ type: 'start', point: { x: tip.x, y: tip.y + 48 } }, next);
  const left = session.input(
    { type: 'move', point: { x: tip.x + 150, y: tip.y + 90 } },
    next,
  );
  assert.equal(left.preview.snapped, false);
  assert.ok(
    session.input({ type: 'end', reason: 'release' }, next).stroke.at(-1)[0] >
      1.3,
  );
});
test('road snapping off makes no road queries; missing roads stay freehand', () => {
  const session = new DrawingSession();
  const options = {
    mode: 'points',
    anchor: null,
    length: 48,
    width: 800,
    height: 800,
    candidates: [],
    snapping: false,
    roadSnapping: false,
    project,
    unproject: ({ x, y }) => [x / 100, y / 100],
    snapRoad: () => {
      throw new Error('unexpected query');
    },
  };
  session.input({ type: 'start', point: { x: 100, y: 244 } }, options);
  assert.deepEqual(
    session.input({ type: 'end', reason: 'release' }, options).vertex,
    [1, 2],
  );
  const result = session.input(
    { type: 'start', point: { x: 100, y: 244 } },
    {
      ...options,
      roadSnapping: true,
      snapRoad: () => ({ status: 'loading', match: null }),
    },
  );
  assert.equal(result.preview.snapped, false);
  assert.match(result.hint, /加载/);
});
test('map adapter matches loaded road vectors while other tiles are still loading', async () => {
  const built = await build({
    stdin: {
      contents: "export { snapMapRoad } from './modules/map/roadSnap.ts';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { snapMapRoad } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  let queries = 0;
  const map = {
    getZoom: () => 15,
    getSource: () => ({}),
    getLayer: () => ({}),
    isSourceLoaded: () => false,
    project,
    queryRenderedFeatures: () => {
      queries++;
      return [
        {
          properties: { class: 'path', name: '山路' },
          geometry: { type: 'LineString', coordinates: line.coordinates },
        },
      ];
    },
  };
  const result = snapMapRoad(map, { x: 108, y: 220 }, null, true);
  assert.equal(result.status, 'ready');
  assert.ok(result.match);
  assert.equal(queries, 1);
  assert.equal(
    snapMapRoad(map, { x: 108, y: 220 }, null, false).status,
    'hidden',
  );
  assert.equal(queries, 1);
  assert.equal(
    snapMapRoad({ ...map, getZoom: () => 10 }, { x: 108, y: 220 }, null, true)
      .status,
    'zoom',
  );
});
test('model dimensions and volumes keep absolute metres across primitives', () => {
  const base = {
    ...newAnnotation('box', [104, 30], 500, 'test'),
    width: 4,
    length: 8,
    height: 6,
  };
  assert.equal(volume(base), 192);
  close(volume({ ...base, kind: 'cylinder' }), Math.PI * 4 * 6, 1e-10);
  close(volume({ ...base, kind: 'sphere' }), (Math.PI * 64) / 6, 1e-10);
  assert.deepEqual(dimensions({ ...base, kind: 'sphere' }), [4, 4, 4]);
  assert.deepEqual(dimensions({ ...base, kind: 'cylinder' }), [4, 4, 6]);
});
test('rotated underground models remain below the requested top depth', () => {
  const item = {
    ...newAnnotation('box', [104, 30], 500, 'test'),
    placement: 'underground',
    width: 4,
    length: 8,
    height: 6,
    pitch: 37,
    roll: 22,
    heading: 128,
    offset: 12,
  };
  const range = altitudeRange(item);
  close(range.top, 488, 1e-10);
  const rotation = new THREE.Euler(
    (item.pitch * Math.PI) / 180,
    (item.roll * Math.PI) / 180,
    (-item.heading * Math.PI) / 180,
    'ZYX',
  );
  const z = [];
  for (const x of [-2, 2])
    for (const y of [-4, 4])
      for (const z0 of [-3, 3])
        z.push(new THREE.Vector3(x, y, z0).applyEuler(rotation).z);
  close(Math.max(...z), verticalHalfExtent(item), 1e-10);
  close(range.center + Math.max(...z), 488, 1e-10);
  close(altitudeRange({ ...item, placement: 'surface' }).bottom, 512, 1e-10);
});
test('horizontal cylinders use radius for burial clearance and missing terrain is not zero', () => {
  const item = {
    ...newAnnotation('cylinder', [104, 30], 500, 'test'),
    width: 6,
    height: 20,
    pitch: 90,
    offset: 4,
    placement: 'underground',
  };
  close(verticalHalfExtent(item), 3, 1e-10);
  close(altitudeRange(item).bottom, 490, 1e-10);
  assert.equal(altitudeRange({ ...item, groundElevation: null }), null);
});
test('annotation storage roundtrips parameters and rejects invalid or duplicate records', () => {
  const item = newAnnotation('box', [104, 30], 500, 'test');
  assert.deepEqual(parseAnnotations(JSON.stringify([item])), [item]);
  for (const patch of [
    { width: -1 },
    { height: Infinity },
    { offset: -1 },
    { color: 'url(javascript:)' },
    { coordinates: [0, 90] },
    { kind: '__proto__' },
  ])
    assert.equal(validAnnotation({ ...item, ...patch }), false);
  assert.throws(() => parseAnnotations(JSON.stringify([item, item])));
  assert.throws(() => parseAnnotations('{invalid json'));
});
test('Tianditu config is opt-in and WMTS coordinates use the documented Mercator row/column order', () => {
  assert.equal(basemapConfiguration('').domestic, false);
  assert.equal(basemapConfiguration('bad key').domestic, false);
  const token = 'test-key'.replace('-', '').repeat(4);
  assert.equal(basemapConfiguration(token).domestic, true);
  const urls = tiandituTiles('img', token);
  assert.equal(urls.length, 4);
  assert.ok(
    urls.every(
      (url) =>
        url.includes('/img_w/wmts?') &&
        url.includes('TILEROW={y}') &&
        url.includes('TILECOL={x}') &&
        url.includes('TILEMATRIXSET=w'),
    ),
  );
});
test('domestic map style has native WMTS imagery and labels with no overseas imagery/font request', async () => {
  const result = await build({
    stdin: {
      contents: `export { baseStyle } from './modules/terrain/terrain.ts';`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    define: {
      'process.env.NEXT_PUBLIC_TIANDITU_KEY': JSON.stringify(
        'testingkey'.repeat(4),
      ),
    },
  });
  const { baseStyle } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(result.outputFiles[0].text).toString('base64')
  );
  const previous = globalThis.window;
  globalThis.window = { location: { origin: 'http://localhost:3000' } };
  try {
    const style = baseStyle();
    assert.deepEqual(validateStyleMin(style), []);
    assert.ok(style.sources['domestic-labels-image']);
    assert.ok(
      style.sources.detail.tiles.every((url) =>
        new URL(url).hostname.endsWith('.tianditu.gov.cn'),
      ),
    );
    assert.ok(style.glyphs.startsWith('http://localhost:3000/fonts/'));
    assert.equal(style.sources.elevation.encoding, 'terrarium');
  } finally {
    globalThis.window = previous;
  }
});
