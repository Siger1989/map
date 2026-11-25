import assert from 'node:assert/strict';
import test from 'node:test';
import { terrainPrintStl } from '../modules/terrainPrint/mesh.ts';

function readTriangles(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  assert.equal(buffer.byteLength, 84 + count * 50);
  return Array.from({ length: count }, (_, index) => {
    const offset = 84 + index * 50;
    const vector = start => [0, 4, 8].map(delta => view.getFloat32(offset + start + delta, true));
    assert.ok(Math.abs(Math.hypot(...vector(0)) - 1) < 1e-5);
    return [vector(12), vector(24), vector(36)];
  });
}

function assertClosedAndOutward(triangles) {
  const edges = new Map();
  let volume = 0;
  for (const [a, b, c] of triangles) {
    volume += (
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
    for (const [from, to] of [[a, b], [b, c], [c, a]]) {
      const start = from.join(',');
      const end = to.join(',');
      assert.notEqual(start, end);
      const forward = start < end;
      const key = forward ? `${start}|${end}` : `${end}|${start}`;
      const prior = edges.get(key) ?? [0, 0];
      prior[forward ? 0 : 1]++;
      edges.set(key, prior);
    }
  }
  for (const use of edges.values()) assert.deepEqual(use, [1, 1]);
  assert.ok(volume > 0);
}

const rectGrid = {
  width: 3,
  height: 2,
  eastWestMeters: 80,
  northSouthMeters: 40,
  elevations: [-20, -12, -4, -20, -12, -4],
};

test('rectangle keeps actual terrain proportions and makes a closed flat bottom', () => {
  const triangles = readTriangles(terrainPrintStl(rectGrid, {
    shape: 'rectangle', widthMm: 100, baseMm: 3, rimMm: 0,
  }));
  assertClosedAndOutward(triangles);
  const vertices = triangles.flat();
  assert.equal(Math.max(...vertices.map(v => v[0])), 50);
  assert.equal(Math.max(...vertices.map(v => v[1])), 25);
  assert.equal(Math.min(...vertices.map(v => v[2])), 0);
  assert.equal(Math.max(...vertices.map(v => v[2])), 23);
  assert.ok(vertices.some(([x, y, z]) => x === -50 && y === 25 && z === 3));
});

test('flush edges weld to the wraparound base without degenerate or open faces', () => {
  const triangles = readTriangles(terrainPrintStl(rectGrid, {
    shape: 'rectangle', widthMm: 100, baseMm: 3, rimMm: 4,
  }));
  assertClosedAndOutward(triangles);
  const vertices = triangles.flat();
  assert.equal(Math.max(...vertices.map(v => v[0])), 54);
  assert.equal(Math.max(...vertices.map(v => v[1])), 29);
  assert.equal(Math.max(...vertices.map(v => v[2])), 23);
  assert.ok(vertices.some(([x, y, z]) => x === -54 && y === 29 && z === 3));
});

test('circle ignores missing corner samples and exports a smooth, closed round rim', () => {
  const side = 7;
  const elevations = Array.from({ length: side ** 2 }, (_, index) => {
    const x = index % side - 3;
    const y = Math.floor(index / side) - 3;
    return Math.hypot(x, y) <= 3 ? x + y : null;
  });
  const triangles = readTriangles(terrainPrintStl({
    width: side, height: side, eastWestMeters: 48, northSouthMeters: 48, elevations,
  }, { shape: 'circle', widthMm: 100, baseMm: 2, rimMm: 5 }));
  assertClosedAndOutward(triangles);
  const floor = triangles.flat().filter((v) => v[2] === 0 && (v[0] || v[1]));
  assert.ok(new Set(floor.map(v => v.join(','))).size >= 64);
  for (const [x, y] of floor) assert.ok(Math.abs(Math.hypot(x, y) - 55) < 1e-5);
});

test('a NoData hole inside the selected area prevents STL export', () => {
  const elevations = Array(25).fill(1);
  elevations[12] = null;
  for (const shape of ['rectangle', 'circle']) {
    assert.throws(() => terrainPrintStl({
      width: 5, height: 5, eastWestMeters: 32, northSouthMeters: 32, elevations,
    }, { shape, widthMm: 100, baseMm: 3, rimMm: 0 }), /数据缺口/);
  }
});
