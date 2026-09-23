import { reverseRegion } from '../navigation/provider.ts';
import {
  coordinateKey,
  type CollectionRegion,
  type CollectionRegions,
} from '../collections/regions.ts';
import type { Annotation } from './data.ts';

/** Resolve only missing export columns; a failed lookup never blocks the spreadsheet. */
export async function spreadsheetRegions(
  items: Annotation[],
  saved: CollectionRegions,
  signal: AbortSignal = AbortSignal.timeout(15_000),
  lookup: typeof reverseRegion = reverseRegion,
) {
  const regions = { ...saved };
  let lookups = 0;
  let unresolved = 0;
  for (const item of items) {
    const key = `annotation:${item.id}`;
    const coordinate = coordinateKey(item.coordinates);
    const prior = regions[key];
    if (prior?.coordinateKey === coordinate && (prior.country || prior.province || prior.city)) continue;
    if (lookups >= 20 || signal.aborted) { unresolved++; continue; }
    lookups++;
    try {
      const data = await lookup(item.coordinates, signal);
      if (!data.country && !data.province && !data.city) { unresolved++; continue; }
      regions[key] = {
        ...data,
        coordinateKey: coordinate,
        source: 'auto',
        language: 'local',
        checkedAt: Date.now(),
      } satisfies CollectionRegion;
    } catch {
      unresolved++;
    }
  }
  return { regions, unresolved };
}
