import { unzipSync, strFromU8 } from 'fflate';
import { trackStyleText, readTrackStyle } from '../tracks/styleExchange.ts';
import {
  SAVED_MEASUREMENTS_KEY,
  parseSavedMeasurements,
  type SavedMeasurement,
} from '../measurement/saved.ts';
import {
  SECTION_OBJECTS_KEY,
  readSectionObjects,
  validateSectionObjects,
  type SectionObject,
} from '../section/sectionObjects.ts';
import { SAVED_SECTION_KEY } from '../section/savedSection.ts';
import {
  PROFILE_NOTES_KEY,
  readSavedSections,
  sectionKey,
  type SavedSection,
} from '../section/profileNotes.ts';
import {
  REGION_STORAGE,
  readRegions,
  validateRegions,
  type CollectionRegions,
} from '../collections/regions.ts';
import { AREA_STORAGE, parseAreas, type MapArea } from '../areas/data.ts';
import {
  COLLECTION_STORAGE,
  entriesFor,
  parseLayout,
  validateLayout,
  type CollectionLayout,
} from '../collections/data.ts';
import { mergeCollections } from '../collections/transfer.ts';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import {
  parseSavedTracks,
  MAX_SAVED_TRACKS,
  TRACK_STORAGE,
  type ManualTrack,
} from '../tracks/drawing.ts';
import {
  ANNOTATION_STORAGE,
  newAnnotation,
  parseAnnotations,
  type Annotation,
} from '../annotations/data.ts';
import {
  FAVORITES_STORAGE,
  validFavorite,
  type RouteFavorite,
} from '../navigation/favorites.ts';
export type Transfer = {
  format: 'guanyun-backup';
  version: 1;
  tracks: ManualTrack[];
  annotations: Annotation[];
  favorites: RouteFavorite[];
  collections?: CollectionLayout;
  sections?: SectionObject[];
  sectionNotes?: SavedSection[];
  regions?: CollectionRegions;
  areas?: MapArea[];
  measurements?: SavedMeasurement[];
};
export const DATA_CHANGED = 'guanyun-data-changed';
const MAX_BYTES = 8 * 1024 * 1024;
const escapeXML = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export function validateTransfer(v: unknown): Transfer {
  const data = v as Transfer;
  if (
    !data ||
    data.format !== 'guanyun-backup' ||
    data.version !== 1 ||
    !Array.isArray(data.tracks) ||
    data.tracks.length > MAX_SAVED_TRACKS ||
    !Array.isArray(data.favorites) ||
    data.favorites.length > 20 ||
    !data.favorites.every(validFavorite)
  )
    throw new Error('备份版本或格式不支持');
  if (
    parseSavedTracks(JSON.stringify(data.tracks)).length !== data.tracks.length
  )
    throw new Error('备份含无效轨迹，未导入');
  parseAnnotations(JSON.stringify(data.annotations));
  if (data.collections !== undefined) validateLayout(data.collections);
  if (data.sections !== undefined) validateSectionObjects(data.sections);
  if (data.sectionNotes !== undefined)
    readSavedSections(JSON.stringify(data.sectionNotes));
  if (data.regions !== undefined) validateRegions(data.regions);
  if (data.areas !== undefined) parseAreas(JSON.stringify(data.areas));
  if (data.measurements !== undefined)
    parseSavedMeasurements(
      JSON.stringify({ version: 1, items: data.measurements }),
    );
  for (const items of [data.tracks, data.annotations, data.favorites])
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new Error('文件含重复编号');
  return data;
}
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
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(DATA_CHANGED));
  return next;
}
export async function parseFile(file: File): Promise<Transfer> {
  if (file.size > MAX_BYTES) throw new Error('文件超过 8 MB，请先拆分');
  let text: string;
  if (/\.kmz$/i.test(file.name)) {
    let size = 0,
      count = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (!/\.kml$/i.test(f.name)) return false;
        size += f.originalSize;
        count++;
        if (size > MAX_BYTES || count > 10)
          throw new Error('KMZ 内的 KML 超过大小限制');
        return true;
      },
    });
    const names = Object.keys(files);
    if (names.length !== 1) throw new Error('请选择只含一个 KML 文档的 KMZ');
    if (files[names[0]].length > MAX_BYTES)
      throw new Error('解压后的 KML 过大');
    text = strFromU8(files[names[0]]);
  } else text = await file.text();
  if (/\.json$/i.test(file.name)) return validateTransfer(JSON.parse(text));
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('不支持带外部实体的 XML');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 文件无法解析');
  const data: Transfer = {
    format: 'guanyun-backup',
    version: 1,
    tracks: [],
    annotations: [],
    favorites: [],
  };
  const elements = (root: Document | Element, name: string) =>
    Array.from(root.getElementsByTagNameNS('*', name));
  const label = (el: Element) =>
    (
      elements(el, 'name')[0]?.textContent?.trim() ||
      file.name.replace(/\.[^.]+$/, '')
    ).slice(0, 60);
  const point = (lng: string | null, lat: string | null): Coordinate => {
    if (lng === null || lat === null || !lng.trim() || !lat.trim())
      throw new Error('坐标缺失');
    const p: Coordinate = [Number(lng), Number(lat)];
    if (!coordinate(p)) throw new Error('坐标超出地图范围');
    return p;
  };
  const addTrack = (name: string, segments: Coordinate[][]) => {
    if (!segments.length || segments.some((s) => s.length < 2))
      throw new Error('轨迹分段至少需要两个点');
    data.tracks.push({
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      source: doc.documentElement.localName === 'gpx' ? 'gpx' : 'kml',
      segments,
    });
  };
  const addPin = (name: string, coordinates: Coordinate) =>
    data.annotations.push({
      ...newAnnotation('pin', coordinates, null, crypto.randomUUID()),
      name,
    });
  const applyStyle = (element: Element) => {
    const text =
      elements(element, 'route-style')[0]?.textContent ??
      elements(element, 'Data').find(
        (e) => e.getAttribute('name') === 'shantu-route-style',
      )?.textContent;
    if (text?.trim()) {
      const track = data.tracks.at(-1)!;
      Object.assign(track, readTrackStyle(text, track.segments));
    }
  };
  if (doc.documentElement.localName === 'gpx') {
    for (const trk of elements(doc, 'trk')) {
      const lines = elements(trk, 'trkseg').map((seg) =>
        elements(seg, 'trkpt'),
      );
      addTrack(
        label(trk),
        lines.map((line) =>
          line.map((p) => point(p.getAttribute('lon'), p.getAttribute('lat'))),
        ),
      );
      data.tracks.at(-1)!.samples = lines.map((line) =>
        line.map((p) => {
          const t = elements(p, 'time')[0]?.textContent?.trim(),
            a = elements(p, 'ele')[0]?.textContent?.trim();
          const time = t ? Date.parse(t) : null,
            altitude = a ? Number(a) : null;
          if (
            (time !== null && !Number.isFinite(time)) ||
            (altitude !== null && !Number.isFinite(altitude))
          )
            throw new Error('GPX 时间或海拔无效');
          return { time, altitude };
        }),
      );
      applyStyle(trk);
    }
    for (const rte of elements(doc, 'rte'))
      addTrack(label(rte), [
        elements(rte, 'rtept').map((p) =>
          point(p.getAttribute('lon'), p.getAttribute('lat')),
        ),
      ]);
    for (const p of elements(doc, 'wpt'))
      addPin(label(p), point(p.getAttribute('lon'), p.getAttribute('lat')));
  } else if (doc.documentElement.localName === 'kml') {
    if (
      elements(doc, 'NetworkLink').length ||
      elements(doc, 'Polygon').length ||
      elements(doc, 'Track').length
    )
      throw new Error(
        '当前支持 KML 点和线；请先将面、动态轨迹或网络链接转成普通点线',
      );
    const coords = (el: Element) =>
      (elements(el, 'coordinates')[0]?.textContent?.trim() || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => {
          const v = s.split(',');
          return point(v[0] ?? null, v[1] ?? null);
        });
    for (const pm of elements(doc, 'Placemark')) {
      const lines = elements(pm, 'LineString').map(coords);
      if (lines.length) {
        addTrack(label(pm), lines);
        applyStyle(pm);
      }
      for (const p of elements(pm, 'Point')) {
        const list = coords(p);
        if (list.length !== 1) throw new Error('KML 点坐标无效');
        addPin(label(pm), list[0]);
      }
    }
  } else
    throw new Error('请选择 GPX、KML、KMZ 或山兔 JSON 备份（兼容旧版观云）');
  if (!data.tracks.length && !data.annotations.length)
    throw new Error('文件中没有可导入的点或轨迹');
  return validateTransfer(data);
}
export function exportGPX(data: Transfer) {
  const tracks: Pick<
    ManualTrack,
    'name' | 'segments' | 'samples' | 'style' | 'edgeColors' | 'colorConditions'
  >[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Guanyun" xmlns="http://www.topografix.com/GPX/1/1">${data.annotations.map((p) => `<wpt lat="${p.coordinates[1]}" lon="${p.coordinates[0]}"><name>${escapeXML(p.name)}</name><desc>${escapeXML(p.note)}</desc></wpt>`).join('')}${tracks
    .map(
      (t) =>
        `<trk><name>${escapeXML(t.name)}</name><extensions><shantu:route-style xmlns:shantu="urn:shantu:route-style:1">${escapeXML(trackStyleText(t))}</shantu:route-style></extensions>${t.segments
          .map(
            (s, i) =>
              `<trkseg>${s
                .map((p, j) => {
                  const sample = t.samples?.[i]?.[j];
                  return `<trkpt lat="${p[1]}" lon="${p[0]}">${sample?.altitude != null ? `<ele>${sample.altitude}</ele>` : ''}${sample?.time != null ? `<time>${new Date(sample.time).toISOString()}</time>` : ''}</trkpt>`;
                })
                .join('')}</trkseg>`,
          )
          .join('')}</trk>`,
    )
    .join('')}</gpx>`;
}
export function exportKML(data: Transfer) {
  const tracks: Pick<
    ManualTrack,
    'name' | 'segments' | 'samples' | 'style' | 'edgeColors' | 'colorConditions'
  >[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${data.annotations.map((p) => `<Placemark><name>${escapeXML(p.name)}</name><Point><coordinates>${p.coordinates.join(',')}</coordinates></Point></Placemark>`).join('')}${tracks.map((t) => `<Placemark><name>${escapeXML(t.name)}</name><ExtendedData><Data name="shantu-route-style"><value>${escapeXML(trackStyleText(t))}</value></Data></ExtendedData><MultiGeometry>${t.segments.map((s) => `<LineString><tessellate>1</tessellate><coordinates>${s.map((p) => p.join(',')).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`).join('')}</Document></kml>`;
}
export function saveFile(name: string, mime: string, text: string) {
  if (window.GuanyunNative) {
    window.GuanyunNative.saveFile(name, mime, text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
