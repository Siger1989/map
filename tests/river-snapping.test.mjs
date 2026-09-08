import test from 'node:test';
import assert from 'node:assert/strict';
import { riverLines, riverHint } from '../modules/tracks/riverSnapping.ts';
import { nearestRoad, roadLines } from '../modules/tracks/roadSnapping.ts';
import { roadPath } from '../modules/tracks/roadPath.ts';
import { DrawingSession } from '../modules/tracks/DrawingSession.ts';
const points = [
  [1, 1],
  [2, 1],
  [2, 2],
  [3, 2],
];
const feature = (cls, type = 'LineString') => ({
  properties: { class: cls, name: '验证河流' },
  geometry: { type, coordinates: points },
});
const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
test('river network accepts waterways only, preserves bends and does not pollute road selection', () => {
  const features = ['river', 'primary', 'stream', 'rail', 'canal', 'lake'].map(
    (c) => feature(c),
  );
  features.push(feature('river', 'Polygon'));
  const rivers = riverLines(features);
  assert.equal(rivers.length, 1); // same tile geometry is deduplicated
  assert.ok(rivers[0].id.startsWith('waterway:'));
  assert.equal(roadLines(features).length, 1);
  const start = nearestRoad(project(points[0]), rivers, project),
    end = nearestRoad(project(points.at(-1)), rivers, project);
  assert.deepEqual(roadPath(start, end, rivers), points.slice(1));
  assert.match(riverHint('已吸附道路 · 验证河流'), /^已吸附河流/);
});
test('strict river selection never creates an unbound start or bridges a disconnected channel', () => {
  const line = riverLines([feature('river')])[0],
    target = nearestRoad(project(points.at(-1)), [line], project);
  const options = {
    mode: 'points',
    anchor: null,
    lastVertex: points[0],
    width: 800,
    height: 800,
    length: 48,
    candidates: [],
    snapping: false,
    roadSnapping: true,
    strictNetwork: true,
    project,
    unproject: (p) => [p.x / 100, p.y / 100],
    snapRoad: () => ({
      status: 'ready',
      match: target,
      section: points.slice(1),
    }),
  };
  const session = new DrawingSession();
  session.input({ type: 'start', point: { x: 250, y: 244 } }, options);
  assert.deepEqual(
    session.input({ type: 'end', reason: 'release' }, options).section,
    points.slice(1),
  );
  for (const patch of [
    { snapRoad: () => ({ status: 'ready', match: target, section: null }) },
    { lastVertex: null, snapRoad: () => ({ status: 'loading', match: null }) },
  ]) {
    const blocked = { ...options, ...patch };
    const preview = session.input(
      { type: 'start', point: { x: 250, y: 244 } },
      blocked,
    );
    assert.equal(preview.preview.blocked, true);
    assert.equal(preview.preview.crossing, false);
    assert.equal(
      session.input({ type: 'end', reason: 'release' }, blocked).vertex,
      undefined,
    );
  }
});
