import { tileCoordinate, type TerrainTile } from './terrainMath.ts';
type Point = [number, number];
type Rectangle = [number, number, number, number];
export type ContourTile = { tile: TerrainTile; lines: number[][][] };
function childOf(a: TerrainTile, b: TerrainTile) {
  const scale = 2 ** (a.z - b.z);
  return (
    a.z > b.z &&
    Math.floor(a.x / scale) === b.x &&
    Math.floor(a.y / scale) === b.y
  );
}
function rectangle(tile: TerrainTile): Rectangle {
  const sw = tileCoordinate(tile, 0, 256),
    ne = tileCoordinate(tile, 256, 0);
  return [sw[0], sw[1], ne[0], ne[1]];
}
/** Return segment pieces outside a finer tile's footprint (Liang-Barsky interval). */
function outside(a: Point, b: Point, box: Rectangle): [Point, Point][] {
  let enter = 0,
    exit = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - box[0]],
    [dx, box[2] - a[0]],
    [-dy, a[1] - box[1]],
    [dy, box[3] - a[1]],
  ]) {
    if (Math.abs(p) < 1e-15) {
      if (q < 0) return [[a, b]];
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return [[a, b]];
  }
  const at = (t: number): Point => [a[0] + dx * t, a[1] + dy * t];
  const parts: [Point, Point][] = [];
  if (enter > 1e-10) parts.push([a, at(enter)]);
  if (exit < 1 - 1e-10) parts.push([at(exit), b]);
  return parts;
}
/** Raster DEMs mask coarse parents with finer tiles. GeoJSON contours must do the same. */
export function coveredContours(
  entry: ContourTile,
  entries: ContourTile[],
): number[][][] {
  const children = entries.filter((candidate) =>
    childOf(candidate.tile, entry.tile),
  );
  const boxes = children
    .filter(
      (candidate) =>
        !children.some((other) => childOf(candidate.tile, other.tile)),
    )
    .map((candidate) => rectangle(candidate.tile));
  if (!boxes.length) return entry.lines;
  const result: Point[][] = [];
  for (const line of entry.lines) {
    let previous: Point[] | undefined;
    for (let i = 1; i < line.length; i++) {
      let pieces: [Point, Point][] = [[line[i - 1] as Point, line[i] as Point]];
      for (const box of boxes)
        pieces = pieces.flatMap(([a, b]) => outside(a, b, box));
      for (const [a, b] of pieces) {
        const last = previous?.at(-1);
        if (
          last &&
          Math.abs(last[0] - a[0]) < 1e-10 &&
          Math.abs(last[1] - a[1]) < 1e-10
        )
          previous!.push(b);
        else {
          previous = [a, b];
          result.push(previous);
        }
      }
      if (!pieces.length) previous = undefined;
    }
  }
  return result;
}
