import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectedPointIndex } from '../modules/map/native/projectedPointIndex.ts';

test('node grid agrees with full scan including 14px boundary, ties, exclusions and negative cells', () => {
  const points = Array.from({ length: 6000 }, (_, id) => ({ id, x: (id * 37 % 1600) - 800, y: (id * 59 % 1600) - 800 }));
  points.unshift({ id: -1, x: 14, y: 0 }, { id: -2, x: -14, y: 0 });
  let projections = 0;
  const index = new ProjectedPointIndex(points, value => { projections++; return value; });
  const brute = (point, accept) => {
    let result = null, distance = 14;
    for (const value of points) {
      const d = Math.hypot(value.x - point.x, value.y - point.y);
      if (accept(value) && d <= 14 && (!result || d < distance)) { result = value; distance = d; }
    }
    return result;
  };
  const accept = v => v.id !== 100 && v.id !== 150;
  for (let i = 0; i < 200; i++) {
    const point = { x: (i * 73 % 1700) - 850, y: (i * 19 % 1700) - 850 };
    assert.equal(index.nearest(point, 14, accept), brute(point, accept));
  }
  assert.equal(projections, points.length, 'subsequent MOVE queries must not reproject the saved nodes');
  assert.equal(index.nearest({ x: NaN, y: 0 }, 14), null);
});
