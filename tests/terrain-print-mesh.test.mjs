import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTerrainTrackColor, terrainPrintStl, terrainTrackPalette } from '../modules/terrainPrint/mesh.ts';

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

function assertSingleShell(triangles) {
  assertClosedAndOutward(triangles);
  const connected = new Set([0]);
  const pending = [0];
  const atEdge = new Map();
  const neighbours = Array.from(triangles, () => []);
  triangles.forEach((vertices, index) => {
    const names = vertices.map(v => v.join(','));
    for (let side = 0; side < 3; side++) {
      const key = [names[side], names[(side + 1) % 3]].sort().join('|');
      const other = atEdge.get(key);
      if (other === undefined) atEdge.set(key, index);
      else {
        neighbours[other].push(index);
        neighbours[index].push(other);
      }
    }
  });
  while (pending.length) {
    for (const neighbour of neighbours[pending.pop()]) {
      if (connected.has(neighbour)) continue;
      connected.add(neighbour);
      pending.push(neighbour);
    }
  }
  assert.equal(connected.size, triangles.length);
}

test('long crossing tracks refine just the necessary area and form one shell on real relief', () => {
  const options = { shape: 'rectangle', widthMm: 160, baseMm: 3, rimMm: 4 };
  const tracks = [[[-0.1, 0.37], [1.1, 0.37]], [[0.39, 0.12], [0.39, 0.92]]];
  const noTrack = terrainPrintStl(rectGrid, options);
  assert.deepEqual(terrainPrintStl(rectGrid, options, []), noTrack);
  const triangles = readTriangles(terrainPrintStl(rectGrid, options, tracks));
  assertSingleShell(triangles);
  assert.ok(triangles.length < 30_000);
  const vertices = triangles.flat();
  for (const x of [-79, -40, 0, 40, 79]) {
    assert.ok(vertices.some(([vx, y, z]) => Math.abs(vx - x) < 0.5 && Math.abs(y - 10.4) < 0.3 &&
      z - (3 + (vx + 80) * 0.2) > 0.65));
  }
  assert.ok(vertices.some(([x, y, z]) => x === 0 && y === 40 && z === 19));
});

test('circle clips the ridge at its edge and keeps the wraparound base connected', () => {
  const options = { shape: 'circle', widthMm: 120, baseMm: 2, rimMm: 5 };
  const triangles = readTriangles(terrainPrintStl(rectGrid, options, [[[0, 0.5], [1, 0.5]]]));
  assertSingleShell(triangles);
  const raised = triangles.flat().filter(([, , z]) => z > 2.05);
  assert.ok(raised.some(([x, y]) => Math.abs(x - 60) < 0.05 && Math.abs(y) < 0.2));
  assert.ok(raised.every(([x, y]) => Math.hypot(x, y) <= 60 + 1e-5));
  assert.deepEqual(terrainPrintStl(rectGrid, options, [[[0, 0], [0.1, 0.1]]]), terrainPrintStl(rectGrid, options));
});

test('track face colors affect only the raised ridge and preserve the printable STL geometry', () => {
  assert.equal(normalizeTerrainTrackColor(' #F00 '), '#ff0000');
  assert.equal(normalizeTerrainTrackColor('red'), '#ffb477');
  assert.deepEqual(terrainTrackPalette([' #F00 ', '#ff0001', '#ff0000']), ['#ff0000', '#ff0001', '#ffb477']);
  assert.deepEqual(terrainTrackPalette(['#ffb477', '#010203']), ['#ffb477', '#010203']);
  const options = { shape: 'rectangle', widthMm: 160, baseMm: 3, rimMm: 4 };
  const tracks = [[[0.05, 0.3], [0.95, 0.3]], [[0.05, 0.7], [0.95, 0.7]]];
  const plain = terrainPrintStl(rectGrid, options, tracks);
  const colored = terrainPrintStl(rectGrid, options, tracks, ['#f00', '#ff0001']);
  const triangles = readTriangles(colored);
  const view = new DataView(colored);
  const counts = new Map();
  triangles.forEach((vertices, i) => {
    const offset = 84 + i * 50 + 48;
    const color = view.getUint16(offset, true);
    if (!color) return;
    assert.ok([0x8000, 0x8001].includes(color));
    const centerY = color === 0x8000 ? 16 : -16;
    for (const [x, y, z] of vertices) {
      assert.ok(Math.abs(y - centerY) <= 0.508);
      assert.ok(z - (3 + (x + 80) * 0.2) >= 0.3999);
    }
    counts.set(color, (counts.get(color) ?? 0) + 1);
    view.setUint16(offset, 0, true);
  });
  assert.ok(counts.get(0x8000) > 100);
  assert.ok(counts.get(0x8001) > 100);
  assert.deepEqual(colored, plain);
});

test('the internal track palette reserves one fallback slot and rejects overflowing color indices', () => {
  const colors = Array.from({ length: 0x7fff }, (_, i) => '#' + i.toString(16).padStart(6, '0'));
  const palette = terrainTrackPalette(colors);
  assert.equal(palette.length, 0x8000);
  assert.equal(palette.at(-1), '#ffb477');
  assert.throws(() => terrainTrackPalette([...colors, '#008000']), /轨迹颜色过多/);
});
