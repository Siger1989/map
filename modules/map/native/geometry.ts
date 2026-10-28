import type { Coordinate } from '../../navigation/types.ts';
import type { NativeDemTile, NativeProjectionFrame } from './types.ts';

export type NativeGeometryResult<T> =
  | { status: 'ready'; value: T }
  | { status: 'blocked'; reason: string };

export type NativeScreenPoint = { x: number; y: number; depth: number; elevationMeters: number | null };
export type NativeGroundCoordinate = { coordinate: Coordinate; elevationMeters: number | null };
export type Matrix4 = readonly number[];

const SEMI_MAJOR = 6_378_137;
const SEMI_MINOR = 6_356_752.314245;
const ECCENTRICITY_SQUARED = 1 - (SEMI_MINOR * SEMI_MINOR) / (SEMI_MAJOR * SEMI_MAJOR);
const MAX_DEM_CELLS = 1_000_000;
const MAX_DEM_BATCH_CELLS = 4_000_000;
const MAX_DEM_TILES = 256;
const DEPTH_EPSILON = 1e-7;

/** Revisioned, bounded native DEM samples used only when the host supplied real terrain data. */
export class NativeDemCache {
  private revisionValue = -1;
  private tiles: NativeDemTile[] = [];

  get revision() { return this.revisionValue; }

  replace(revision: number, tiles: readonly NativeDemTile[]): boolean {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision < this.revisionValue) return false;
    if (tiles.length > MAX_DEM_TILES || tiles.some((tile) => !validDemTile(tile)) ||
      tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0) > MAX_DEM_BATCH_CELLS) return false;
    this.tiles = tiles.map((tile) => ({ ...tile, heights: [...tile.heights] }));
    this.revisionValue = revision;
    return true;
  }

  clear(revision = this.revisionValue + 1) {
    if (!Number.isSafeInteger(revision) || revision < this.revisionValue) return false;
    this.tiles = [];
    this.revisionValue = revision;
    return true;
  }

  sample(longitude: number, latitude: number): number | null {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const lon = wrapLongitude(longitude);
    const candidates = this.tiles
      .filter((tile) => lon >= tile.west && lon <= tile.east && latitude >= tile.south && latitude <= tile.north)
      .sort((a, b) => b.width * b.height / ((b.east - b.west) * (b.north - b.south)) -
        a.width * a.height / ((a.east - a.west) * (a.north - a.south)));
    for (const tile of candidates) {
      const value = bilinear(tile, lon, latitude);
      if (value !== null) return value;
    }
    return null;
  }
}

export function wgs84ToEcef(longitude: number, latitude: number, altitudeMeters: number): [number, number, number] | null {
  if (![longitude, latitude, altitudeMeters].every(Number.isFinite) || Math.abs(latitude) > 90) return null;
  const lon = degreesToRadians(longitude), lat = degreesToRadians(latitude);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const primeVertical = SEMI_MAJOR / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLat * sinLat);
  return [
    (primeVertical + altitudeMeters) * cosLat * Math.cos(lon),
    (primeVertical + altitudeMeters) * cosLat * Math.sin(lon),
    (primeVertical * (1 - ECCENTRICITY_SQUARED) + altitudeMeters) * sinLat,
  ];
}

export function ecefToWgs84(x: number, y: number, z: number): { longitude: number; latitude: number; altitudeMeters: number } | null {
  if (![x, y, z].every(Number.isFinite)) return null;
  const p = Math.hypot(x, y);
  if (p < 1e-9 && Math.abs(z) < 1e-9) return null;
  const longitude = Math.atan2(y, x);
  if (p < 1e-8) {
    return { longitude: radiansToDegrees(longitude), latitude: z >= 0 ? 90 : -90, altitudeMeters: Math.abs(z) - SEMI_MINOR };
  }
  let latitude = Math.atan2(z, p * (1 - ECCENTRICITY_SQUARED));
  let altitude = 0;
  for (let i = 0; i < 12; i++) {
    const sinLat = Math.sin(latitude);
    const primeVertical = SEMI_MAJOR / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLat * sinLat);
    const cosLat = Math.cos(latitude);
    altitude = Math.abs(cosLat) > 1e-10 ? p / cosLat - primeVertical : z / sinLat - primeVertical * (1 - ECCENTRICITY_SQUARED);
    const next = Math.atan2(z, p * (1 - ECCENTRICITY_SQUARED * primeVertical / (primeVertical + altitude)));
    if (Math.abs(next - latitude) < 1e-13) { latitude = next; break; }
    latitude = next;
  }
  const sinLat = Math.sin(latitude);
  const primeVertical = SEMI_MAJOR / Math.sqrt(1 - ECCENTRICITY_SQUARED * sinLat * sinLat);
  const cosLat = Math.cos(latitude);
  altitude = Math.abs(cosLat) > 1e-10 ? p / cosLat - primeVertical : z / sinLat - primeVertical * (1 - ECCENTRICITY_SQUARED);
  return { longitude: radiansToDegrees(longitude), latitude: radiansToDegrees(latitude), altitudeMeters: altitude };
}

/** Column-major 4x4 inversion; returns null for malformed or singular matrices. */
export function invertMatrix4(input: Matrix4): number[] | null {
  if (input.length !== 16 || input.some((value) => !Number.isFinite(value))) return null;
  const m = input;
  const inv = new Array<number>(16);
  inv[0] = m[5]!*m[10]!*m[15]!-m[5]!*m[11]!*m[14]!-m[9]!*m[6]!*m[15]!+m[9]!*m[7]!*m[14]!+m[13]!*m[6]!*m[11]!-m[13]!*m[7]!*m[10]!;
  inv[4] = -m[4]!*m[10]!*m[15]!+m[4]!*m[11]!*m[14]!+m[8]!*m[6]!*m[15]!-m[8]!*m[7]!*m[14]!-m[12]!*m[6]!*m[11]!+m[12]!*m[7]!*m[10]!;
  inv[8] = m[4]!*m[9]!*m[15]!-m[4]!*m[11]!*m[13]!-m[8]!*m[5]!*m[15]!+m[8]!*m[7]!*m[13]!+m[12]!*m[5]!*m[11]!-m[12]!*m[7]!*m[9]!;
  inv[12] = -m[4]!*m[9]!*m[14]!+m[4]!*m[10]!*m[13]!+m[8]!*m[5]!*m[14]!-m[8]!*m[6]!*m[13]!-m[12]!*m[5]!*m[10]!+m[12]!*m[6]!*m[9]!;
  inv[1] = -m[1]!*m[10]!*m[15]!+m[1]!*m[11]!*m[14]!+m[9]!*m[2]!*m[15]!-m[9]!*m[3]!*m[14]!-m[13]!*m[2]!*m[11]!+m[13]!*m[3]!*m[10]!;
  inv[5] = m[0]!*m[10]!*m[15]!-m[0]!*m[11]!*m[14]!-m[8]!*m[2]!*m[15]!+m[8]!*m[3]!*m[14]!+m[12]!*m[2]!*m[11]!-m[12]!*m[3]!*m[10]!;
  inv[9] = -m[0]!*m[9]!*m[15]!+m[0]!*m[11]!*m[13]!+m[8]!*m[1]!*m[15]!-m[8]!*m[3]!*m[13]!-m[12]!*m[1]!*m[11]!+m[12]!*m[3]!*m[9]!;
  inv[13] = m[0]!*m[9]!*m[14]!-m[0]!*m[10]!*m[13]!-m[8]!*m[1]!*m[14]!+m[8]!*m[2]!*m[13]!+m[12]!*m[1]!*m[10]!-m[12]!*m[2]!*m[9]!;
  inv[2] = m[1]!*m[6]!*m[15]!-m[1]!*m[7]!*m[14]!-m[5]!*m[2]!*m[15]!+m[5]!*m[3]!*m[14]!+m[13]!*m[2]!*m[7]!-m[13]!*m[3]!*m[6]!;
  inv[6] = -m[0]!*m[6]!*m[15]!+m[0]!*m[7]!*m[14]!+m[4]!*m[2]!*m[15]!-m[4]!*m[3]!*m[14]!-m[12]!*m[2]!*m[7]!+m[12]!*m[3]!*m[6]!;
  inv[10] = m[0]!*m[5]!*m[15]!-m[0]!*m[7]!*m[13]!-m[4]!*m[1]!*m[15]!+m[4]!*m[3]!*m[13]!+m[12]!*m[1]!*m[7]!-m[12]!*m[3]!*m[5]!;
  inv[14] = -m[0]!*m[5]!*m[14]!+m[0]!*m[6]!*m[13]!+m[4]!*m[1]!*m[14]!-m[4]!*m[2]!*m[13]!-m[12]!*m[1]!*m[6]!+m[12]!*m[2]!*m[5]!;
  inv[3] = -m[1]!*m[6]!*m[11]!+m[1]!*m[7]!*m[10]!+m[5]!*m[2]!*m[11]!-m[5]!*m[3]!*m[10]!-m[9]!*m[2]!*m[7]!+m[9]!*m[3]!*m[6]!;
  inv[7] = m[0]!*m[6]!*m[11]!-m[0]!*m[7]!*m[10]!-m[4]!*m[2]!*m[11]!+m[4]!*m[3]!*m[10]!+m[8]!*m[2]!*m[7]!-m[8]!*m[3]!*m[6]!;
  inv[11] = -m[0]!*m[5]!*m[11]!+m[0]!*m[7]!*m[9]!+m[4]!*m[1]!*m[11]!-m[4]!*m[3]!*m[9]!-m[8]!*m[1]!*m[7]!+m[8]!*m[3]!*m[5]!;
  inv[15] = m[0]!*m[5]!*m[10]!-m[0]!*m[6]!*m[9]!-m[4]!*m[1]!*m[10]!+m[4]!*m[2]!*m[9]!+m[8]!*m[1]!*m[6]!-m[8]!*m[2]!*m[5]!;
  const determinant = m[0]!*inv[0]! + m[1]!*inv[4]! + m[2]!*inv[8]! + m[3]!*inv[12]!;
  // ECEF view-projection matrices can legitimately have determinants below 1e-20
  // because their translation/scaling terms are expressed in meters.
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  for (let i = 0; i < 16; i++) inv[i] = inv[i]! / determinant;
  return inv;
}

export function projectWgs84(
  coordinate: Coordinate,
  frame: NativeProjectionFrame | null,
  dem: NativeDemCache,
  altitudeMeters?: number,
): NativeGeometryResult<NativeScreenPoint> {
  if (!frame) return blocked('camera-frame-unavailable');
  if (!validFrame(frame)) return blocked('camera-matrix-or-viewport-invalid');
  const terrainEnabled = frame.terrainEnabled !== false;
  const factualElevation = frame.demRevision <= dem.revision ? dem.sample(coordinate[0], coordinate[1]) : null;
  if (terrainEnabled && altitudeMeters === undefined && frame.demRevision > dem.revision) return blocked('dem-cache-stale');
  if (terrainEnabled && altitudeMeters === undefined && (factualElevation === null || !Number.isFinite(factualElevation))) return blocked('dem-sample-unavailable');
  const displayElevation = terrainEnabled
    ? (altitudeMeters ?? factualElevation!) * (altitudeMeters === undefined ? (frame.verticalExaggeration ?? 1) : 1)
    : 0;
  const world = wgs84ToEcef(coordinate[0], coordinate[1], displayElevation);
  if (!world) return blocked('coordinate-invalid');
  const clip = transform(frame.viewProjection, [world[0], world[1], world[2], 1]);
  if (!clip || clip[3]! <= DEPTH_EPSILON) return blocked('behind-camera-or-projection-singular');
  const ndc = [clip[0]! / clip[3]!, clip[1]! / clip[3]!, clip[2]! / clip[3]!];
  const [vx, vy, vw, vh] = [frame.viewport.x, frame.viewport.y, frame.viewport.width, frame.viewport.height];
  return {
    status: 'ready',
    value: {
      x: ((ndc[0]! + 1) * 0.5 * vw) / frame.cssScale,
      y: ((1 - ndc[1]!) * 0.5 * vh) / frame.cssScale,
      depth: ndc[2]!,
      elevationMeters: factualElevation,
    },
  };
}

/** Unprojects through the exact host frame. Flat maps intersect the ellipsoid; terrain maps require fresh DEM. */
export function unprojectWgs84(
  point: { x: number; y: number },
  frame: NativeProjectionFrame | null,
  dem: NativeDemCache,
): NativeGeometryResult<NativeGroundCoordinate> {
  if (!frame) return blocked('camera-frame-unavailable');
  if (!validFrame(frame) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return blocked('camera-matrix-or-viewport-invalid');
  const terrainEnabled = frame.terrainEnabled !== false;
  if (terrainEnabled && frame.demRevision > dem.revision) return blocked('dem-cache-stale');
  // DOM callers pass map-local CSS pixels. Convert to physical screen space, then
  // remove the viewport origin before deriving NDC; auxiliary-pane offsets cancel.
  const px = frame.viewport.x + point.x * frame.cssScale;
  const py = frame.viewport.y + point.y * frame.cssScale;
  const ndcX = ((px - frame.viewport.x) / frame.viewport.width) * 2 - 1;
  const ndcY = 1 - ((py - frame.viewport.y) / frame.viewport.height) * 2;
  const nearZ = frame.clipDepth === 'zeroToOne' ? 0 : -1;
  const near = homogeneousPoint(frame.inverseViewProjection, [ndcX, ndcY, nearZ, 1]);
  const far = homogeneousPoint(frame.inverseViewProjection, [ndcX, ndcY, 1, 1]);
  if (!near || !far) return blocked('inverse-projection-singular');
  const direction = subtract(far, near);
  const length = Math.hypot(...direction);
  if (!(length > 0) || !Number.isFinite(length)) return blocked('projection-ray-invalid');
  const tEllipsoid = intersectEllipsoid(near, direction);
  if (tEllipsoid === null) return blocked('ray-misses-earth');
  if (!terrainEnabled) {
    const surface = addScaled(near, direction, tEllipsoid);
    const geo = ecefToWgs84(...surface);
    if (!geo) return blocked('ellipsoid-intersection-invalid');
    const elevation = frame.demRevision <= dem.revision ? dem.sample(geo.longitude, geo.latitude) : null;
    return { status: 'ready', value: { coordinate: [geo.longitude, geo.latitude], elevationMeters: elevation } };
  }
  let t = tEllipsoid;
  const sampleAt = (value: number) => {
    if (value < 0 || value > 1) return null;
    const point = addScaled(near, direction, value);
    const geo = ecefToWgs84(...point);
    if (!geo) return null;
    const ground = dem.sample(geo.longitude, geo.latitude);
    return ground === null ? null : { point, geo, ground, residual: geo.altitudeMeters - ground * (frame.verticalExaggeration ?? 1) };
  };
  for (let i = 0; i < 10; i++) {
    const sample = sampleAt(t);
    if (!sample) return blocked('dem-sample-unavailable');
    if (Math.abs(sample.residual) < 0.75) {
      return { status: 'ready', value: { coordinate: [sample.geo.longitude, sample.geo.latitude], elevationMeters: sample.ground } };
    }
    const dt = Math.max(1e-9, Math.min(1e-5, 1 / length));
    const adjacent = sampleAt(t + dt);
    if (!adjacent) return blocked('terrain-intersection-unresolved');
    const derivative = (adjacent.residual - sample.residual) / dt;
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-5) return blocked('terrain-intersection-unresolved');
    const next = t - sample.residual / derivative;
    if (!Number.isFinite(next) || next < 0 || next > 1) return blocked('terrain-intersection-outside-frame');
    t = next;
  }
  return blocked('terrain-intersection-unresolved');
}

export function matrix4Vector(matrix: Matrix4, vector: readonly number[]): number[] | null {
  if (matrix.length !== 16 || vector.length !== 4 || matrix.some((v) => !Number.isFinite(v)) || vector.some((v) => !Number.isFinite(v))) return null;
  return [
    matrix[0]!*vector[0]! + matrix[4]!*vector[1]! + matrix[8]!*vector[2]! + matrix[12]!*vector[3]!,
    matrix[1]!*vector[0]! + matrix[5]!*vector[1]! + matrix[9]!*vector[2]! + matrix[13]!*vector[3]!,
    matrix[2]!*vector[0]! + matrix[6]!*vector[1]! + matrix[10]!*vector[2]! + matrix[14]!*vector[3]!,
    matrix[3]!*vector[0]! + matrix[7]!*vector[1]! + matrix[11]!*vector[2]! + matrix[15]!*vector[3]!,
  ];
}

function transform(matrix: Matrix4, vector: readonly number[]) { return matrix4Vector(matrix, vector); }
function homogeneousPoint(matrix: Matrix4, vector: readonly number[]): [number, number, number] | null {
  const out = transform(matrix, vector);
  if (!out || Math.abs(out[3]!) < DEPTH_EPSILON) return null;
  const point: [number, number, number] = [out[0]! / out[3]!, out[1]! / out[3]!, out[2]! / out[3]!];
  return point.every(Number.isFinite) ? point : null;
}
function intersectEllipsoid(origin: readonly number[], direction: readonly number[]): number | null {
  const ox = origin[0]! / SEMI_MAJOR, oy = origin[1]! / SEMI_MAJOR, oz = origin[2]! / SEMI_MINOR;
  const dx = direction[0]! / SEMI_MAJOR, dy = direction[1]! / SEMI_MAJOR, dz = direction[2]! / SEMI_MINOR;
  const aa = dx * dx + dy * dy + dz * dz;
  const bb = 2 * (ox * dx + oy * dy + oz * dz);
  const cc = ox * ox + oy * oy + oz * oz - 1;
  const discriminant = bb * bb - 4 * aa * cc;
  if (!(aa > 0) || discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const roots = [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)].filter((value) => value >= 0 && value <= 1);
  return roots.length ? Math.min(...roots) : null;
}
function validFrame(frame: NativeProjectionFrame) {
  return Number.isSafeInteger(frame.sequence) && frame.sequence >= 0 &&
    frame.viewProjection.length === 16 && frame.inverseViewProjection.length === 16 &&
    frame.viewProjection.every(Number.isFinite) && frame.inverseViewProjection.every(Number.isFinite) &&
    [frame.viewport.x, frame.viewport.y, frame.viewport.width, frame.viewport.height, frame.cssScale].every(Number.isFinite) &&
    frame.viewport.width > 0 && frame.viewport.height > 0 && frame.cssScale > 0 &&
    (frame.verticalExaggeration === undefined || Number.isFinite(frame.verticalExaggeration) && frame.verticalExaggeration > 0 && frame.verticalExaggeration <= 100) &&
    (frame.clipDepth === 'minusOneToOne' || frame.clipDepth === 'zeroToOne');
}
function validDemTile(tile: NativeDemTile) {
  return !!tile && typeof tile.id === 'string' && tile.id.length <= 256 &&
    [tile.west, tile.south, tile.east, tile.north].every(Number.isFinite) &&
    tile.west >= -180 && tile.east <= 180 && tile.east > tile.west && tile.south >= -90 && tile.north <= 90 && tile.north > tile.south &&
    Number.isInteger(tile.width) && Number.isInteger(tile.height) && tile.width >= 2 && tile.height >= 2 &&
    tile.width * tile.height <= MAX_DEM_CELLS && tile.heights.length === tile.width * tile.height &&
    tile.heights.every((value) => value === null || (Number.isFinite(value) && Math.abs(value) <= 12_000));
}
function bilinear(tile: NativeDemTile, longitude: number, latitude: number): number | null {
  const x = (longitude - tile.west) / (tile.east - tile.west) * (tile.width - 1);
  const y = (tile.north - latitude) / (tile.north - tile.south) * (tile.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(tile.width - 1, x0 + 1), y1 = Math.min(tile.height - 1, y0 + 1);
  const values = [tile.heights[y0 * tile.width + x0], tile.heights[y0 * tile.width + x1], tile.heights[y1 * tile.width + x0], tile.heights[y1 * tile.width + x1]];
  if (values.some((value) => value === null || value === undefined)) return null;
  const tx = x - x0, ty = y - y0;
  const top = values[0]! * (1 - tx) + values[1]! * tx;
  const bottom = values[2]! * (1 - tx) + values[3]! * tx;
  return top * (1 - ty) + bottom * ty;
}
function blocked<T = never>(reason: string): NativeGeometryResult<T> { return { status: 'blocked', reason }; }
function wrapLongitude(value: number) { return ((value + 180) % 360 + 360) % 360 - 180; }
function subtract(a: readonly number[], b: readonly number[]): [number, number, number] { return [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]; }
function addScaled(a: readonly number[], b: readonly number[], t: number): [number, number, number] { return [a[0]! + b[0]! * t, a[1]! + b[1]! * t, a[2]! + b[2]! * t]; }
function degreesToRadians(value: number) { return value * Math.PI / 180; }
function radiansToDegrees(value: number) { return value * 180 / Math.PI; }
