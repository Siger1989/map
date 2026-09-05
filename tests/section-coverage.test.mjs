import test from 'node:test';
import assert from 'node:assert/strict';
import { coveredContours } from '../modules/section/contourCoverage.ts';
import { tileCoordinate } from '../modules/section/terrainMath.ts';
const parent = { z: 4, x: 12, y: 6 };
const child = { z: 5, x: 24, y: 12 };
const line = [tileCoordinate(parent, 0, 40), tileCoordinate(parent, 256, 40)];

test('coarse contour portions covered by a finer DEM tile are removed, not drawn across its cut face', () => {
  const coarse = { tile: parent, lines: [line] },
    fine = { tile: child, lines: [] };
  const clipped = coveredContours(coarse, [coarse, fine]);
  assert.equal(clipped.length, 1);
  assert.ok(
    Math.abs(clipped[0][0][0] - tileCoordinate(parent, 128, 40)[0]) < 1e-8,
  );
  assert.deepEqual(clipped[0].at(-1), line[1]);
  assert.deepEqual(
    coarse.lines,
    [line],
    'cached original contours remain unchanged',
  );
});
test('uncovered fine contours survive; fully covered parents disappear; nested descendants do not reconnect across gaps', () => {
  const coarse = { tile: parent, lines: [line] };
  const children = [0, 1].map((dx) => ({
    tile: { z: 5, x: 24 + dx, y: 12 },
    lines: [],
  }));
  assert.deepEqual(coveredContours(coarse, [coarse, ...children]), []);
  assert.strictEqual(coveredContours(coarse, [coarse]), coarse.lines);
  const middle = { tile: { z: 6, x: 49, y: 24 }, lines: [] };
  const clipped = coveredContours(coarse, [coarse, middle]);
  assert.equal(clipped.length, 2);
  assert.ok(clipped[0].at(-1)[0] < clipped[1][0][0]);
  const finer = { tile: { z: 7, x: 98, y: 48 }, lines: [] };
  assert.deepEqual(coveredContours(coarse, [coarse, middle, finer]), clipped);
});
