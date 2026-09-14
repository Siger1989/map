import {
  SAVED_MEASUREMENTS_KEY,
  parseSavedMeasurements,
} from '../measurement/saved.ts';
import {
  SECTION_OBJECTS_KEY,
  readSectionObjects,
} from '../section/sectionObjects.ts';
import { SAVED_SECTION_KEY } from '../section/savedSection.ts';
import {
  PROFILE_NOTES_KEY,
  readSavedSections,
  sectionKey,
  type SavedSection,
} from '../section/profileNotes.ts';
import { REGION_STORAGE, readRegions } from '../collections/regions.ts';
import { AREA_STORAGE, parseAreas } from '../areas/data.ts';
import {
  COLLECTION_STORAGE,
  entriesFor,
  parseLayout,
} from '../collections/data.ts';
import { mergeCollections } from '../collections/transfer.ts';
import { TRACK_STORAGE } from '../tracks/drawing.ts';
import { ANNOTATION_STORAGE } from '../annotations/data.ts';
import { FAVORITES_STORAGE } from '../navigation/favorites.ts';
import { DATA_CHANGED, type Transfer } from './types.ts';
import { validateTransfer } from './validation.ts';
export function collectData(
  storage: Pick<Storage, 'getItem'> = localStorage,
): Transfer {
  return validateTransfer({
    format: 'guanyun-backup',
    version: 1,
    tracks: JSON.parse(storage.getItem(TRACK_STORAGE) ?? '[]'),
    annotations: JSON.parse(storage.getItem(ANNOTATION_STORAGE) ?? '[]'),
    favorites: JSON.parse(storage.getItem(FAVORITES_STORAGE) ?? '[]'),
    ...(storage.getItem(SAVED_MEASUREMENTS_KEY) === null
      ? {}
      : {
          measurements: parseSavedMeasurements(
            storage.getItem(SAVED_MEASUREMENTS_KEY),
          ),
        }),
    ...(storage.getItem(AREA_STORAGE) === null
      ? {}
      : { areas: parseAreas(storage.getItem(AREA_STORAGE)) }),
    ...(storage.getItem(PROFILE_NOTES_KEY) === null
      ? {}
      : {
          sectionNotes: readSavedSections(storage.getItem(PROFILE_NOTES_KEY)),
        }),
    ...(storage.getItem(REGION_STORAGE) === null
      ? {}
      : { regions: readRegions(storage.getItem(REGION_STORAGE)) }),
    ...(storage.getItem(COLLECTION_STORAGE) === null
      ? {}
      : { collections: parseLayout(storage.getItem(COLLECTION_STORAGE)) }),
    ...(storage.getItem(SECTION_OBJECTS_KEY) === null &&
    storage.getItem(SAVED_SECTION_KEY) === null
      ? {}
      : {
          sections: readSectionObjects(
            storage.getItem(SECTION_OBJECTS_KEY),
            storage.getItem(SAVED_SECTION_KEY),
          ),
        }),
  });
}
/** Validate the entire merge before any write, roll back if a quota write fails. */
export function mergeData(
  incoming: Transfer,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
  notify = true,
) {
  validateTransfer(incoming);
  const before = collectData(storage);
  const importedKeys = new Map<string, string>();
  const changedSectionIds = new Set(
    (incoming.sections ?? [])
      .filter((s) =>
        before.sections?.some(
          (old) => old.id === s.id && JSON.stringify(old) !== JSON.stringify(s),
        ),
      )
      .map((s) => s.id),
  );
  const linkedCopies = new Set(
    incoming.annotations
      .filter(
        (a) =>
          a.sectionAnchor && changedSectionIds.has(a.sectionAnchor.sectionId),
      )
      .map((a) => a.id),
  );
  const merge = <T extends { id: string }>(a: T[], b: T[], kind?: string) => [
    ...a,
    ...b
      .filter((v) => {
        const same =
          !(kind === 'annotation' && linkedCopies.has(v.id)) &&
          a.some(
            (old) =>
              old.id === v.id && JSON.stringify(old) === JSON.stringify(v),
          );
        if (same && kind)
          importedKeys.set(`${kind}:${v.id}`, `${kind}:${v.id}`);
        return !same;
      })
      .map((v) => {
        const next = a.some((old) => old.id === v.id)
          ? { ...v, id: crypto.randomUUID() }
          : v;
        if (kind) importedKeys.set(`${kind}:${v.id}`, `${kind}:${next.id}`);
        return next;
      }),
  ];
  const mergedTracks = merge(before.tracks, incoming.tracks, 'track');
  const incomingIds = new Set(
    [...importedKeys]
      .filter(([key]) => key.startsWith('track:'))
      .map(([, value]) => value.slice(6)),
  );
  const next = validateTransfer({
    ...before,
    tracks: mergedTracks.map((t) =>
      !before.tracks.includes(t) && incomingIds.has(t.id) && t.sourceTrackIds
        ? {
            ...t,
            sourceTrackIds: t.sourceTrackIds.flatMap((id) => {
              const mapped = importedKeys.get(`track:${id}`);
              return mapped ? [mapped.slice(6)] : [];
            }),
          }
        : t,
    ),
    annotations: merge(
      before.annotations,
      incoming.annotations.map((a) => {
        if (!a.trackAnchor) return a;
        const mapped = importedKeys.get(`track:${a.trackAnchor.trackId}`);
        if (mapped)
          return {
            ...a,
            trackAnchor: { ...a.trackAnchor, trackId: mapped.slice(6) },
          };
        // A standalone imported pin must not attach to an unrelated local track with a colliding ID.
        const { trackAnchor: _anchor, ...pin } = a;
        return pin;
      }),
      'annotation',
    ),
    ...(before.areas || incoming.areas
      ? { areas: merge(before.areas ?? [], incoming.areas ?? [], 'area') }
      : {}),
    favorites: merge(before.favorites, incoming.favorites, 'route'),
    ...(before.measurements || incoming.measurements
      ? {
          measurements: merge(
            before.measurements ?? [],
            incoming.measurements ?? [],
            'measurement',
          ),
        }
      : {}),
    ...(before.sections || incoming.sections
      ? {
          sections: merge(
            before.sections ?? [],
            (incoming.sections ?? []).map((s) => {
              const line = s.settings.survey;
              if (!line) return s;
              const remap = (id: string) =>
                id === 'A' || id === 'B'
                  ? id
                  : (importedKeys.get(`annotation:${id}`)?.slice(11) ?? id);
              return {
                ...s,
                settings: {
                  ...s.settings,
                  survey: {
                    ...line,
                    stations: line.stations.map((p) => ({
                      ...p,
                      id: remap(p.id),
                    })),
                    ...(line.pointData
                      ? {
                          pointData: Object.fromEntries(
                            Object.entries(line.pointData).map(([id, p]) => [
                              remap(id),
                              p,
                            ]),
                          ),
                        }
                      : {}),
                  },
                },
              };
            }),
            'section',
          ).map((s) =>
            s.settings.objectId && s.settings.objectId !== s.id
              ? { ...s, settings: { ...s.settings, objectId: s.id } }
              : s,
          ),
        }
      : {}),
    collections: mergeCollections(
      before.collections,
      incoming.collections,
      importedKeys,
      new Map(
        entriesFor(incoming.favorites, incoming.tracks).map((e) => [
          e.key,
          e.defaultGroup,
        ]),
      ),
    ),
  });
  if (incoming.regions) {
    next.regions = { ...before.regions };
    for (const [key, region] of Object.entries(incoming.regions)) {
      const mapped = importedKeys.get(key);
      if (mapped && !next.regions[mapped]) next.regions[mapped] = region;
    }
  }
  // Both ID maps are now complete. Standalone markers must not bind to unrelated local sections.
  for (const source of incoming.annotations) {
    if (!source.sectionAnchor) continue;
    const id = importedKeys.get(`annotation:${source.id}`)?.slice(11),
      sectionId = importedKeys
        .get(`section:${source.sectionAnchor.sectionId}`)
        ?.slice(8);
    next.annotations = next.annotations.map((a) => {
      if (a.id !== id || before.annotations.includes(a)) return a;
      if (sectionId)
        return {
          ...a,
          sectionAnchor: {
            ...source.sectionAnchor!,
            sectionId,
            ...(source.sectionAnchor!.stationId
              ? {
                  stationId:
                    importedKeys
                      .get(`annotation:${source.sectionAnchor!.stationId}`)
                      ?.slice(11) ?? source.sectionAnchor!.stationId,
                }
              : {}),
          },
        };
      const { sectionAnchor: _anchor, ...detached } = a;
      return detached;
    });
  }
  if (incoming.sectionNotes) {
    next.sectionNotes = [...(before.sectionNotes ?? [])];
    for (const record of incoming.sectionNotes) {
      const owner = incoming.sections?.find((s) =>
        s.settings.objectId
          ? s.settings.objectId === record.settings.objectId
          : !record.settings.objectId &&
            sectionKey(s.settings) === sectionKey(record.settings),
      );
      if (!owner) continue;
      const mapped = importedKeys.get(`section:${owner.id}`)?.slice(8);
      if (!mapped) continue;
      const settings =
        mapped === owner.id
          ? record.settings
          : { ...record.settings, objectId: mapped };
      const object = next.sections?.find((s) => s.id === mapped);
      if (object && mapped !== owner.id)
        object.settings = { ...object.settings, objectId: mapped };
      const old: SavedSection | undefined = next.sectionNotes.find(
        (s) => sectionKey(s.settings) === sectionKey(settings),
      );
      if (!old) next.sectionNotes.push({ ...record, settings });
      else {
        const notes: SavedSection['notes'] = [...old.notes];
        for (const note of record.notes) {
          if (notes.some((n) => JSON.stringify(n) === JSON.stringify(note)))
            continue;
          notes.push(
            notes.some((n) => n.id === note.id)
              ? { ...note, id: crypto.randomUUID() }
              : note,
          );
        }
        next.sectionNotes = next.sectionNotes.map(
          (s): SavedSection => (s === old ? { ...s, notes } : s),
        );
      }
    }
  }
  validateTransfer(next);
  const values: [string, unknown][] = [
    [TRACK_STORAGE, next.tracks],
    [ANNOTATION_STORAGE, next.annotations],
    [FAVORITES_STORAGE, next.favorites],
  ];
  if (next.collections) values.push([COLLECTION_STORAGE, next.collections]);
  if (next.sections) values.push([SECTION_OBJECTS_KEY, next.sections]);
  if (next.sectionNotes) values.push([PROFILE_NOTES_KEY, next.sectionNotes]);
  if (next.regions) values.push([REGION_STORAGE, next.regions]);
  if (next.areas) values.push([AREA_STORAGE, next.areas]);
  if (next.measurements)
    values.push([
      SAVED_MEASUREMENTS_KEY,
      { version: 1, items: next.measurements },
    ]);
  const originals = values.map(([key]) => [key, storage.getItem(key)] as const);
  try {
    for (const [key, data] of values)
      storage.setItem(key, JSON.stringify(data));
  } catch (e) {
    for (const [key, raw] of originals) {
      try {
        raw === null ? storage.removeItem(key) : storage.setItem(key, raw);
      } catch {}
    }
    throw new Error('存储不足，导入未完成；请检查原存档并释放空间');
  }
  if (notify && typeof window !== 'undefined')
    window.dispatchEvent(new Event(DATA_CHANGED));
  return next;
}
