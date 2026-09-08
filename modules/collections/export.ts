import { validateTransfer, type Transfer } from '../outdoor/exchange.ts';
import {
  PROFILE_NOTES_KEY,
  readSavedSections,
  sectionKey,
} from '../section/profileNotes.ts';
import {
  spreadsheetBytes,
  type SpreadsheetSheet,
} from '../files/spreadsheet.ts';
import { annotationSheet } from '../annotations/spreadsheet.ts';
import { CATALOG_TYPES, regionFor, type CatalogEntry } from './catalog.ts';
import type { CollectionRegions } from './regions';
import { ANNOTATION_STORAGE, parseAnnotations } from '../annotations/data.ts';
export function collectionTransfer(
  entries: CatalogEntry[],
  regions: CollectionRegions,
  storage: Pick<Storage, 'getItem'>,
): Transfer {
  if (!entries.length) throw new Error('请先选择要分享的条目');
  const sections = entries.flatMap((e) =>
    e.kind === 'section' ? [e.section] : [],
  );
  const selectedTracks = new Set(
    entries.flatMap((e) => (e.kind === 'track' ? [e.track.id] : [])),
  );
  const pins = entries.flatMap((e) =>
    'annotation' in e ? [e.annotation] : [],
  );
  if (selectedTracks.size)
    for (const pin of parseAnnotations(storage.getItem(ANNOTATION_STORAGE))) {
      if (
        pin.trackAnchor &&
        selectedTracks.has(pin.trackAnchor.trackId) &&
        !pins.some((p) => p.id === pin.id)
      )
        pins.push(pin);
    }
  const sectionNotes = sections.length
    ? readSavedSections(storage.getItem(PROFILE_NOTES_KEY)).filter((r) =>
        sections.some((s) =>
          s.settings.objectId
            ? r.settings.objectId === s.settings.objectId
            : !r.settings.objectId &&
              sectionKey(r.settings) === sectionKey(s.settings),
        ),
      )
    : [];
  return validateTransfer({
    format: 'guanyun-backup',
    version: 1,
    tracks: entries.flatMap((e) => (e.kind === 'track' ? [e.track] : [])),
    favorites: entries.flatMap((e) => (e.kind === 'route' ? [e.route] : [])),
    annotations: pins,
    sections,
    sectionNotes,
    areas: entries.flatMap((e) => (e.kind === 'area' ? [e.area] : [])),
    regions: Object.fromEntries(
      entries.flatMap((e) => {
        const r = regionFor(e, regions);
        return r ? [[e.key, r]] : [];
      }),
    ),
  });
}
export function collectionSpreadsheet(
  entries: CatalogEntry[],
  regions: CollectionRegions,
  storage: Pick<Storage, 'getItem'>,
) {
  const transfer = collectionTransfer(entries, regions, storage);
  const rows: SpreadsheetSheet['rows'] = [
    [
      '地名',
      '经度（WGS84）',
      '纬度（WGS84）',
      '类型',
      '国家',
      '省/州',
      '市',
      '地区来源',
      '说明',
      'ID',
    ],
  ];
  entries.forEach((e) => {
    const r = regionFor(e, regions);
    rows.push([
      e.name,
      ...e.coordinates,
      CATALOG_TYPES[e.kind],
      r?.country ?? '',
      r?.province ?? '',
      r?.city ?? '',
      r?.source === 'manual'
        ? '手动填写'
        : r
          ? 'Photon / OpenStreetMap'
          : '待归类',
      e.detail,
      e.key,
    ]);
  });
  const sheets: SpreadsheetSheet[] = [{ name: '收藏目录', rows }];
  if (transfer.annotations.length)
    sheets.unshift(annotationSheet(transfer.annotations, regions));
  if (transfer.sections?.length)
    sheets.push({
      name: '剖面参数',
      rows: [
        [
          'ID',
          '名称',
          '中心经度',
          '中心纬度',
          '中心海拔（m）',
          '宽（m）',
          '高（m）',
          '方向（°）',
          '倾角（°）',
          '面内转角（°）',
        ],
        ...transfer.sections.map((s) => {
          const p = s.settings.plane!;
          return [
            s.id,
            s.name,
            ...p.center,
            s.settings.altitude,
            p.width,
            p.height,
            p.heading,
            p.tilt,
            p.roll ?? 0,
          ];
        }),
      ],
    });
  if (transfer.sectionNotes?.length)
    sheets.push({
      name: '剖面测点',
      rows: [
        [
          '所属剖面ID',
          '测点ID',
          '名称',
          '经度',
          '纬度',
          '海拔（m）',
          '距离（m）',
          '采样时间',
          '备注',
          '属性数据',
        ],
        ...transfer.sectionNotes.flatMap((s) =>
          s.notes.map((n) => [
            s.settings.objectId ?? 'legacy-section',
            n.id,
            n.name,
            ...n.point.coordinates,
            n.point.altitude,
            n.point.distance,
            new Date(n.sampledAt).toISOString(),
            n.note,
            n.fields.map((f) => `${f.name}: ${f.value} ${f.unit}`).join('\n'),
          ]),
        ),
      ],
    });
  const vertices: SpreadsheetSheet['rows'] = [
    [
      '条目ID',
      '分段',
      '点序号',
      '经度（WGS84）',
      '纬度（WGS84）',
      '高程（m）',
      '时间',
    ],
  ];
  for (const e of entries) {
    if (e.kind === 'route')
      e.route.route.coordinates.forEach((p, i) =>
        vertices.push([e.key, 1, i + 1, ...p, null, '']),
      );
    if (e.kind === 'track')
      e.track.segments.forEach((segment, s) =>
        segment.forEach((p, i) => {
          const sample = e.track.samples?.[s]?.[i];
          vertices.push([
            e.key,
            s + 1,
            i + 1,
            ...p,
            sample?.altitude ?? null,
            sample?.time == null ? '' : new Date(sample.time).toISOString(),
          ]);
        }),
      );
  }
  if (vertices.length > 1) sheets.push({ name: '路线坐标', rows: vertices });
  if (transfer.areas?.length) {
    sheets.push({
      name: '区域边界',
      rows: [
        ['区域ID', '名称', '边界点序号', '经度（WGS84）', '纬度（WGS84）'],
        ...transfer.areas.flatMap((a) =>
          a.boundary.map((p, i) => [a.id, a.name, i + 1, ...p]),
        ),
      ],
    });
    sheets.push({
      name: '区域属性',
      rows: [
        ['区域ID', '名称', '属性名', '具体数据'],
        ...transfer.areas.flatMap((a) =>
          (a.attributes ?? []).map((f) => [a.id, a.name, f.name, f.value]),
        ),
      ],
    });
  }
  return spreadsheetBytes(sheets);
}
