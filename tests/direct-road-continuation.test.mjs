import test from 'node:test';
import assert from 'node:assert/strict';
import { directSharedVertexRoadSection } from '../modules/tracks/directRoadContinuation.ts';
import { roadPathDetailed } from '../modules/tracks/roadPath.ts';

const line = (id, coordinates, level = 0) => ({ id, name: '', level, coordinates });
const match = (source, index, fraction) => {
  const a = source.coordinates[index], b = source.coordinates[index + 1];
  const mercator = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
  const coordinate = [
    a[0] + (b[0] - a[0]) * fraction,
    Math.atan(Math.sinh(mercator(a[1]) + (mercator(b[1]) - mercator(a[1])) * fraction)) * 180 / Math.PI,
  ];
  return { line: source, index, fraction, coordinate, screen: { x: 0, y: 0 } };
};
const byId = (...lines) => new Map(lines.map((item) => [item.id, item]));

test('crowded 6000-point snapshot bypasses the graph limit via two real bent features', () => {
  const fromLine = line('from', [[0, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001]]);
  const toLine = line('to', [[0.001, 0.001], [0.001, 0.002], [0.002, 0.002], [0.003, 0.002]]);
  const unrelated = Array.from({ length: 2996 }, (_, i) => {
    const x = 10 + i * 0.00002;
    return line(`crowded-${i}`, [[x, 20], [x + 0.00001, 20]]);
  });
  const roads = [fromLine, toLine, ...unrelated];
  const snapshot = byId(...roads);
  assert.equal(roads.reduce((n, road) => n + road.coordinates.length, 0), 6000);
  assert.equal(roadPathDetailed(match(fromLine, 0, 0.2), match(toLine, 2, 0.5), roads).status, 'limited');

  const section = directSharedVertexRoadSection(
    match(fromLine, 0, 0.2),
    match(toLine, 2, 0.5),
    snapshot,
  );
  assert.deepEqual(section, [
    fromLine.coordinates[1],
    fromLine.coordinates[2],
    toLine.coordinates[1],
    toLine.coordinates[2],
    match(toLine, 2, 0.5).coordinate,
  ]);
  assert.ok(section.some((point, i) => i > 0 && point[1] !== section[i - 1][1]));
  assert.ok(section.some((point, i) => i > 0 && point[0] !== section[i - 1][0]));
  assert.ok(section.length <= 3000);
});

test('interior common vertex follows original vertices in either direction', () => {
  const a = line('a', [[0, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001]]);
  const b = line('b', [[0.001, 0.002], [0.001, 0.001], [0.002, 0.001], [0.003, 0.001]]);
  const snapshot = byId(a, b);
  const aStart = match(a, 0, 0.4);
  const bEnd = match(b, 2, 0.5);
  const forward = directSharedVertexRoadSection(aStart, bEnd, snapshot);
  assert.deepEqual(forward, [a.coordinates[1], a.coordinates[2], b.coordinates[2], bEnd.coordinate]);

  const bStart = match(b, 2, 0.5);
  const aEnd = match(a, 0, 0.4);
  const reverse = directSharedVertexRoadSection(bStart, aEnd, snapshot);
  assert.deepEqual(reverse, [b.coordinates[2], b.coordinates[1], a.coordinates[1], aEnd.coordinate]);
});

test('keeps repeated real vertices after a shared-node start even when one equals the target anchor', () => {
  const shared = [1, 1];
  const repeatedTarget = [1.001, 1];
  const bend = [1.001, 1.001];
  const fromLine = line('from-at-junction', [[0.999, 1], shared]);
  const toLine = line('loop-after-junction', [shared, repeatedTarget, bend, repeatedTarget, [1.002, 1]]);
  const from = match(fromLine, 0, 1);
  const to = match(toLine, 3, 0);
  const section = directSharedVertexRoadSection(from, to, byId(fromLine, toLine));
  assert.deepEqual(section, [repeatedTarget, bend, repeatedTarget]);
  assert.equal(section.includes(shared), false);
});

test('chooses the shortest real path when the two features share multiple exact vertices', () => {
  const a = line('a', [[0, 0], [0.001, 0], [0.002, 0], [0.003, 0]]);
  const b = line('b', [[0.002, 0], [0.003, 0], [0.004, 0]]);
  const end = match(b, 1, 0.5);
  const section = directSharedVertexRoadSection(match(a, 2, 0.9), end, byId(a, b));
  assert.deepEqual(section, [a.coordinates[3], end.coordinate]);
});

test('rejects different levels, missing/stale snapshot features, and near-but-not-equal vertices', () => {
  const a = line('a', [[0, 0], [0.001, 0], [0.001, 0.001]]);
  const exact = line('exact', [[0.001, 0.001], [0.002, 0.001]]);
  assert.equal(directSharedVertexRoadSection(match(a, 0, 0.5), match(exact, 0, 0.5), byId(a, line('exact', exact.coordinates))), null);

  const elevated = line('elevated', exact.coordinates, 1);
  assert.equal(directSharedVertexRoadSection(match(a, 1, 0.5), match(elevated, 0, 0.5), byId(a, elevated)), null);
  const unknownLevel = { ...exact, level: undefined };
  assert.equal(directSharedVertexRoadSection(match(a, 1, 0.5), match(unknownLevel, 0, 0.5), byId(a, unknownLevel)), null);

  const oneMetreGap = line('gap', [[0.001009, 0.001], [0.002, 0.001]]);
  assert.equal(directSharedVertexRoadSection(match(a, 1, 0.5), match(oneMetreGap, 0, 0.5), byId(a, oneMetreGap)), null);

  const stale = line('a', a.coordinates);
  assert.equal(directSharedVertexRoadSection(match(a, 0, 0.5), match(exact, 0, 0.5), byId(stale, exact)), null);
  assert.equal(directSharedVertexRoadSection(match(a, 0, 0.5), match(exact, 0, 0.5), byId(a)), null);
});

test('rejects stale anchors and rebuilds its weakly cached index after in-place geometry edits', () => {
  const a = line('a', [[0, 0], [0.001, 0], [0.001, 0.001]]);
  const b = line('b', [[0.001, 0.001], [0.002, 0.001], [0.003, 0.001]]);
  const snapshot = byId(a, b);
  const from = match(a, 0, 0.5);
  const to = match(b, 1, 0.5);
  assert.ok(directSharedVertexRoadSection(from, to, snapshot));

  const offRoadAnchor = { ...from, coordinate: [0.0005, 0.00001] };
  assert.equal(directSharedVertexRoadSection(offRoadAnchor, to, snapshot), null);

  b.coordinates[0][1] += 0.0002;
  const movedTo = match(b, 1, 0.5);
  assert.equal(directSharedVertexRoadSection(from, movedTo, snapshot), null);
});

test('rejects output above the synchronous road-section point budget', () => {
  const shared = [0.02, 0.02];
  const fromCoordinates = Array.from({ length: 1601 }, (_, i) => [i * 0.00001, 0]);
  fromCoordinates[fromCoordinates.length - 1] = shared;
  const toCoordinates = [shared, ...Array.from({ length: 1599 }, (_, i) => [0.02 + (i + 1) * 0.00001, 0.001])];
  const fromLine = line('long-from', fromCoordinates);
  const toLine = line('long-to', toCoordinates);
  const result = directSharedVertexRoadSection(
    match(fromLine, 0, 0),
    match(toLine, toCoordinates.length - 2, 1),
    byId(fromLine, toLine),
  );
  assert.equal(result, null);
});

test('caps repeated shared-vertex candidate pairs', () => {
  const repeated = Array.from({ length: 34 }, () => [1, 1]);
  const a = line('a', repeated.map(([x, y]) => [x, y]));
  const b = line('b', repeated.map(([x, y]) => [x, y]));
  assert.equal(directSharedVertexRoadSection(match(a, 0, 0.5), match(b, 32, 0.5), byId(a, b)), null);
});
