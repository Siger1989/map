import {
  collectData,
  DATA_CHANGED,
  validateTransfer,
  type Transfer,
} from '../outdoor/exchange.ts';
import { TRACK_STORAGE } from '../tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../annotations/data.ts';
import { FAVORITES_STORAGE } from '../navigation/favorites.ts';
import { COLLECTION_STORAGE } from './data.ts';
import { REGION_STORAGE } from './regions.ts';
import { SECTION_OBJECTS_KEY } from '../section/sectionObjects.ts';
import { PROFILE_NOTES_KEY, sectionKey } from '../section/profileNotes.ts';
import { AREA_STORAGE } from '../areas/data.ts';

/** Remove only reviewed catalog keys; surviving markers and photo originals stay available. */
export function withoutEntries(before: Transfer, keys: string[]): Transfer {
  const selected = new Set(keys),
    keep = (type: string, id: string) => !selected.has(`${type}:${id}`);
  const removedSections = (before.sections ?? []).filter(
    (s) => !keep('section', s.id),
  );
  return validateTransfer({
    ...before,
    tracks: before.tracks.filter((t) => keep('track', t.id)),
    favorites: before.favorites.filter((t) => keep('route', t.id)),
    annotations: before.annotations
      .filter((a) => keep('annotation', a.id))
      .map((a) => {
        if (!a.trackAnchor || keep('track', a.trackAnchor.trackId)) return a;
        const { trackAnchor: _removed, ...pin } = a;
        return pin;
      }),
    ...(before.areas && {
      areas: before.areas.filter((a) => keep('area', a.id)),
    }),
    ...(before.sections && {
      sections: before.sections.filter((s) => keep('section', s.id)),
    }),
    ...(before.sectionNotes && {
      sectionNotes: before.sectionNotes.filter(
        (n) =>
          !removedSections.some((s) =>
            n.settings.objectId
              ? n.settings.objectId === s.id
              : !s.settings.objectId &&
                sectionKey(n.settings) === sectionKey(s.settings),
          ),
      ),
    }),
    ...(before.regions && {
      regions: Object.fromEntries(
        Object.entries(before.regions).filter(([k]) => !selected.has(k)),
      ),
    }),
    ...(before.collections && {
      collections: {
        ...before.collections,
        assignments: Object.fromEntries(
          Object.entries(before.collections.assignments).filter(
            ([k]) => !selected.has(k),
          ),
        ),
        order: before.collections.order.filter((k) => !selected.has(k)),
      },
    }),
  });
}
export function removeEntries(
  keys: string[],
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
) {
  const next = withoutEntries(collectData(storage), keys);
  const writes: [string, unknown][] = [
    [TRACK_STORAGE, next.tracks],
    [ANNOTATION_STORAGE, next.annotations],
    [FAVORITES_STORAGE, next.favorites],
  ];
  for (const [key, value] of [
    [AREA_STORAGE, next.areas],
    [SECTION_OBJECTS_KEY, next.sections],
    [PROFILE_NOTES_KEY, next.sectionNotes],
    [REGION_STORAGE, next.regions],
    [COLLECTION_STORAGE, next.collections],
  ] as [string, unknown][])
    if (value !== undefined) writes.push([key, value]);
  const originals = writes.map(([key]) => [key, storage.getItem(key)] as const);
  try {
    for (const [key, value] of writes)
      storage.setItem(key, JSON.stringify(value));
  } catch {
    for (const [key, raw] of originals) {
      try {
        raw === null ? storage.removeItem(key) : storage.setItem(key, raw);
      } catch {}
    }
    throw new Error('删除未完成，请检查本机存储后重试');
  }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(DATA_CHANGED));
  return next;
}
