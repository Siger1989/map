import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { GeologyIssue, XlsxRow, XlsxSheet, XlsxValue, XlsxWorkbook } from './types.ts';

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
function textContent(node: any): string {
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  let out = typeof node['#text'] === 'string' ? node['#text'] : '';
  for (const [key, value] of Object.entries(node)) if (key !== ':@' && key !== '#text') out += textContent(value);
  return out;
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
function decodeCell(cell: any, shared: string[], sheet: string): XlsxValue {
  const a = attrs(cell), address = a['@_r'] || `${sheet}!未知单元格`;
  if (direct(cell, 'f').length || descendants(cell, 'f').length) fail(`${sheet}!${address} 是公式；请粘贴计算后的值`);
  const type = a['@_t'] ?? '';
  const v = descendants(cell, 'v')[0];
  const raw = v ? textContent(v) : '';
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
  const xmlParts = zipNames.filter(name => name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels'
    || name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(name));
  try { files = unzipSync(bytes, { filter: file => xmlParts.includes(file.name) }); } catch { fail('ZIP 解压失败'); }
  const actualExpanded = Object.values(files).reduce((sum, part) => sum + part.byteLength, 0);
  if (actualExpanded > XLSX_LIMITS.expandedBytes) fail(`XML解压内容超过 ${XLSX_LIMITS.expandedBytes} 字节上限`);
  const workbookDoc = parseXml('xl/workbook.xml', files);
  const relDoc = parseXml('xl/_rels/workbook.xml.rels', files);
  const rootWorkbook = descendants(workbookDoc, 'workbook')[0];
  const rootRels = descendants(relDoc, 'Relationships')[0];
  if (!rootWorkbook || !rootRels) fail('工作簿目录或关系表缺失');
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
      const cells: Record<string, XlsxValue> = {};
      for (const cell of descendants(rowNode, 'c')) {
        const address = attrs(cell)['@_r'] || '';
        if (!/^[A-Z]+[1-9][0-9]*$/.test(address) || columnIndex(address) < 0 || columnIndex(address) >= 16_384 || rowIndex(address) !== rowNum) fail(`${name}!${address || `第${rowNum}行`} 单元格坐标无效`);
        if (Object.hasOwn(cells, address)) fail(`${name}!${address} 单元格重复`);
        cells[address] = decodeCell(cell, shared, name);
      }
      if (Object.values(cells).some(v => v !== null && v !== '')) rows.push({ row: rowNum, values: {}, cells });
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

export function rowsByHeader(sheet: XlsxSheet, sheetName: string, headerRow = 1): { headers: string[]; rows: Array<{ row: number; values: Record<string, XlsxValue>; cells: Record<string, string> }> } {
  const header = sheet.rows.find(r => r.row === headerRow);
  if (!header) fail(`${sheetName}!${headerRow} 缺少表头行`);
  const max = Math.max(-1, ...Object.keys(header.cells).map(columnIndex));
  const headers = Array.from({ length: max + 1 }, (_, i) => String(header.cells[cellAddress(i, headerRow)] ?? '').trim());
  const result = sheet.rows.filter(r => r.row > headerRow).map(r => {
    const values: Record<string, XlsxValue> = {}, cells: Record<string, string> = {};
    headers.forEach((name, i) => { if (!name) return; const addr = cellAddress(i, r.row); values[name] = r.cells[addr] ?? null; cells[name] = `${sheetName}!${addr}`; });
    return { row: r.row, values, cells };
  }).filter(r => Object.values(r.values).some(v => v !== null && v !== ''));
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
