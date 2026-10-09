import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { GeologyIssue, XlsxRow, XlsxSheet, XlsxValue, XlsxWorkbook } from './types.ts';
import { INTEGRATED_DRILL_HEADERS, isIntegratedDrillHeaderSet } from './integratedDrillSchema.ts';

export const XLSX_LIMITS = { compressedBytes: 20 * 1024 * 1024, expandedBytes: 64 * 1024 * 1024, rowsPerWorkbook: 10_000 } as const;
const decoder = new TextDecoder('utf-8', { fatal: true });
const xml = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false });

function fail(message: string): never { throw new Error(`XLSX：${message}`); }
function local(name: string): string { return name.split(':').at(-1) ?? name; }
function attrs(node: any): Record<string, string> { return node?.[':@'] ?? {}; }
function direct(node: any, wanted: string): any[] {
  if (!node || typeof node !== 'object') return [];
  const out: any[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === ':@' || key === '#text' || local(key) !== wanted) continue;
    out.push({ [key]: value, ...(node[':@'] ? { ':@': node[':@'] } : {}) });
  }
  return out;
}
function descendants(node: any, wanted: string): any[] {
  const out = direct(node, wanted);
  if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) {
    if (key === ':@' || key === '#text') continue;
    for (const child of Array.isArray(value) ? value : [value]) out.push(...descendants(child, wanted));
  }
  return out;
}
function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    if (code === 'amp') return '&'; if (code === 'lt') return '<'; if (code === 'gt') return '>';
    if (code === 'quot') return '"'; if (code === 'apos') return "'";
    const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}
function textContent(node: any): string {
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (typeof node === 'string') return unescapeXml(node);
  if (typeof node !== 'object') return '';
  let out = typeof node['#text'] === 'string' ? node['#text'] : '';
  for (const [key, value] of Object.entries(node)) if (key !== ':@' && key !== '#text') out += textContent(value);
  return unescapeXml(out);
}
function parseXml(file: string, entries: Record<string, Uint8Array>): any {
  const bytes = entries[file];
  if (!bytes) fail(`缺少文件 ${file}`);
  const source = decoder.decode(bytes);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) fail(`${file} 包含不支持的 DOCTYPE/ENTITY`);
  try { return xml.parse(source); } catch { fail(`${file} XML 无法解析`); }
}
function checkZip(bytes: Uint8Array): string[] {
  if (bytes.byteLength > XLSX_LIMITS.compressedBytes) fail(`压缩文件超过 ${XLSX_LIMITS.compressedBytes} 字节上限`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 65_557); i <= bytes.length - 22; i++) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) eocd = i;
  }
  if (eocd < 0) fail('ZIP中央目录缺失或文件已损坏');
  const disk = view.getUint16(eocd + 4, true), cdDisk = view.getUint16(eocd + 6, true);
  const entries = view.getUint16(eocd + 10, true), cdSize = view.getUint32(eocd + 12, true), cdStart = view.getUint32(eocd + 16, true);
  if (disk || cdDisk || entries === 0xffff || cdSize === 0xffffffff || cdStart === 0xffffffff) fail('不支持分卷ZIP或ZIP64');
  if (cdStart + cdSize > eocd || entries > 4096) fail('ZIP中央目录范围异常');
  let offset = cdStart, expanded = 0;
  const names = new Set<string>();
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) fail('ZIP中央目录条目损坏');
    const flags = view.getUint16(offset + 8, true), compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true), n = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    if (flags & 1) fail('不支持加密工作簿');
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) fail('不支持ZIP64条目');
    const start = offset + 46;
    if (start + n + extra + comment > bytes.length) fail('ZIP目录文件名越界');
    let name: string;
    try { name = decoder.decode(bytes.subarray(start, start + n)); } catch { fail('ZIP文件名不是有效UTF-8'); }
    const normalized = name.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(p => p === '..' || p === '.')) fail(`ZIP路径越界：${name}`);
    if (names.has(normalized)) fail(`ZIP存在重名文件：${name}`);
    names.add(normalized);
    expanded += uncompressed;
    if (expanded > XLSX_LIMITS.expandedBytes) fail(`解压内容超过 ${XLSX_LIMITS.expandedBytes} 字节上限`);
    offset = start + n + extra + comment;
  }
  if (offset !== cdStart + cdSize) fail('ZIP中央目录长度不匹配');
  return [...names];
}
const BUILTIN_DATE_FORMATS = new Set([14,15,16,17,18,19,20,21,22,27,28,29,30,31,32,33,34,35,36,45,46,47,50,51,52,53,54,55,56,57,58]);
function customFormatIsDate(format: string): boolean {
  const visible = format.replace(/"(?:[^"]|"")*"|\\.|\[[^\]]*\]/g, '').toLowerCase();
  return /y|d|h|s/.test(visible) || /m\s*[-/]/.test(visible) || /[-/]\s*m/.test(visible);
}
function dateStyleIndexes(stylesXml: any): Set<number> {
  if (!stylesXml) return new Set();
  const customFormats = new Map<number, string>();
  for (const node of descendants(stylesXml, 'numFmt')) {
    const a = attrs(node), id = Number(a['@_numFmtId']);
    if (Number.isInteger(id) && a['@_formatCode']) customFormats.set(id, a['@_formatCode']);
  }
  const cellXfs = descendants(stylesXml, 'cellXfs')[0];
  const xfs = cellXfs ? descendants(cellXfs, 'xf') : [];
  const result = new Set<number>();
  xfs.forEach((node, index) => {
    const id = Number(attrs(node)['@_numFmtId'] ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || customFormats.has(id) && customFormatIsDate(customFormats.get(id)!)) result.add(index);
  });
  return result;
}
function excelDate(serial: number, date1904: boolean): string {
  const day = Math.floor(serial), fraction = serial - day;
  if (!date1904 && day === 60) {
    const time = Math.round(fraction * 86_400_000);
    const date = `1900-02-29`;
    if (time <= 0) return date;
    const hours = Math.floor(time / 3_600_000), minutes = Math.floor(time % 3_600_000 / 60_000), seconds = Math.floor(time % 60_000 / 1_000), millis = time % 1_000;
    return `${date}T${[hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')}${millis ? `.${String(millis).padStart(3, '0')}` : ''}Z`;
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const correctedDays = !date1904 && day > 60 ? day - 1 : day;
  const value = new Date(epoch + correctedDays * 86_400_000 + Math.round(fraction * 86_400_000));
  if (!Number.isFinite(value.getTime())) fail('日期序列超出可解析范围');
  const date = value.toISOString();
  return fraction === 0 ? date.slice(0, 10) : date.replace(/\.000Z$/, 'Z');
}
function knownIntegratedDateCell(sheet: string, address: string, headers: Record<string, string[]>): boolean {
  const row = rowIndex(address), col = columnIndex(address);
  if (sheet === '钻孔基本信息' && row === 5 && (col === 1 || col === 3)) return true;
  if (sheet === '孔深校正及弯曲度' && row === 30 && (col === 4 || col === 10)) return true;
  if (sheet === '图签' && row === 10 && col === 1) return true;
  if (sheet === '样品测试结果' && row > 5) {
    const dateCol = headers[sheet]?.indexOf('检测日期') ?? -1;
    return dateCol >= 0 && dateCol === col;
  }
  return false;
}
function decodeCell(cell: any, shared: string[], sheet: string, allowFormula = false, formulas?: Record<string, string>, dateStyles = new Set<number>(), date1904 = false, dateField = false): XlsxValue {
  const a = attrs(cell), address = a['@_r'] || `${sheet}!未知单元格`;
  const formulaNode = descendants(cell, 'f')[0];
  if (formulaNode) {
    if (!allowFormula) fail(`${sheet}!${address} 是公式；请粘贴计算后的值`);
    if (formulas) formulas[address] = textContent(formulaNode);
  }
  const type = a['@_t'] ?? '';
  const v = descendants(cell, 'v')[0];
  const raw = v ? textContent(v) : '';
  if (type === 'd') {
    if (!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(raw)) fail(`${sheet}!${address} 日期文本无效`);
    return raw;
  }
  if (type === 'inlineStr') {
    const is = descendants(cell, 'is')[0];
    return is ? descendants(is, 't').map(textContent).join('') : '';
  }
  if (type === 's') {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) fail(`${sheet}!${address} shared string 索引无效`);
    return shared[index];
  }
  if (type === 'str') return raw === '' ? '' : raw;
  if (type === 'b') return raw === '1';
  if (type === 'e') fail(`${sheet}!${address} 是 Excel 错误值 ${raw}`);
  if (raw === '') return null;
  const number = Number(raw);
  if (!Number.isFinite(number)) fail(`${sheet}!${address} 数字无效`);
  const style = Number(a['@_s'] ?? 0);
  if (dateStyles.has(style) || dateField) return excelDate(number, date1904);
  return number;
}
function columnIndex(address: string): number {
  const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n - 1;
}
function rowIndex(address: string): number {
  const n = Number(address.match(/\d+$/)?.[0]);
  return Number.isInteger(n) ? n : -1;
}
function pathForTarget(target: string): string {
  const original = target.replaceAll('\\', '/');
  const path = original.startsWith('/') ? original.slice(1) : `xl/${original}`;
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (!parts.length) fail('工作表关系路径越界'); parts.pop(); }
    else parts.push(p);
  }
  const result = parts.join('/');
  if (!result.startsWith('xl/worksheets/')) fail(`工作表关系不指向 xl/worksheets：${target}`);
  return result;
}

export async function parseXlsx(buffer: ArrayBuffer, filename: string): Promise<XlsxWorkbook> {
  const bytes = new Uint8Array(buffer);
  const zipNames = checkZip(bytes);
  let files: Record<string, Uint8Array>;
  const xmlParts = zipNames.filter(name => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'xl/styles.xml'
    || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  try { files = unzipSync(bytes, { filter: file => xmlParts.includes(file.name) }); } catch { fail('ZIP 解压失败'); }
  const actualExpanded = Object.values(files).reduce((sum, part) => sum + part.byteLength, 0);
  if (actualExpanded > XLSX_LIMITS.expandedBytes) fail(`XML解压内容超过 ${XLSX_LIMITS.expandedBytes} 字节上限`);
  const workbookDoc = parseXml('xl/workbook.xml', files);
  const relDoc = parseXml('xl/_rels/workbook.xml.rels', files);
  const rootWorkbook = descendants(workbookDoc, 'workbook')[0];
  const rootRels = descendants(relDoc, 'Relationships')[0];
  if (!rootWorkbook || !rootRels) fail('工作簿目录或关系表缺失');
  const workbookProperties = descendants(rootWorkbook, 'workbookPr')[0];
  const date1904Value = attrs(workbookProperties)['@_date1904'];
  const date1904 = date1904Value === '1' || date1904Value?.toLowerCase() === 'true';
  const dateStyles = dateStyleIndexes(files['xl/styles.xml'] ? parseXml('xl/styles.xml', files) : null);
  const relationship = new Map<string, string>();
  for (const rel of descendants(rootRels, 'Relationship')) {
    const a = attrs(rel);
    if (a['@_TargetMode'] === 'External') fail('工作表关系不能指向外部文件');
    if (a['@_Id'] && a['@_Target']) {
      if (relationship.has(a['@_Id'])) fail(`工作簿关系编号重复：${a['@_Id']}`);
      relationship.set(a['@_Id'], a['@_Target']);
    }
  }
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const stringsDoc = parseXml('xl/sharedStrings.xml', files);
    for (const si of descendants(stringsDoc, 'si')) shared.push(descendants(si, 't').map(textContent).join(''));
  }
  const workbookSheetNodes = descendants(rootWorkbook, 'sheet');
  const sheetNames = workbookSheetNodes.map((node: any) => attrs(node)['@_name'] || '');
  const headerValues: Record<string, string[]> = {};
  for (const node of workbookSheetNodes) {
    const a = attrs(node), name = a['@_name'] || '', id = a['@_r:id'], target = id ? relationship.get(id) : undefined;
    const spec = INTEGRATED_DRILL_HEADERS[name];
    if (!spec || !target) continue;
    const doc = parseXml(pathForTarget(target), files), sheetData = descendants(descendants(doc, 'worksheet')[0], 'sheetData')[0];
    const headerRow = descendants(sheetData, 'row').find((row: any) => Number(attrs(row)['@_r']) === spec.row);
    const cells = headerRow ? descendants(headerRow, 'c') : [];
    let max = -1;
    for (const cell of cells) max = Math.max(max, columnIndex(attrs(cell)['@_r'] || ''));
    const byAddress = new Map(cells.map((cell: any) => [attrs(cell)['@_r'], decodeCell(cell, shared, name)]));
    headerValues[name] = Array.from({ length: max + 1 }, (_, i) => String(byAddress.get(cellAddress(i, spec.row)) ?? '').trim()).filter(Boolean);
  }
  const integratedTemplate = isIntegratedDrillHeaderSet(sheetNames, headerValues);
  const sheets = new Map<string, XlsxSheet>();
  const seenSheetNames = new Set<string>();
  let totalRows = 0;
  for (const sheetNode of descendants(rootWorkbook, 'sheet')) {
    const a = attrs(sheetNode), name = a['@_name'] || '', id = a['@_r:id'];
    const target = id ? relationship.get(id) : undefined;
    if (!name || !target) fail(`工作表名称/关系缺失：${name || '未命名'}`);
    if (seenSheetNames.has(name)) fail(`工作簿工作表名称重复：${name}`);
    seenSheetNames.add(name);
    const path = pathForTarget(target);
    const doc = parseXml(path, files);
    const sheetRoot = descendants(doc, 'worksheet')[0];
    const sheetData = sheetRoot && descendants(sheetRoot, 'sheetData')[0];
    if (!sheetRoot || !sheetData) fail(`${name} 工作表数据缺失`);
    const rows: XlsxRow[] = [];
    const seenRowNums = new Set<number>();
    for (const rowNode of descendants(sheetData, 'row')) {
      const rowNum = Number(attrs(rowNode)['@_r']);
      if (!Number.isInteger(rowNum) || rowNum < 1 || rowNum > XLSX_LIMITS.rowsPerWorkbook) fail(`${name} 行号超出 1–${XLSX_LIMITS.rowsPerWorkbook} 限制`);
      if (seenRowNums.has(rowNum)) fail(`${name}!第${rowNum}行重复`);
      seenRowNums.add(rowNum);
      totalRows++;
      if (totalRows > XLSX_LIMITS.rowsPerWorkbook) fail(`工作簿总行数超过 ${XLSX_LIMITS.rowsPerWorkbook} 限制`);
      const cells: Record<string, XlsxValue> = {}, formulas: Record<string, string> = {};
      for (const cell of descendants(rowNode, 'c')) {
        const address = attrs(cell)['@_r'] || '';
        if (!/^[A-Z]+[1-9][0-9]*$/.test(address) || columnIndex(address) < 0 || columnIndex(address) >= 16_384 || rowIndex(address) !== rowNum) fail(`${name}!${address || `第${rowNum}行`} 单元格坐标无效`);
        if (Object.hasOwn(cells, address)) fail(`${name}!${address} 单元格重复`);
        cells[address] = decodeCell(cell, shared, name, integratedTemplate, formulas, dateStyles, date1904,
          integratedTemplate && knownIntegratedDateCell(name, address, headerValues));
      }
      if (Object.values(cells).some(v => v !== null && v !== '') || Object.keys(formulas).length) rows.push({ row: rowNum, values: {}, cells, ...(Object.keys(formulas).length ? { formulas } : {}) });
    }
    sheets.set(name, { name, rows });
  }
  if (!sheets.size) fail('工作簿没有工作表');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
  return { filename, sheets, sha256, warnings: [] as GeologyIssue[] };
}

export function cellAddress(column: number, row: number): string {
  let n = column + 1, letters = '';
  while (n) { const rem = (n - 1) % 26; letters = String.fromCharCode(65 + rem) + letters; n = Math.floor((n - 1) / 26); }
  return `${letters}${row}`;
}

export function rowsByHeader(sheet: XlsxSheet, sheetName: string, headerRow = 1): { headers: string[]; rows: Array<{ row: number; values: Record<string, XlsxValue>; cells: Record<string, string>; formulas: Record<string, string> }> } {
  const header = sheet.rows.find(r => r.row === headerRow);
  if (!header) fail(`${sheetName}!${headerRow} 缺少表头行`);
  const max = Math.max(-1, ...Object.keys(header.cells).map(columnIndex));
  const headers = Array.from({ length: max + 1 }, (_, i) => String(header.cells[cellAddress(i, headerRow)] ?? '').trim());
  const result = sheet.rows.filter(r => r.row > headerRow).map(r => {
    const values: Record<string, XlsxValue> = {}, cells: Record<string, string> = {}, formulas: Record<string, string> = {};
    headers.forEach((name, i) => { if (!name) return; const addr = cellAddress(i, r.row); values[name] = r.cells[addr] ?? null; cells[name] = `${sheetName}!${addr}`; if (r.formulas?.[addr] !== undefined) formulas[name] = r.formulas[addr]; });
    return { row: r.row, values, cells, formulas };
  }).filter(r => Object.values(r.values).some(v => v !== null && v !== '') || Object.keys(r.formulas).length > 0);
  return { headers, rows: result };
}

export function projectParameters(sheet: XlsxSheet): { params: Record<string, XlsxValue>; cells: Record<string, string> } {
  const table = rowsByHeader(sheet, '项目');
  if (table.headers[0] !== '参数' || table.headers[1] !== '值') fail('项目!A1/B1 必须为“参数”/“值”');
  const params: Record<string, XlsxValue> = {}, cells: Record<string, string> = {};
  for (const row of table.rows) {
    const key = String(row.values['参数'] ?? '').trim();
    if (!key) continue;
    if (Object.hasOwn(params, key)) fail(`项目!A${row.row} 参数“${key}”重复`);
    params[key] = row.values['值'] ?? null;
    cells[key] = row.cells['值'];
  }
  return { params, cells };
}
