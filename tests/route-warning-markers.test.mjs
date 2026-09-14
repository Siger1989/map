import test from 'node:test';
import assert from 'node:assert/strict';
import { steepWarningMarkers } from '../modules/routeDisplay/warningMarkers.ts';
import { ROUTE_WARNING_POLICY } from '../modules/routeDisplay/config.ts';
import { analyzeRoute } from '../modules/routeAnalysis/metrics.ts';
import { metresBetween } from '../modules/navigation/types.ts';

const line = (count, step = 0.001) =>
  Array.from({ length: count }, (_, i) => [i * step, 0]);

test('all isolated steep runs survive beyond the former first twelve', () => {
  const track = { segments: [line(41)] },
    grades = [Array.from({ length: 40 }, (_, i) => (i % 2 ? 0 : 25))],
    before = JSON.stringify({ track, grades });
  const marks = steepWarningMarkers(track, grades);
  assert.equal(marks.length, 20);
  assert.ok(marks.at(-1).coordinate[0] > 0.038);
  assert.equal(JSON.stringify({ track, grades }), before);
});

test('a crest separates steep ascent and descent even without a flat edge', () => {
  const track = { segments: [line(4, 0.0004)] };
  const marks = steepWarningMarkers(track, [[25, 35, -45]]);
  assert.equal(marks.length, 2);
  assert.equal(marks[0].label, '陡上 35%');
  assert.equal(marks[1].label, '陡下 45%');
  assert.ok(marks[0].coordinate[0] < marks[1].coordinate[0]);
});

test('long continuous slopes repeat through the tail even after a steeper beginning', () => {
  const track = { segments: [line(13)] };
  const marks = steepWarningMarkers(track, [[45, ...Array(11).fill(25)]]);
  const distance = metresBetween(
    track.segments[0][0],
    track.segments[0].at(-1),
  );
  assert.equal(
    marks.length,
    Math.ceil(distance / ROUTE_WARNING_POLICY.repeatDistanceMetres),
  );
  assert.match(marks[0].label, /45%/);
  assert.match(marks.at(-1).label, /25%/);
  assert.ok(
    metresBetween(marks.at(-1).coordinate, track.segments[0].at(-1)) <
      ROUTE_WARNING_POLICY.repeatDistanceMetres,
  );
});

test('single sparse edges receive distributed markers, and extreme runs stay bounded without dropping their end', () => {
  const marks = steepWarningMarkers(
    {
      segments: [
        [
          [170, 0],
          [-170, 0],
        ],
      ],
    },
    [[30]],
  );
  assert.ok(marks.length <= ROUTE_WARNING_POLICY.maximumMarkersPerRun);
  assert.ok(marks.length > 12);
  assert.ok(marks[0].coordinate[0] > 170 && marks[0].coordinate[0] < 171);
  assert.ok(
    marks.at(-1).coordinate[0] < -170 && marks.at(-1).coordinate[0] > -171,
  );
  assert.ok(
    marks.every((m) => m.coordinate[0] >= -180 && m.coordinate[0] <= 180),
  );
});

test('missing, nonfinite, subthreshold slopes and separate parts never merge runs', () => {
  const marks = steepWarningMarkers(
    {
      segments: [
        line(8, 0.0004),
        [
          [1, 0],
          [1.0004, 0],
        ],
      ],
    },
    [[25, null, 25, NaN, 19.9, -20, undefined], [20]],
  );
  assert.equal(marks.length, 4);
  assert.equal(marks[2].label, '陡下 20%');
  assert.ok(marks.at(-1).coordinate[0] > 1);
  assert.deepEqual(
    steepWarningMarkers(
      {
        segments: [
          [
            [0, 0],
            [0, 0],
          ],
        ],
      },
      [[30]],
    ),
    [],
  );
});

test('markers use the same measured grade as route colours and selected point analysis', () => {
  const segments = [line(5, 0.0004)],
    samples = [
      [100, 115, 130, 110, 90].map((altitude) => ({ altitude, time: null })),
    ];
  const metrics = analyzeRoute({ segments, samples });
  const marks = steepWarningMarkers({ segments }, metrics.slopes);
  assert.equal(marks.length, 2);
  assert.ok(metrics.slopes[0][0] > 20 && metrics.slopes[0][3] < -20);
  assert.equal(marks[0].label, `陡上 ${Math.round(metrics.slopes[0][0])}%`);
  assert.equal(
    marks[1].label,
    `陡下 ${Math.round(Math.abs(metrics.slopes[0][3]))}%`,
  );
});
