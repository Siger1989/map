import { Observer, Rotation_EQJ_HOR, Rotation_GAL_EQJ, type RotationMatrix } from 'astronomy-engine';
import catalog from './constellations.catalog.json' with { type: 'json' };
import type { SkyDirection, SkyObserver } from './astronomy.ts';

export { drawConstellations } from './constellationsDrawing.ts';
export type { ConstellationDrawOptions } from './constellationsDrawing.ts';

export type StarVector = readonly [number, number, number];
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

function unit(ra: number, dec: number): StarVector {
  const latitude = dec * radians, longitude = ra * radians, radius = Math.cos(latitude);
  return [radius * Math.cos(longitude), radius * Math.sin(longitude), Math.sin(latitude)];
}

function normalize(x: number, y: number, z: number): StarVector {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function rotated(vector: StarVector, rotation: RotationMatrix): StarVector {
  const [x, y, z] = vector, m = rotation.rot;
  return [x*m[0][0] + y*m[1][0] + z*m[2][0], x*m[0][1] + y*m[1][1] + z*m[2][1],
    x*m[0][2] + y*m[1][2] + z*m[2][2]];
}

function localVector(vector: StarVector, rotation: RotationMatrix): StarVector {
  // Astronomy Engine HOR uses north, west, up. The map camera uses east, north, up.
  const [north, west, up] = rotated(vector, rotation);
  return [-west, north, up];
}

function skyDirection(vector: StarVector): SkyDirection {
  return {azimuthDeg: (Math.atan2(vector[0], vector[1]) * degrees + 360) % 360,
    altitudeDeg: Math.asin(Math.max(-1, Math.min(1, vector[2]))) * degrees};
}

const stars = catalog.stars.map(([hip, ra, dec, mag, bv]) => ({
  hip: hip!, eq: unit(ra!, dec!), magnitude: mag!,
  color: bv != null && bv > 1.1 ? '#ffd3a5' : bv != null && bv < .24 ? '#c8e0ff' : '#f1eee3',
}));
const indexByHip = new Map(stars.map((star, i) => [star.hip, i]));
const nodes: StarVector[] = stars.map(star => star.eq);

function subdivide(a: number, b: number) {
  const v = nodes[a], w = nodes[b];
  const angle = Math.acos(Math.max(-1, Math.min(1, v[0]*w[0] + v[1]*w[1] + v[2]*w[2]))) * degrees;
  const count = Math.max(1, Math.ceil(angle / 1.5));
  const path = [a];
  for (let j = 1; j < count; j++) {
    const t = j / count;
    path.push(nodes.length);
    nodes.push(normalize(v[0]*(1-t) + w[0]*t, v[1]*(1-t) + w[1]*t, v[2]*(1-t) + w[2]*t));
  }
  path.push(b);
  return path;
}

export const constellationFigures = catalog.constellations.map(({id, name, latin, lines}) => {
  const memberIndices = [...new Set(lines.flat())].map(hip => indexByHip.get(hip)!);
  const sums = memberIndices.reduce((sum, i) => sum.map((v, k) => v + nodes[i][k]), [0, 0, 0]);
  const center = normalize(sums[0], sums[1], sums[2]);
  const score = (i: number) => nodes[i][0]*center[0] + nodes[i][1]*center[1] + nodes[i][2]*center[2];
  // Aim at an actual figure member, including for the disjoint head and tail of Serpens.
  const anchor = memberIndices.reduce((a, b) => score(a) > score(b) ? a : b);
  const paths = lines.map(line => {
    const first = indexByHip.get(line[0])!;
    const result = [first];
    for (let i = 1; i < line.length; i++) {
      const connection = subdivide(result[result.length - 1], indexByHip.get(line[i])!);
      result.push(...connection.slice(1));
    }
    return result;
  });
  return {id, name, latin, anchor, paths, members:memberIndices, nodeIndices:[...new Set(paths.flat())]};
});

export const constellationOptions = constellationFigures.map(({id, name, latin}) => ({id, name, latin}));
export const catalogStars = stars.map(({magnitude, color}) => ({magnitude, color}));
export const equatorialNodes: readonly StarVector[] = nodes;
const figureById = new Map(constellationFigures.map(figure => [figure.id, figure]));
const galacticPole = rotated([0, 0, 1], Rotation_GAL_EQJ());
const galacticZero = rotated([1, 0, 0], Rotation_GAL_EQJ());
const galacticEast = rotated([0, 1, 0], Rotation_GAL_EQJ());
const galacticCenter = unit(266.41683, -29.0078); // Sgr A*, ICRS.

export interface ConstellationFrame {
  vectors: readonly StarVector[];
  directions: readonly SkyDirection[];
  equatorialAxis(local:StarVector): StarVector;
  directionOf(index:number): SkyDirection;
  zenithEquatorial: StarVector;
  galacticPole: StarVector;
  galacticZero: StarVector;
  galacticEast: StarVector;
  galacticCenter: StarVector;
  galacticCenterDirection: SkyDirection;
}

function horizontalRotation(timeMs: number, observer: SkyObserver) {
  return Rotation_EQJ_HOR(new Date(timeMs), new Observer(observer.latitude, observer.longitude, observer.elevationM ?? 0));
}

let cache: {time: number; latitude: number; longitude: number; frame: ConstellationFrame} | undefined;

/** Convert the fixed J2000 vectors once per time/location, independently of sensor or render frequency. */
export function createConstellationFrame(timeMs: number, observer: SkyObserver): ConstellationFrame {
  const time = Math.floor(timeMs / 1000) * 1000;
  if (cache && cache.time === time && cache.latitude === observer.latitude && cache.longitude === observer.longitude) return cache.frame;
  const rotation = horizontalRotation(time, observer);
  const center = localVector(galacticCenter, rotation);
  const m=rotation.rot;
  const equatorialAxis=([east,north,up]:StarVector):StarVector => [
    north*m[0][0]-east*m[0][1]+up*m[0][2],
    north*m[1][0]-east*m[1][1]+up*m[1][2],
    north*m[2][0]-east*m[2][1]+up*m[2][2],
  ];
  const cachedDirections: SkyDirection[]=[];
  const directionOf=(i:number) => cachedDirections[i] ??= skyDirection(localVector(nodes[i],rotation));
  let vectors:StarVector[]|undefined, directions:SkyDirection[]|undefined;
  const frame:ConstellationFrame = {
    equatorialAxis,directionOf,zenithEquatorial:equatorialAxis([0,0,1]),
    get vectors(){return vectors ??= nodes.map(node=>localVector(node,rotation));},
    get directions(){return directions ??= nodes.map((_,i)=>directionOf(i));},
    galacticPole: localVector(galacticPole,rotation),galacticZero:localVector(galacticZero,rotation),galacticEast:localVector(galacticEast,rotation),
    galacticCenter: center, galacticCenterDirection: skyDirection(center),
  };
  cache = {time, latitude: observer.latitude, longitude: observer.longitude, frame};
  return frame;
}

export function getConstellationTarget(frame: ConstellationFrame, id: string): SkyDirection | null {
  if (id === 'milky-way') return frame.galacticCenterDirection;
  const figure = figureById.get(id);
  return figure ? frame.directionOf(figure.anchor) : null;
}

/** Single-target visibility searches do not project the whole catalog. */
export function getConstellationDirection(timeMs: number, observer: SkyObserver, id: string): SkyDirection | null {
  const figure = figureById.get(id);
  const target = id === 'milky-way' ? galacticCenter : figure ? nodes[figure.anchor] : null;
  return target ? skyDirection(localVector(target, horizontalRotation(timeMs, observer))) : null;
}
