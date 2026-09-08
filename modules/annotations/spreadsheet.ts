import { spreadsheetBytes } from '../files/spreadsheet.ts';
import { KINDS, type Annotation } from './data.ts';
import { markerIcon } from './icons.ts';

export function annotationSheet(items: Annotation[]) {
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
      'ID',
      '名称',
      '类型',
      '图标',
      '经度（WGS84）',
      '纬度（WGS84）',
      '地面海拔（m）',
      '备注',
      ...[...headers.values()].map((s) => `属性：${s}`),
    ],
  ];
  items.forEach((a, i) =>
    rows.push([
      a.id,
      a.name,
      KINDS[a.kind],
      markerIcon(a.icon).name,
      ...a.coordinates,
      a.groundElevation,
      a.note,
      ...[...headers.keys()].map(
        (k) => fields[i].find((f) => f.key === k)?.value ?? '',
      ),
    ]),
  );
  return { name: '标记与属性', rows };
}
export const annotationSpreadsheet = (items: Annotation[]) =>
  spreadsheetBytes([annotationSheet(items)]);
