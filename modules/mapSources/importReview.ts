import type { MapDraft, MapSource } from './types.ts';

/** Compare configuration locally; never expose the address or credentials in UI text. */
export function sameOnlineMap(a: MapDraft, b: MapDraft): boolean {
  return a.kind === 'online' && b.kind === 'online' &&
    JSON.stringify([a.tiles, a.scheme ?? 'xyz', a.tileSize, a.minzoom, a.maxzoom, a.datum ?? 'wgs84', a.ovmap?.layers]) ===
    JSON.stringify([b.tiles, b.scheme ?? 'xyz', b.tileSize, b.minzoom, b.maxzoom, b.datum ?? 'wgs84', b.ovmap?.layers]);
}

export function existingMapIndexes(drafts: MapDraft[], saved: MapSource[]): Set<number> {
  const duplicates = new Set<number>();
  const accepted: MapDraft[] = [];
  drafts.forEach((draft, index) => {
    if ([...saved, ...accepted].some(map => sameOnlineMap(draft, map))) duplicates.add(index);
    else accepted.push(draft);
  });
  return duplicates;
}
