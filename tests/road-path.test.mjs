import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { roadLines, nearestRoad, roadHint, roadSnapResult } from '../modules/tracks/roadSnapping.ts';
import { roadPath, roadPathDetailed } from '../modules/tracks/roadPath.ts';
import { DrawingSession, blockedSnapHint } from '../modules/tracks/DrawingSession.ts';
import {
  appendVertex,
  appendRoadVertex,
  undoDraft,
  draftVertices,
  EMPTY_DRAFT,
} from '../modules/tracks/draft.ts';
import { joinSegments, hasLoosePoints } from '../modules/tracks/snapping.ts';
import { parseSavedTracks } from '../modules/tracks/drawing.ts';

const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
const line = (id, coordinates, level = 0) => ({
  id,
  name: '',
  coordinates,
  level,
});
const match = (line, index, fraction) => {
  const a = line.coordinates[index],
    b = line.coordinates[index + 1];
  const m = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
  const coordinate = [
    a[0] + fraction * (b[0] - a[0]),
    (Math.atan(Math.sinh(m(a[1]) + fraction * (m(b[1]) - m(a[1])))) * 180) /
      Math.PI,
  ];
  return { line, index, fraction, coordinate, screen: project(coordinate) };
};
const bend = line('bend', [
  [1, 1],
  [2, 1],
  [2, 2],
  [3, 2],
]);

test('reported mountain road connects across bridges and tile seams at zoom 13 and 14', () => {
  const fixture = JSON.parse(
    fs.readFileSync(new URL('./fixtures/road-corridor.json', import.meta.url)),
  );
  const project = ([lng, lat]) => ({
    x: ((lng * Math.PI) / 180) * 6378137,
    y: Math.asinh(Math.tan((lat * Math.PI) / 180)) * 6378137,
  });
  for (const sample of fixture.cases) {
    const roads = roadLines(sample.features);
    const start = nearestRoad(project(sample.start), roads, project);
    const end = nearestRoad(project(sample.end), roads, project);
    assert.ok(start && end);
    const route = roadPath(start, end, roads);
    assert.ok(
      route && route.length > 30,
      `zoom ${sample.zoom} follows the full curved corridor`,
    );
    assert.deepEqual(route.at(-1), end.coordinate);
    const bridge = roads.find(
      (r) => r.level === 1 && r.coordinates[0][0] > 103.01,
    );
    assert.ok(
      route.some(
        (p) =>
          p[0] === bridge.coordinates[0][0] &&
          p[1] === bridge.coordinates[0][1],
      ),
    );
  }
});

test('road path rejects inputs above its synchronous point budget', () => {
  const overBudget = line(
    'large',
    Array.from({ length: 3001 }, (_, i) => [1 + i * 0.00001, 1]),
  );
  const start = match(bend, 0, 0.2),
    end = match(bend, 1, 0.8);
  assert.equal(roadPath(start, end, [overBudget]), null);
  assert.equal(roadPathDetailed(start, end, [overBudget]).status, 'limited');
});

test('same source road follows its full curved polyline both ways when the global build is over budget', () => {
  const coordinates = Array.from({ length: 3105 }, (_, i) => [
    1 + i * 0.00001,
    1 + (i % 2 === 0 ? 0 : 0.00002),
  ]);
  const longRoad = line('long-source-road', coordinates);
  const unrelated = [
    line('unrelated-a', [[8, 8], [8.01, 8], [8.02, 8]]),
    line('unrelated-b', [[9, 9], [9.01, 9], [9.02, 9]]),
  ];
  const roads = [longRoad, ...unrelated];
  const start = match(longRoad, 100, 0.25),
    end = match(longRoad, 3000, 0.75);
  const forward = roadPathDetailed(start, end, roads);
  assert.equal(forward.status, 'ready');
  assert.equal(forward.section.length, 2901);
  assert.deepEqual(forward.section[0], coordinates[101]);
  assert.deepEqual(forward.section.at(-1), end.coordinate);
  assert.ok(forward.section.some((point, index) => index > 0 && point[1] !== forward.section[index - 1][1]));

  const reverse = roadPathDetailed(end, start, roads);
  assert.equal(reverse.status, 'ready');
  assert.equal(reverse.section.length, forward.section.length);
  assert.deepEqual(reverse.section[0], coordinates[3000]);
  assert.deepEqual(reverse.section.at(-1), start.coordinate);
});

test('same-segment and endpoint fallback removes duplicate vertices', () => {
  const route = line('limited-same-segment', [[1, 1], [2, 1], [2, 2]]);
  const sameSegment = roadPathDetailed(match(route, 0, 0.2), match(route, 0, 0.8), [route]);
  assert.equal(sameSegment.status, 'ready');
  assert.deepEqual(sameSegment.section, [match(route, 0, 0.8).coordinate]);
  const toVertex = roadPathDetailed(match(route, 0, 0), match(route, 0, 1), [route]);
  assert.equal(toVertex.status, 'ready');
  assert.deepEqual(toVertex.section, [[2, 1]]);
});

test('bounded global search reports limited separately from a real disconnected network', () => {
  const a = line('limited-a', [[1, 1], [1.001, 1]]),
    b = line('limited-b', [[2, 1], [2.001, 1]]),
    large = line('large-unrelated', Array.from({ length: 3001 }, (_, i) => [10 + i * 0.00001, 10]));
  assert.equal(roadPathDetailed(match(a, 0, 0), match(b, 0, 1), [a, b, large]).status, 'limited');
  assert.equal(roadPathDetailed(match(a, 0, 0), match(b, 0, 1), [a, b]).status, 'disconnected');
  assert.equal(roadPath(match(a, 0, 0), match(b, 0, 1), [a, b, large]), null);
});

test('road path stops endpoint seam work at its synchronous check budget', () => {
  const dense = Array.from({ length: 600 }, (_, i) =>
    line(`dense-${i}`, [[1, 1], [1.01, 1]]),
  );
  const start = match(dense[0], 0, 0.2),
    end = match(dense[0], 0, 0.8);
  assert.deepEqual(roadPath(start, end, dense), [end.coordinate]);
  const otherLineEnd = match(dense.at(-1), 0, 0.8);
  assert.equal(roadPathDetailed(start, otherLineEnd, dense).status, 'limited');
});

test('two selected points retain every bend, forwards and backwards', () => {
  const a = match(bend, 0, 0.5),
    b = match(bend, 2, 0.5);
  assert.deepEqual(roadPath(a, b, [bend]), [[2, 1], [2, 2], b.coordinate]);
  assert.deepEqual(roadPath(b, a, [bend]), [[2, 2], [2, 1], a.coordinate]);
  assert.deepEqual(roadPath(match(bend, 0, 0.2), a, [bend]), [a.coordinate]);
});
test('connected road features and clipped overlapping tile edges form a continuous route', () => {
  const a = line('a', [
      [0, 0],
      [2, 0],
    ]),
    b = line('b', [
      [1, 0],
      [3, 0],
    ]),
    c = line('c', [
      [3, 0],
      [3, 1],
    ]);
  const start = match(a, 0, 0.25),
    end = match(c, 0, 1);
  assert.deepEqual(roadPath(start, end, [a, b, c]), [
    [1, 0],
    [2, 0],
    [3, 0],
    end.coordinate,
  ]);
  const middleA = match(a, 0, 0.65),
    middleB = match(b, 0, 0.25);
  assert.deepEqual(roadPath(middleA, middleB, [a, b]), [middleB.coordinate]);
});
test('nearby road endpoints connect regardless of layer, while distant gaps remain disconnected', () => {
  const a = line('a', [
      [1, 1],
      [3, 1],
    ]),
    t = line('t', [
      [2, 1],
      [2, 2],
    ]);
  assert.ok(roadPath(match(a, 0, 0), match(t, 0, 1), [a, t]));
  const cross = line('cross', [
    [2, 0.5],
    [2, 2],
  ]);
  assert.equal(roadPath(match(a, 0, 0), match(cross, 0, 1), [a, cross]), null);
  const bridge = line('bridge', t.coordinates, 1);
  assert.ok(roadPath(match(a, 0, 0), match(bridge, 0, 1), [a, bridge]));
  const gap = line('gap', [
    [3.00001, 1],
    [4, 1],
  ]);
  assert.ok(roadPath(match(a, 0, 0), match(gap, 0, 1), [a, gap]));
  const far = line('far', [
    [3.0001, 1],
    [4, 1],
  ]);
  assert.equal(roadPath(match(a, 0, 0), match(far, 0, 1), [a, far]), null);
});
test('explicit point selection follows a hairpin instead of applying the freehand detour cutoff', () => {
  const h = line('hairpin', [
    [1, 1],
    [1, 7],
    [1.1, 7],
    [1.1, 1],
  ]);
  const a = match(h, 0, 0),
    b = match(h, 2, 1);
  assert.deepEqual(roadPath(a, b, [h]), [[1, 7], [1.1, 7], b.coordinate]);
});
test('draft commits one road leg, keeps only chosen edit handles and undoes the whole leg', () => {
  const a = match(bend, 0, 0.5),
    b = match(bend, 2, 0.5);
  const original = appendVertex(EMPTY_DRAFT, a.coordinate);
  const points = roadPath(a, b, [bend]);
  const next = appendRoadVertex(original, points);
  assert.deepEqual(next.segments.at(-1), [a.coordinate, ...points]);
  assert.deepEqual(draftVertices(next), [b.coordinate, a.coordinate]);
  assert.equal(hasLoosePoints(next.segments), false);
  const undo = undoDraft(next);
  assert.deepEqual(undo.segments, original.segments);
  assert.deepEqual(undo.nodes, original.nodes);
  const saved = {
    id: 'path',
    name: 'route',
    createdAt: 1,
    segments: joinSegments(next.segments),
    nodes: draftVertices(next),
  };
  assert.deepEqual(parseSavedTracks(JSON.stringify([saved]))[0].segments, [
    [a.coordinate, ...points],
  ]);
});
test('connected roads follow curves; disconnected roads cross explicitly and resume road snapping', () => {
  const a = match(bend, 0, 0.5),
    b = match(bend, 2, 0.5),
    section = roadPath(a, b, [bend]);
  const session = new DrawingSession();
  const options = {
    mode: 'points',
    anchor: null,
    lastVertex: a.coordinate,
    width: 800,
    height: 800,
    length: 48,
    candidates: [],
    snapping: false,
    roadSnapping: true,
    project,
    unproject: (p) => [p.x / 100, p.y / 100],
    snapRoad: () => ({ status: 'ready', match: b, section }),
  };
  const preview = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    options,
  );
  assert.match(preview.preview.path, /L 200 100 L 200 200/);
  assert.deepEqual(
    session.input({ type: 'end', reason: 'release' }, options).section,
    section,
  );
  const crossing = {
    ...options,
    snapRoad: () => ({ status: 'ready', match: b, section: null }),
  };
  const previewCrossing = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    crossing,
  );
  assert.equal(previewCrossing.preview.crossing, true);
  assert.equal(previewCrossing.preview.blocked, false);
  assert.match(previewCrossing.hint, /跨越断路/);
  const result = session.input({ type: 'end', reason: 'release' }, crossing);
  assert.deepEqual(result.section, [b.coordinate]);
  assert.deepEqual(result.vertex, b.coordinate);
  assert.match(result.hint, /已直线跨越/);
  const draft = appendVertex(EMPTY_DRAFT, a.coordinate);
  const crossed = appendRoadVertex(draft, result.section);
  assert.deepEqual(undoDraft(crossed).segments, draft.segments);
  const resumed = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    options,
  );
  assert.equal(resumed.preview.crossing, false);
  assert.deepEqual(
    session.input({ type: 'end', reason: 'release' }, options).section,
    section,
  );
  session.input({ type: 'start', point: { x: 250, y: 244 } }, crossing);
  assert.equal(session.input({ type: 'cancel' }, crossing).vertex, undefined);
  assert.equal(
    session.input({ type: 'end', reason: 'release' }, crossing).vertex,
    undefined,
  );
  const blocked = {
    ...options,
    snapRoad: () => ({ status: 'no-match', match: null }),
  };
  assert.equal(
    session.input({ type: 'start', point: { x: 250, y: 244 } }, blocked).preview
      .blocked,
    true,
  );
  assert.equal(
    session.input({ type: 'end', reason: 'release' }, blocked).vertex,
    undefined,
  );
  const missing = {
    ...options,
    snapRoad: () => ({ status: 'unavailable', match: null }),
  };
  const unavailablePreview = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    missing,
  );
  assert.equal(unavailablePreview.preview.blocked, true);
  assert.match(unavailablePreview.hint, /数据不可用/);
  assert.equal(
    session.input({ type: 'end', reason: 'release' }, missing).vertex,
    undefined,
  );
  const loading = { ...options, snapRoad: () => ({ status: 'loading', match: null }) };
  const loadingPreview = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    loading,
  );
  assert.equal(loadingPreview.preview.blocked, true);
  assert.match(loadingPreview.hint, /数据加载中/);
  assert.equal(session.input({ type: 'end', reason: 'release' }, loading).vertex, undefined);
  const limited = { ...options, snapRoad: () => roadSnapResult(b, a.coordinate, null, 'limited') };
  const limitedPreview = session.input(
    { type: 'start', point: { x: 250, y: 244 } },
    limited,
  );
  assert.equal(limitedPreview.preview.blocked, true);
  assert.match(limitedPreview.hint, /吸附计算受限/);
  assert.equal(session.input({ type: 'end', reason: 'release' }, limited).vertex, undefined);
  assert.match(roadHint({ status: 'unavailable', match: null }), /数据不可用/);
  assert.match(roadHint({ status: 'ready', match: null }), /附近没有/);
  assert.match(roadHint({ status: 'no-match', match: null }), /保留原始点/);
  assert.match(roadHint({ status: 'disconnected', match: b }), /不连通/);
  assert.match(roadHint({ status: 'limited', match: null }), /计算受限/);
  assert.match(roadHint({ status: 'hidden', match: null }), /吸附已关闭/);
  assert.match(blockedSnapHint('loading', false), /道路数据加载中/);
  assert.match(blockedSnapHint('unavailable', false), /道路数据不可用/);
  assert.match(blockedSnapHint('limited', false), /吸附计算受限/);
  assert.match(blockedSnapHint('no-match', false), /没有可吸附道路/);
  assert.match(blockedSnapHint('disconnected', true), /水系断点/);
  const free = { ...blocked, roadSnapping: false };
  session.input({ type: 'start', point: { x: 250, y: 244 } }, free);
  assert.deepEqual(
    session.input({ type: 'end', reason: 'release' }, free).vertex,
    [2.5, 2],
  );
});
test('road snap result distinguishes no match from disconnected while preserving real candidate data', () => {
  const candidate = match(bend, 2, 0.5),
    section = [candidate.coordinate];
  assert.equal(roadSnapResult(null, candidate.coordinate).status, 'no-match');
  const disconnected = roadSnapResult(candidate, [0, 0], null);
  assert.equal(disconnected.status, 'disconnected');
  assert.equal(disconnected.match, candidate);
  assert.equal(disconnected.section, null);
  const connected = roadSnapResult(candidate, [0, 0], section);
  assert.equal(connected.status, 'ready');
  assert.equal(connected.match, candidate);
  assert.equal(connected.section, section);
  const limited = roadSnapResult(candidate, [0, 0], null, 'limited');
  assert.equal(limited.status, 'limited');
  assert.equal(limited.match, null);
});
test('freehand road snapping does not report a disconnected route as snapped', () => {
  const a = line('freehand-a', [[1, 1], [1, 2]]),
    b = line('freehand-b', [[2, 1], [2, 2]]),
    first = match(a, 0, 0.62),
    second = match(b, 0, 0.62);
  const session = new DrawingSession();
  const options = {
    mode: 'freehand',
    anchor: [1, 1],
    length: 48,
    width: 800,
    height: 800,
    candidates: [],
    snapping: false,
    roadSnapping: true,
    project,
    unproject: (p) => [p.x / 100, p.y / 100],
    snapRoad: (_point, previous, from) => ({
      status: 'ready',
      match: previous ? second : first,
      ...(previous ? { section: null } : {}),
    }),
  };
  session.input({ type: 'start', point: { x: 100, y: 148 } }, options);
  session.input({ type: 'move', point: { x: 100, y: 210 } }, options);
  const moved = session.input({ type: 'move', point: { x: 100, y: 272 } }, options);
  assert.equal(moved.preview.snapped, false);
  const stroke = session.input({ type: 'end', reason: 'release' }, options).stroke;
  assert.deepEqual(stroke.at(-1), [1, 2.24]);
  assert.notDeepEqual(stroke.at(-1), second.coordinate);
});
