import type { Coordinate } from '../../navigation/types.ts';

export type MapScaleMark = { meters: number; width: number; label: string };

/** Haversine ground distance between two real coordinates, including longitude wrap. */
export function groundDistanceMeters(a: Coordinate, b: Coordinate): number | null {
  if (![...a, ...b].every(Number.isFinite) || Math.abs(a[1]) > 90 || Math.abs(b[1]) > 90) return null;
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians, lat2 = b[1] * radians;
  const dLat = (b[1] - a[1]) * radians;
  const dLon = ((((b[0] - a[0]) % 360) + 540) % 360 - 180) * radians;
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distance = 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, hav))));
  return Number.isFinite(distance) && distance > 0 ? distance : null;
}

/** A 1/2/5 ground-distance tick that always fits the actual sampled span. */
export function makeMapScaleMark(metersAcross: number | null, maxWidth = 72): MapScaleMark | null {
  if (metersAcross === null || !Number.isFinite(metersAcross) || metersAcross <= 0 || !Number.isFinite(maxWidth) || maxWidth <= 0) return null;
  const magnitude = 10 ** Math.floor(Math.log10(metersAcross));
  const units = metersAcross / magnitude;
  const meters = (units >= 5 ? 5 : units >= 2 ? 2 : 1) * magnitude;
  const display = meters >= 1000 ? meters / 1000 : meters;
  const value = display >= 1 ? String(Math.round(display)) : String(Number(display.toPrecision(2)));
  return { meters, width: maxWidth * meters / metersAcross, label: `${value} ${meters >= 1000 ? 'km' : 'm'}` };
}
