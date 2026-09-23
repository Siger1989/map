import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  KINDS,
  MAX_PINS,
  newAnnotation,
  validAnnotation,
  type Annotation,
} from './data.ts';
import { MAX_ATTRIBUTES, type AnnotationAttribute } from './attributes.ts';
import type { Transfer } from '../dataTransfer/types.ts';

const MAX_FILE = 8 * 1024 * 1024;
const MAX_XML = 16 * 1024 * 1024;
const ATTRIBUTE_HEADER = /^(?:属性|条目)[：:](.+)$/;
type Row = { number: number; cells: string[] };
type Issue = { row: number; message: string };
export type MarkerSpreadsheetPlan = {
  before: Transfer;
  after: Transfer;
  added: number;
  updated: number;
  unchanged: number;
  issues: Issue[];
  examples: { row: number; action: '新增' | '更新' | '不变'; name: string }[];
};

const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const decodeEntities = (value: string) => value
  .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex: string | undefined, decimal: string | undefined) => {
    const code = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
      throw new Error('Excel 包含无效字符实体');
    return String.fromCodePoint(code);
  })
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name as 'amp' | 'lt' | 'gt' | 'quot' | 'apos']);
const text = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return decodeEntities(String(value));
  if (value && typeof value === 'object' && '#text' in value)
    return text((value as { '#text': unknown })['#text']);
  return '';
};
const xml = (bytes: Uint8Array, label: string): Record<string, any> => {
  if (bytes.length > MAX_XML) throw new Error(`${label} 超过大小限制`);
  const source = strFromU8(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) || XMLValidator.validate(source) !== true)
    throw new Error(`${label} 的 XML 无效`);
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
  }).parse(source);
};
const sharedText = (item: Record<string, any>): string =>
  item.t !== undefined
    ? text(item.t)
    : list<Record<string, any>>(item.r).map((run) => text(run.t)).join('');
const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
};
const worksheetRows = (sheet: Record<string, any>, strings: string[]): Row[] => {
  const rows = list<Record<string, any>>(sheet.worksheet?.sheetData?.row);
  if (rows.length > 2001) throw new Error('Excel 超过 2000 个标记，请分批导入');
  return rows.map((row, index) => {
    const number = Number(row['@_r'] ?? index + 1);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Excel 行号无效');
    const cells: string[] = [];
    list<Record<string, any>>(row.c).forEach((cell, position) => {
      const ref = String(cell['@_r'] ?? '');
      const at = ref ? columnIndex(ref) : position;
      if (at < 0 || at > 511) throw new Error('Excel 列数超过 512 列上限');
      if (cell.f !== undefined) throw new Error(`第 ${number} 行含公式，请粘贴为值后导入`);
      const type = cell['@_t'];
      let value = type === 'inlineStr'
        ? sharedText(cell.is ?? {})
        : text(cell.v);
      if (type === 's') {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id < 0 || id >= strings.length)
          throw new Error(`第 ${number} 行引用了无效文字`);
        value = strings[id];
      }
      if (type === 'e') throw new Error(`第 ${number} 行有 Excel 错误单元格`);
      cells[at] = value;
    });
    return { number, cells };
  });
};
type Headers = {
  longitude: number;
  latitude: number;
  name: number;
  note: number;
  id: number;
  kind: number;
  attributes: { index: number; name: string; occurrence: number }[];
};
const headersFor = (row: Row): Headers | null => {
  const values = row.cells.map((value) => (value ?? '').trim());
  const normalized = values.map((value) => value.replace(/\s/g, ''));
  const find = (...names: string[]) => normalized.findIndex((value) => names.includes(value));
  const longitude = find('经度（WGS84）', '经度(WGS84)');
  const latitude = find('纬度（WGS84）', '纬度(WGS84)');
  const name = find('名称', '地名');
  if (longitude < 0 || latitude < 0 || name < 0) return null;
  const seen = new Map<string, number>();
  const attributes = values.flatMap((value, index) => {
    const match = ATTRIBUTE_HEADER.exec(value);
    if (!match) return [];
    let field = match[1].trim();
    const suffix = /^(.*)（([2-9]\d*)）$/.exec(field);
    if (suffix && seen.has(suffix[1])) field = suffix[1];
    if (!field || field.length > 60) throw new Error(`第 ${index + 1} 列条目名称无效`);
    const occurrence = (seen.get(field) ?? 0) + 1;
    seen.set(field, occurrence);
    return [{ index, name: field, occurrence }];
  });
  return {
    longitude, latitude, name,
    note: find('备注'),
    id: find('ID', 'ID（自动）', 'ID(自动)'),
    kind: find('类型'),
    attributes,
  };
};
/** Read only the marker worksheet. Other collection sheets and workbook macros are ignored. */
export function markerSpreadsheetRows(bytes: Uint8Array): Row[] {
  if (!bytes.length || bytes.length > MAX_FILE) throw new Error('Excel 文件须小于 8 MB');
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        if (total > MAX_XML) throw new Error('Excel 解压内容过大');
        return /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/i.test(entry.name);
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Excel ')) throw error;
    throw new Error('文件不是有效的 XLSX 工作簿');
  }
  const required = (path: string) => {
    const result = files[path];
    if (!result) throw new Error(`Excel 缺少 ${path}`);
    return result;
  };
  const workbook = xml(required('xl/workbook.xml'), '工作簿');
  const rels = xml(required('xl/_rels/workbook.xml.rels'), '工作表索引');
  const strings = files['xl/sharedStrings.xml']
    ? list<Record<string, any>>(xml(files['xl/sharedStrings.xml'], '共享文字').sst?.si).map(sharedText)
    : [];
  const sheets = list<Record<string, any>>(workbook.workbook?.sheets?.sheet);
  const relationships = list<Record<string, any>>(rels.Relationships?.Relationship);
  const sheetName = (sheet: Record<string, any>) => decodeEntities(String(sheet['@_name'] ?? ''));
  const ordered = [
    ...sheets.filter((sheet) => sheetName(sheet) === '标记与属性'),
    ...sheets.filter((sheet) => sheetName(sheet) !== '标记与属性' && sheetName(sheet) !== '收藏目录'),
  ];
  for (const sheet of ordered) {
    const relation = relationships.find((item) => item['@_Id'] === sheet['@_r:id']);
    if (!relation || relation['@_TargetMode'] === 'External') continue;
    const target = String(relation['@_Target'] ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (target.includes('..')) continue;
    const path = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(path) || !files[path]) continue;
    const rows = worksheetRows(xml(files[path], '标记工作表'), strings);
    if (!rows.length) continue;
    if (rows[0].cells.includes('地区来源') && rows[0].cells.includes('说明')) continue;
    if (rows[0].number === 1 && headersFor(rows[0])) return rows;
  }
  throw new Error('未找到标记工作表：首行须有经度（WGS84）、纬度（WGS84）、名称');
}
const coordinateNumber = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed))
    throw new Error(`${label}须为 WGS84 十进制度纯数字`);
  return Number(trimmed);
};
const coordinateKey = (coordinates: [number, number]) =>
  `${coordinates[0].toFixed(6)},${coordinates[1].toFixed(6)}`;

/** Plan a compare-and-swap update; no data is written until the user confirms. */
export function planMarkerSpreadsheet(rows: Row[], before: Transfer): MarkerSpreadsheetPlan {
  const header = headersFor(rows[0]);
  if (!header) throw new Error('标记表首行缺少 WGS84 经纬度或名称');
  const original = before.annotations;
  const next = [...original];
  const used = new Set<string>();
  const issues: Issue[] = [];
  const examples: MarkerSpreadsheetPlan['examples'] = [];
  let added = 0, updated = 0, unchanged = 0;
  for (const row of rows.slice(1)) {
    if (!row.cells.some((value) => (value ?? '').trim())) continue;
    try {
      const rawCell = (index: number) => index < 0 ? '' : (row.cells[index] ?? '');
      const cell = (index: number) => rawCell(index).trim();
      const longitude = coordinateNumber(cell(header.longitude), '经度');
      const latitude = coordinateNumber(cell(header.latitude), '纬度');
      if (longitude < -180 || longitude > 180 || latitude < -85 || latitude > 85)
        throw new Error('经纬度超出地图范围，请检查是否写反');
      const coordinates: [number, number] = [longitude, latitude];
      const id = cell(header.id);
      if (id.length > 100) throw new Error('ID 过长');
      let match = id ? original.find((item) => item.id === id) : undefined;
      if (!match) {
        const nearby = original.filter((item) => item.kind === 'pin' && coordinateKey(item.coordinates) === coordinateKey(coordinates));
        if (nearby.length > 1) throw new Error('同一坐标有多个已有标记，无法确定更新对象');
        match = nearby[0];
      }
      if (match && used.has(match.id)) throw new Error('同一标记在表中出现多次');
      const kind = cell(header.kind);
      if (kind && match && kind !== KINDS[match.kind]) throw new Error('类型与已有标记不符');
      if (kind && !match && kind !== KINDS.pin) throw new Error('表格仅可新建地点标记，模型须保留已有 ID');
      const name = rawCell(header.name);
      const note = rawCell(header.note);
      if (name.length > 60 || note.length > 500) throw new Error('名称或备注过长');
      const prior = match?.attributes ?? [];
      const consumed = new Set<number>();
      const attributes: AnnotationAttribute[] = [];
      for (const field of header.attributes) {
        const matching = prior.map((item, index) => item.name === field.name ? index : -1).filter((index) => index >= 0);
        const existingIndex = matching[field.occurrence - 1];
        if (existingIndex !== undefined) consumed.add(existingIndex);
        const value = rawCell(field.index);
        if (value.length > 2000) throw new Error(`条目“${field.name}”内容过长`);
        if (value.trim() || existingIndex !== undefined)
          attributes.push({ name: field.name, value: value.trim() ? value : prior[existingIndex].value });
      }
      prior.forEach((field, index) => { if (!consumed.has(index)) attributes.push(field); });
      if (attributes.length > MAX_ATTRIBUTES) throw new Error(`条目超过 ${MAX_ATTRIBUTES} 项`);
      const item: Annotation = match
        ? { ...match, coordinates, name: name.trim() ? name : match.name, note: note.trim() ? note : match.note, attributes }
        : { ...newAnnotation('pin', coordinates, null, id || crypto.randomUUID()),
            name: name.trim() ? name : KINDS.pin, note, attributes };
      if (!validAnnotation(item)) throw new Error('标记数据无效');
      if (match) {
        used.add(match.id);
        const index = next.findIndex((value) => value.id === match.id);
        if (JSON.stringify(item) === JSON.stringify(match)) unchanged++;
        else { next[index] = item; updated++; }
      } else {
        if (next.some((value) => value.id === item.id)) throw new Error('ID 重复');
        if (next.filter((value) => value.kind === 'pin').length >= MAX_PINS)
          throw new Error('地点标记达到 2000 个上限');
        if (next.some((value) => value.kind === 'pin' && coordinateKey(value.coordinates) === coordinateKey(coordinates)))
          throw new Error('本表内出现重复坐标');
        next.push(item);
        added++;
      }
      if (examples.length < 8)
        examples.push({ row: row.number, action: match ? JSON.stringify(item) === JSON.stringify(match) ? '不变' : '更新' : '新增', name: item.name });
    } catch (error) {
      issues.push({ row: row.number, message: error instanceof Error ? error.message : '行数据无效' });
    }
  }
  if (!added && !updated && !unchanged && !issues.length)
    throw new Error('标记工作表没有数据行');
  return { before, after: { ...before, annotations: next }, added, updated, unchanged, issues, examples };
}
