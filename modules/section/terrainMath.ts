/** Terrarium stores true metres, independently of relief exaggeration. */
export function decodeTerrain(data: Uint8ClampedArray): Float32Array {
  const heights = new Float32Array(data.length / 4);
  for (let i = 0; i < heights.length; i++) {
    const p = i * 4;
    heights[i] = data[p + 3]
      ? data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768
      : NaN;
  }
  return heights;
}

/** The remaining solid is z <= min(original surface, cut altitude). */
export function clippedTerrain(
  heights: Float32Array,
  altitude: number,
): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray(heights.length * 4);
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) throw new Error('地形瓦片含缺测值');
    const encoded = Math.round(
      (Math.max(-32768, Math.min(32767.996, heights[i], altitude)) + 32768) *
        256,
    );
    const p = i * 4;
    result[p] = Math.floor(encoded / 65536);
    result[p + 1] = Math.floor(encoded / 256) % 256;
    result[p + 2] = encoded % 256;
    result[p + 3] = 255;
  }
  return result;
}

type Point = [number, number];
type Vertex = [number, number, number];
export type TerrainTile = { z: number; x: number; y: number };
export function tileCoordinate(
  tile: TerrainTile,
  px: number,
  py: number,
): Point {
  const n = 2 ** tile.z;
  return [
    ((tile.x + px / 256) / n) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + py / 256)) / n))) *
      180) /
      Math.PI,
  ];
}

/** Marching triangles: linear crossings, no false outlines along tile borders. */
export function terrainEdges(
  heights: Float32Array,
  tile: TerrainTile,
  altitude: number,
): Point[][] {
  const lines: Point[][] = [];
  const triangle = (a: Vertex, b: Vertex, c: Vertex) => {
    if (![a[2], b[2], c[2]].every(Number.isFinite)) return;
    const points: Point[] = [];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (p[2] >= altitude === q[2] >= altitude) continue;
      const t = (altitude - p[2]) / (q[2] - p[2]);
      points.push(
        tileCoordinate(
          tile,
          p[0] + (q[0] - p[0]) * t,
          p[1] + (q[1] - p[1]) * t,
        ),
      );
    }
    if (
      points.length === 2 &&
      (points[0][0] !== points[1][0] || points[0][1] !== points[1][1])
    )
      lines.push(points);
  };
  for (let y = 0; y < 255; y += 2)
    for (let x = 0; x < 255; x += 2) {
      const xx = Math.min(255, x + 2),
        yy = Math.min(255, y + 2);
      const h0 = heights[y * 256 + x],
        h1 = heights[y * 256 + xx],
        h2 = heights[yy * 256 + xx],
        h3 = heights[yy * 256 + x];
      if (
        h0 >= altitude === h1 >= altitude &&
        h0 >= altitude === h2 >= altitude &&
        h0 >= altitude === h3 >= altitude
      )
        continue;
      const a: Vertex = [x + 0.5, y + 0.5, heights[y * 256 + x]];
      const b: Vertex = [xx + 0.5, y + 0.5, heights[y * 256 + xx]];
      const c: Vertex = [xx + 0.5, yy + 0.5, heights[yy * 256 + xx]];
      const d: Vertex = [x + 0.5, yy + 0.5, heights[yy * 256 + x]];
      triangle(a, b, c);
      triangle(a, c, d);
    }
  return joinEdges(lines);
}

/** Join triangle fragments into continuous contours before sending them to the map worker. */
function joinEdges(segments: Point[][]): Point[][] {
  const key = (p: Point) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
  const adjacent = new Map<string, number[]>();
  segments.forEach((line, index) =>
    line.forEach((p) => {
      const k = key(p);
      const indices = adjacent.get(k) ?? [];
      indices.push(index);
      adjacent.set(k, indices);
    }),
  );
  const used = new Set<number>(),
    paths: Point[][] = [];
  const walk = (start: Point, index: number) => {
    const path: Point[] = [start];
    while (!used.has(index)) {
      used.add(index);
      const edge = segments[index],
        end = key(edge[0]) === key(path.at(-1)!) ? edge[1] : edge[0];
      path.push(end);
      const next = adjacent
        .get(key(end))
        ?.find((candidate) => !used.has(candidate));
      if (next === undefined) break;
      index = next;
    }
    // Drop collinear intermediate points: one slope boundary can be one line instead of 256 objects.
    const simplified: Point[] = [];
    for (const point of path) {
      while (simplified.length > 1) {
        const a = simplified.at(-2)!,
          b = simplified.at(-1)!;
        const cross =
          (b[0] - a[0]) * (point[1] - b[1]) - (b[1] - a[1]) * (point[0] - b[0]);
        if (Math.abs(cross) > 1e-18) break;
        simplified.pop();
      }
      simplified.push(point);
    }
    paths.push(simplified);
  };
  // Open paths first, then closed loops.
  segments.forEach((line, index) => {
    if (used.has(index)) return;
    const end = line.find((p) => adjacent.get(key(p))?.length === 1);
    if (end) walk(end, index);
  });
  segments.forEach((line, index) => {
    if (!used.has(index)) walk(line[0], index);
  });
  return paths;
}
