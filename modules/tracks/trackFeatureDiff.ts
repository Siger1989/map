import type { FeatureCollection } from 'geojson';

type Feature = FeatureCollection['features'][number];

/** The track renderer uses flat primitive properties and Point/MultiLineString geometry. */
export function sameTrackFeature(a: Feature, b: Feature) {
  if (a.id !== b.id || a.geometry.type !== b.geometry.type) return false;
  const left = a.properties ?? {}, right = b.properties ?? {};
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length || keys.some(key => left[key] !== right[key])) return false;
  if (a.geometry.type === 'Point' && b.geometry.type === 'Point') {
    return samePosition(a.geometry.coordinates, b.geometry.coordinates);
  }
  if (a.geometry.type !== 'MultiLineString' || b.geometry.type !== 'MultiLineString') return false;
  const lines = a.geometry.coordinates, next = b.geometry.coordinates;
  return lines.length === next.length && lines.every((line, i) =>
    line.length === next[i].length && line.every((point, j) => samePosition(point, next[i][j])));
}

function samePosition(a: number[], b: number[]) {
  return a === b || (a.length === b.length && a.every((value, i) => value === b[i]));
}
