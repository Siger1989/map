import patterns from './templates/drill-patterns.json' with { type: 'json' };
import { projectParameters, rowsByHeader } from './xlsx.ts';
import { importIntegratedDrill } from './importIntegratedDrill.ts';
import { isIntegratedDrillSheets } from './integratedDrillSchema.ts';
import type { GeologyIssue, ImportResult, XlsxSheet, XlsxValue, XlsxWorkbook } from './types.ts';

export const DRILL_PARAMETERS = ['模板类型', '模板版本', '项目名称', '钻孔编号', '长度单位', '孔深基准', '终孔深度_m', 'Au单位', 'Pb单位', 'Zn单位'];
export const DRILL_COLUMNS: Record<string, string[]> = {
  分层: ['层号', '顶深_m', '底深_m', '岩性名称', '岩性描述', '岩心长_m', '花纹代码'],
  回次: ['回次号', '顶深_m', '底深_m', '岩心长_m'], 样品: ['样品编号', '顶深_m', '底深_m', '岩心长_m', 'Au', 'Pb', 'Zn'], 孔径: ['孔深_m', '孔径_mm'],
};
const blank = (v: unknown): boolean => v == null || (typeof v === 'string' && !v.trim());
const text = (v: unknown): string => v == null ? '' : typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v).trim();
function issue(severity: GeologyIssue['severity'], code: string, message: string, cells: string[] = []): GeologyIssue { return { severity, code, message, ...(cells.length ? { cells } : {}) }; }
function number(v: XlsxValue, at: string, issues: GeologyIssue[], required = false): number | null {
  if (blank(v)) { if (required) issues.push(issue('error', 'MISSING_GEOMETRY', `${at} 缺少必需几何值`, [at])); return null; }
  if (typeof v === 'boolean') { issues.push(issue('error', 'INVALID_NUMBER', `${at} 的 TRUE/FALSE 不是有效数字`, [at])); return null; }
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) { issues.push(issue('error', 'INVALID_NUMBER', `${at} 不是有效数字`, [at])); return null; }
  return n;
}
function failIfErrors(issues: GeologyIssue[]): void {
  const errors = issues.filter(i => i.severity === 'error');
  if (!errors.length) return;
  const e = new Error(errors.slice(0, 5).map(i => `${i.cells?.join(',') || ''} ${i.message}`).join('；')) as Error & { issues: GeologyIssue[] };
  e.issues = issues; throw e;
}
function source(sheet: string, row: number, cells: Record<string, string>): Record<string, unknown> { return { sheet, row, cells }; }
function projectRows(sheet: XlsxSheet): { params: Record<string, XlsxValue>; cells: Record<string, string> } {
  return projectParameters(sheet);
}
function dataRows(sheet: XlsxSheet | undefined, name: string, required: string[], issues: GeologyIssue[]) {
  if (!sheet) return [] as Array<{ row: number; values: Record<string, XlsxValue>; cells: Record<string, string> }>;
  const table = rowsByHeader(sheet, name);
  const duplicates = [...new Set(required.filter(h => table.headers.filter(x => x === h).length > 1))];
  const missing = required.filter(h => !table.headers.includes(h));
  if (duplicates.length) issues.push(issue('error', 'DUPLICATE_COLUMN', `${name}表存在重复列名：${duplicates.join(', ')}`, [`${name}!1:1`]));
  if (missing.length) issues.push(issue('error', 'MISSING_COLUMN', `${name}表缺少列：${missing.join(', ')}`, [`${name}!1:1`]));
  return table.rows;
}
function checkRanges(items: any[], label: string, endpoint: number | null, issues: GeologyIssue[]): void {
  const rows = items.filter(x => x.top_m != null && x.bottom_m != null);
  if (!rows.length) return;
  let cursor = 0;
  for (const x of rows) {
    const c = x.source.cells;
    if (x.bottom_m <= x.top_m) issues.push(issue('error', 'INVALID_INTERVAL', `${label}底深必须大于顶深`, [c['顶深_m'] ?? '', c['底深_m'] ?? '']));
    if (x.top_m < cursor - 1e-6) issues.push(issue('error', 'INTERVAL_OVERLAP', `${label}区间重叠或倒序`, [c['顶深_m'] ?? '']));
    else if (x.top_m > cursor + 1e-6) issues.push(issue('error', 'INTERVAL_GAP', `${label}区间存在缺段：${cursor}–${x.top_m} m`, [c['顶深_m'] ?? '']));
    cursor = Math.max(cursor, x.bottom_m);
    if (x.top_m < -1e-6 || (endpoint != null && x.bottom_m > endpoint + 1e-6)) issues.push(issue('error', 'INTERVAL_OUT_OF_RANGE', `${label}区间超出0至终孔深度`, [c['顶深_m'] ?? '', c['底深_m'] ?? '']));
  }
  if (rows[0].top_m > 1e-6 || (endpoint != null && Math.abs(cursor - endpoint) > 1e-6)) issues.push(issue('error', 'INCOMPLETE_COVERAGE', `${label}必须连续覆盖0至终孔深度`, [rows[0].source.cells['顶深_m'] ?? '', rows.at(-1).source.cells['底深_m'] ?? '']));
}
function validateId(id: string, seen: Set<string>, at: string, label: string, issues: GeologyIssue[]): void {
  if (!id) issues.push(issue('error', 'MISSING_ID', `${label}不能为空`, [at]));
  else if (seen.has(id)) issues.push(issue('error', 'DUPLICATE_ID', `${label}重复：${id}`, [at]));
  seen.add(id);
}

export function importDrill(workbook: XlsxWorkbook): ImportResult {
  if (isIntegratedDrillSheets(workbook.sheets)) return importIntegratedDrill(workbook);
  const issues: GeologyIssue[] = [...workbook.warnings];
  const project = workbook.sheets.get('项目');
  if (!project) throw new Error('规范工作簿必须包含“项目”工作表');
  const { params, cells: paramCells } = projectRows(project);
  for (const key of DRILL_PARAMETERS) if (!Object.hasOwn(params, key)) issues.push(issue('error', 'MISSING_PROJECT_PARAMETER', `项目表缺少参数：${key}`, ['项目!A:A']));
  if (text(params['模板类型']) !== '钻孔柱状图') issues.push(issue('error', 'INVALID_TEMPLATE_TYPE', '模板类型必须为“钻孔柱状图”', [paramCells['模板类型'] ?? '项目!B:B']));
  const version = params['模板版本'];
  if (!(typeof version === 'number' && version === 1 || text(version) === '1.0')) issues.push(issue('error', 'INVALID_TEMPLATE_VERSION', '模板版本必须为 1.0', [paramCells['模板版本'] ?? '项目!B:B']));
  if (text(params['长度单位']) !== 'm') issues.push(issue('error', 'INVALID_LENGTH_UNIT', '长度单位必须为 m', [paramCells['长度单位'] ?? '项目!B:B']));
  const basis = text(params['孔深基准']);
  if (!['原始沿孔深', '校正沿孔深'].includes(basis)) issues.push(issue('error', 'INVALID_DEPTH_BASIS', '孔深基准必须明确为原始沿孔深或校正沿孔深', [paramCells['孔深基准'] ?? '项目!B:B']));
  const holeId = text(params['钻孔编号']);
  if (!holeId) issues.push(issue('error', 'MISSING_HOLE_ID', '钻孔编号必填', [paramCells['钻孔编号'] ?? '项目!B:B']));
  const endpoint = number(params['终孔深度_m'] ?? null, paramCells['终孔深度_m'] ?? '项目!B:B', issues, true);
  if (endpoint != null && endpoint <= 0) issues.push(issue('error', 'INVALID_ENDPOINT', '终孔深度必须大于 0', [paramCells['终孔深度_m'] ?? '项目!B:B']));
  const recordsets: Record<string, ReturnType<typeof dataRows>> = {};
  for (const [name, columns] of Object.entries(DRILL_COLUMNS)) recordsets[name] = dataRows(workbook.sheets.get(name), name, columns, issues);
  if (!workbook.sheets.has('分层')) issues.push(issue('error', 'MISSING_LAYER_SHEET', '必需的“分层”工作表缺失', []));

  const seen = { 分层: new Set<string>(), 回次: new Set<string>(), 样品: new Set<string>() };
  const layers: any[] = [];
  for (const row of recordsets['分层']) {
    const v = row.values, c = row.cells, id = text(v['层号']);
    const top = number(v['顶深_m'], c['顶深_m'] ?? `分层!row${row.row}`, issues, true), bottom = number(v['底深_m'], c['底深_m'] ?? `分层!row${row.row}`, issues, true);
    validateId(id, seen['分层'], c['层号'] ?? `分层!A${row.row}`, '层号', issues);
    const core = number(v['岩心长_m'] ?? null, c['岩心长_m'] ?? '', issues);
    if (core != null && core < 0) issues.push(issue('error', 'NEGATIVE_CORE_LENGTH', '岩心长不能为负数', [c['岩心长_m']]));
    if (core != null && top != null && bottom != null && core > bottom - top + 1e-6) issues.push(issue('error', 'CORE_LENGTH_EXCEEDS_INTERVAL', '岩心长不能大于层段沿孔长度', [c['岩心长_m'], c['顶深_m'], c['底深_m']]));
    const thickness = top != null && bottom != null ? bottom - top : null;
    const name = text(v['岩性名称']), code = text(v['花纹代码']);
    const cells: Record<string, string> = { '层号': c['层号'], '顶深_m': c['顶深_m'], '底深_m': c['底深_m'], '岩性名称': c['岩性名称'], '岩性描述': c['岩性描述'], '岩心长_m': c['岩心长_m'], '花纹代码': c['花纹代码'] };
    layers.push({ id, top_m: top, bottom_m: bottom, thickness_m: thickness, core_m: core,
      recovery_percent: core != null && thickness != null && thickness > 0 ? core / thickness * 100 : null,
      description: text(v['岩性描述']), lithology_name: name, material_code: code, pattern_id: code || null, source: source('分层', row.row, cells) });
    if (!name) issues.push(issue('warning', 'MISSING_LITHOLOGY', '岩性名称为空，保留空白待补', [c['岩性名称']]));
  }
  if (!layers.length) issues.push(issue('error', 'EMPTY_LAYER_SHEET', '分层表至少需要一条有效分层记录', ['分层!2:2']));
  checkRanges(layers, '分层', endpoint, issues);

  const turns: any[] = [];
  for (const row of recordsets['回次']) {
    const v = row.values, c = row.cells, id = text(v['回次号']);
    const top = number(v['顶深_m'], c['顶深_m'], issues, true), bottom = number(v['底深_m'], c['底深_m'], issues, true), core = number(v['岩心长_m'], c['岩心长_m'], issues, true);
    validateId(id, seen['回次'], c['回次号'], '回次号', issues);
    if (top != null && bottom != null && bottom > top && core != null && core > bottom - top + 1e-6) issues.push(issue('error', 'CORE_LENGTH_EXCEEDS_INTERVAL', '岩心长不能大于回次段长', [c['岩心长_m']]));
    if (core != null && core < 0) issues.push(issue('error', 'NEGATIVE_CORE_LENGTH', '岩心长不能为负数', [c['岩心长_m']]));
    const length = top != null && bottom != null ? bottom - top : null;
    turns.push({ id, top_m: top, bottom_m: bottom, advance_m: length, core_m: core,
      recovery_percent: core != null && length != null && length > 0 ? core / length * 100 : null,
      source: source('回次', row.row, c) });
  }
  if (turns.length) checkRanges(turns, '回次', endpoint, issues);

  const units: Record<string, string> = { Au: text(params['Au单位']), Pb: text(params['Pb单位']), Zn: text(params['Zn单位']) };
  const samples: any[] = [];
  for (const row of recordsets['样品']) {
    const v = row.values, c = row.cells, id = text(v['样品编号']);
    const top = number(v['顶深_m'], c['顶深_m'], issues, true), bottom = number(v['底深_m'], c['底深_m'], issues, true), core = number(v['岩心长_m'] ?? null, c['岩心长_m'], issues);
    validateId(id, seen['样品'], c['样品编号'], '样品编号', issues);
    if (top != null && bottom != null && (top < 0 || (endpoint != null && bottom > endpoint))) issues.push(issue('error', 'SAMPLE_OUT_OF_RANGE', '样品区间超出孔深范围', [c['顶深_m'], c['底深_m']]));
    if (top != null && bottom != null && bottom <= top) issues.push(issue('error', 'INVALID_INTERVAL', '样品底深必须大于顶深', [c['顶深_m'], c['底深_m']]));
    if (core != null && top != null && bottom != null && core > bottom - top + 1e-6) issues.push(issue('error', 'CORE_LENGTH_EXCEEDS_INTERVAL', '岩心长不能大于样品段长', [c['岩心长_m']]));
    if (core != null && core < 0) issues.push(issue('error', 'NEGATIVE_CORE_LENGTH', '岩心长不能为负数', [c['岩心长_m']]));
    const assays: Record<string, number | null> = {};
    for (const element of ['Au', 'Pb', 'Zn']) {
      const raw = v[element];
      if (!blank(raw) && typeof raw === 'string' && /[<]|检出|低于/.test(raw)) issues.push(issue('error', 'NON_NUMERIC_ASSAY_TEXT', `${element}分析结果为原始文本“${raw}”，保留原值且不转为0；当前图形要求数值`, [c[element]]));
      const assay = number(raw ?? null, c[element], issues);
      if (assay != null && assay < 0) issues.push(issue('error', 'NEGATIVE_ASSAY', `${element}分析值不能为负数`, [c[element]]));
      if (assay != null && !units[element]) issues.push(issue('error', 'MISSING_ASSAY_UNIT', `填写了${element}分析值但未提供单位`, [c[element], paramCells[`${element}单位`] ?? '项目!B:B']));
      assays[element] = assay;
    }
    const length = top != null && bottom != null ? bottom - top : null;
    samples.push({ id, top_m: top, bottom_m: bottom, length_m: length, core_m: core,
      recovery_percent: core != null && length != null && length > 0 ? core / length * 100 : null, assays,
      source: source('样品', row.row, c) });
  }

  const structures: any[] = [];
  for (const row of recordsets['孔径']) {
    const depth = number(row.values['孔深_m'], row.cells['孔深_m'], issues, true), diameter = number(row.values['孔径_mm'], row.cells['孔径_mm'], issues, true);
    if (diameter != null && diameter <= 0) issues.push(issue('error', 'INVALID_DIAMETER', '孔径必须大于0', [row.cells['孔径_mm']]));
    if (depth != null && endpoint != null && !(depth >= 0 && depth <= endpoint)) issues.push(issue('error', 'STRUCTURE_OUT_OF_RANGE', '孔径记录深度超出孔深范围', [row.cells['孔深_m']]));
    structures.push({ depth_m: depth, diameter_mm: diameter, source: source('孔径', row.row, row.cells) });
  }
  const orderedSamples = samples.filter(s => s.top_m != null && s.bottom_m != null).sort((a, b) => a.top_m - b.top_m);
  let farthest: any = null;
  for (const s of orderedSamples) {
    if (farthest && s.top_m < farthest.bottom_m - 1e-9) {
      issues.push(issue('warning', 'OVERLAPPING_SAMPLES', `样品区间存在重叠，将分轨显示：${farthest.id} / ${s.id}`, [farthest.source.cells['顶深_m'], s.source.cells['顶深_m']])); break;
    }
    if (!farthest || s.bottom_m > farthest.bottom_m) farthest = s;
  }
  const codeMap = patterns.codes as Record<string, string>, materialMap = patterns.materials as Record<string, string>;
  const patternToCode = Object.fromEntries(Object.entries(codeMap).map(([code, id]) => [code, id]));
  for (const layer of layers) {
    const code = layer.material_code, expected = materialMap[layer.lithology_name], at = layer.source.cells['花纹代码'];
    if (code && !patternToCode[code]) issues.push(issue('error', 'UNKNOWN_PATTERN_CODE', `未配置花纹代码：${code}`, [at]));
    else if (code && expected && code !== expected) issues.push(issue('error', 'PATTERN_MATERIAL_CONFLICT', '花纹代码与精确岩性名称映射冲突', [at, layer.source.cells['岩性名称']]));
    else if (code) layer.pattern_id = patternToCode[code];
    else if (expected) { layer.material_code = expected; layer.pattern_id = patternToCode[expected]; }
    else issues.push(issue('warning', 'PENDING_PATTERN', `岩性“${layer.lithology_name || '未提供'}”无精确花纹映射，保留留白待配置`, [layer.source.cells['岩性名称']]));
  }
  failIfErrors(issues);
  samples.sort((a, b) => a.top_m - b.top_m || a.bottom_m - b.bottom_m || a.id.localeCompare(b.id));
  const normalized = { drawing_type: 'drill', schema_version: 'drill-1.0', source: { filename: workbook.filename, sha256: workbook.sha256, adapter: 'drill-1.0' },
    project: { name: text(params['项目名称']), hole_id: holeId, analysis_units: units, source_cells: paramCells },
    meta: { hole_id: holeId, endpoint_m: endpoint, depth_basis: basis }, turns, layers, samples, structures, issues,
    summary: { turns: turns.length, layers: layers.length, samples: samples.length, endpoint_m: endpoint, pending_patterns: layers.filter(l => !l.material_code).length } };
  return { normalized, issues };
}
