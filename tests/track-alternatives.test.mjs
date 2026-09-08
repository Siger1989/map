import test from 'node:test';
import assert from 'node:assert/strict';
import {
  trackAlternatives,
  alternativeLineParts,
  trackEdgeKey,
} from '../modules/tracks/alternatives.ts';
import { trackDistance } from '../modules/tracks/drawing.ts';
import { trackPointAt, markerChainage } from '../modules/tracks/linePoint.ts';
const A = [103, 30],
  B = [103.001, 30],
  M = [103.002, 30],
  C = [103.003, 30],
  D = [103.004, 30];
const X = [103.001, 30.002],
  Y = [103.003, 30.002];
const main = [A, B, M, C, D],
  detour = [B, X, Y, C];
test('default remains original; alternative skips the replaced interval and never sums both routes', () => {
  const segments = [main, detour],
    before = JSON.stringify(segments);
  const [normal, alternate] = trackAlternatives(segments);
  assert.equal(normal.id, 'main');
  assert.deepEqual(normal.coordinates, main);
  assert.deepEqual(alternate.coordinates, [A, B, X, Y, C, D]);
  assert.deepEqual(alternate.detour, detour);
  assert.equal(alternate.distance, trackDistance([[A, B, X, Y, C, D]]));
  assert.ok(alternate.distance < trackDistance(segments));
  assert.ok(!alternate.coordinates.includes(M));
  assert.deepEqual(alternate.coordinates[0], A);
  assert.deepEqual(alternate.coordinates.at(-1), D);
  assert.equal(JSON.stringify(segments), before);
});
test('reversed detour and separate strokes with a direct final connection form the same replacement', () => {
  const choices = trackAlternatives([main, [Y, X, B], [C, Y]]);
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[1].coordinates, [A, B, X, Y, C, D]);
});
test('dangling branches, disconnected routes and visual crossings are not round-trip alternatives', () => {
  assert.equal(trackAlternatives([main, [B, X, Y]]).length, 1);
  assert.equal(trackAlternatives([main, [X, Y]]).length, 1);
  assert.equal(
    trackAlternatives([
      main,
      [
        [103.002, 29.99],
        [103.002, 30.01],
      ],
    ]).length,
    1,
  );
  assert.equal(trackAlternatives([main, [B]]).length, 1);
});
test('a multi-stroke original keeps its full extent and a shorter detour does not replace the default', () => {
  const longer = [A, B, X, Y, C, D];
  const choices = trackAlternatives([
    [A, B, X],
    [X, Y, C, D],
    [B, C],
  ]);
  assert.deepEqual(choices[0].coordinates, longer);
  assert.deepEqual(choices[1].coordinates, [A, B, C, D]);
  assert.ok(choices[1].distance < choices[0].distance);
});
test('coloring highlights the detour and only dims omitted main edges on alternative selection', () => {
  const parts = alternativeLineParts([main, detour], 'detour-1');
  const muted = parts
    .filter((p) => p.muted)
    .flatMap((p) =>
      p.coordinates.slice(1).map((v, i) => trackEdgeKey(p.coordinates[i], v)),
    );
  assert.deepEqual(muted, [trackEdgeKey(B, M), trackEdgeKey(M, C)]);
  assert.ok(parts.find((p) => p.color)?.coordinates.some((p) => p === X));
  assert.ok(alternativeLineParts([main, detour]).every((p) => !p.muted));
  const colors = trackAlternatives([main, detour], '#55d6ff');
  assert.notEqual(colors[0].color, colors[1].color);
});
test('alternative progress and marker chainage follow detour instead of the omitted middle segment', () => {
  const choice = trackAlternatives([main, detour])[1],
    lines = [choice.coordinates];
  const atX = trackDistance([[A, B, X]]);
  const point = trackPointAt(lines, atX);
  assert.ok(
    Math.abs(point[0] - X[0]) < 1e-8 && Math.abs(point[1] - X[1]) < 1e-8,
  );
  assert.ok(Math.abs(markerChainage(lines, X).distance - atX) < 0.01);
  assert.ok(markerChainage(lines, M).offset > 30);
});
test('two different detours remain independently selectable', () => {
  const other = [B, [103.001, 29.998], [103.003, 29.998], C];
  const choices = trackAlternatives([main, detour, other]);
  assert.equal(choices.length, 3);
  assert.notEqual(choices[1].color, choices[2].color);
  assert.deepEqual(choices[2].coordinates, [A, ...other, D]);
});
