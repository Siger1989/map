import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestRoad, ROAD_RELEASE_RADIUS } from '../modules/tracks/roadSnapping.ts';
import { ProjectedRoadIndex } from '../modules/tracks/projectedRoadIndex.ts';

function assertSameMatch(actual, expected) {
  assert.equal(actual?.line.id ?? null, expected?.line.id ?? null);
  assert.equal(actual?.index ?? null, expected?.index ?? null);
  if (!actual || !expected) return;
  assert.ok(Math.abs(actual.fraction - expected.fraction) < 1e-10);
  assert.ok(Math.abs(actual.screen.x - expected.screen.x) < 1e-8);
  assert.ok(Math.abs(actual.screen.y - expected.screen.y) < 1e-8);
}

function compareIndexed(point, lines, project, previous = null) {
  const index = new ProjectedRoadIndex(lines, project);
  assertSameMatch(
    nearestRoad(point, lines, project, previous, index),
    nearestRoad(point, lines, project, previous),
  );
  return index;
}

test('projected candidates preserve nonlinear tilted-map refinement on bends', () => {
  const lines = [{
    id: 'bend', name: 'bend', coordinates: [[0, 0], [0.4, 0.6], [0.8, -0.2], [1.2, 0.3]],
  }];
  // Deliberately non-affine, as with terrain and a pitched camera.
  const project = ([lon, lat]) => ({
    x: lon * 900 + Math.sin(lat * 5) * 7,
    y: lat * 700 + lon * lon * 130 + lon * lat * 45,
  });
  const index = compareIndexed({ x: 420, y: 365 }, lines, project);
  assert.ok(index.candidatesAt({ x: 420, y: 365 }, 22).length > 0);
});

test('projected candidates preserve source ordering for equal-distance matches', () => {
  const lines = [
    { id: 'first', name: '', coordinates: [[0, 0], [1, 0]] },
    { id: 'second', name: '', coordinates: [[0, 0.2], [1, 0.2]] },
  ];
  const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
  const match = nearestRoad({ x: 50, y: 10 }, lines, project, null,
    new ProjectedRoadIndex(lines, project));
  assert.equal(match?.line.id, 'first');
  assertSameMatch(match, nearestRoad({ x: 50, y: 10 }, lines, project));
});

test('indexed broad phase retains snap and previous-road release boundaries', () => {
  const line = { id: 'road', name: '', coordinates: [[0, 0], [1, 0]] };
  const lines = [line];
  const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
  const point = { x: 50, y: 18 };
  const previous = {
    line, index: 0, fraction: 0.5, coordinate: [0.5, 0], screen: { x: 50, y: 0 },
  };
  const index = new ProjectedRoadIndex(lines, project);
  assertSameMatch(
    nearestRoad(point, lines, project, previous, index),
    nearestRoad(point, lines, project, previous),
  );
  assert.ok(nearestRoad(point, lines, project, previous, index));
  assert.equal(nearestRoad(point, lines, project, null, index), null);
  const releaseEdge = { x: 50, y: ROAD_RELEASE_RADIUS };
  assertSameMatch(
    nearestRoad(releaseEdge, lines, project, previous, index),
    nearestRoad(releaseEdge, lines, project, previous),
  );
  assertSameMatch(
    nearestRoad({ x: 50, y: 14 }, lines, project, null, index),
    nearestRoad({ x: 50, y: 14 }, lines, project),
  );
});

test('segments spanning many grid cells use bounded overflow and remain candidates', () => {
  const lines = [{ id: 'long', name: '', coordinates: [[-100, 0], [100, 0]] }];
  const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
  const index = new ProjectedRoadIndex(lines, project);
  assert.equal(index.overflowCount, 1);
  assert.equal(index.candidatesAt({ x: 0, y: 10 }, 22).length, 1);
  assertSameMatch(
    nearestRoad({ x: 0, y: 10 }, lines, project, null, index),
    nearestRoad({ x: 0, y: 10 }, lines, project),
  );
});

test('6000-coordinate projected index reuses endpoint projections across MOVE queries', () => {
  const coordinates = Array.from({ length: 6000 }, (_, i) => [i * 0.001, 0]);
  const lines = [{ id: 'long-road', name: '', coordinates }];
  let indexedCalls = 0;
  const indexedProject = ([x, y]) => {
    indexedCalls++;
    return { x: x * 8000, y: y * 8000 + Math.sin(x * 8) * 2 };
  };
  const index = new ProjectedRoadIndex(lines, indexedProject);
  const callsAfterBuild = indexedCalls;
  let baselineCalls = 0;
  const baselineProject = ([x, y]) => {
    baselineCalls++;
    return { x: x * 8000, y: y * 8000 + Math.sin(x * 8) * 2 };
  };
  for (let move = 0; move < 8; move++) {
    const point = { x: 2500 + move * 13, y: 6 };
    const indexed = nearestRoad(point, lines, indexedProject, null, index);
    const baseline = nearestRoad(point, lines, baselineProject);
    assertSameMatch(indexed, baseline);
  }
  const indexedWork = indexedCalls;
  const naiveWork = baselineCalls;
  assert.equal(callsAfterBuild, (coordinates.length - 1) * 2);
  assert.ok(indexedWork - callsAfterBuild < naiveWork / 20,
    `indexed per-MOVE projection calls ${indexedWork - callsAfterBuild}; baseline ${naiveWork}`);
});

test('index falls back to legacy scan if the source segment is mutated in place', () => {
  const lines = [{ id: 'road', name: '', coordinates: [[0, 0], [1, 0]] }];
  const project = ([x, y]) => ({ x: x * 100, y: y * 100 });
  const index = new ProjectedRoadIndex(lines, project);
  lines[0].coordinates[1] = [1, 0.1];
  assertSameMatch(
    nearestRoad({ x: 50, y: 10 }, lines, project, null, index),
    nearestRoad({ x: 50, y: 10 }, lines, project),
  );
});
