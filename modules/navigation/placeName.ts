import { coordinate, metresBetween, type Coordinate } from './types.ts';

export type PlaceName = { region: string; local: string; full: string };
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 120) : '';
const join = (values: unknown[]) =>
  [...new Set(values.map(text).filter(Boolean))].join(' · ');

/** City/administrative context of a nearby OSM feature; never use a shop as the region name. */
export function normalizePlaceName(
  input: unknown,
  center: Coordinate,
): PlaceName | null {
  const features = (input as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) throw new Error('Invalid place response');
  for (const feature of features) {
    const f = feature as {
      geometry?: { coordinates?: unknown };
      properties?: Record<string, unknown>;
    } | null;
    const p = f?.properties,
      at = f?.geometry?.coordinates;
    if (!p || !coordinate(at) || metresBetween(center, at) > 11000) continue;
    const ownPlace =
      (p.osm_key === 'place' && p.osm_value !== 'postcode') ||
      (p.osm_key === 'boundary' && p.osm_value === 'administrative')
        ? text(p.name)
        : '';
    const region = join([p.country, p.state]);
    const local =
      join([p.city || p.county, p.district]) ||
      ownPlace ||
      text(p.state) ||
      text(p.country);
    const full = join([
      p.country,
      p.state,
      p.county,
      p.city,
      p.district,
      ownPlace,
    ]);
    if (local || region)
      return {
        local: local || region,
        region: region || local,
        full: full || local,
      };
  }
  return null;
}

/** ~1 km grid avoids sending precise device coordinates and repeated local queries. */
export function placeCenter(center: Coordinate): Coordinate | null {
  if (!center.every(Number.isFinite) || Math.abs(center[1]) > 90) return null;
  const lng = ((((center[0] + 180) % 360) + 360) % 360) - 180;
  return [Number(lng.toFixed(2)), Number(center[1].toFixed(2))];
}
