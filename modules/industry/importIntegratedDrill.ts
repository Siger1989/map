import { INTEGRATED_DRILL_HEADERS, integratedDrillVersion } from './integratedDrillSchema.ts';
import drillPatterns from './templates/drill-patterns.json' with { type: 'json' };
import { rowsByHeader } from './xlsx.ts';
import type { GeologyIssue, ImportResult, XlsxSheet, XlsxValue, XlsxWorkbook } from './types.ts';

const blank = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
const txt = (value: unknown) => value == null ? '' : String(value).trim();
const isSet = (value: unknown) => !blank(value);
const issue = (severity: GeologyIssue['severity'], code: string, message: string, cells: string[] = []): GeologyIssue => ({ severity, code, message, ...(cells.length ? { cells } : {}) });

function asNumber(value: XlsxValue, at: string, issues: GeologyIssue[], required = false): number | null {
  if (blank(value)) { if (required) issues.push(issue('error', 'MISSING_GEOMETRY', `${at} 缺少必需手填几何值`, [at])); return null; }
  if (typeof value === 'boolean') { issues.push(issue('error', 'INVALID_NUMBER', `${at} 不是有效数字`, [at])); return null; }
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) { issues.push(issue('error', 'INVALID_NUMBER', `${at} 不是有效数字`, [at])); return null; }
  return parsed;
}

function rawValues(row: { values: Record<string, XlsxValue> }, ignored: string[] = []) {
  return Object.fromEntries(Object.entries(row.values).filter(([key]) => !ignored.includes(key)));
}
function formulaMetadata(row: { formulas?: Record<string, string>; cells: Record<string, string> }) {
  return Object.fromEntries(Object.entries(row.formulas ?? {}).map(([key, formula]) => [key, { cell: row.cells[key], formula }]));
}
function source(sheet: string, row: number, cells: Record<string, string>, raw: Record<string, unknown>, formulas: Record<string, unknown> = {}, derived?: Record<string, unknown>) {
  return { sheet, row, cells, raw, ...(Object.keys(formulas).length ? { formulas } : {}), ...(derived ? { derived } : {}) };
}
function table(sheet: XlsxSheet, name: string) {
  const headerRow = INTEGRATED_DRILL_HEADERS[name].row;
  return rowsByHeader(sheet, name, headerRow);
}
function meaningful(row: { values: Record<string, XlsxValue>; formulas?: Record<string, string> }, fields: string[]) {
  return fields.some(field => !blank(row.values[field]) && !row.formulas?.[field]);
}
function handValue(row: { values: Record<string, XlsxValue>; formulas?: Record<string, string>; cells: Record<string, string> }, field: string, issues: GeologyIssue[]): XlsxValue {
  if (row.formulas?.[field] !== undefined) {
    issues.push(issue('error', 'FORMULA_VALUE', `${row.cells[field]}（${field}）为公式；请填写原始值，适配器不会执行公式`, [row.cells[field]]));
    return null;
  }
  return row.values[field] ?? null;
}
function cellsFromRow(sheet: XlsxSheet, row: number, labels: Record<string, string>) {
  return Object.fromEntries(Object.entries(labels).map(([label, address]) => [label, `${sheet.name}!${address}${row}`]));
}
function valAt(sheet: XlsxSheet, address: string): XlsxValue {
  return sheet.rows.find(row => row.row === Number(address.match(/\d+$/)?.[0]))?.cells[address] ?? null;
}
function formulaAt(sheet: XlsxSheet, address: string) {
  return sheet.rows.find(row => row.row === Number(address.match(/\d+$/)?.[0]))?.formulas?.[address];
}
function valueCell(sheet: XlsxSheet, address: string, issues: GeologyIssue[], requiredLabel?: string): XlsxValue {
  const formula = formulaAt(sheet, address);
  if (formula) issues.push(issue('error', 'FORMULA_IN_MANUAL_FIELD', `${sheet.name}!${address} 必须填写手动值，不能使用公式`, [`${sheet.name}!${address}`]));
  const value = valAt(sheet, address);
  if (requiredLabel && blank(value)) issues.push(issue('error', 'MISSING_REQUIRED_FIELD', `${requiredLabel}必填`, [`${sheet.name}!${address}`]));
  return formula ? null : value;
}
function includeErrors(issues: GeologyIssue[]) {
  const errors = issues.filter(item => item.severity === 'error');
  if (!errors.length) return;
  const error = new Error(errors.slice(0, 6).map(item => `${item.cells?.join(',') ?? ''} ${item.message}`).join('；')) as Error & { issues: GeologyIssue[] };
  error.issues = issues;
  throw error;
}

export function importIntegratedDrill(workbook: XlsxWorkbook): ImportResult {
  const templateVersion = integratedDrillVersion(workbook.sheets);
  if (!templateVersion) throw new Error('不是 2026-10-09 钻孔资料整合模板（工作表或字段表头不匹配）');
  const isV3 = templateVersion === 'v3';
  const issues = [...workbook.warnings];
  const basicSheet = workbook.sheets.get('钻孔基本信息')!;
  const fieldLabels: Record<string, string> = {
    矿区: 'B4', 线号: 'D4', 钻孔编号: 'F4', 项目名称: 'H4', 开孔日期: 'B5', 终孔日期: 'D5',
    '终孔深度_m': 'F5', 孔深基准: 'H5', '设计方位角_deg': 'B6', '倾角_deg': 'D6', 'X坐标_m': 'F6', 'Y坐标_m': 'H6',
    '孔口标高_m': 'B7', 坐标系: 'D7', 角度定义: 'F7', 比例尺分母: 'H7', 备注: 'B8',
  };
  const basicInfo: Record<string, unknown> = { fields: {}, source_cells: {} };
  for (const [label, address] of Object.entries(fieldLabels)) {
    const required = ['钻孔编号', '终孔深度_m', '孔深基准'].includes(label) ? label : undefined;
    const value = valueCell(basicSheet, address, issues, required);
    (basicInfo.fields as Record<string, unknown>)[label] = value;
    (basicInfo.source_cells as Record<string, string>)[label] = `钻孔基本信息!${address}`;
  }
  const holeId = txt((basicInfo.fields as any).钻孔编号), projectName = txt((basicInfo.fields as any).项目名称);
  const endpoint = asNumber((basicInfo.fields as any)['终孔深度_m'] as XlsxValue, '钻孔基本信息!F5', issues, true);
  if (endpoint != null && endpoint <= 0) issues.push(issue('error', 'INVALID_ENDPOINT', '终孔深度必须大于0', ['钻孔基本信息!F5']));
  if (!['原始沿孔深', '校正沿孔深'].includes(txt((basicInfo.fields as any).孔深基准))) issues.push(issue('error', 'INVALID_DEPTH_BASIS', '孔深基准需明确填写原始沿孔深或校正沿孔深', ['钻孔基本信息!H5']));
  const basicSummary: Record<string, unknown> = {};
  for (let row = 12; row <= 15; row++) for (const [labelCol, valueCol] of [['A','B'],['C','D'],['E','F'],['G','H']]) {
    const label = txt(valAt(basicSheet, `${labelCol}${row}`));
    if (!label) continue;
    const address = `${valueCol}${row}`, formula = formulaAt(basicSheet, address);
    basicSummary[label] = { value: valAt(basicSheet, address), formula: formula ?? null, source: `钻孔基本信息!${address}` };
  }
  basicInfo.summary = basicSummary;

  const layerSheet = workbook.sheets.get('分层-原始记录')!, layerTable = table(layerSheet, '分层-原始记录');
  const layerData = layerTable.rows.filter(row => meaningful(row, layerTable.headers.filter(h => !['序号','分层采取率_pct（计算）'].includes(h))));
  const layers: any[] = [];
  const seenLayers = new Set<string>();
  let layerTop = 0;
  if (!layerData.length) issues.push(issue('error', 'EMPTY_LAYER_SHEET', '缺少有效分层记录；请填写“分层-原始记录”后再生成钻孔图', ['分层-原始记录!B6:Q25']));
  for (const row of layerData) {
    const v = row.values, c = row.cells;
    const id = txt(handValue(row, '层号', issues));
    if (!id) issues.push(issue('error', 'MISSING_ID', '层号不能为空', [c['层号']]));
    if (id && seenLayers.has(id)) issues.push(issue('error', 'DUPLICATE_ID', `层号重复：${id}`, [c['层号']]));
    seenLayers.add(id);
    const bottom = asNumber(handValue(row, '换层累计孔深_m', issues), c['换层累计孔深_m'], issues, true);
    const top = layerTop;
    if (bottom != null && bottom <= top) issues.push(issue('error', 'INVALID_INTERVAL', '换层累计孔深必须大于上一条手填边界', [c['换层累计孔深_m']]));
    if (bottom != null && endpoint != null && bottom > endpoint + 1e-6) issues.push(issue('error', 'INTERVAL_OUT_OF_RANGE', '分层底深超出终孔深度', [c['换层累计孔深_m']]));
    const thickness = bottom == null ? null : bottom - top;
    const core = asNumber(handValue(row, '分层岩心长_m', issues), c['分层岩心长_m'], issues);
    const recordedLayerAdvance = asNumber(handValue(row, '分层进尺_m', issues), c['分层进尺_m'], issues);
    const originalRecovery = asNumber(handValue(row, '分层采取率_pct（原填）', issues), c['分层采取率_pct（原填）'], issues);
    const computedRecoverySource = asNumber(v['分层采取率_pct（计算）'], c['分层采取率_pct（计算）'], issues);
    const previousRow = layers.at(-1)?.source?.row as number | undefined;
    const cells = { ...c, '顶深_m': previousRow ? `${layerSheet.name}!G${previousRow}` : 'derived:first-row-zero', '底深_m': c['换层累计孔深_m'] };
    const sourceDerived = { top_m: { value: top, rule: 'first row 0; subsequent row previous explicit cumulative bottom', source: previousRow ? `${layerSheet.name}!G${previousRow}` : null } };
    layers.push({ id, top_m: top, bottom_m: bottom, thickness_m: thickness, core_m: core,
      recovery_percent: core != null && (isV3 ? recordedLayerAdvance : thickness) != null && (isV3 ? recordedLayerAdvance : thickness)! > 0
        ? core / (isV3 ? recordedLayerAdvance! : thickness!) * 100 : null,
      recovery_original_percent: originalRecovery,
      recovery_raw_percent: originalRecovery,
      recovery_computed_percent_source: computedRecoverySource,
      true_thickness_m_raw: handValue(row, '真厚度_m（原填）', issues), mean_axis_angle_deg: handValue(row, '平均轴夹角_deg', issues),
      description: txt(handValue(row, '调整/说明', issues)), lithology_name: txt(handValue(row, '岩性名称', issues)), material_code: '', pattern_id: null,
      raw_layer_notes: { adjustment: v['调整/说明'] ?? null, stop_run_core_m: v['止回次岩心长_m'] ?? null, source_O_unlabeled: v['原表O列未命名值'] ?? null },
      raw: rawValues(row, ['序号','分层采取率_pct（计算）']),
      source: source(layerSheet.name, row.row, cells, rawValues(row, ['序号','分层采取率_pct（计算）']), formulaMetadata(row), sourceDerived) });
    if (recordedLayerAdvance != null && thickness != null && Math.abs(recordedLayerAdvance - thickness) > 0.01)
      issues.push(issue('warning', 'LAYER_ADVANCE_MISMATCH', '分层进尺与连续底深差值不一致；几何仍按连续底深推导，采取率按表内分层进尺计算', [c['分层进尺_m'], c['换层累计孔深_m']]));
    if (core != null && core < 0) issues.push(issue('error', 'NEGATIVE_CORE_LENGTH', '分层岩心长不能为负数', [c['分层岩心长_m']]));
    if (!txt(v['岩性名称'])) issues.push(issue('warning', 'MISSING_LITHOLOGY', '岩性名称为空，保留空白待补', [c['岩性名称']]));
    if (bottom != null) layerTop = bottom;
  }
  const patternCodes = drillPatterns.codes as Record<string, string>, materialPatterns = drillPatterns.materials as Record<string, string>;
  for (const layer of layers) {
    const materialCode = materialPatterns[layer.lithology_name];
    if (materialCode) { layer.material_code = materialCode; layer.pattern_id = patternCodes[materialCode] ?? null; }
    else issues.push(issue('warning', 'PENDING_PATTERN', `岩性“${layer.lithology_name || '未提供'}”无精确花纹映射，保留留白待配置`, [layer.source.cells['岩性名称']]));
  }
  if (layers.length && endpoint != null && layers.at(-1)?.bottom_m != null && Math.abs(layers.at(-1).bottom_m - endpoint) > 1e-6)
    issues.push(issue('error', 'INCOMPLETE_COVERAGE', `分层必须连续覆盖0至终孔深度；当前末深 ${layers.at(-1).bottom_m} m，终孔 ${endpoint} m`, [layers.at(-1).source.cells['底深_m']]));

  const turnSheet = workbook.sheets.get('回次表')!, turnTable = table(turnSheet, '回次表');
  const turnData = turnTable.rows.filter(row => meaningful(row, turnTable.headers.filter(h => !['序号','回次采取率_pct（计算）','长度核对提示'].includes(h))));
  const turns: any[] = [];
  let turnTop = 0;
  const seenTurns = new Set<string>();
  for (const row of turnData) {
    const v = row.values, c = row.cells, id = txt(handValue(row, '回次号', issues));
    if (!id) issues.push(issue('error', 'MISSING_ID', '回次号不能为空', [c['回次号']]));
    if (id && seenTurns.has(id)) issues.push(issue('error', 'DUPLICATE_ID', `回次号重复：${id}`, [c['回次号']]));
    seenTurns.add(id);
    const bottom = asNumber(handValue(row, '下界记录孔深_m', issues), c['下界记录孔深_m'], issues, true);
    const recordedAdvance = asNumber(handValue(row, '回次进尺_m', issues), c['回次进尺_m'], issues);
    const top = turnTop;
    if (bottom != null && bottom <= top) issues.push(issue('error', 'INVALID_INTERVAL', '回次下界记录孔深必须大于上一条手填边界', [c['下界记录孔深_m']]));
    if (bottom != null && endpoint != null && bottom > endpoint + 1e-6) issues.push(issue('error', 'INTERVAL_OUT_OF_RANGE', '回次底深超出终孔深度', [c['下界记录孔深_m']]));
    const core = asNumber(handValue(row, '处理后岩心长_m（手填）', issues), c['处理后岩心长_m（手填）'], issues);
    const originalRecovery = asNumber(handValue(row, '回次采取率_pct（原填）', issues), c['回次采取率_pct（原填）'], issues);
    const computedRecoverySource = asNumber(v['回次采取率_pct（计算）'], c['回次采取率_pct（计算）'], issues);
    const previousRow = turns.at(-1)?.source?.row as number | undefined;
    const cells = { ...c, ...(previousRow ? { '顶深_m': `${turnSheet.name}!C${previousRow}` } : {}) };
    const advance = top != null && bottom != null ? bottom - top : null;
    if (recordedAdvance != null && advance != null && Math.abs(recordedAdvance - advance) > 0.01) issues.push(issue('warning', 'ROUND_ADVANCE_MISMATCH', isV3
      ? '回次进尺与连续底深差值不一致；几何仍按连续底深推导，采取率按表内回次进尺计算'
      : '回次进尺与连续底深差值不一致；沿用底深推导几何', [c['回次进尺_m'], c['下界记录孔深_m']]));
    if (core != null && core < 0) issues.push(issue('error', 'NEGATIVE_CORE_LENGTH', '处理后岩心长不能为负数', [c['处理后岩心长_m（手填）']]));
    turns.push({ id, top_m: top, bottom_m: bottom, advance_m: advance, core_m: core,
      recovery_percent: core != null && (isV3 ? recordedAdvance : advance) != null && (isV3 ? recordedAdvance : advance)! > 0
        ? core / (isV3 ? recordedAdvance! : advance!) * 100 : null,
      recovery_original_percent: originalRecovery,
      recovery_raw_percent: originalRecovery,
      recovery_computed_percent_source: computedRecoverySource,
      source_metrics: { raw_core_length_m: v['岩心长度_m'] ?? null, raw_recovery_percent: originalRecovery,
        computed_recovery_formula: row.formulas?.['回次采取率_pct（计算）'] ? `=${row.formulas['回次采取率_pct（计算）']}` : null,
        depth_correction_m: v['孔深校正量_m'] ?? null, corrected_bottom_depth_m: v['下界校正孔深_m'] ?? null, rqd_raw: v['RQD_pct（原填）'] ?? null },
      raw: { ...rawValues(row, ['序号','回次采取率_pct（计算）','长度核对提示']), '回次进尺_m（原填）': recordedAdvance },
      source: source(turnSheet.name, row.row, cells, { ...rawValues(row, ['序号','回次采取率_pct（计算）','长度核对提示']), '回次进尺_m（原填）': recordedAdvance }, formulaMetadata(row), {
        top_m: { value: top, rule: 'first row 0; subsequent row previous explicit bottom', source: previousRow ? `${turnSheet.name}!C${previousRow}` : null },
        advance_m: { value: advance, rule: 'bottom_m - top_m' },
      }) });
    if (bottom != null) turnTop = bottom;
  }
  if (turns.length && endpoint != null && turns.at(-1)?.bottom_m != null && Math.abs(turns.at(-1).bottom_m - endpoint) > 1e-6)
    issues.push(issue('error', 'INCOMPLETE_COVERAGE', `回次必须连续覆盖0至终孔深度；当前末深 ${turns.at(-1).bottom_m} m，终孔 ${endpoint} m`, [turns.at(-1).source.cells['底深_m']]));

  const sampleSheet = workbook.sheets.get('采样')!, sampleTable = table(sampleSheet, '采样');
  const sampleData = sampleTable.rows.filter(row => meaningful(row, sampleTable.headers.filter(h => !['序号','采取率_pct（计算）'].includes(h))));
  const samples: any[] = [], sampleById = new Map<string, any>();
  for (const row of sampleData) {
    const v = row.values, c = row.cells, id = txt(handValue(row, '样品编号', issues));
    if (!id) issues.push(issue('error', 'MISSING_ID', '样品编号不能为空', [c['样品编号']]));
    if (id && sampleById.has(id)) issues.push(issue('error', 'DUPLICATE_SAMPLE', `样品编号重复：${id}`, [sampleById.get(id).source.cells['样品编号'], c['样品编号']]));
    const top = asNumber(handValue(row, '孔深自_m', issues), c['孔深自_m'], issues, true), bottom = asNumber(handValue(row, '孔深至_m', issues), c['孔深至_m'], issues, true);
    if (top != null && bottom != null && (top < 0 || bottom <= top || endpoint != null && bottom > endpoint)) issues.push(issue('error', 'INVALID_INTERVAL', '样品孔深区间无效或超出终孔深度', [c['孔深自_m'], c['孔深至_m']]));
    const recordedLength = asNumber(handValue(row, '进尺_m', issues), c['进尺_m'], issues), core = asNumber(handValue(row, '岩心长度_m', issues), c['岩心长度_m'], issues);
    const rowRaw = { ...rawValues(row, ['序号','采取率_pct（计算）']), '进尺_m（原填）': recordedLength };
    const sampleLength = top != null && bottom != null ? bottom - top : null;
    const originalRecovery = asNumber(handValue(row, '采取率_pct（原填）', issues), c['采取率_pct（原填）'], issues);
    const computedRecoverySource = asNumber(v['采取率_pct（计算）'], c['采取率_pct（计算）'], issues);
    if (recordedLength != null && sampleLength != null && Math.abs(recordedLength - sampleLength) > 0.01) issues.push(issue('warning', 'SAMPLE_ADVANCE_MISMATCH', isV3
      ? '样品进尺与深度区间差值不一致；几何仍按深度区间推导，采取率按表内进尺计算'
      : '样品进尺与深度区间差值不一致；沿用深度区间', [c['进尺_m'], c['孔深自_m'], c['孔深至_m']]));
    const sample = { id, top_m: top, bottom_m: bottom, length_m: sampleLength, core_m: core,
      recovery_percent: core != null && (isV3 ? recordedLength : sampleLength) != null && (isV3 ? recordedLength : sampleLength)! > 0
        ? core / (isV3 ? recordedLength! : sampleLength!) * 100 : null,
      recovery_original_percent: originalRecovery,
      recovery_raw_percent: originalRecovery, recovery_computed_percent_source: computedRecoverySource,
      assays: {}, assay_raw: {}, assay_records: [], raw: rowRaw,
      sample_details: { start_round: v['起回次号'] ?? null, start_position_m: v['起位置_m'] ?? null, end_round: v['止回次号'] ?? null,
        end_position_m: v['止位置_m'] ?? null, raw_recovery_percent: originalRecovery, computed_recovery_percent_source: computedRecoverySource,
        weight_value: v['重量数值（原单位未明）'] ?? null, weight_unit: v['重量单位（手填）'] ?? null,
        source_L_unconfirmed: v['原表L列值（含义待确认）'] ?? null, unlabeled_M: v['原表M列未命名值/附加备注'] ?? null, unlabeled_N: v['原表N列未命名值/附加备注'] ?? null },
      source: source(sampleSheet.name, row.row, { ...c, '顶深_m': c['孔深自_m'], '底深_m': c['孔深至_m'] }, rowRaw, formulaMetadata(row)) };
    samples.push(sample); if (id) sampleById.set(id, sample);
  }

  const catalogSheet = workbook.sheets.get('自定义测试项目')!, catalog = rowsByHeader(catalogSheet, '自定义测试项目', 5);
  const analysisItems: any[] = [], byCode = new Map<string, any>();
  for (const row of catalog.rows.filter(r => meaningful(r, catalog.headers))) {
    const v = row.values, c = row.cells, code = txt(handValue(row, '项目代码', issues));
    if (!code) issues.push(issue('error', 'MISSING_ANALYSIS_CODE', '分析项目代码不能为空', [c['项目代码']]));
    if (byCode.has(code)) issues.push(issue('error', 'DUPLICATE_ANALYSIS_CODE', `分析项目代码重复：${code}`, [byCode.get(code).source.cells['项目代码'], c['项目代码']]));
    const showText = txt(handValue(row, '图中显示', issues));
    if (showText && !['是','否'].includes(showText)) issues.push(issue('error', 'INVALID_ANALYSIS_SHOW', '图中显示只能填写“是”或“否”', [c['图中显示']]));
    const itemRaw = rawValues(row);
    const item = { code, name: txt(handValue(row, '项目名称/元素', issues)), unit: txt(handValue(row, '单位', issues)), order: asNumber(handValue(row, '显示顺序', issues), c['显示顺序'], issues) ?? analysisItems.length,
      detection_limit: handValue(row, '检出限', issues) ?? null, method: txt(handValue(row, '分析方法', issues)), show: showText !== '否', notes: txt(handValue(row, '备注', issues)), source: source(catalogSheet.name, row.row, c, itemRaw, formulaMetadata(row)) };
    if (!item.name) issues.push(issue('error', 'MISSING_ANALYSIS_NAME', `分析项目${code || '(空代码)'}缺少名称`, [c['项目名称/元素']]));
    analysisItems.push(item); if (code) byCode.set(code, item);
  }

  const projectUnits: Record<string, string> = Object.fromEntries(analysisItems.map(item => [item.code, item.unit]));
  const resultSheet = workbook.sheets.get('样品测试结果')!, resultTable = table(resultSheet, '样品测试结果'), resultRows = resultTable.rows;
  const seenAssays = new Map<string, string>();
  for (const sample of samples) { sample.assays = Object.fromEntries(analysisItems.map(item => [item.code, null])); sample.assay_raw = Object.fromEntries(analysisItems.map(item => [item.code, ''])); }
  for (const row of resultRows.filter(r => meaningful(r, resultTable.headers))) {
    const v = row.values, c = row.cells, sampleId = txt(handValue(row, '样品编号', issues)), code = txt(handValue(row, '项目代码', issues));
    if (!sampleId || !sampleById.has(sampleId)) { issues.push(issue('error', 'UNKNOWN_SAMPLE', `测试结果引用了未知样品：${sampleId || '空样品编号'}`, [c['样品编号']])); continue; }
    const item = byCode.get(code);
    if (!code || !item) { issues.push(issue('error', 'UNKNOWN_ANALYSIS_CODE', `测试结果引用了未知分析项目：${code || '空项目代码'}`, [c['项目代码']])); continue; }
    const key = `${sampleId}\0${code}`;
    if (seenAssays.has(key)) issues.push(issue('error', 'DUPLICATE_SAMPLE_ANALYSIS', `样品${sampleId}的项目${code}重复`, [seenAssays.get(key)!, c['项目代码']]));
    seenAssays.set(key, c['项目代码']);
    const resultUnit = txt(handValue(row, '单位', issues));
    if (item.unit && resultUnit && item.unit !== resultUnit) issues.push(issue('error', 'ANALYSIS_UNIT_CONFLICT', `项目${code}单位“${resultUnit}”与项目表单位“${item.unit}”冲突`, [c['单位'], item.source.cells['单位']]));
    if (!item.unit && resultUnit) item.unit = projectUnits[code] = resultUnit;
    else if (!item.unit && !resultUnit && !blank(handValue(row, '数值结果（可空）', issues))) issues.push(issue('error', 'MISSING_ANALYSIS_UNIT', `项目${code}有数值结果但未填写单位`, [c['单位']]));
    const numeric = asNumber(handValue(row, '数值结果（可空）', issues), c['数值结果（可空）'], issues);
    const rawValue = handValue(row, '结果原文', issues), rawText = isSet(rawValue) ? String(rawValue) : null;
    const sampleRecord = sampleById.get(sampleId);
    sampleRecord.assays[code] = numeric;
    sampleRecord.assay_raw[code] = rawText ?? '';
    const rowRaw = rawValues(row);
    sampleRecord.assay_records.push({ code, result_raw: rawText, value: numeric, flag: txt(handValue(row, '结果标记', issues)), unit: resultUnit,
      detection_limit: handValue(row, '检出限', issues) ?? null, method: txt(handValue(row, '分析方法', issues)), test_date: handValue(row, '检测日期', issues) ?? null, report_number: txt(handValue(row, '报告编号', issues)), notes: txt(handValue(row, '备注', issues)),
      source: source(resultSheet.name, row.row, c, rowRaw, formulaMetadata(row)) });
  }
  // A raw qualifier such as <0.1 remains text and never becomes an assay value.
  for (const sample of samples) for (const item of analysisItems) {
    const raw = sample.assay_raw[item.code];
    if (typeof raw === 'string' && /<|检出|低于/.test(raw) && sample.assays[item.code] == null) continue;
  }

  const depthSheet = workbook.sheets.get('孔深校正及弯曲度')!;
  const depthRows = rowsByHeader(depthSheet, depthSheet.name, 7).rows.filter(row => row.row >= 8 && row.row < 27);
  const depthFieldLabels = ['记录孔深_m','校测孔深_m','误差_m','误差率_pct','测量孔深_m','测量天顶角_deg','实测方位角_deg','测量方法','测量仪器'];
  const depthRecords: any[] = [];
  for (const row of depthRows.filter(r => meaningful(r, depthFieldLabels))) {
    const sequenceAddress = `A${row.row}`, sequenceFormula = formulaAt(depthSheet, sequenceAddress);
    const rawSequence = sequenceFormula ? null : valAt(depthSheet, sequenceAddress);
    const recorded = asNumber(handValue(row, '记录孔深_m', issues), row.cells['记录孔深_m'], issues, false);
    const seq = rawSequence == null ? depthRecords.length + 1 : txt(rawSequence);
    if (blank(rawSequence)) issues.push(issue('warning', 'DERIVED_DEPTH_SEQUENCE', '测点序号由记录顺序生成；模板公式不执行', [sequenceFormula ? `${depthSheet.name}!${sequenceAddress}` : row.cells['记录孔深_m']]));
    const raw = { 序号: rawSequence, ...rawValues(row) };
    const cells = { 序号: `${depthSheet.name}!${sequenceAddress}`, ...row.cells };
    const sourceObj = source(depthSheet.name, row.row, cells, raw, { ...(sequenceFormula ? { 序号: { cell: `${depthSheet.name}!${sequenceAddress}`, formula: sequenceFormula } } : {}), ...formulaMetadata(row) }, sequenceFormula ? { sequence: { value: seq, rule: 'sequential_order_when_template_formula_has_no_cached_value' } } : undefined);
    depthRecords.push({ sequence: seq, recorded_depth_m: recorded, checked_depth_m: asNumber(handValue(row, '校测孔深_m', issues), row.cells['校测孔深_m'], issues),
      error_m: asNumber(handValue(row, '误差_m', issues), row.cells['误差_m'], issues), error_percent: asNumber(handValue(row, '误差率_pct', issues), row.cells['误差率_pct'], issues),
      measurement_depth_m: asNumber(handValue(row, '测量孔深_m', issues), row.cells['测量孔深_m'], issues), zenith_deg: asNumber(handValue(row, '测量天顶角_deg', issues), row.cells['测量天顶角_deg'], issues),
      azimuth_deg: asNumber(handValue(row, '实测方位角_deg', issues), row.cells['实测方位角_deg'], issues), method: txt(handValue(row, '测量方法', issues)), instrument: txt(handValue(row, '测量仪器', issues)), source: sourceObj,
      derived: sequenceFormula ? { sequence: { value: seq, rule: 'sequential_order_when_template_formula_has_no_cached_value' } } : undefined });
  }
  const summaryLabels = ['应测次数','实测次数','超差次数','应测次数','实测次数','超差次数'];
  const summaryAddresses = ['B29','D29','F29','H29','J29','L29'];
  const summaryKeys = ['应测次数','实测次数','超差次数','弯曲度应测次数','弯曲度实测次数','弯曲度超差次数'];
  const depthSummary: Record<string, unknown> = {};
  summaryKeys.forEach((key, i) => {
    const address = summaryAddresses[i], labelCell = ['A28','C28','E28','G28','I28','K28'][i];
    const value = valAt(depthSheet, address), formula = formulaAt(depthSheet, address);
    depthSummary[key] = { value, formula: formula ?? null, source: `${depthSheet.name}!${address}`, label_source: `${depthSheet.name}!${labelCell}`, label: summaryLabels[i] };
  });
  const signatures: Record<string, unknown> = {};
  for (const [key, address] of Object.entries({ 记录人: 'B30', 记录日期: 'E30', 检查人: 'H30', 检查日期: 'K30' })) signatures[key] = { value: valAt(depthSheet, address), source: `${depthSheet.name}!${address}` };

  const titleSheet = workbook.sheets.get('图签')!;
  const titleMap: Record<string, [string, string]> = {
    '项目/单位': ['A4','B4'], 图名: ['A5','B5'], 拟编: ['A6','B6'], 审核: ['C6','D6'], 制图: ['A7','B7'], 项目负责: ['C7','D7'],
    单位负责: ['A8','B8'], 图号: ['C8','D8'], 顺序号: ['A9','B9'], 比例尺分母: ['C9','D9'], 日期: ['A10','B10'], 资料来源: ['C10','D10'],
  };
  const titleFields: Record<string, unknown> = {}, titleCells: Record<string, string> = {};
  for (const [label, [labelAddress, valueAddress]] of Object.entries(titleMap)) {
    const value = valueCell(titleSheet, valueAddress, issues);
    titleFields[label] = value; titleCells[label] = `${titleSheet.name}!${valueAddress}`;
  }
  const settingRows: any[] = [];
  for (let row = 15; row <= 18; row++) {
    const cells: Record<string, string> = Object.fromEntries(['A','B','C','D','E'].map(col => [col, `${titleSheet.name}!${col}${row}`]));
    const values = Object.fromEntries(['A','B','C','D','E'].map(col => [col, valAt(titleSheet, `${col}${row}`)]));
    if (Object.values(values).some(isSet)) settingRows.push({ layout_item: values.A, width_mm: values.B, height_mm: values.C, order: values.D, description: values.E, source: { sheet: titleSheet.name, row, cells, raw: values } });
  }
  const widthFormula = formulaAt(titleSheet, 'B19');
  const titleBlock = { fields: titleFields, settings: settingRows, settings_summary: {
    reference_total_width_mm: valAt(titleSheet, 'B19'), reference_total_width_formula: widthFormula ?? null,
    row_height_mm: valAt(titleSheet, 'D19'), source_cells: { reference_total_width_mm: `${titleSheet.name}!B19`, row_height_mm: `${titleSheet.name}!D19` },
  }, source_cells: titleCells };

  const synthesisSheet = workbook.sheets.get('分层-地质综合')!;
  const synthesisTable = table(synthesisSheet, '分层-地质综合');
  const synthesisRows = synthesisTable.rows.filter(row => meaningful(row, synthesisTable.headers.filter(h => h !== '序号'))).map(row => ({
    sheet: synthesisSheet.name, row: row.row, cells: row.cells, raw: rawValues(row, ['序号']), ...(Object.keys(formulaMetadata(row)).length ? { formulas: formulaMetadata(row) } : {}),
  }));
  if (synthesisRows.length) issues.push(issue('warning', 'SYNTHESIS_NOT_DRAWN', '分层-地质综合是独立人工汇总页；当前绘图仅取分层-原始记录，不会覆盖或融合本页', [`分层-地质综合!B6:K${synthesisRows.at(-1)!.row}`]));

  includeErrors(issues);
  samples.sort((a, b) => (a.top_m ?? 0) - (b.top_m ?? 0) || txt(a.id).localeCompare(txt(b.id)));
  analysisItems.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const summary = { turns: turns.length, layers: layers.length, samples: samples.length, endpoint_m: endpoint, pending_patterns: layers.filter(layer => !layer.material_code).length };
  const normalized = {
    drawing_type: 'drill', schema_version: 'drill-integrated-1.0', template_version: templateVersion,
    source: { filename: workbook.filename, sha256: workbook.sha256, adapter: 'drill-integrated-1.0', template_version: templateVersion },
    project: { name: projectName, hole_id: holeId, analysis_units: projectUnits, analysis_items: analysisItems, source_cells: basicInfo.source_cells },
    meta: { hole_id: holeId, endpoint_m: endpoint, depth_basis: txt((basicInfo.fields as any).孔深基准) }, basic_info: basicInfo,
    analysis_items: analysisItems, depth_measurements: { records: depthRecords, summary: depthSummary, signatures }, title_block: titleBlock,
    turns, layers, samples, structures: [], source_tables: { '分层-地质综合': synthesisRows }, issues, summary,
  };
  return { normalized, issues };
}
