import type { BrowseTile } from '../outdoor/tileCache.ts';

export type Tile = BrowseTile & { key: string };
export type Vec3 = [number, number, number];

const rad = Math.PI / 180;
const maxLatitude = 85.05112878;
const baseZoom = 9;
const detailZoom = 16;
const demMaxZoom = 12;
const maxTiles = 39;
const demSize = 256;
function divisions(tile: Tile) { return tile.z <= 10 ? 56 : 36; }

export function mercator(longitude: number, latitude: number, zoom: number) {
  const size = 2 ** zoom;
  const lat = Math.max(-maxLatitude, Math.min(maxLatitude, latitude)) * rad;
  return [
    (((longitude + 180) % 360 + 360) % 360) / 360 * size,
    Math.max(0, Math.min(size - 1e-9, (1 - Math.asinh(Math.tan(lat)) / Math.PI) * size / 2)),
  ] as const;
}

export function coordinate(x: number, y: number, zoom: number) {
  const size = 2 ** zoom;
  return [360 * x / size - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) / rad] as const;
}

export function eyeCell(longitude: number, latitude: number) {
  const [x, y] = mercator(longitude, latitude, 14);
  return `${Math.floor(2 * x)}/${Math.floor(2 * y)}`;
}

function tile(z: number, x: number, y: number): Tile {
  const size = 2 ** z;
  const wrappedX = ((x % size) + size) % size;
  return { z, x: wrappedX, y, key: `${z}/${wrappedX}/${y}` };
}

function delta(lon: number, x: number, period: number) {
  return ((lon - x + period / 2) % period + period) % period - period / 2;
}

/** One base ring and nested subdivisions, sorted from the observer out. */
export function planSatelliteTiles(longitude: number, latitude: number): Tile[] {
  const [centerX, centerY] = mercator(longitude, latitude, baseZoom);
  const size = 2 ** baseZoom;
  const startX = Math.floor(centerX);
  const startY = Math.floor(centerY);
  const leaves: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (startY + dy >= 0 && startY + dy < size) leaves.push(tile(baseZoom, startX + dx, startY + dy));
    }
  }
  function score(value: Tile) {
    const scale = 2 ** (value.z - baseZoom);
    const distanceX = delta(centerX * scale, value.x + 0.5, size * scale);
    const distanceY = centerY * scale - value.y - 0.5;
    const edge = Math.hypot(Math.max(0, Math.abs(distanceX) - .5), Math.max(0, Math.abs(distanceY) - .5));
    return { edge, center: Math.hypot(distanceX, distanceY) / scale };
  }
  while (leaves.length + 3 <= maxTiles) {
    const selected = leaves.map((value, index) => ({ value, index, ...score(value) }))
      .filter(({ value, edge }) => value.z < detailZoom && edge < 0.38)
      .sort((a, b) => (a.edge ? 1 : 0) - (b.edge ? 1 : 0) || a.value.z - b.value.z || a.center - b.center)[0];
    if (!selected) break;
    const { z, x, y } = selected.value;
    leaves.splice(selected.index, 1, tile(z + 1, 2 * x, 2 * y), tile(z + 1, 2 * x + 1, 2 * y),
      tile(z + 1, 2 * x, 2 * y + 1), tile(z + 1, 2 * x + 1, 2 * y + 1));
  }
  return leaves.sort((a, b) => score(a).center - score(b).center);
}

export function earthPosition(longitude: number, latitude: number, height: number): Vec3 {
  const longitudeRad = longitude * rad;
  const latitudeRad = latitude * rad;
  const sin = Math.sin(latitudeRad);
  const cos = Math.cos(latitudeRad);
  const major = 6_378_137;
  const eccentricitySquared = 0.00669437999014;
  const normal = major / Math.sqrt(1 - eccentricitySquared * sin * sin);
  return [
    (normal + height) * cos * Math.cos(longitudeRad),
    (normal + height) * cos * Math.sin(longitudeRad),
    (normal * (1 - eccentricitySquared) + height) * sin,
  ];
}

/** Convert the sky shader's east/north/up direction into Earth-centered axes. */
export function earthAxis(longitude: number, latitude: number, azimuth: number, altitude: number): Vec3 {
  const lng = longitude * rad;
  const lat = latitude * rad;
  const az = azimuth * rad;
  const h = altitude * rad;
  const east = Math.cos(h) * Math.sin(az);
  const north = Math.cos(h) * Math.cos(az);
  const up = Math.sin(h);
  const sinLng = Math.sin(lng), cosLng = Math.cos(lng);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  return [
    -east * sinLng - north * sinLat * cosLng + up * cosLat * cosLng,
    east * cosLng - north * sinLat * sinLng + up * cosLat * sinLng,
    north * cosLat + up * sinLat,
  ];
}

export function demTileFor(imageTile: Tile): Tile {
  const z = Math.min(imageTile.z, demMaxZoom);
  const scale = 2 ** (imageTile.z - z);
  return tile(z, Math.floor(imageTile.x / scale), Math.floor(imageTile.y / scale));
}

export function heightAtTile(imageTile: Tile, heights: Float32Array, u: number, v: number): number {
  const dem = demTileFor(imageTile);
  const scale = 2 ** (imageTile.z - dem.z);
  const parentU = (imageTile.x - dem.x * scale + u) / scale;
  const parentV = (imageTile.y - dem.y * scale + v) / scale;
  return terrainHeight(heights, parentU, parentV);
}

export function terrainHeight(heights: Float32Array, u: number, v: number): number {
  const x = Math.max(0, Math.min(demSize - 1, u * demSize - .5));
  const y = Math.max(0, Math.min(demSize - 1, v * demSize - .5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(demSize - 1, x0 + 1), y1 = Math.min(demSize - 1, y0 + 1);
  const a = heights[y0 * demSize + x0], b = heights[y0 * demSize + x1];
  const c = heights[y1 * demSize + x0], d = heights[y1 * demSize + x1];
  return (a * (1 - (x - x0)) + b * (x - x0)) * (1 - (y - y0)) +
    (c * (1 - (x - x0)) + d * (x - x0)) * (y - y0);
}

/** Same two triangles and samples as the rendered mesh, so the camera stays above its surface. */
export function surfaceHeight(tile: Tile, heights: Float32Array, u: number, v: number) {
  const steps = divisions(tile);
  const x = Math.max(0, Math.min(steps, u * steps));
  const y = Math.max(0, Math.min(steps, v * steps));
  const x0 = Math.min(steps - 1, Math.floor(x));
  const y0 = Math.min(steps - 1, Math.floor(y));
  const dx = x - x0, dy = y - y0;
  const sample = (x: number, y: number) => heightAtTile(tile, heights, x / steps, y / steps);
  const east = sample(x0 + 1, y0), south = sample(x0, y0 + 1);
  return dx + dy <= 1
    ? sample(x0, y0) * (1 - dx - dy) + east * dx + south * dy
    : sample(x0 + 1, y0 + 1) * (dx + dy - 1) + east * (1 - dy) + south * (1 - dx);
}

export function buildSatelliteMesh(tile: Tile, heights: Float32Array) {
  const meshSteps = divisions(tile);
  const [longitude, latitude] = coordinate(tile.x + .5, tile.y + .5, tile.z);
  const origin = earthPosition(longitude, latitude, 0);
  const vertices: number[] = [];
  const indices: number[] = [];
  const valid: boolean[] = [];
  const row = meshSteps + 1;
  function vertex(x: number, y: number) {
    const u = x / meshSteps, v = y / meshSteps;
    const [longitude, latitude] = coordinate(tile.x + u, tile.y + v, tile.z);
    const h = heightAtTile(tile, heights, u, v);
    const at = vertices.length / 5;
    valid.push(Number.isFinite(h));
    const [X, Y, Z] = earthPosition(longitude, latitude, Number.isFinite(h) ? h : 0);
    vertices.push(X - origin[0], Y - origin[1], Z - origin[2], u, v);
    return at;
  }
  function triangle(a: number, b: number, c: number) {
    if (valid[a] && valid[b] && valid[c]) indices.push(a, b, c);
  }
  for (let y = 0; y <= meshSteps; y++) {
    for (let x = 0; x <= meshSteps; x++) vertex(x, y);
  }
  for (let y = 0; y < meshSteps; y++) {
    for (let x = 0; x < meshSteps; x++) {
      const a = y * row + x;
      triangle(a, a + row, a + 1);
      triangle(a + 1, a + row, a + row + 1);
    }
  }
  return { origin, vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}
