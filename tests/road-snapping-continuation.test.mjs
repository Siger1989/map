import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseRoadMatchAtCoordinate } from '../modules/tracks/roadSnapping.ts';

test('a continuing road match is rebound to the current same-ID snapshot', () => {
  const oldLine = { id: 'same-road', name: '', coordinates: [[0, 0], [1, 0]] };
  const currentLine = { id: 'same-road', name: '', coordinates: [[0, 0], [1, 0]] };
  const anchor = [0.4, 0];
  const previous = { line: oldLine, index: 0, fraction: 0.4, coordinate: anchor, screen: { x: 40, y: 0 } };

  const rebound = reuseRoadMatchAtCoordinate(previous, [0.4, 0], new Map([[currentLine.id, currentLine]]));
  assert.ok(rebound);
  assert.strictEqual(rebound.line, currentLine);
  assert.equal(rebound.index, previous.index);
  assert.equal(rebound.fraction, previous.fraction);
  assert.deepEqual(rebound.coordinate, previous.coordinate);
});

test('a stale anchor or absent source feature cannot be reused', () => {
  const line = { id: 'same-road', name: '', coordinates: [[0, 0], [1, 0]] };
  const previous = { line, index: 0, fraction: 0.4, coordinate: [0.4, 0], screen: { x: 40, y: 0 } };
  const linesById = new Map([[line.id, line]]);

  assert.equal(reuseRoadMatchAtCoordinate(previous, [0.41, 0], linesById), null);
  assert.equal(reuseRoadMatchAtCoordinate(previous, undefined, linesById), null);
  assert.equal(reuseRoadMatchAtCoordinate(previous, [0.4, 0], new Map()), null);
});
