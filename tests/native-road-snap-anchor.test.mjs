import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNativeRoadSnapAnchorState,
  rememberNativeRoadSnapCandidate,
  resolveNativeRoadSnapAnchor,
} from '../modules/map/native/roadSnapAnchor.ts';
import { roadSnapResult } from '../modules/tracks/roadSnapping.ts';

const line = (id, coordinates) => ({ id, name: id, coordinates });
const match = (source, index, fraction, coordinate, screen = { x: 0, y: 0 }) => ({
  line: source,
  index,
  fraction,
  coordinate,
  screen,
});
const projectWith = (offset = 0) => point => ({ x: point[0] * 10 + offset, y: point[1] * 10 - offset });

function resolve(state, {
  kind = 'road', generation = 4, from, previous = null,
  lines, project = projectWith(), projectionValid = true,
}) {
  return resolveNativeRoadSnapAnchor(state, kind, generation, from, previous, new Map(lines.map(value => [value.id, value])), project, projectionValid);
}

function committedState(sourceMatch, { kind = 'road', generation = 4, lines = [sourceMatch.line] } = {}) {
  const initial = resolve(emptyNativeRoadSnapAnchorState(), { kind, generation, from: undefined, lines });
  const withCandidate = rememberNativeRoadSnapCandidate(initial.state, kind, generation, sourceMatch, initial.trackCandidate);
  return resolve(withCandidate, { kind, generation, from: sourceMatch.coordinate, lines }).state;
}

test('exact committed candidate promotes and wins over a dense ambiguous same-coordinate road', () => {
  const committed = [2, 2];
  const primary = line('chosen', [[0, 2], [4, 2]]);
  const crossing = line('nearby-crossing', [[2, 0], [2, 4]]);
  const candidate = match(primary, 0, 0.5, committed);

  const initial = resolve(emptyNativeRoadSnapAnchorState(), { from: undefined, lines: [primary, crossing] });
  const state = rememberNativeRoadSnapCandidate(initial.state, 'road', 4, candidate, initial.trackCandidate);
  const next = resolve(state, { from: committed, lines: [crossing, primary] });

  assert.equal(next.previous.line.id, 'chosen');
  assert.equal(next.start.line.id, 'chosen');
  assert.equal(next.start.line, primary);
});

test('an uncommitted aim candidate never replaces the anchor; exact next from promotes it', () => {
  const firstPoint = [1, 0];
  const secondPoint = [3, 0];
  const source = line('main', [[0, 0], [4, 0]]);
  const anchor = match(source, 0, 0.25, firstPoint);
  const candidate = match(source, 0, 0.75, secondPoint);
  const anchorState = committedState(anchor);
  const state = rememberNativeRoadSnapCandidate(anchorState, 'road', 4, candidate, true);

  const stillAtFirst = resolve(state, { from: firstPoint, lines: [source] });
  assert.deepEqual(stillAtFirst.previous.coordinate, firstPoint);
  assert.equal(stillAtFirst.previous.line.id, 'main');

  const committedSecond = resolve(state, { from: secondPoint, lines: [source] });
  assert.deepEqual(committedSecond.previous.coordinate, secondPoint);
  assert.equal(committedSecond.previous.fraction, 0.75);
});

test('a changed from that is not the exact last candidate clears the anchor without promotion', () => {
  const source = line('main', [[0, 0], [4, 0]]);
  const oldAnchor = match(source, 0, 0.25, [1, 0]);
  const uncommitted = match(source, 0, 0.75, [3, 0]);
  const anchorState = committedState(oldAnchor);
  const state = rememberNativeRoadSnapCandidate(anchorState, 'road', 4, uncommitted, true);
  const result = resolve(state, {
    from: [3.0000001, 0], lines: [source],
  });

  assert.equal(result.previous, null);
  assert.equal(result.start, null);
  assert.equal(result.trackCandidate, true);
});

test('same source segment rebinds to current snapshot and refreshes screen coordinates', () => {
  const oldSource = line('stable-id', [[0, 0], [10, 0]]);
  const currentSource = line('stable-id', [[0, 0], [10, 0]]);
  const point = [4, 0];
  const oldMatch = match(oldSource, 0, 0.4, point, { x: 40, y: 0 });
  const result = resolve(committedState(oldMatch), {
    from: point, lines: [currentSource], project: projectWith(100),
  });

  assert.equal(result.previous.line, currentSource);
  assert.equal(result.start.line, currentSource);
  assert.deepEqual(result.previous.screen, { x: 140, y: -100 });
  assert.deepEqual(result.previous.coordinate, point);
});

test('missing or changed anchor segment, invalid projection, generation and kind changes clear reuse', () => {
  const original = line('same-id', [[0, 0], [10, 0]]);
  const anchor = match(original, 0, 0.4, [4, 0]);
  const base = committedState(anchor);

  assert.equal(resolve(base, { from: [4, 0], lines: [] }).previous, null);
  assert.equal(resolve(base, { from: [4, 0], lines: [line('same-id', [[0, 1], [10, 1]])] }).previous, null);
  assert.equal(resolve(base, { from: [4, 0], lines: [original], projectionValid: false }).previous, null);
  assert.equal(resolve(base, { from: [4, 0], lines: [original], generation: 5 }).previous, null);
  assert.equal(resolve(base, { from: [4, 0], lines: [original], kind: 'river' }).previous, null);
  assert.equal(resolve(base, { from: [4, 0], lines: [original], project: () => ({ x: NaN, y: 0 }) }).previous, null);
});

test('remembered anchor rejects in-place source endpoint or level mutation', () => {
  for (const mutate of [
    source => { source.coordinates[0][1] = 0.25; },
    source => { source.level = 1; },
  ]) {
    const source = line('same-id', [[0, 0], [10, 0]]);
    const candidate = match(source, 0, 0.4, [4, 0]);
    const state = committedState(candidate);
    mutate(source);

    const result = resolve(state, { from: [4, 0], lines: [source] });
    assert.equal(result.previous, null);
    assert.equal(result.start, null);
  }
});

test('explicit freehand previous match stays authoritative and is not stored as a points candidate', () => {
  const source = line('stroke', [[0, 0], [10, 0]]);
  const explicit = match(source, 0, 0.4, [4, 0]);
  const staleAnchor = match(line('old', [[0, 0], [10, 0]]), 0, 0.2, [2, 0]);
  const result = resolve({ kind: 'road', generation: 4, anchor: staleAnchor, lastCandidate: null }, {
    from: [4, 0], previous: explicit, lines: [source],
  });

  assert.equal(result.previous, explicit);
  assert.equal(result.start.line, source);
  assert.equal(result.trackCandidate, false);
  assert.equal(rememberNativeRoadSnapCandidate(result.state, 'road', 4, explicit, result.trackCandidate).anchor, null);
});

test('a genuinely limited road path remains limited and supplies no committed match', () => {
  const result = roadSnapResult(null, [1, 1], null, 'limited');
  assert.equal(result.status, 'limited');
  assert.equal(result.match, null);
  assert.equal(result.section, undefined);
});
