import { freeMap } from './presets.ts';
import type { MapSource } from './types.ts';

/** Restore a selected built-in or local map only while its definition still exists. */
export function resolveAvailableMapSelection(id: string | null, maps: MapSource[]): string {
  return id && (freeMap(id) || maps.some((map) => map.id === id)) ? id : '';
}
