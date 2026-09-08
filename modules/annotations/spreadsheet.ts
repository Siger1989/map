import { spreadsheetBytes } from '../files/spreadsheet.ts';
import { KINDS, type Annotation } from './data.ts';
import { markerIcon } from './icons.ts';
import {
  coordinateKey,
  type CollectionRegions,
} from '../collections/regions.ts';

export function annotationSheet(
  items: Annotation[],
  regions: CollectionRegions = {},
) {
  const linked = items.some((a) => a.trackAnchor);
  // Occurrence-indexed headers retain duplicate and temporarily unnamed fields without overwriting cells.
  const fieldsFor = (a: Annotation) => {
    const seen = new Map<string, number>();
    return (a.attributes ?? []).map((f, i) => {
      const name = f.name.trim() || `未命名属性 ${i + 1}`,
        count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      return {
        key: JSON.stringify([name, count]),
        name: count > 1 ? `${name}（${count}）` : name,
        value: f.value,
      };
    });
  };
  const fields = items.map(fieldsFor),
    headers = new Map<string, string>();
  fields.flat().forEach((f) => headers.set(f.key, f.name));
  const rows: (string | number | null)[][] = [
    [
      '地名',
      '经度（WGS84）',
      '纬度（WGS84）',
      '地面海拔（m）',
      ...[...headers.values()].map((s) => `属性：${s}`),
      '备注',
      '类型',
      '图标',
      'ID',
      '国家',
      '省/州',
      '城市',
      '区县',
      '乡镇/街道',
      '社区/村',
      '附近道路',
      ...(linked ? ['关联行程ID', '添加时距起点（m）'] : []),
    ],
  ];
  items.forEach((a, i) =>
    rows.push([
      a.name,
      ...a.coordinates,
      a.groundElevation,
      ...[...headers.keys()].map(
        (k) => fields[i].find((f) => f.key === k)?.value ?? '',
      ),
      a.note,
      KINDS[a.kind],
      markerIcon(a.icon).name,
      a.id,
      ...(() => {
        const r = regions[`annotation:${a.id}`];
        return [
          'country',
          'province',
          'city',
          'district',
          'township',
          'locality',
          'street',
        ].map((key) =>
          r?.coordinateKey === coordinateKey(a.coordinates)
            ? (r[key as keyof typeof r] ?? '')
            : '',
        );
      })(),
      ...(linked
        ? [a.trackAnchor?.trackId ?? '', a.trackAnchor?.distance ?? null]
        : []),
    ]),
  );
  return { name: '标记与属性', rows };
}
export const annotationSpreadsheet = (
  items: Annotation[],
  regions: CollectionRegions = {},
) => spreadsheetBytes([annotationSheet(items, regions)]);
