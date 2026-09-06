import { unzipSync, strFromU8 } from 'fflate';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import {
  parseSavedTracks,
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
    data.tracks.length > 20 ||
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
  });
}
/** Validate the entire merge before any write, roll back if a quota write fails. */
export function mergeData(
  incoming: Transfer,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
) {
  const before = collectData(storage);
  const merge = <T extends { id: string }>(a: T[], b: T[]) => [
    ...a,
    ...b
      .filter(
        (v) =>
          !a.some(
            (old) =>
              old.id === v.id && JSON.stringify(old) === JSON.stringify(v),
          ),
      )
      .map((v) =>
        a.some((old) => old.id === v.id)
          ? { ...v, id: crypto.randomUUID() }
          : v,
      ),
  ];
  const next = validateTransfer({
    ...before,
    tracks: merge(before.tracks, incoming.tracks),
    annotations: merge(before.annotations, incoming.annotations),
    favorites: merge(before.favorites, incoming.favorites),
  });
  const values = [
    [TRACK_STORAGE, next.tracks],
    [ANNOTATION_STORAGE, next.annotations],
    [FAVORITES_STORAGE, next.favorites],
  ] as const;
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
      segments,
    });
  };
  const addPin = (name: string, coordinates: Coordinate) =>
    data.annotations.push({
      ...newAnnotation('pin', coordinates, null, crypto.randomUUID()),
      name,
    });
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
      if (lines.length) addTrack(label(pm), lines);
      for (const p of elements(pm, 'Point')) {
        const list = coords(p);
        if (list.length !== 1) throw new Error('KML 点坐标无效');
        addPin(label(pm), list[0]);
      }
    }
  } else throw new Error('请选择 GPX、KML、KMZ 或观云 JSON 备份');
  if (!data.tracks.length && !data.annotations.length)
    throw new Error('文件中没有可导入的点或轨迹');
  return validateTransfer(data);
}
export function exportGPX(data: Transfer) {
  const tracks: Pick<ManualTrack, 'name' | 'segments' | 'samples'>[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Guanyun" xmlns="http://www.topografix.com/GPX/1/1">${data.annotations.map((p) => `<wpt lat="${p.coordinates[1]}" lon="${p.coordinates[0]}"><name>${escapeXML(p.name)}</name><desc>${escapeXML(p.note)}</desc></wpt>`).join('')}${tracks
    .map(
      (t) =>
        `<trk><name>${escapeXML(t.name)}</name>${t.segments
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
  const tracks: Pick<ManualTrack, 'name' | 'segments' | 'samples'>[] = [
    ...data.tracks,
    ...data.favorites.map((f) => ({
      name: f.name,
      segments: [f.route.coordinates],
    })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${data.annotations.map((p) => `<Placemark><name>${escapeXML(p.name)}</name><Point><coordinates>${p.coordinates.join(',')}</coordinates></Point></Placemark>`).join('')}${tracks.map((t) => `<Placemark><name>${escapeXML(t.name)}</name><MultiGeometry>${t.segments.map((s) => `<LineString><tessellate>1</tessellate><coordinates>${s.map((p) => p.join(',')).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry></Placemark>`).join('')}</Document></kml>`;
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
